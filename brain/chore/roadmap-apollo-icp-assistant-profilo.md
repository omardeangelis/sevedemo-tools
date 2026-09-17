---
domain: prospect-crm
type: index
links:
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/crm-foundation/PLAN|crm-foundation PLAN]]"
created: 2026-09-16
updated: 2026-09-16
---

# Roadmap — Lookalike Apollo · Assistente ICP · Anagrafica automatica

Piani preliminari per tre capability richieste il 2026-09-16, con i servizi esterni necessari. Sono
materiale di pianificazione (`brain/chore/`): ogni sezione diventa una spec formale con `create-spec`
(`brain/specs/prospect-crm/<nome>/`) prima di scrivere codice. I piani rispettano gli invarianti del
[[domains/prospect-crm/prospect-crm-contract|contract]]: preview prima di ogni spesa, un solo job alla
volta, l'utente decide sempre (niente assegnazioni automatiche a liste/stati), SQLite unica verità,
identità = `linkedin_url` normalizzato, adattamento provider in un solo punto, esito onesto.

## 0. Cosa esiste già e cosa si riusa

| Pezzo | Dove | Riuso |
|---|---|---|
| Registry job + preview uniforme + controller (spawn, wrapper, guard 409) | `src/jobs/*`, `src/server/jobs.ts` | tutti i nuovi job kind |
| Adapter Apify (`profileDetail` no-cookie, `companyEmployees`) | `src/apify/actors.ts` | #3 (profilo proprio), fallback #1 |
| Client Claude iniettato, structured outputs + zod, `ANALYSIS_MODEL` | `src/analysis/*`, `src/jobs/analyze.ts` | #2, #3 |
| `settings` k/v + readiness | `src/db/settings.ts` | #3 (nuove chiavi), #1 (`apollo`) |
| ICP + aziende di riferimento + `companies` | `src/db/icps.ts`, `src/db/companies.ts` | #1, #2 |
| `upsertProspect` / `sources` idempotenti | `src/db/prospects.ts` | #1 (contatti) |
| `JobPreviewDialog`, `ListPicker`, toast, job hooks | `web/src/components`, `web/src/lib/jobs.ts` | tutti |

`APOLLO_API_KEY` è già nel `.env` dell'utente ma **non** è letta da `src/config.ts` né documentata in
`.env.example`/README: il primo task di #1 la porta in `config` (`apolloApiKey`, `requireApollo()`) e
in `readiness.apollo`.

## 1. Lookalike Apollo: aziende simili → contatti

### Obiettivo

Dato un ICP con almeno un'azienda di riferimento e una lista, trovare su Apollo aziende simili alle
referenze, farle vagliare all'utente, e per quelle accettate estrarre le persone che matchano i ruoli
dell'ICP direttamente nella lista. È la capability che il contract chiamava `CompanyLookalikeProvider`
(seam "solo documentato"): qui diventa reale.

### Flusso utente (bozza per il FLOW.md)

1. **Pagina ICP** → nuova card **"Aziende simili (Apollo)"** con CTA **"Trova aziende simili"**.
   Blocker in preview: `APOLLO_API_KEY` mancante; nessuna azienda di riferimento con **sito/dominio**
   (Apollo arricchisce per dominio); nessuna lista attiva per l'ICP.
2. **Dialog di preview** (`JobPreviewDialog`): mostra i **filtri derivati** dalle referenze e
   dall'ICP (settori/keyword, fasce dipendenti, località) **modificabili**, il numero di pagine di
   ricerca (`maxPages`, default 1 = fino a 100 aziende) e i **crediti stimati** (`counts.est_credits`
   = referenze da arricchire + pagine). `est_cost_usd` è `null` salvo `APOLLO_CREDIT_USD` in env
   (il prezzo del credito dipende dal piano: mai inventato).
