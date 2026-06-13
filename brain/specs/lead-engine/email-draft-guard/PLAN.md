---
domain: lead-engine
type: plan
spec: email-draft-guard
links:
  - "[[specs/lead-engine/email-draft-guard/SPEC|email-draft-guard]]"
  - "[[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]"
created: 2026-06-13
updated: 2026-06-13
---

# PLAN — Niente bozza email senza indirizzo (`email-draft-guard`)

**Status:** Complete
**Execution mode (suggerito):** `sequential` — catena lineare T1 → T2 → T3, write-scope condiviso, nessuna parallelizzazione utile.

---

## 1. Situazione iniziale

Nel run giornaliero (`runDaily()`, `src/pipeline/run.ts`) le bozze email vengono generate con
**Sonnet** (`config.emailModel = claude-sonnet-4-6`) per **tutti** i 40 selezionati, via
`draftMany(selectedRows)` (`src/pipeline/run.ts:179`). `draftMany`/`draftOne`
(`src/email/draft.ts`) **non** controllano `contact.email` prima di invocare il modello.

Molti profili escono dall'enrichment senza email (campo best-effort): oggi il sistema paga una
chiamata Sonnet per produrre una bozza che non potrà mai essere inviata.

Entrambi i canali di lancio convergono sullo stesso punto:
- CLI → `src/cli.ts:51` → `runDaily()`
- Web UI → `src/server/run-daily-job.ts:10` → `runDaily()`

Quindi **un guard dentro `draftMany` copre automaticamente CLI e UI**.

## 2. Problema

Spreco di chiamate Sonnet su contatti senza email (tetto ~40 bozze/giorno → risparmio
proporzionale ai selezionati senza email). Intervento di **sola ottimizzazione costi**, minimale.

## 3. Forma della soluzione

Guard nel motore (`draftMany`, Opzione A):

1. Predicato puro `hasEmail(email)` in `src/util/fields.ts` — definizione unica di "senza email"
   (`null` | `''` | solo spazi).
2. `draftMany` salta `draftOne` (= la chiamata Sonnet) per i contatti senza email e ritorna un
   risultato `{ id, skipped: true }` (niente `draft`, niente `error`). Il tipo di ritorno guadagna
   un campo opzionale `skipped?: boolean`.
3. `runDaily` riconosce i risultati `skipped` (niente warning spurio) e logga il conteggio dei
   saltati. Nessun `updateEmail` per i saltati → `email_subject`/`email_body` restano vuoti, come
   per una bozza fallita.

