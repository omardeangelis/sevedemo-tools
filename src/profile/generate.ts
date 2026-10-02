import type Anthropic from '@anthropic-ai/sdk';
import { anthropicConfigError, modelErrorText, responseText, type AnalysisClient, type AnalysisResponse } from '../analysis/analyze.js';
import { jsonFromText } from '../analysis/schema.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from '../db/profile.js';
import { listServices } from '../db/services.js';
import { currentRunId, runLog } from '../runs/log.js';
import { serviceNameKey } from '../util/fields.js';
import { LooseProposalSchema, PROPOSAL_JSON_SCHEMA, PROPOSAL_MAX_SERVICES, type LooseProposal } from './schema.js';
import { isGenerationSource, type GenerationSource, type SourceOutcome } from './sources.js';

/*
 * Elaborazione delle fonti lette e proposta salvata (own-profile-services T26: E1, E2, E5, E6, E11, E13). Il modello
 * è `PROFILE_MODEL` (default quello dell'analisi, G-3). La risposta valida diventa **una** riga di `profile_proposals`
 * che sostituisce la pendente (E11) e non tocca nessun valore del profilo né dei servizi (E1). Una risposta che non
 * rispetta la forma, anche al secondo tentativo, fa fallire il job con un errore leggibile: mai un profilo a metà.
 */

const PROFILE_MAX_TOKENS = 16_000;
/** Attesa massima del modello, tentativi compresi: le fonti possono essere lunghe. */
const PROFILE_TIMEOUT_MS = 180_000;

export interface ProposedValue {
  value: string;
  sources: GenerationSource[];
}

export interface ProposedService {
  name: string;
  description: string | null;
  audience: string | null;
  problem: string | null;
  proof: string | null;
  sources: GenerationSource[];
}

/** Perché una voce non è entrata (E2, E6): contata nell'esito e salvata con la proposta. */
export type DiscardReason = 'no_source' | 'duplicate' | 'not_generable' | 'too_many';

export interface DiscardedItem {
  kind: 'field' | 'service';
  name: string;
  reason: DiscardReason;
}