3. **Job `lookalike_companies`** (fasi): (a) arricchisce le referenze non ancora arricchite
   (`organizations/enrich`, cache in `companies.apollo_json`); (b) deriva i filtri; (c)
   `mixed_companies/search` per pagina, escludendo domini già presenti (referenze, aziende note);
   (d) `upsertCompany` per dominio e/o LinkedIn (unione se già nota con l'altra chiave) + riga in
   `icp_company_candidates` con `status='proposta'` e un punteggio di somiglianza spiegabile
   (sovrapposizione keyword / settore / fascia / paese).
   Esito onesto: "N aziende trovate, M nuove candidate, K già note, J senza pagina LinkedIn (solo
   dominio)".
4. **Sezione "Candidate"** nella pagina ICP: tabella con nome, dominio, settore, dipendenti, sede,
   "perché simile"; azioni **Accetta / Scarta**, bulk su selezione. Le candidate **non** sono aziende
   di riferimento: restano target dell'ICP.
5. **CTA "Trova contatti"** sulle accettate (selezione) → dialog con `ListPicker` (lista dell'ICP),
   ruoli (default `target_roles`), seniority Apollo (opzionale), località (default
   `target_locations`), tetto persone per azienda (`APOLLO_PEOPLE_PER_COMPANY`, default 10).
   Preview: 0 crediti (People Search è gratuita), numero di richieste vs rate limit del piano,
   warning se > 100 aziende (paginazione).
6. **Job `apollo_people`**: `mixed_people/api_search` con `q_organization_domains_list` (batch di
   domini), `person_titles`, `person_seniorities`, `person_locations` → per ogni persona con
   `linkedin_url` → `upsertProspect` (+ `company_id`, `title`, `apollo_person_id`) → `sources`
   `kind='apollo_people'` (con `company_id`) → membro della lista scelta, stato `nuovo`. Persone senza
   URL LinkedIn: saltate e contate (identità non violata). Esito: "P persone lette, A aggiunte a
   '<lista>' (N nuove, E già in archivio), S già in lista".
7. **Email (opzionale, a pagamento)**: "Trova email con Apollo" sulla selezione della lista =
   l'enrichment esistente con `provider: 'apollo'` (`people/match`, 1 credito a persona, bulk da 10).
   Preview con crediti. Apollo **non rivela email personali** per contatti EU (GDPR): esito onesto
   "email di lavoro trovata / non disponibile". L'arricchimento Apify (`Full+email`) resta
   l'alternativa.
8. **Opzione "pipeline"** nel dialog del passo 2: `autoContacts: true` salta il triage e, trovate le
   aziende, esegue subito il passo 6 su **tutte** le candidate verso la lista scelta (stessa preview,
   stesso job, una sola spesa dichiarata). Default **off**: il triage è il modo in cui l'utente resta
   la decisione, come vuole il contract. Con questo flag il requisito "una volta creati ICP, referenze
   e lista deve partire l'estrazione" è un solo click con anteprima; **non** un avvio automatico
   senza preview (che violerebbe "preview prima di ogni spesa" e "i job partono solo dalla UI").

### Modello dati (delta)

- `companies`: **identità a doppia chiave** (D-A): `linkedin_url` diventa **nullable** (`UNIQUE` parziale
  `WHERE linkedin_url IS NOT NULL`), nuova `domain TEXT` (`UNIQUE` parziale; minuscolo, senza `www.`,
  ricavato dal sito con `normalizeDomain`), `CHECK (linkedin_url IS NOT NULL OR domain IS NOT NULL)`.
  Più `apollo_org_id TEXT UNIQUE`, `apollo_json TEXT`, `apollo_enriched_at TEXT`. Stesso modello dei
  prospect (`linkedin_url` + `member_urn`): `upsertCompany({linkedinUrl?, domain?, …})` →
  `{id, created, mergedIds}` e `mergeCompanies` in `src/db/identity.ts` quando una fonte rivela che
  un'azienda "solo dominio" e una "solo LinkedIn" sono la stessa (Apollo restituisce entrambi: è il
  caso tipico). Il `website` esistente popola `domain` in una migrazione idempotente all'avvio.
  Conseguenze: il **sourcing da azienda** (harvestapi) resta possibile solo con `linkedin_url`
  (blocker in preview: "Azienda senza pagina LinkedIn: recuperala prima"); l'URL LinkedIn si
  recupera **poi** (arricchimento Apollo, futuro scraper dei siti, o a mano dal dettaglio azienda).
  Nessuna azienda Apollo viene persa.