Il contatto senza email **resta** in selezione ed export con colonne email vuote: nessuna
rimozione, nessuna riclassificazione (quello è scope della spec #3).

## 4. Decision ledger (risolto)

| Decisione | Esito | Rationale |
|-----------|-------|-----------|
| Confine spec #2 / #3 (Open Question #1 della SPEC) | **Defer a #3**: solo skip della bozza, nessun flag/colonna/riclassificazione | Mantiene #2 minimale e a basso rischio; la segmentazione è responsabilità della #3 (vedi `email-segmentation-filters`) |
| Osservabilità dei saltati | **Riga di log** con conteggio in `runDaily`; nessuna telemetria/colonna DB nuova | "log o telemetria" basta; coerente con il logging già presente nel run; catturata sia su stdout CLI sia nell'output del job UI |
| Posizionamento del guard | **Dentro `draftMany`** (Opzione A) | Chokepoint unico (CLI+UI), proprietà del motore, testabile in isolamento e a costo zero senza rete |
| Posizione di `hasEmail` | `src/util/fields.ts` | Puro predicato di presenza accanto a `truncate`/`normalizeLinkedinUrl`; riutilizzabile dalla #3 senza essere segmentazione |
| Definizione "senza email" | `null` \| `''` \| solo whitespace (`.trim() === ''`) | Da SPEC; nessuna validazione di sintassi |
| `getStats().withEmail` (SQL `email IS NOT NULL AND email <> ''`) | **Non toccato** | Fuori scope; layer diverso (query stats), edge whitespace trascurabile lì |

## 5. Assunzioni e vincoli

- Best-effort: il guard non introduce nuovi punti di fallimento; isolamento per-contatto di
  `draftMany` preservato (un saltato non blocca gli altri).
- Nessun cambio a modello, prompt, formato bozze, selezione o export.
- L'unico consumatore di `draftMany` è `runDaily` → aggiungere `skipped?` al tipo di ritorno è
  sicuro e localizzato.
- Test deterministici: niente dipendenza dalla presenza/assenza reale di `ANTHROPIC_API_KEY`
  (vedi Testing strategy).

## 6. Findings dal codice

- `src/email/draft.ts`
  - `draftOne(contact)` → `client()` → `requireAnthropic()` (throw se manca la key) → `messages.create` (Sonnet).
  - `draftMany(contacts)` → `pLimit(config.scoringConcurrency)`, map per-contatto, ritorna
    `Array<{ id; draft?; error? }>` con `try/catch` per isolamento.
- `src/pipeline/run.ts:177-183` — unico consumatore:
  ```ts
  const drafts = await draftMany(selectedRows);
  for (const d of drafts) {
    if (d.draft) updateEmail(d.id, d.draft.subject, d.draft.body);
    else log(`    ⚠️  email id=${d.id}: ${d.error}`);
  }
  ```
  ⚠️ **Attenzione**: senza modifica, un risultato `{ id, skipped: true }` (né `draft` né `error`)
  cadrebbe nel ramo `else` e produrrebbe `⚠️ email id=X: undefined`. T3 deve gestire `skipped`
  **prima** del ramo d'errore.
- `src/util/fields.ts` — utility pure (`field`, `normalizeLinkedinUrl`, `truncate`); home naturale di `hasEmail`.
- `src/db/contacts.ts` — `ContactRow.email: string | null`.
- Test harness: `vitest`, `tests/setup.ts` (temp `DB_PATH`), import dinamici. Nessun test esistente
  su `draft.ts`; nessun precedente di mock dell'SDK Anthropic.
- `draftOne` parsa la risposta come `content.find(b => b.type==='tool_use').input` validato
  `{subject, body}` con zod — forma da replicare nel mock.

## 7. Ricerca esterna

Nessuna. Comportamento interamente locale; nessuna nuova API/libreria.

## 8. Dependency graph & waves

```
T1 (hasEmail)  →  T2 (guard in draftMany)  →  T3 (runDaily: skip-aware + log)
```

- **Wave 1:** T1
- **Wave 2:** T2 (consuma `hasEmail`)
- **Wave 3:** T3 (consuma il flag `skipped`)

Catena lineare: ogni task usa l'artefatto del precedente, write-scope su file diversi ma
concettualmente accoppiati → esecuzione **sequenziale**.

## 9. Testing strategy

- **T1:** unit test puro su `hasEmail` (no DB, no rete).
- **T2:** test su `draftMany` **hermetic**, che mocca `@anthropic-ai/sdk`. Tre accortezze di harness
  (altrimenti il RED fallisce "per il motivo sbagliato" — throw del costruttore o `requireAnthropic`
  invece dell'asserzione su call-count):
  1. **Key fittizia a import-time, non nel body del test.** `config.anthropicApiKey` è letto **una
     sola volta** all'import di `src/config.ts` (riga 16) → un assegnamento nel corpo del test arriva
     troppo tardi. Aggiungere in `tests/setup.ts` (accanto a `DB_PATH`, stesso motivo import-time):
     `process.env.ANTHROPIC_API_KEY = 'test-key';` — deterministico e maschera l'eventuale key del
     `.env` locale (i test non devono mai chiamare l'API reale). Senza questo, su CI/clone senza
     `.env` il test esplode in `requireAnthropic()` prima di raggiungere il mock.
  2. **Mock del default export come classe-costruttore** (il codice fa `new Anthropic(...)`), con
     handle via `vi.hoisted` per poter asserire sul call-count:
     ```ts
     const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
     vi.mock('@anthropic-ai/sdk', () => ({
       default: class { messages = { create: createMock }; },
     }));
     // nel test: createMock.mockResolvedValue({
     //   content: [{ type: 'tool_use', input: { subject: 'S', body: 'B' } }],
     // });
     ```
     (La forma della risposta combacia con ciò che `draftOne` parsa: `content.find(type==='tool_use').input` → zod `{subject, body}`.)
  3. **File di test isolato + `vi.mock` hoisted sopra ogni import di `draft.ts`.** `_client` è un
     singleton di modulo (`draft.ts:8`): in un file dedicato con isolamento per-file di vitest il
     mock viene applicato prima della prima `client()`. Tenere il describe `draftMany` nello stesso
     file `tests/email-draft-guard.test.ts` va bene (nessun altro file istanzia il client).
  - batch misto: contatti con email + senza email (`null`, `''`, `'   '`).
  - asserzioni GREEN: `createMock` chiamato **una sola volta** (solo il contatto con email);
    i contatti senza email → `{ skipped: true }`, `draft` undefined, `error` undefined;
    il contatto con email → `draft` presente.
  - RED (pre-fix): `createMock` verrebbe chiamato 3 volte e i senza-email non avrebbero `skipped` →
    asserzioni su call-count e su `skipped` falliscono (per il motivo giusto).
- **T3:** `runDaily` non è esercitabile offline (Apify + Anthropic end-to-end). La fonte del
  conteggio (`skipped`) è già coperta da T2. Validazione: `npm run typecheck` + ispezione del
  ramo `skipped` nel loop e della riga di log. Documentato onestamente: la stringa di log non è
  unit-testata, ma il dato che riassume sì.
- **Sanity gate per ogni task:** `npm run typecheck` e `npm test`.

## 10. Rischi & mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Risultato `skipped` cade nel ramo `else` di `runDaily` → `⚠️ email id=X: undefined` | T3 gestisce `skipped` prima del ramo d'errore (vedi Findings) |
| Cambio del tipo di ritorno di `draftMany` rompe consumatori | Unico consumatore è `runDaily`, aggiornato in T3; `skipped?` opzionale e additivo |
| Test fragile rispetto a `ANTHROPIC_API_KEY` nel `.env` locale | Mock dell'SDK + key fittizia in T2 → deterministico, nessuna rete |
| `hasEmail` percepito come anticipo della segmentazione #3 | È un puro predicato di presenza, nessun cambio al data model/stato; documentato nel ledger |

## 11. Validation gates

- Dopo T1: `npm test` (test `hasEmail` verde) + `npm run typecheck`.
- Dopo T2: `npm test` (test `draftMany` verde, RED→GREEN dimostrato) + `npm run typecheck`.
- Dopo T3: `npm run typecheck` + re-read degli Acceptance Criteria della SPEC + ispezione del log.

## 12. Domande aperte

Nessuna. Open Question #1 della SPEC risolta (defer a #3) — vedi Decision ledger.

---

## Tasks

### T1: Predicato `hasEmail` (definizione unica di "senza email")

- **depends_on**: []
- **location**: src/util/fields.ts
- **description**: Aggiungere `export function hasEmail(email: string | null | undefined): boolean` che ritorna `false` per `null`/`undefined`/`''`/stringa di soli spazi (`.trim() === ''`) e `true` altrimenti. Nessuna validazione di sintassi.
- **validation**: `npm test` — nuovo test unit su `hasEmail` verde; `npm run typecheck` pulito.
- **status**: Done
- **log**: RED (`hasEmail is not a function`) → impl `hasEmail` in fields.ts (`typeof === 'string' && trim() !== ''`) → GREEN (2/2). Typecheck pulito.
- **files edited/created**: `src/util/fields.ts` (edit), `tests/email-draft-guard.test.ts` (create — describe `hasEmail`)
- **backlog_item_id**: email-draft-guard
- **backlog_item_url**: brain/specs/lead-engine/email-draft-guard/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: `hasEmail(null) === false`, `hasEmail('') === false`, `hasEmail('   ') === false`, `hasEmail('a@b.com') === true`. RED: la funzione non esiste ancora (import fallisce).
- **review_mode**: cli

### T2: Guard dentro `draftMany` (salta Sonnet senza email)

- **depends_on**: [T1]
- **location**: src/email/draft.ts
- **description**: In `draftMany`, prima di chiamare `draftOne`, se `!hasEmail(c.email)` ritornare `{ id: c.id, skipped: true }` senza invocare il modello. Estendere il tipo di ritorno a `Array<{ id: number; draft?: EmailDraft; error?: string; skipped?: boolean }>`. Importare `hasEmail` da `../util/fields.js`. Isolamento per-contatto invariato.
- **validation**: `npm test` — test hermetic su `draftMany` verde (RED→GREEN); `npm run typecheck` pulito.
- **status**: Done
- **log**: dummy key in setup.ts; test con `vi.hoisted`+`vi.mock` default-export classe. RED giusto (`createMock` chiamato 4× invece di 1×) → guard `if (!hasEmail(c.email)) return { id, skipped: true }` + tipo di ritorno esteso con `skipped?` → GREEN (3/3, `createMock` 1×). Typecheck pulito.
- **files edited/created**: `src/email/draft.ts` (edit), `tests/email-draft-guard.test.ts` (edit — describe `draftMany`, con `vi.hoisted` + `vi.mock('@anthropic-ai/sdk')` default-export classe), `tests/setup.ts` (edit — `process.env.ANTHROPIC_API_KEY = 'test-key'` per determinismo a import-time)
- **backlog_item_id**: email-draft-guard
- **backlog_item_url**: brain/specs/lead-engine/email-draft-guard/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: con `@anthropic-ai/sdk` moccato (default export come classe con `messages.create` via `vi.hoisted`) e key fittizia impostata in `tests/setup.ts`, `draftMany([conEmail, {email:null}, {email:'   '}])` chiama `createMock` **esattamente una volta** (solo `conEmail`); i contatti senza email ritornano `{ skipped: true }` con `draft`/`error` undefined. RED: pre-fix `createMock` chiamato 3 volte e nessun `skipped`. Vedi §9 per le 3 accortezze di harness.
- **review_mode**: cli

### T3: `runDaily` skip-aware + log del conteggio

- **depends_on**: [T2]
- **location**: src/pipeline/run.ts
- **description**: Nel loop su `drafts` gestire il caso `skipped` **prima** del ramo d'errore (nessun `updateEmail`, nessun warning). Dopo il loop, contare i saltati e loggare una riga (es. `→ N bozze saltate (contatto senza email)`) solo se `N > 0`. Nessun'altra modifica a selezione/export.
- **validation**: `npm run typecheck` pulito; ispezione: ramo `skipped` presente prima dell'`else`, riga di log condizionata; re-read Acceptance Criteria SPEC. (`runDaily` non è esercitabile offline; la fonte del conteggio è coperta da T2.)
- **status**: Done
- **log**: loop → `else if (!d.skipped)` (niente warning spurio `undefined` per i saltati); conteggio `drafts.filter(d => d.skipped).length` + riga di log condizionata a `> 0`. Typecheck pulito; suite completa 18/18 verde. Log line validata per ispezione (runDaily non offline).
- **files edited/created**: `src/pipeline/run.ts` (edit)
- **backlog_item_id**: email-draft-guard
- **backlog_item_url**: brain/specs/lead-engine/email-draft-guard/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: un risultato `{ skipped: true }` NON deve produrre `⚠️ email id=X: undefined` né chiamare `updateEmail`; quando esistono saltati, il run logga il loro conteggio. (Verificato via typecheck + ispezione; comportamento del flag già coperto da T2.)
- **review_mode**: cli

---

## Backlog sync

Nessun tracker esterno (Linear/GitHub Issues) è cablato per questo flusso: la "backlog" del dominio
sono le spec in `brain/specs/lead-engine/`, indicizzate in
[[specs/lead-engine/lead-engine-specs|lead-engine-specs]]. L'epic è questa SPEC; i task puntano ad
essa via `backlog_item_id: email-draft-guard`. Nessun item creato/modificato.