export interface ProposalDraft {
  fields: Partial<Record<ProfileFieldKey, ProposedValue>>;
  services: ProposedService[];
  discarded: DiscardedItem[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SOURCE_TAGS: Record<GenerationSource, string> = { linkedin: 'profilo_linkedin', website: 'sito', posts: 'post' };

const SYSTEM = [
  "Sei l'assistente del CRM personale di un professionista che vende servizi, spesso un freelance. Dalle sue superfici",
  'pubbliche — profilo LinkedIn, sito, post — ricavi una proposta del suo profilo e dei suoi servizi, che lui rivedrà',
  'voce per voce prima di applicarla.',
  '',
  'Regole:',
  '- Scrivi in italiano, asciutto e concreto, con le sue parole quando le fonti le usano.',
  '- Usa solo ciò che le fonti dicono: nessun numero, cliente o risultato che non compaia nelle fonti.',
  '- Ogni voce cita le fonti da cui deriva (linkedin, website, posts). Se nessuna fonte sostiene una voce, lasciala a',
  "  null o fuori dall'elenco.",
  `- Un servizio per voce, dal più importante, al massimo ${PROPOSAL_MAX_SERVICES}. Se l'utente ha già scritto un`,
  '  servizio che descrivi, usa lo stesso nome.',
  "- Non proporre l'indirizzo del profilo LinkedIn né quello del sito: sono già noti.",
].join('\n');

const JSON_ONLY = `\n\nRispondi solo con un oggetto JSON conforme a questo JSON Schema, senza testo attorno:\n${JSON.stringify(PROPOSAL_JSON_SCHEMA)}`;

interface ProfileInput {
  system: string;
  user: string;
}

/** Prompt dalle fonti che hanno dato contenuto e dai nomi dei servizi già scritti (per riconoscerli, E4). */
function buildProfileInput(outcomes: readonly SourceOutcome[], opts: { jsonOnly: boolean }): ProfileInput {
  const blocks = outcomes
    .filter((o) => o.content)
    .map((o) => {
      const tag = SOURCE_TAGS[o.kind];
      const read = o.readAt ? ` letto="${o.readAt.slice(0, 10)}"` : '';
      return `<${tag}${read}>\n${o.content}\n</${tag}>`;
    });
  const services = listServices().map((s) => `- ${s.name}`);
  const user = [
    'Fonti lette, una per tag:',
    '',
    blocks.join('\n\n'),
    '',
    services.length > 0
      ? `Servizi già scritti dall'utente (usa lo stesso nome se descrivi lo stesso servizio):\n${services.join('\n')}`
      : "L'utente non ha ancora scritto nessun servizio.",
    '',
    'Proponi il profilo e i servizi.',
  ].join('\n');
  return { system: opts.jsonOnly ? SYSTEM + JSON_ONLY : SYSTEM, user };
}

// ---------------------------------------------------------------------------
// Voci della risposta (E2, E5, E6)
// ---------------------------------------------------------------------------

/** Fonti citate che sono state davvero lette in questa generazione, senza doppioni. */
function citedSources(sources: readonly string[], read: ReadonlySet<GenerationSource>): GenerationSource[] {
  return [...new Set(sources.filter((s): s is GenerationSource => isGenerationSource(s) && read.has(s)))];
}

/** Dalla risposta letta alla bozza: le voci fuori regola si scartano e si contano, le altre restano nell'ordine. */
function draftOf(response: LooseProposal, read: ReadonlySet<GenerationSource>): ProposalDraft {
  const draft: ProposalDraft = { fields: {}, services: [], discarded: [] };
  for (const [name, proposed] of Object.entries(response.fields)) {
    if (proposed === null) continue;
    if (!(PROFILE_FIELD_KEYS as readonly string[]).includes(name)) {
      draft.discarded.push({ kind: 'field', name, reason: 'not_generable' });
      continue;
    }
    const sources = citedSources(proposed.sources, read);
    if (sources.length === 0) draft.discarded.push({ kind: 'field', name, reason: 'no_source' });
    else draft.fields[name as ProfileFieldKey] = { value: proposed.value, sources };
  }
  const seen = new Set<string>();
  for (const s of response.services) {
    const sources = citedSources(s.sources, read);
    const key = serviceNameKey(s.name);
    const reason: DiscardReason | null =
      sources.length === 0 ? 'no_source' : seen.has(key) ? 'duplicate' : draft.services.length >= PROPOSAL_MAX_SERVICES ? 'too_many' : null;
    if (reason) {
      draft.discarded.push({ kind: 'service', name: s.name, reason });
      continue;
    }
    seen.add(key);
    draft.services.push({
      name: s.name,
      description: s.description || null,
      audience: s.audience || null,
      problem: s.problem || null,
      proof: s.proof || null,
      sources,
    });
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Chiamata al modello
// ---------------------------------------------------------------------------

/**
 * Elabora le fonti: due tentativi entro un'unica attesa, il secondo con il motivo per cui il primo non andava. Lancia
 * `config:` per la chiave mancante o rifiutata e `actor:<modello>:` per il resto: conta per Anthropic (J4).
 */
export async function proposeProfile(
  client: AnalysisClient,
  outcomes: readonly SourceOutcome[],
): Promise<{ draft: ProposalDraft; model: string }> {
  const model = config.profileModel;
  const fail = (text: string) => new Error(`actor:${model}: ${text}`);
  const input = buildProfileInput(outcomes, { jsonOnly: !config.analysisStructured });
  const read = new Set(outcomes.filter((o) => o.content).map((o) => o.kind));
  const signal = AbortSignal.timeout(PROFILE_TIMEOUT_MS);
  let lastIssue = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const user =
      attempt === 1
        ? input.user
        : `${input.user}\n\nNota: la risposta precedente non era valida (${lastIssue}). Rispetta esattamente il formato richiesto.`;
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: PROFILE_MAX_TOKENS,
      system: input.system,
      messages: [{ role: 'user', content: user }],
      ...(config.analysisStructured ? { output_config: { format: { type: 'json_schema', schema: PROPOSAL_JSON_SCHEMA } } } : {}),
    };

    let response: AnalysisResponse;
    try {
      response = await client.messages.create(body, { signal });
    } catch (err) {
      const configError = anthropicConfigError(err, model);
      if (configError) throw new Error(configError);
      if (signal.aborted) throw fail(`Nessuna risposta dal modello entro ${PROFILE_TIMEOUT_MS / 1000} s. Riprova tra poco.`);
      throw fail(`Chiamata al modello non riuscita: ${modelErrorText(err)}`);
    }

    if (response.stop_reason === 'refusal') throw fail('Il modello ha rifiutato di elaborare le fonti: nessuna proposta creata.');
    if (response.stop_reason === 'max_tokens') {
      throw fail('Risposta del modello troncata (limite di token raggiunto): nessuna proposta creata. Riprova.');
    }
    const json = jsonFromText(responseText(response));
    const parsed = LooseProposalSchema.safeParse(json);
    if (parsed.success) return { draft: draftOf(parsed.data, read), model };
    lastIssue =
      json === undefined
        ? 'la risposta non è JSON valido'
        : parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.') || '(radice)'}: ${i.message}`)
            .join('; ');
    runLog.warn(`Anthropic · risposta non valida (tentativo ${attempt} di 2)`);
  }
  throw fail('Il modello ha risposto in una forma inattesa: nessuna proposta creata. Riprova.');
}

// ---------------------------------------------------------------------------
// Proposta salvata
// ---------------------------------------------------------------------------

/**
 * Salva la proposta al posto della pendente (E11), con l'esito di ogni fonte alla generazione e le voci scartate.
 * Nessun valore del profilo né dei servizi cambia (E1). Restituisce l'id della riga.
 */
export function saveProposal(draft: ProposalDraft, outcomes: readonly SourceOutcome[], model: string): number {
  const sources = outcomes.map((o) => ({ kind: o.kind, outcome: o.outcome, reused: o.reused, read_at: o.readAt, reason: o.reason }));
  return db.transaction(() => {
    db.prepare(`DELETE FROM profile_proposals`).run();
    return Number(
      db
        .prepare(`INSERT INTO profile_proposals (job_id, model, fields, services, sources, discarded) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(currentRunId(), model, JSON.stringify(draft.fields), JSON.stringify(draft.services), JSON.stringify(sources), JSON.stringify(draft.discarded))
        .lastInsertRowid,
    );
  })();
}