- Nuova tabella `icp_company_candidates (icp_id, company_id, status 'proposta'|'accettata'|'scartata',
  score REAL, reasons JSON, job_id, created_at, decided_at, PRIMARY KEY (icp_id, company_id))`.
  Una referenza non può essere candidata dello stesso ICP (esclusa a monte).
- `sources.kind`: + `'apollo_people'` (richiede `company_id`, come `company_employees`).
- `prospects`: `apollo_person_id TEXT` (unico se presente; chiave secondaria come `member_urn`,
  **non** identità).
- `jobs.kind`: + `'lookalike_companies'`, `'apollo_people'`; `enrich` acquisisce `params.provider`.
- `settings` invariati; `readiness.apollo`.

### API

- `GET /api/icps/:id/candidates?status=` → `{items}`; `PATCH /api/icps/:id/candidates/:companyId
  {status}`; `POST /api/icps/:id/candidates/bulk {company_ids, status}`.
- `POST /api/icps/:id/lookalike/preview` / `POST /api/icps/:id/lookalike` → 202 `{job}` (400
  `blocked`, 409 `job_running`).
- `POST /api/icps/:id/contacts/preview` / `POST /api/icps/:id/contacts {company_ids, list_id, roles,
  seniorities, locations, per_company}` → 202.
- `POST /api/prospects/enrich/preview|enrich` con `provider: 'apollo'` (route esistente estesa).

### Codice

- `src/apollo/client.ts` (fetch nativo, header `x-api-key`, retry su 429 con `retry-after`,
  errori `actor:apollo:<endpoint>:` per coerenza con l'attribuzione esistente),
  `src/apollo/requests.ts` = **unico punto** dove si costruiscono i body (equivalente di
  `actors.ts`), `src/apollo/mappers/{organizations,people}.ts` puri con `field()` + fixture JSON in
  `tests/fixtures/apollo/`.
- `src/jobs/lookalike-companies.ts`, `src/jobs/apollo-people.ts` (Deps: `enrichOrganizations`,
  `searchOrganizations`, `searchPeople`), fake in `fake-deps.ts`, entry nel registry.
- `src/db/candidates.ts`; `src/server/routes/candidates.ts` (una route per file).
- FE: `icps.$id.tsx` (card + candidate), `LookalikeDialog`, `ContactsDialog`; tipi/client in
  `web/src/api/*`; hook in `lib/jobs.ts`.
- Env: `APOLLO_API_KEY`, `APOLLO_MAX_COMPANY_PAGES=1`, `APOLLO_PEOPLE_PER_COMPANY=10`,
  `APOLLO_CREDIT_USD=` (vuoto = stima non disponibile). README: tabella costi Apollo.

### Ordine dei task

T0 smoke reale (script `scripts/apollo-smoke.ts`, una chiamata per endpoint: conferma scope della
master key, crediti consumati, header di rate limit; esito nel PLAN) → T1 config + readiness +
client Apollo + mappers/fixture (RED: mapper puri) → T2 identità azienda a doppia chiave
(`domain`, `upsertCompany`, `mergeCompanies`, migrazione da `website`, blocker del sourcing senza
LinkedIn) → T3 schema candidate + `db/candidates.ts` → T4 job `lookalike_companies` + preview +
route (RED: deps fake, esito con conteggi) → T5 FE card/dialog/candidate + triage → T6 job
`apollo_people` + route + FE → T7 enrich `provider: 'apollo'` → T8 README/.env.example, FLOW,
UX-review.

### Rischi e verifiche preliminari

- **Chiave e piano Apollo**: piano a pagamento con **master key** (D-E): tutti e quattro gli
  endpoint sono disponibili. T0 lo conferma con uno smoke reale prima di scrivere il client.
- **Rate limit**: sui piani a pagamento 200/min con tetti orari/giornalieri più alti; i job contano
  comunque le richieste e si fermano con esito onesto ("limite raggiunto: 37 aziende su 80 lette").
- **Qualità del lookalike**: Apollo non ha un endpoint "simili a": la somiglianza è la nostra
  derivazione dei filtri. v1 deterministica e visibile nel dialog; v2 (opzionale) Claude propone i
  filtri leggendo le referenze (structured output, pochi centesimi).
- **GDPR**: i prospect trovati via Apollo sono dati personali; `sources` conserva la provenienza,
  l'export CSV già mostra la fonte. Nessuna email personale.

## 2. Assistente ICP (chatbot con URL di aziende)

### Obiettivo

Un assistente conversazionale che aiuta a definire un ICP partendo da testo libero e/o da URL di
aziende (pagina LinkedIn o sito). L'assistente **propone** una bozza che compila il form ICP in
tempo reale; l'utente modifica e **salva lui**. Può anche proporre le aziende passate come
**aziende di riferimento** (con esito) e, se la #3 è fatta, usa l'anagrafica dell'utente come
contesto.

### Flusso utente

1. Entry point: `/icps/nuovo` e pagina ICP esistente → pannello laterale **"Assistente"**;
   onboarding passo 2 → CTA "Crea l'ICP con l'assistente". Blocker: `ANTHROPIC_API_KEY` mancante.
2. L'utente scrive ("vendo consulenza HR a PMI manifatturiere del Nord Italia, clienti tipo
   https://acme.it e https://www.linkedin.com/company/beta").
3. Il server **rileva gli URL** e li risolve con il servizio `company-intel` (§4): sito → estrazione
   testo in-house (gratis); URL LinkedIn company → Apollo `organizations/enrich` (1 credito) o, senza
   Apollo, solo i metadati noti. **Prima di spendere crediti** l'assistente chiede conferma inline
   ("Arricchisco 2 aziende con Apollo: 2 crediti. Procedi?") — è la preview, in forma di chat.
4. Chiamata Claude (`ASSISTANT_MODEL`, default = `ANALYSIS_MODEL`; structured output) →
   `{reply, draft: IcpDraft parziale, open_questions[], suggested_reference_companies[]}`.
   Il form si aggiorna con la bozza (campi evidenziati "proposto"), la risposta pone al massimo
   2-3 domande mirate (ruoli, dimensione, pain, esclusioni).
5. Iterazione finché l'utente è soddisfatto → **"Salva ICP"** (POST esistente). Se ci sono aziende
   suggerite: dialog "Aggiungi come riferimento" con esito per ciascuna (crea `companies` +
   `icp_reference_companies`). Nessuna scrittura automatica.
6. Ogni messaggio mostra il costo effettivo dal `usage` della risposta ("≈ $0,02"); la sessione è
   riapribile (persistita).

### Modello dati e API

- Nuova tabella `assistant_sessions (id, kind 'icp', icp_id NULL, messages JSON, draft JSON,
  context JSON, created_at, updated_at)`. I `messages` sono i `MessageParam` dell'SDK (storia
  completa: l'API è stateless).
- `POST /api/assistant/icp/sessions {icp_id?}` → 201; `GET /api/assistant/icp/sessions/:id`;
  `POST /api/assistant/icp/sessions/:id/messages {text, confirm_credits?: boolean}` →
  `{message, draft, questions, pending: {credits, companies[]} | null, usage}`;
  `DELETE` → `{ok}`.
- Le chiamate sono **sincrone** (una risposta ≤ 60 s), non job: l'unico job a costo variabile resta
  quello di un'eventuale estrazione lunga. Il contract va aggiornato: "l'AI serve solo all'analisi"
  diventa "l'AI non assegna liste né stati; propone, l'utente conferma".

### Codice

- `src/assistant/icp/{prompt,schema,run}.ts` (schema zod → JSON schema come `analysis/schema.ts`;
  system prompt stabile con `cache_control` per il caching, contesto azienda/anagrafica dopo).
- `src/intel/company-intel.ts` (§4) con deps iniettate (`fetchSite`, `enrichOrganization`).
- `src/server/routes/assistant.ts`; `src/db/assistant.ts`.
- FE: `AssistantPanel` (lista messaggi, input, chip "proposto" sui campi, conferma crediti),
  integrato in `icps.$id.tsx` (già 896 righe: estrarre prima il form ICP in un componente).
- Test: client Claude fake con risposte fixture; `company-intel` con deps fake; route via
  `createApp().request()`.
- Modello: `claude-opus-5`, thinking adattivo, `output_config.effort: 'medium'`, `max_tokens`
  16 000, structured outputs; fallback prompt "solo JSON" quando `ANALYSIS_STRUCTURED=0`.

### Ordine dei task

T1 `company-intel` (estrazione sito + Apollo enrich opzionale) con fixture → T2 schema/prompt/run
dell'assistente + tabella sessioni (RED: bozza valida da fixture) → T3 route → T4 refactor form ICP
in componente + `AssistantPanel` → T5 conferma crediti + referenze suggerite → T6 onboarding CTA,
FLOW, UX-review.

### Rischi

- **Siti JS-only** o bloccati: estrazione vuota → l'assistente lo dice e chiede una descrizione.
- **Costo nascosto**: ogni URL LinkedIn = 1 credito Apollo; sempre conferma inline.
- **Allucinazioni di tassonomia**: settori/località devono essere stringhe libere (come oggi
  nell'ICP), non ID Apollo; la mappatura ai filtri Apollo è compito della #1.

## 3. Anagrafica automatica da LinkedIn + sito

### Obiettivo

Generare profilo, azienda e servizi dell'utente (oggi 4 chiavi in `settings`, compilate a mano)
da due input: l'URL del proprio profilo LinkedIn (già in `own_profile_url`) e il sito. Un job estrae
entrambi, un LLM li elabora in un'**anagrafica strutturata** che l'utente rivede e applica.

### Flusso utente

1. Impostazioni → nuova sezione **"Anagrafica"** (e onboarding passo 1 riscritto: "Profilo
   LinkedIn + sito → Genera"). Campi: URL profilo (esistente), **`website_url`** (nuovo).
2. CTA **"Genera anagrafica"** → `JobPreviewDialog`: costo = prezzo del profile-detail Apify (o
   "stima non disponibile" se `PRICE_PROFILE_DETAIL_USD` vuoto) + analisi Claude (≈ $0,05); blocker:
   `APIFY_TOKEN`/`ANTHROPIC_API_KEY` mancanti, nessun input; warning se il sito non risponde.
3. **Job `build_profile`**: (a) actor `profileDetail` sul proprio URL → headline, about,
   esperienze, servizi/skill → `own_profile_json` (+ `own_profile_fetched_at`, riusabile con
   freshness `FRESHNESS_DAYS`); (b) `web-extract` sul sito (home + fino a `WEB_EXTRACT_MAX_PAGES`
   pagine interne scelte per path `about|chi-siamo|servizi|services|team|prezzi` e sitemap) →
   `website_extract_json`; (c) Claude structured output → `ProfileSchema {company_name,
   company_description ≤ 600, company_offering, services[] {name, description, for_whom},
   positioning, proof_points[], tone, target_hint}` → salvato come **proposta**
   (`profile_proposal`), mai applicato da solo. Isolamento per fonte: se il sito fallisce si
   produce la proposta dal solo LinkedIn con warning.
4. UI: **confronto proposta vs valori attuali** campo per campo, "Applica" singolo o "Applica
   tutto" → `PUT /api/settings` (esistente, esteso alle nuove chiavi). Toast "Anagrafica salvata".
5. Consumatori: il prompt dell'analisi (già usa descrizione/offerta) riceve anche `services` e
   `positioning`; l'assistente ICP (#2) usa l'anagrafica come contesto.

### Modello dati e API

- `SETTING_KEYS` + `website_url`, `company_services` (JSON), `positioning`, `proof_points` (JSON),
  `own_profile_json`, `own_profile_fetched_at`, `website_extract_json`, `website_fetched_at`,
  `profile_proposal` (JSON). Il payload di `GET /api/settings` parsa le chiavi JSON.
- `jobs.kind` + `'build_profile'`; `POST /api/settings/profile/preview` e `POST
  /api/settings/profile` → 202 `{job}`; `POST /api/settings/profile/apply {fields[]}` copia dalla
  proposta alle chiavi (o la UI fa una PUT normale: preferibile, meno endpoint).
- `readiness.company` invariata (descrizione presente).

### Codice

- `src/profile/{schema,prompt,build}.ts`; `src/jobs/build-profile.ts` (Deps: `fetchProfile`,
  `fetchSite`, `client`); fake in `fake-deps.ts`.
- `src/intel/web-extract.ts` (§4) condiviso con #2.
- FE: `settings.tsx` (663 righe: estrarre le sezioni in componenti), `ProfileProposal` (diff),
  onboarding `index.tsx` passo 1.
- Test: fixture del profile-detail (già esistente per l'enrichment), fixture HTML del sito,
  client Claude fake; verifica che la proposta non tocchi `settings` finché non si applica.

### Ordine dei task

T1 `web-extract` + fixture → T2 chiavi settings + payload → T3 schema/prompt + job + preview
(RED: proposta da fixture, sito fallito → warning) → T4 route → T5 FE sezione Anagrafica + diff +
onboarding → T6 prompt analisi esteso, README, FLOW, UX-review.

## 4. Servizi necessari

| Servizio | Uso | Endpoint / actor | Costo | Note |
|---|---|---|---|---|
| **Apollo API** (`APOLLO_API_KEY`) | #1 arricchimento referenze | `GET /v1/organizations/enrich?domain=` (bulk: 10 per chiamata) | 1 credito/azienda | free tier solo con account a email di lavoro |
| | #1 ricerca aziende simili | `POST /v1/mixed_companies/search` (filtri: keyword tag, fasce dipendenti, località, tecnologie, revenue; 100/pagina) | 1 credito/pagina | scope `mixed_companies_search` |
| | #1 contatti per azienda | `POST /v1/mixed_people/api_search` (`person_titles`, `person_seniorities`, `q_organization_domains_list`, `person_locations`; 100/pagina) | **0 crediti** | **niente email/telefono**; richiede master key o scope `mixed_people_api_search` |
| | #1 email (opzionale) | `POST /v1/people/match` (bulk: 10) | 1 credito (+8 se telefono) | no email personali EU (GDPR) |
| | #2 URL LinkedIn company | `organizations/enrich` con `linkedin_url` | 1 credito | conferma inline in chat |
| | rate limit | free 50/min · 200/h · 600/giorno; piani a pagamento 200/min e limiti giornalieri più alti | — | i job contano le richieste e si fermano con esito onesto |
| **Anthropic** (`ANTHROPIC_API_KEY`) | #2 assistente, #3 anagrafica, (v2) filtri lookalike | Messages API, `claude-opus-5`, structured outputs, thinking adattivo, prompt caching sul system prompt | token: ≈ $0,01–0,05 per messaggio/anagrafica | client già iniettabile; modello via `ASSISTANT_MODEL`/`ANALYSIS_MODEL` |
| **Apify** (`APIFY_TOKEN`) | #3 profilo LinkedIn proprio | `apimaestro/linkedin-profile-detail` (esistente, no cookie) | `PRICE_PROFILE_DETAIL_USD` | fallback per aziende LinkedIn senza Apollo: un actor company-detail (da scegliere), non necessario in v1 |
| **Estrattore web in-house** (`src/intel/web-extract.ts`) | #2 siti aziende, #3 sito proprio | `fetch` nativo + parser HTML leggero (`htmlparser2`) → testo; sitemap; cap pagine/bytes/timeout; rispetto `robots.txt` | gratis | niente rendering JS: siti SPA → warning. Alternativa senza codice di scraping: tool server `web_fetch_20260209` di Claude (costo token, meno testabile) — scartata in v1 per determinismo e test offline |
| **Servizio `company-intel`** (`src/intel/company-intel.ts`) | #2 (e #1 v2) | orchestrazione: URL → dominio → sito (gratis) → Apollo enrich (a pagamento, su conferma) | — | deps iniettate, fixture |

Nessun altro servizio a pagamento. Nessun cron: tutto parte dalla UI con anteprima.

## 5. Ordine consigliato e dipendenze

1. **#1 Lookalike Apollo** — valore più alto, indipendente dagli altri; porta Apollo in config,
   client e mappers che #2 riusa. Da sola: 7 task.
2. **#3 Anagrafica** — piccola (6 task), riusa actor esistente e introduce `web-extract`; migliora
   subito l'analisi AI e fornisce contesto a #2.
3. **#2 Assistente ICP** — riusa `web-extract` (#3) e Apollo enrich (#1); è la più nuova come UI
   (chat) e beneficia dell'anagrafica.

Ogni capability = una spec (`create-spec` → FLOW con `ux-advisor` → `create-plan` →
`implement-spec` → `adversarial-review` in sessione separata → `docs-maintenance`). Contract da
aggiornare in `docs-maintenance`: seam `CompanyLookalikeProvider` → capability posseduta; nuovi
source kind, job kind, tabella candidate/sessioni; invariante AI riformulato.

## 6. Decisioni prese (2026-09-16)

| # | Decisione | Esito | Conseguenze |
|---|---|---|---|
| D-A | Identità aziende | **Dominio come identità alternativa**: `linkedin_url` nullable, `domain` seconda chiave unica, almeno una delle due; unione quando una fonte rivela entrambe. L'URL LinkedIn si recupera in seguito (Apollo, scraper dei siti, a mano) | Cambia l'invariante "identità aziende" del contract (da aggiornare in `docs-maintenance`); sourcing Apify bloccato per aziende senza LinkedIn; `upsertCompany`/`mergeCompanies` come per i prospect |
| D-B | Default pipeline | **Triage manuale**; flag `autoContacts` disponibile ma spento | Le candidate passano da "Accetta/Scarta"; "Trova contatti" è un secondo click con anteprima |
| D-C | Email | **Entrambi i provider**: l'enrichment acquisisce `provider: 'apollo'` (`people/match`) accanto ad Apify `Full+email` | Dialog di arricchimento con scelta provider e costo relativo; esito onesto per le email personali EU non rivelate da Apollo |
| D-D | Chat fuori dai job | **Sì**: chiamate sincrone, costo effettivo mostrato per messaggio dal `usage`; crediti Apollo sempre sotto conferma inline | Invariante "l'AI serve solo all'analisi" riformulato: l'AI propone, l'utente conferma; nessuna scrittura automatica |
| D-E | Piano Apollo | **Piano a pagamento, master key** | Nessun fallback Apify per i contatti; T0 di #1 = smoke reale che conferma scope, crediti e limiti |
