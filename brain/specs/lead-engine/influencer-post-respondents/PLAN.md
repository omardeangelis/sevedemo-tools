---
domain: lead-engine
type: plan
links:
  - "[[specs/lead-engine/influencer-post-respondents/SPEC|SPEC]]"
created: 2026-06-17
updated: 2026-06-17
---

# PLAN — Influencer Post Respondents (fonte primaria azienda-first)

**Status:** Complete (T0–T13 implementati in TDD; T14 manuale differito all'operatore).
Gate `adversarial-review`: **SHIP** (1 BLOCKER risolto + ri-verificato). Suite 131/131,
typecheck pulito, web build verde, UI verificata con agent-browser. Vedi `REPORT.md` +
`IMPLEMENTATION-NOTES.md`.

Esecuzione handoff per `implement-spec`. Standalone: contiene situazione, findings,
ricerca, grafo dipendenze, wave, strategia di test, rischi, gate e ledger.

## 1. Situazione iniziale

Lead Engine estrae lead LinkedIn via Apify + Claude, seleziona 20 freelance + 20
azienda/giorno, scrive bozze email, esporta CSV; gli esiti rientrano via
`eval:import` e si confrontano nel "Report strategie". Esiste già una strategia
`freelance-post-reactors` (`src/strategies/freelance-post-reactors.ts`) che legge
`data/seeds/influencers.json`, è abilitata (no-cookie) ed entra nel run giornaliero.

## 2. Problema

Quella strategia **estrae 0** → non compare con un valore nel report. Cause:

- usa `harvestapi/linkedin-profile-posts` + `harvestapi/linkedin-post-reactions`
  (`src/apify/actors.ts:14-16`) che non rendono, mentre l'operatore ha validato
  **`apimaestro/linkedin-profile-posts`**;
- estrae solo **reactor** (like), mai **commentatori** ("chi risponde");
- il report (`reportByStrategy`, `src/db/runs.ts:130`) è costruito **solo** su
  `contacts.source_strategy`: una strategia a 0 contatti **non ha riga** (non è
  "0", è *assente*) — anche se la tabella `runs` registra già `items_in/items_new`
  per ogni run, errori inclusi (`pipeline/run.ts:68`), ma non viene mai joinata;
- il budget è splittato **equamente** (`gather`, `pipeline/run.ts:50`): nessuna
  primazia;
- il bucket azienda/freelance lo decide Claude in scoring: il `bucketHint` di
  strategia è solo documentazione.

## 3. Forma della soluzione

Riscrivere la strategia in **`influencer-post-respondents`** (rename del file/ id):
per ogni influencer del seed → post recenti (apimaestro, profondità configurabile)
→ **commentatori** di ogni post + **persone taggate** nel testo come candidati, e
**aziende taggate espanse** ai loro decision-maker via people-search. La fonte è
**primaria** (budget dominante + eseguita per prima, con riflusso del budget non
consumato) e **azienda-first** in selezione. Il "Report strategie" diventa onesto:
mostra le strategie a 0/errore joinando `runs`, e attribuisce per **sotto-fonte**
(`commenter` / `tagged-person` / `company-expansion`). CLI e UI restano un'unica
fonte (`reportByStrategy`), due viste.

## 4. Decision ledger (risolto)

| # | Decisione | Esito |
|---|---|---|
| D1 | "Chi risponde" | **Solo commenti** (pivot da reazioni → commenti) |
| D2 | Entità taggate (`text_annotations`) | **Sì, persone + aziende** |
| D3 | "Soprattutto aziendali" | **Priorità al bucket azienda** in selezione + quota maggiore |
| D4 | "Prima fonte" | **Budget dominante + eseguita per prima** (statico, non eval-driven) |
| D5 | Aziende taggate | **Espandi subito** a decision-maker (people-search per ruolo) |
| D6 | Profondità | **Moderata + configurabile** (~5 post / finestra recente; seed cresce nel tempo; primacy = primo claim, non quota forzata) |
| D7 | Forma strategia | **Rework + rinomina** l'esistente in una sola strategia |
| D8 (ux) | Osservabilità | Report mostra 0/errore joinando `runs` + drill-down per sotto-fonte (vedi §10) |
| D9 | Scope reshared/annotation | **Commenti**: validi anche sui repost (il commentatore risponde alla condivisione dell'influencer). **`text_annotations`**: si usano **solo** quelle del post top-level, **non** quelle di `reshared_post` (evita doppi conteggi e drift dell'autore originale) |
| D10 | Id storico dopo il rename | **Backfill one-shot** in `migrate()` di `contacts.source_strategy` e `runs.strategy` da `freelance-post-reactors` → `influencer-post-respondents` (guarded, idempotente). Eccezione documentata a "source_strategy mai modificato" di doc 06: è un **rename** della stessa strategia, non una ri-attribuzione → flag a docs-maintenance |

## 5. Assunzioni e vincoli

- **Provider seam**: post/commenti → `apimaestro` (validato; harvest rende 0);
  people-search **resta `harvestapi`** (funziona: ha estratto 130+ nel report) ed è
  riusato per l'espansione-azienda.
- **No-cookie**: tutti gli actor della fonte sono no-cookie → la strategia resta
  abilitata di default.
- **Peso statico**: la primazia NON è guidata dagli esiti → preserva l'invariante
  "nessun feedback loop automatico" di [[domains/lead-engine/06-evaluation]]. Questo
  **modifica deliberatamente** il modello "budget equo" documentato in doc 06 →
  drift da far ingerire a `docs-maintenance` dopo l'implementazione.
- **Migrazioni**: non esiste framework; si usa `ensureColumn` in `migrate()`
  (`src/db/index.ts:92`), idempotente.
- **Test**: server = vitest; frontend = `agent-browser` (niente runner FE). Le
  chiamate Apify reali NON sono in CI: smoke manuale.
- **Tracker**: nessun tracker esterno cablato → backlog a livello brain-spec
  (epic = questa `SPEC.md`).
- **Volume reale basso**: nel fixture i commenti/post sono 0–43 → la primazia è
  "primo claim + riflusso", non una quota grande forzata; il seed va ampliato.
- **Dedup chiave URN vs slug (limite noto)**: i commentatori arrivano con
  `author.profile_url = /in/<slug>`; le persone taggate arrivano con `profile_urn`
  (id membro `ACoAA…`) → `/in/<urn>`. `normalizeLinkedinUrl` preserva entrambe ma
  **non può unificarle**: lo stesso umano commentatore + taggato resta su due chiavi
  → possibile doppio candidato + doppio enrichment. Mitigazione in T5 (spike di
  risolvibilità) + rischio RH; il `tagged-person` non risolvibile **si scarta**, non
  si fabbrica un URL.

## 6. Findings dal codice (file:riga)

- Strategia attuale: `src/strategies/freelance-post-reactors.ts:14` (reactor-only).
- Actor + input builder: `src/apify/actors.ts` (`profilePostsInput:37`,
  `postReactionsInput:41`, `profileSearchInput:27`, `profileDetailInput:57`).
- Registry: `src/strategies/registry.ts:9` (`ALL`), `dailyStrategies:31`.
- Contratto: `src/strategies/types.ts` (`RawCandidate` con `sourcePostUrl:8`).
- Seed loader: `src/strategies/seeds.ts:28` (`loadInfluencers`).
- Pipeline: `src/pipeline/run.ts` — `gather:46` (budget equo), `persist:75`
  (mappa `sourceStrategy`/`sourcePostUrl`), `enrichAndScore:112`, geo-gate
  `runGeoGatePre/Post`, `selectBucket` in `pipeline/select.ts:12` (ordina per
  `fit_score DESC, last_evaluated_at DESC`, cap per settore).
- DB: `src/db/index.ts` (schema `contacts:7`, `runs:34`, `outcomes:60`,
  `ensureColumn:92`, `migrate:110`); `src/db/runs.ts` (`logRun:29`,
  `reportByStrategy:130`, `upsertOutcome:91`).
- Util tolleranti: `src/util/fields.ts` (`field`, `normalizeLinkedinUrl`).
- Scoring: `src/score/claude.ts` + `src/score/rubric.ts` (bucket deciso qui).
- Eval/report: `src/eval/import.ts`, `src/eval/report.ts`; UI
  `web/src/routes/report.tsx`, `web/src/api/client.ts:69`,
  `web/src/api/types.ts:86` (`StrategyReport`).
- Invariante da preservare: doc 06 "un'unica fonte, due viste".

## 7. Ricerca esterna (Apify, giugno 2026)

- **`apimaestro/linkedin-profile-posts`** — input `username` (accetta anche
  `linkedin.com/in/...`), `page_number`, `pagination_token`, `limit` (1-100),
  `total_posts` (auto-paginazione). Output = post (come da fixture incollato dal
  cliente): `urn.activity_urn`, `full_urn`, `url`, `author`, `stats.comments`,
  `text_annotations[]` con `type: profile|company` + `profile_urn`/`company_urn` +
  `text`, e `reshared_post` per i repost.
- **`apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies`** —
  input `postIds` (array; ID numerico es. `7472928569657225216`, activity URL o post
  URL — split su virgola), `page_number`, `sortOrder` ("most recent" | "most
  relevant"), `limit` (1-100, default 100). Output per commento (**schema confermato
  dall'operatore con item reale**): `comment_id`, `text`, `posted_at{timestamp,date,
  relative}`, `is_edited`, `is_pinned`, `comment_url`, `comment_type` ("comment" |
  "reply"), `parent_comment_id` (**solo sui reply**), `author.{name, headline,
  profile_url, profile_picture}` — `profile_url` è un **`/in/<slug>` reale** (niente
  URN autore), `stats.{total_reactions,reactions,comments}`, e **`post_input`** =
  l'id post interrogato (linkage commento→post gratis). Pricing ~$1.2/1000 commenti.
- Espansione-azienda: nessun nuovo actor — riuso `harvestapi/linkedin-profile-search`
  (`profileSearchInput`) con query `"<ruolo> <nome azienda>"` (il nome azienda è in
  `text_annotations[].text`).

Fonti: apify.com/apimaestro/linkedin-profile-posts ·
apify.com/apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies/api

## 8. Grafo delle dipendenze

```
foundation     S1 (estrazione)        S2 (primazia/bias)   S3 (osservabilità)
T0 (fixture)─┬─► T3 ─┐                                       T11 ─► T12 ─► T13
T1 ──────────┼─► T4 ─┼─► T6 ─► T8 ─┬─► T9 ──────────────────► (legge run_error)
             ├─► T5 ─┘     ▲       └─► T10                    ▲
T2 ──────────┴────────► T7 ┘                                  │ T1 (run_error +
                                                              │ canale errore in gather)
T14 (smoke e2e) ◄── T8, T9, T10, T11 ─────────────────────────┘
```

depends_on:
T0:[] · T1:[] · T2:[] · T3:[T0] · T4:[T0,T1] · T5:[T0,T1] · T7:[T1,T5] ·
T6:[T1,T2,T3,T4,T5,T7] · T8:[T6] · T9:[T8] · T10:[T8] · T11:[T1] · T12:[T1,T11] ·
T13:[T11,T12] · T14:[T8,T9,T10,T11]

> Nota canale-errore (fix BLOCKER): il **canale** di propagazione errore esce da
> `gather` ed è **stabilito in T1** (widening del return + parametro `error` in
> `logRun` + colonna `runs.run_error`). T9 riscrive l'algoritmo di budget ma
> **continua a popolare** quel canale nel `catch`. Così T11 (report) dipende solo da
> T1 e può essere testato seedando `runs.run_error`, senza serializzarsi dietro T9.

## 9. Wave di esecuzione parallela

- **Wave 0** — T0, T1, T2
- **Wave 1** — T3, T4, T5, T11
- **Wave 2** — T7, T12
- **Wave 3** — T6, T13
- **Wave 4** — T8
- **Wave 5** — T9, T10
- **Wave 6** — T14 (smoke reale + verifica end-to-end)

## 10. Strategia di test (TDD)

- **Mapper puri** (T3/T4/T5): vitest con fixture. Salvare il payload reale incollato
  dal cliente in `tests/fixtures/apimaestro-profile-posts.json`; per i commenti
  creare `tests/fixtures/apimaestro-post-comments.json` dallo schema documentato
  (T14 ne valida la forma reale). Pattern esistente: `tests/extraction-mapping.test.ts`.
- **gather/select** (T9/T10): vitest con strategie finte + DB in-memory (vedi
  `tests/run-id-selection.test.ts`, `tests/enrich-selection.test.ts`).
- **report** (T11/T12): vitest seedando `runs` + `contacts` + `outcomes`.
- **UI** (T13): `agent-browser` (no runner FE).
- **Apify reale**: solo smoke manuale (T14), fuori CI (costo + token).

## 11. Rischi e mitigazioni

| # | Rischio | Mitigazione |
|---|---|---|
| RA | Schema I/O apimaestro commenti drifta | mapping tollerante `field()`, isolato in `actors.ts`; smoke T14 |
| RB | Volume commentatori basso | primacy = primo claim + riflusso budget; taggati + espansione-azienda integrano; ampliare seed |
| RC | Costo espansione-azienda (N ricerche × ruoli) | cap per-azienda + dedup aziende + ruoli configurabili ($0.10/pagina harvest) |
| RD | ~~Fixture commenti sintetico~~ **risolto**: schema commenti confermato dall'operatore (item reale) | resta solo da validare in T14 la forma a volume/limite (reply annidate, 0 commenti); mapper comunque tollerante |
| RE | Si modifica il modello "budget equo" (doc 06) | scelta esplicita; peso **statico** (non eval-driven) preserva "no feedback loop"; flag drift per docs-maintenance |
| RF | Geo-gate scarta molti commentatori esteri | atteso; audience influencer IT ~italiana; il run deve **completare** e mostrare "0-pulito", non errore (T6/T11/T14) |
| RG | Cambio report rompe "un'unica fonte, due viste" | mantenere `reportByStrategy` unica fonte; aggiornare CLI (T12) e UI (T13) in lockstep |
| RH | Chiave URN (taggati) vs slug (commentatori) non deduplica | spike risolvibilità in T5; taggato non risolvibile **scartato**; limite documentato (§5); enrichment apimaestro accetta la forma URN (`actors.ts:52-58`) ma la dedup cross-sotto-fonte resta best-effort |
| RI | Id storico `freelance-post-reactors` resta come riga fantasma nel report (contatti + `runs` storici) e `scripts/seed-demo.ts` lo hardcoda | backfill one-shot in `migrate()` (D10) su `contacts.source_strategy` + `runs.strategy`; aggiornare `scripts/seed-demo.ts` in T8 |

## 12. Gate di validazione per fase

- **Gate S1** (dopo Wave 3): `npm test` verde sui mapper; `npm run typecheck` pulito.
- **Gate S2** (dopo Wave 5): unit gather/select verdi (primaria per prima + riflusso;
  azienda boost).
- **Gate S3** (dopo Wave 3, ramo report): report mostra strategia a 0/errore +
  sotto-fonte; UI verificata con `agent-browser`.
- **Gate finale** (Wave 6 / T14): `npm run cli -- pipeline --strategy
  influencer-post-respondents --limit 50` → > 0 commentatori; `npm run cli --
  eval:report` mostra la strategia; UI report la mostra.

## 13. Domande aperte / da validare in esecuzione

- Nomi esatti dei campi di output del comments actor (confermati a doc:
  `author.profile_url`; validare su payload reale in T14).
- Lista ruoli decision-maker per l'espansione-azienda (default: CEO, CTO, Founder,
  Co-founder, Head of Engineering, HR, Talent) — tunabile via config/seed.
- Quota esatta "budget dominante" (default proposto: primaria ~50% del peso o
  primo-claim fino a disponibilità; le people-search riempiono il resto) — tunabile
  via env.

---

## Task

### T0: Commit fixture reali (sblocca i mapper RED)

- **depends_on**: []
- **location**: `tests/fixtures/apimaestro-profile-posts.json` (nuovo), `tests/fixtures/apimaestro-post-comments.json` (nuovo)
- **description**: Crea la cartella `tests/fixtures/` (oggi **non esiste**) e committa: (a) il payload **reale** `linkedin-profile-posts` incollato dall'operatore per `guido-penta` → `apimaestro-profile-posts.json` (verità di terra per le costanti asserite in T3); (b) `apimaestro-post-comments.json` con lo **schema confermato dall'operatore** (item reale, §7: `comment_id`, `comment_type`, `author.profile_url=/in/<slug>`, `post_input`, …) — basta arricchirlo con un item `comment_type='reply'` (con `parent_comment_id`) per coprire il caso reply. Resta da validare in T14 solo la **forma a volume/limite** (reply annidate, 0 commenti). Senza questo i RED di T3/T4/T5 sono inscrivibili (fix BLOCKER fixture-mancante).
- **validation**: i due file esistono e sono JSON validi; `apimaestro-profile-posts.json` contiene il post con `activity_urn=7472928569657225216` e una `text_annotations` company `Welyk`; `apimaestro-post-comments.json` contiene un item con `author.profile_url` e `post_input`, più un item `comment_type='reply'`.
- **status**: Done
- **log**: Creati `tests/fixtures/apimaestro-profile-posts.json` (3 post reali guido-penta: post#1 con annotation profile `Victoria` + company `Welyk/105729725`; post#3 `quote` con `reshared_post` annotato `Talentware`/`Michela`/`Luca` per il test D9 = ignorare le annotation del reshared) e `tests/fixtures/apimaestro-post-comments.json` (schema confermato: item `comment` John Smith `/in/johnsmith/`, item `reply` Laura Bianchi con `parent_comment_id`, item senza `profile_url` da scartare; tutti con `post_input=7472928569657225216`). Validazione JSON + asserzioni passate.
- **files edited/created**: `tests/fixtures/apimaestro-profile-posts.json` (nuovo), `tests/fixtures/apimaestro-post-comments.json` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "`require/import` del fixture posts espone almeno 1 item con `urn.activity_urn` e `text_annotations` non vuoto" — precondizione dei mapper.
- **review_mode**: cli

### T1: Foundation — `source_detail`, `runs.run_error` + canale errore, rename backfill, tipi + persist

- **depends_on**: []
- **location**: `src/db/index.ts` (`migrate`), `src/strategies/types.ts`, `src/db/contacts.ts` (`upsertCandidate`/`NewCandidate`), `src/pipeline/run.ts` (`gather` return + `persist` + `logRun` call sites), `src/db/runs.ts` (`logRun`/`RunLog`)
- **description**: Quattro cose, tutte additive/idempotenti:
  1. Via `ensureColumn` in `migrate()`: `contacts.source_detail TEXT` e **`runs.run_error TEXT`** (nome pinnato — niente "o status"). Aggiunte **dentro `migrate()`**, non nello `SCHEMA` statico, così `tests/migration.test.ts` (legacy DB) regge.
  2. **Canale errore** (fix BLOCKER): allarga il return di `gather` con `errorByStrategy: Map<string,string>`; nel `catch` (oggi `run.ts:65-69` scarta l'errore) registra il messaggio; aggiungi `error?: string` a `RunLog` e fai scrivere `logRun` su `runs.run_error`; passa l'errore ai call site di `logRun` in `runDaily`/`runStrategy`. (T9 riscriverà l'algoritmo ma **manterrà** questo canale.)
  3. Estendi `RawCandidate` con `sourceDetail?: 'commenter'|'tagged-person'|'company-expansion'`; propagalo in `NewCandidate`/`upsertCandidate` e in `persist()` accanto a `sourcePostUrl` (nullable → nessun cambio per le strategie esistenti).
  4. **Backfill one-shot** (D10): `UPDATE contacts SET source_strategy='influencer-post-respondents' WHERE source_strategy='freelance-post-reactors'` e analogo su `runs.strategy`. ⚠️ **Guard di esistenza colonna** (fix BLOCKER re-gate): `tests/migration.test.ts` esegue `migrate()` su un `LEGACY_SCHEMA` dove `contacts` **non ha `source_strategy`** (`migration.test.ts:7-14`) → un UPDATE incondizionato lancerebbe `no such column`. Esegui il backfill **solo se** la colonna esiste: helper `hasColumn(db,'contacts','source_strategy')` (via `PRAGMA table_info`, come `ensureColumn`) prima dell'UPDATE; idem per `runs.strategy`. Sul DB legacy il backfill è un **no-op** (colonna assente); in produzione gira (la colonna è nello `SCHEMA` statico). Idempotente (dopo la prima esecuzione nessuna riga matcha).
- **validation**: migrazione idempotente (riesecuzione non rilancia; `PRAGMA table_info` contiene `source_detail` e `run_error`); un candidato con `sourceDetail` è leggibile su `contacts.source_detail`; `logRun({error:'x'})` scrive su `runs.run_error`; **`migrate(legacyDb())` (schema senza `source_strategy`) NON lancia** (guard col-existence) — la suite `migration.test.ts` resta verde; **nuovo caso di test** con `contacts.source_strategy` presente e popolato a `'freelance-post-reactors'` → dopo `migrate()` nessuna riga con quell'id resta, e una **seconda** `migrate()` sulla stessa riga già rinominata è **no-op** (idempotenza — `migrate` gira a ogni boot, `index.ts:141`).
- **status**: Done
- **log**: RED (`tests/influencer-respondents-foundation.test.ts`, 5 casi) → GREEN. (1) `migrate()`: aggiunte `contacts.source_detail` e `runs.run_error` via `ensureColumn`; nuovo helper `hasColumn`. (2) Backfill rename guarded (`hasColumn`) su `contacts.source_strategy` + `runs.strategy` — no-op su DB legacy senza la colonna (`migration.test.ts` resta verde), idempotente in prod. (3) Canale errore: `gather` ritorna `errorByStrategy: Map`, popolato nel `catch`; `RunLog.error` + `logRun` scrive `runs.run_error`; passato ai call-site in `runDaily`/`runStrategy`. (4) `RawCandidate.sourceDetail` + `NewCandidate.sourceDetail` + `ContactRow.source_detail` + `upsertCandidate` INSERT/COALESCE + `persist()` lo propaga. Fix collaterale typecheck: aggiunto `source_detail: null` ai due fixture ContactRow (`italy-geo-gate`, `email-draft-guard`). Suite 86/86, typecheck pulito.
- **files edited/created**: `src/db/index.ts`, `src/db/runs.ts`, `src/db/contacts.ts`, `src/strategies/types.ts`, `src/pipeline/run.ts`, `tests/influencer-respondents-foundation.test.ts` (nuovo), `tests/italy-geo-gate.test.ts`, `tests/email-draft-guard.test.ts`
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "dopo `migrate()` su un DB legacy con un contatto `source_strategy='freelance-post-reactors'`, quella riga è rimappata a `influencer-post-respondents` e `PRAGMA table_info(runs)` contiene `run_error`" — RED prima di toccare lo schema.
- **review_mode**: cli

### T2: Actor apimaestro — IDs + input builder (posts, comments)

- **depends_on**: []
- **location**: `src/apify/actors.ts`
- **description**: In `ACTORS` aggiungi `profilePostsApimaestro: 'apimaestro/linkedin-profile-posts'` e `postComments: 'apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies'`. Builder: `profilePostsInput(profileUrl, totalPosts)` → `{ username: <url/slug>, total_posts }`; `postCommentsInput(postIds, limit, sortOrder='most recent')` → `{ postIds: string[], limit, sortOrder }`. Mantieni i vecchi harvest builder finché T6 non li dismette.
- **validation**: unit sui builder: `profilePostsInput('https://www.linkedin.com/in/guido-penta/', 5)` produce `{username:'...guido-penta...', total_posts:5}`; `postCommentsInput(['7472928569657225216'], 100)` produce `postIds`/`limit`/`sortOrder` corretti.
- **status**: Done
- **log**: RED (`tests/apimaestro-actors.test.ts`, 4 casi) → GREEN. Aggiunti `ACTORS.profilePostsApimaestro` + `ACTORS.postComments`; builder `postCommentsInput(postIds,limit,sortOrder='most recent')`. ⚠️ **Deviazione**: il builder posts apimaestro è chiamato `profilePostsApimaestroInput` (NON `profilePostsInput`) per non collidere con il builder harvest omonimo che `freelance-post-reactors` ancora importa (T2 deve "tenere i vecchi builder fino a T6"). Stessa shape `{username,total_posts}` richiesta dalla validation. I vecchi `profilePostsInput`/`postReactionsInput` harvest restano (rimossi in T8).
- **files edited/created**: `src/apify/actors.ts`, `tests/apimaestro-actors.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "`postCommentsInput([id], 100)` ritorna l'oggetto con `postIds:[id]`, `limit:100`, `sortOrder:'most recent'`" — RED prima di scrivere il builder.
- **review_mode**: cli

### T3: Mapper puro — post item apimaestro → { activityId, postUrl, people[], companies[] }

- **depends_on**: [T0]
- **location**: `src/strategies/post-extract.ts` (nuovo), usa fixture `tests/fixtures/apimaestro-profile-posts.json` (T0)
- **description**: Funzione pura che, dato un item `linkedin-profile-posts`, estrae `activityId` (da `urn.activity_urn`/`full_urn`), `postUrl` (`url`), e dalle `text_annotations` **del post top-level** separa `people` (`type:'profile'` → `{name:text, profileUrn}`) e `companies` (`type:'company'` → `{name:text, companyUrn}`). Lettura tollerante (`field`). **D9 risolto**: le `text_annotations` di `reshared_post` **NON** si usano (solo il top-level), per evitare doppi conteggi e drift dell'autore originale; l'`activityId`/`postUrl` restano quelli del top-level (è lì che vivono i commenti dell'influencer).
- **validation**: sul fixture reale, il primo post di guido-penta dà `activityId='7472928569657225216'`, `people` con `{name:'Victoria'}`, `companies` con `{name:'Welyk', companyUrn:'105729725'}`.
- **status**: Done
- **log**: RED (`tests/post-extract.test.ts`, 3 casi) → GREEN. Creato `src/strategies/post-extract.ts` con `extractPost(item)` → `{activityId, postUrl, people[], companies[]}`. `activityId` da `urn.activity_urn`, fallback parse `full_urn` (activity|ugcPost). D9 verificato: le `text_annotations` di `reshared_post` sono ignorate (post#3 quote → 0 persone, solo company `Talentware` top-level). Tipi esportati: `TaggedPerson`, `CompanyRef`, `PostExtract`.
- **files edited/created**: `src/strategies/post-extract.ts` (nuovo), `tests/post-extract.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "parsando il fixture, il post #1 espone `activityId` corretto e una company `Welyk`/`105729725` dalle `text_annotations`" — RED prima del mapper.
- **review_mode**: cli

### T4: Mapper puro — commento apimaestro → RawCandidate(commenter)

- **depends_on**: [T0, T1]
- **location**: `src/strategies/post-extract.ts`, usa fixture `tests/fixtures/apimaestro-post-comments.json` (T0)
- **description**: Funzione pura che mappa un item commento → `RawCandidate` con `linkedinUrl = normalizeLinkedinUrl(author.profile_url)`, `fullName = author.name`, `headline = author.headline`, `sourceDetail='commenter'`, `raw`. `sourcePostUrl` dal `postUrl` passato dall'orchestratore; in fallback usa **`post_input`** (l'id post echeggiato dall'actor) per la linkage. Include sia `comment_type='comment'` sia `'reply'` (entrambi "chi risponde"). Scarta item senza `profile_url` valido. Dedup per URL a carico del chiamante. Schema **confermato** (§7) → asserzioni su campi reali, non solo shape.
- **validation**: dato l'item reale del fixture (`author.profile_url='https://www.linkedin.com/in/johnsmith/'`) → candidato `commenter` con URL normalizzato `https://www.linkedin.com/in/johnsmith`, `fullName='John Smith'`, `headline` valorizzata; un item `comment_type='reply'` è incluso; un item **senza** `profile_url` → null (scartato); lista vuota → `[]` (nessun throw).
- **status**: Done
- **log**: RED (5 casi in `tests/post-extract.test.ts`) → GREEN. `mapComment(item, postUrl?)` → RawCandidate `commenter` (URL normalizzato, name/headline da `author`, `sourcePostUrl` con fallback su `post_input`); include reply; scarta item senza `profile_url`. Helper `mapComments(items, postUrl?)` (lista vuota → []). Asserzioni su campi reali del fixture.
- **files edited/created**: `src/strategies/post-extract.ts`, `tests/post-extract.test.ts`
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "un item commento con `author.profile_url` produce un `RawCandidate` con URL normalizzato e `sourceDetail='commenter'`" — RED prima del mapper.
- **review_mode**: cli

### T5: Mapper puro — annotation persona → RawCandidate(tagged-person) + companyRef

- **depends_on**: [T0, T1]
- **location**: `src/strategies/post-extract.ts`
- **description**: Dalla persona taggata costruisci un `RawCandidate` con `sourceDetail='tagged-person'`. ⚠️ **Limite noto (RH)**: le `text_annotations` danno `profile_urn` (id membro `ACoAA…`) + nome, **non** un `/in/<slug>`; questa chiave **non deduplica** con i commentatori che usano `/in/<slug>` (vedi §5). Mapping: costruisci `https://www.linkedin.com/in/<profile_urn>`; **se la risolvibilità non è provata, scarta** (non fabbricare URL). **Spike obbligatorio in questa task**: smoke una annotation reale contro `apimaestro/linkedin-profile-detail` (forma URN accettata, `actors.ts:52-58`) per confermare che l'URN-as-URL si arricchisce; se fallisce, `tagged-person` resta **disabilitato** (flag config) e si annota il debito. Le aziende → `companyRef { name, companyUrn }` (le espande T7, non candidati persona qui).
- **validation**: annotation `type:'profile'` → candidato `tagged-person` con URL membro normalizzato (solo se lo spike conferma risolvibilità); annotation `type:'company'` → `companyRef`, mai candidato persona; spike documentato (risolvibile sì/no) nel `log` della task.
- **status**: Done (mapper) · Spike: DEFERRED a T14 (gated off)
- **log**: RED (2 casi) → GREEN. `mapTaggedPerson(p)` costruisce `https://www.linkedin.com/in/<profile_urn>` (case preservato), `sourceDetail='tagged-person'`; senza URN → null (non fabbrica URL). Company resta `companyRef` (separata già da `extractPost`, T3). **Spike risolvibilità — scoperta**: l'enrichment **daily** usa `dev_fusion/linkedin-profile-scraper` (`enrich/profile.ts:14`), NON apimaestro/profile-detail (quello è solo l'enrichment *progressivo*). La prova R1 documentata in `actors.ts:52-58` (URN-as-username) vale per apimaestro, **non** per dev_fusion → la risolvibilità URN sul path daily resta **non provata**. Decisione (fedele al fallback del plan): mapper implementato + testato, ma l'**emissione** dei `tagged-person` nel pipeline è gated da `config.taggedPersonEnabled` (**default false**, T8) finché lo smoke reale (T14) non conferma. Debito registrato in `brain/tech-debt/lead-engine/influencer-post-respondents.md`. Non eseguito un Apify call unilaterale a pagamento: lo spike live è batchato in T14 (autorizzato dall'operatore).
- **files edited/created**: `src/strategies/post-extract.ts`, `tests/post-extract.test.ts`, `brain/tech-debt/lead-engine/influencer-post-respondents.md` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "annotation profilo → `RawCandidate(sourceDetail='tagged-person')` con URL membro; annotation azienda → `companyRef`, mai un candidato persona" — RED prima del mapper; lo spike di risolvibilità è gate separato.
- **review_mode**: cli

### T6: Strategia `influencer-post-respondents` (orchestrazione)

- **depends_on**: [T1, T2, T3, T4, T5, T7]
- **location**: `src/strategies/influencer-post-respondents.ts` (rinomina da `freelance-post-reactors.ts`)
- **description**: Orchestrazione: `loadInfluencers()` → per ogni influencer `runActor(profilePostsApimaestro, profilePostsInput(url, POSTS_PER_INFLUENCER))` → per ogni post (entro finestra recente) `runActor(postComments, postCommentsInput([activityId], COMMENTS_PER_POST))` → candidati `commenter` (T4); più candidati `tagged-person` (T5); raccogli i `companyRef`, dedup, e passali a T7 per i candidati `company-expansion`. Dedup globale per URL normalizzato, rispetta `limit`, fail-fast se seed vuoto. `bucketHint:'misto'`. **Errori e vuoti per-post isolati**: un post con 0 commenti o commenti disabilitati contribuisce 0 e **non** fa fallire `source()`; se TUTTI i post rendono 0, `source()` ritorna `[]` (è il gather a registrarlo, poi il report mostra "0-pulito", non errore).
- **validation**: con actor mockati e 2 influencer, `source(50)` ritorna candidati con i 3 `sourceDetail` attesi, deduplicati e ≤ limit; un post con `comments=[]` non lancia e contribuisce 0; tutti i post a 0 → `source()` ritorna `[]` senza throw; seed vuoto → throw coerente.
- **status**: Done
- **log**: RED (`tests/influencer-post-respondents.test.ts`, 8 casi) → GREEN. Creato `src/strategies/influencer-post-respondents.ts` con core iniettabile `collectRespondents(limit, deps)` (deps: influencers, fetchPosts, fetchComments, expand, taggedPersonEnabled, recencyCutoffMs) + l'oggetto `Strategy` che wira `config` + `runActor`. Commentatori raccolti per primi (segnale più caldo), poi espansione-azienda col budget residuo. Errori per-post/​per-influencer isolati (try/catch → 0, niente throw). Filtro recency opzionale (post senza data non scartati). `tagged-person` emessi solo se `config.taggedPersonEnabled` (default off). Aggiunti i config knob (`postsPerInfluencer`, `commentsPerPost`, `postRecencyDays`, `companyExpansionRoles`, `companyExpansionPerCompany`, `primaryStrategyId`, `primaryWeight`, `taggedPersonEnabled`) + helper `bool/float/list` — necessari per compilare T6 (documentazione `.env.example` + cleanup a T8). **Il vecchio `freelance-post-reactors.ts` resta in piedi** finché T8 non lo rimuove e swappa il registry (suite verde tra i task). Full suite 113/113, typecheck pulito.
- **files edited/created**: `src/strategies/influencer-post-respondents.ts` (nuovo), `src/config.ts`, `tests/influencer-post-respondents.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "con actor mockati, `source(limit)` produce ≥1 candidato `commenter` e i candidati taggati/espansi, deduplicati per URL e ≤ limit" — RED prima dell'orchestrazione.
- **review_mode**: cli

### T7: Modulo espansione-azienda — companyRef[] → RawCandidate(company-expansion)

- **depends_on**: [T1, T5]
- **location**: `src/strategies/company-expansion.ts` (nuovo)
- **description**: Dati `companyRef[]` **deduplicati per `companyUrn` (fallback nome) attraverso TUTTI i post/influencer** (una stessa azienda taggata in più post si espande **una volta sola**), per ogni azienda esegui people-search `harvestapi` (`profileSearchInput("<ruolo> <nome>", location, perCompanyCap)`) sui ruoli decisionali configurati, mappa i risultati a `RawCandidate` con `sourceDetail='company-expansion'`. Cap per-azienda + lista ruoli da config. Riusa `mapProfileItem` (`people-search.ts:27`) se estraibile, altrimenti `field()` tollerante.
- **validation**: con profileSearch mockato, 1 `companyRef` e 2 ruoli → candidati `company-expansion` ≤ perCompanyCap, deduplicati; **la stessa azienda passata 3 volte produce una sola espansione** (cross-post dedup); 0 aziende → [].
- **status**: Done
- **log**: RED (`tests/company-expansion.test.ts`, 4 casi) → GREEN. `expandCompanies(companies, {roles, perCompany, location, search})` con people-search **iniettabile** (`PeopleSearch`, default = harvest `runActor`). Dedup aziende cross-post per `companyUrn` (fallback nome), cap `perCompany` cumulativo sui ruoli, dedup candidati per URL, riuso `mapProfileItem`. Errore di una singola ricerca isolato (contribuisce 0). `sourceDetail='company-expansion'`.
- **files edited/created**: `src/strategies/company-expansion.ts` (nuovo), `tests/company-expansion.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "dato un `companyRef`, il modulo emette candidati `company-expansion` (≤ cap) dalla people-search per ruolo" — RED prima del modulo.
- **review_mode**: cli

### T8: Registry rename + config knobs

- **depends_on**: [T6]
- **location**: `src/strategies/registry.ts`, `src/config.ts`, `.env.example`, **`scripts/seed-demo.ts`**
- **description**: Sostituisci `freelancePostReactors` con `influencerPostRespondents` in `ALL` (id `influencer-post-respondents`). **Aggiorna `scripts/seed-demo.ts` (righe ~21, ~108)** che hardcoda `'freelance-post-reactors'` come `source_strategy`/branch demo → altrimenti il DB demo seeda una strategia fantasma e rompe la verifica UI di T13 (fix MAJOR). Aggiungi in `config`: `postsPerInfluencer` (default 5), `commentsPerPost` (default 100), `postRecencyDays` (default 90), `companyExpansionRoles` (default lista decision-maker), `companyExpansionPerCompany` (default 3), e i pesi primazia (vedi T9). Documenta in `.env.example`. Rimuovi i builder/actor harvest post/reazioni se non più referenziati (lasciando `profileSearch` per T7).
- **validation**: `listStrategies()` contiene `influencer-post-respondents` e NON `freelance-post-reactors`; `npm run strategies` la elenca abilitata; `grep -r 'freelance-post-reactors' src scripts` → nessun match residuo.
- **status**: Done
- **log**: RED (`tests/registry-respondents.test.ts`, 2 casi) → GREEN. Registry: `influencerPostRespondents` sostituisce `freelancePostReactors` in `ALL` (messa **prima** = coerente con T9). Eliminato `src/strategies/freelance-post-reactors.ts` (`git rm`). Rimossi i builder/actor harvest morti (`profilePostsInput`, `postReactionsInput`, `ACTORS.profilePosts`, `ACTORS.postReactions`) — referenziati solo dal file eliminato. `scripts/seed-demo.ts` aggiornato (righe 21+108: `freelance-post-reactors`→`influencer-post-respondents`) → niente strategia fantasma nel DB demo (fix MAJOR RI). `.env.example` documenta tutti i nuovi knob. Residue check: solo i literal di backfill in `db/index.ts` restano (corretti). I config knob erano già stati aggiunti in T6 per compilare. Full suite 115/115, typecheck pulito, `npm run strategies` elenca la strategia.
- **files edited/created**: `src/strategies/registry.ts`, `src/apify/actors.ts`, `scripts/seed-demo.ts`, `.env.example`, `tests/registry-respondents.test.ts` (nuovo), `src/strategies/freelance-post-reactors.ts` (eliminato)
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "`getStrategy('influencer-post-respondents')` è definita e `getStrategy('freelance-post-reactors')` è undefined" — RED prima del rename.
- **review_mode**: cli

### T9: Primazia in `gather` — primaria per prima + budget dominante + riflusso

- **depends_on**: [T8]
- **location**: `src/pipeline/run.ts` (`gather`), `src/strategies/registry.ts` (ordine/peso), `src/config.ts`
- **description**: Sostituisci il budget equo con **due fasi, una sola chiamata `source()` per strategia** (no doppio costo API):
  1. **Primaria per prima**: chiama `influencer-post-respondents` con `min(POOL_SIZE, primaryCap)`, `primaryCap = round(POOL_SIZE * primaryWeight)` (default ~0.5). Aggiungi gli univoci; `remaining = POOL_SIZE − univociPrimaria`. Essendo prima, **vince le collisioni di URL** (attribuzione).
  2. **Le altre si dividono il RESIDUO con carry-over**: `strategiesLeft = N−1`; per ciascuna (in ordine) chiama `source(min(remaining, ceil(remaining / strategiesLeft)))`; poi `remaining −= univociAggiunti`, `strategiesLeft−−`; ferma a `remaining ≤ 0`.
  ⚠️ Il punto chiave del fix (re-gate MAJOR): la quota delle non-primarie è calcolata sul **residuo corrente**, NON su una quota pesata fissa — così se la primaria rende 0, `remaining = POOL_SIZE` e le altre lo riempiono fino a `min(Σ disponibili, POOL_SIZE)` (nessun under-fill). **NON rimuovere** il canale errore di T1: il `catch` continua a popolare `errorByStrategy`. `primaryWeight`/ordine da config.
- **validation**: unit con 3 strategie finte: (a) **primaria rende 0** → il totale estratto **= min(Σ disponibili, POOL_SIZE)** (le 2 altre, abbondanti, riempiono tutto il pool — è il test che l'algoritmo a quota-fissa falliva); (b) primaria sovrabbondante → riceve `primaryCap` (quota dominante) ed è iterata per prima; (c) primaria parziale (es. 30) → le altre si dividono `POOL−30` con carry-over; (d) **supply mista** (primaria 0 + una non-primaria a supply limitata) → totale = `min(Σ disponibili, POOL)` (blinda l'off-by-one nel decremento `remaining -= univociAggiunti`, non solo il caso tutte-abbondanti); (e) una strategia che lancia → `errorByStrategy` la contiene e il run prosegue.
- **status**: Done
- **log**: RED (`tests/gather-primacy.test.ts`, 6 casi) → GREEN. `gather` ora **esportata** e riscritta a due fasi: (1) primaria (`config.primaryStrategyId`) per prima, `primaryAsk = round(POOL*primaryWeight)`; (2) altre dividono il residuo con carry-over (`ceil(remaining/strategiesLeft)`), stop a `remaining≤0`. `remaining` calcolato sui candidati **realmente** resi (non sul cap) → niente under-fill quando la primaria rende poco. Canale errore T1 preservato. **Aggiunta necessaria**: se la lista ha **una sola** strategia (es. `runStrategy` della primaria) la primaria prende l'intero `limit` (niente split). **Post adversarial-review (BLOCKER risolto)**: aggiunta una **fase 3 "reclaim"** — quando primaria supply-rich OLTRE il cap + altre supply-thin, la fase 2 lasciava il pool sotto `min(Σ,POOL)` (riprodotto: 60 vs 90). Ora se `remaining>0` si ri-chiede (primaria per prima) alle strategie con `sourced≥asked` il target cumulativo `min(POOL, asked+remaining)`, bounded a ≤1 ri-chiamata per strategia, **solo** sul path di under-fill (nel caso comune la fase 2 riempie → nessuna chiamata extra). Nuovi casi (f)/(g)/no-reclaim. Ri-verificato indipendentemente → SHIP. 9/9 gather verdi, suite 131/131.
- **files edited/created**: `src/pipeline/run.ts`, `tests/gather-primacy.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S2
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "con primaria che rende meno della sua quota, `gather` riempie comunque fino a POOL_SIZE riversando il budget residuo sulle altre, e la primaria è iterata per prima" — RED prima di modificare `gather`.
- **review_mode**: cli

### T10: Azienda-first in selezione

- **depends_on**: [T8]
- **location**: `src/pipeline/select.ts` (`selectBucket`)
- **description**: Nel bucket **azienda**, a parità di fit, i candidati con `source_strategy='influencer-post-respondents'` sono selezionati **prima**. Aggiungi una chiave d'ordine leading (`CASE WHEN source_strategy = ? THEN 0 ELSE 1 END`) **solo per azienda**, preservando il cap per settore (`perSectorCap`) e l'eleggibilità (non già in `daily_selection`). ⚠️ La priorità agisce **dentro** l'ordinamento, quindi un candidato respondents può comunque finire in `overflow` per il cap di settore: il test deve coprire questa interazione, non solo il tie semplice. Bucket freelance invariato.
- **validation**: unit: (a) due azienda a pari `fit_score`, settori diversi → vince prima il respondents; (b) **interazione cap-settore**: con `perSectorCap` saturo dal settore del respondents, un respondents in eccesso va in overflow e non scavalca il cap — il comportamento è deterministico e documentato; (c) freelance invariato.
- **status**: Done
- **log**: RED (`tests/select-azienda-first.test.ts`, 3 casi) → GREEN. In `selectBucket`, SOLO per `bucket='azienda'`, chiave d'ordine leading `CASE WHEN source_strategy = ? THEN 0 ELSE 1 END` (param = `config.primaryStrategyId`), prima di `fit_score DESC, last_evaluated_at DESC`. `perSectorCap` ed eleggibilità invariati. Caso (b) reso **discriminante**: un non-resp dello stesso settore, pur più recente, perde contro i respondents nel cap → prova che il boost agisce; il 3° respondents (settore saturo) va comunque overflow. Freelance: nessun ramo CASE → invariato (test c lo prova). Full suite 124/124, typecheck pulito.
- **files edited/created**: `src/pipeline/select.ts`, `tests/select-azienda-first.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S2
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "a parità di fit in bucket azienda, `selectBucket` ritorna prima il candidato `influencer-post-respondents`" — RED prima del boost.
- **review_mode**: cli

### T11: Report onesto — join `runs` (0/errore/sourced/new/last-run)

- **depends_on**: [T1]
- **location**: `src/db/runs.ts` (`reportByStrategy`), `web/src/api/types.ts`
- **description**: `reportByStrategy` deve includere **anche le strategie senza contatti** unendo l'universo da `runs` (e/o registry) in LEFT JOIN con le metriche da `contacts`. Esponi `sourced` (Σ `runs.items_in`), `new` (Σ `runs.items_new`), `last_run` (max `created_at`) e lo stato derivato leggendo **`runs.run_error`** (canale già stabilito e popolato da T1/T9). Deriva i **4 stati** (AC5): mai-girata (no riga in `runs`), 0-pulito (`items_in=0`, no error), tutti-duplicati (`items_in>0` ma `extracted` piatto → gap sourced/new), errore (`run_error` non nullo nell'ultimo run). Ordine: preserva "vincitore (più positive) in cima", righe a 0 visibili in coda. Aggiorna `StrategyReportRow`/`StrategyReport`. Riga fantasma id storico: già neutralizzata dal backfill T1 (D10/RI).
- **validation**: vitest: (a) seed `runs` con `items_in=0` e nessun contatto → riga con `extracted=0`, `last_run` valorizzato (non assente); (b) seed `runs.run_error` non nullo → stato **errore** distinguibile da **0-pulito**; (c) `items_in>0` con 0 nuovi contatti → stato **tutti-duplicati** distinguibile.
- **status**: Done
- **log**: RED (`tests/report-honest.test.ts`, 2 casi) → GREEN. `reportByStrategy(knownStrategies=[])` riscritta: universo = unione di `contacts.source_strategy` ∪ `runs.strategy` ∪ `knownStrategies` (iniettate dal chiamante per evitare ciclo `db→registry`). Nuovi campi: `sourced` (Σ items_in), `new` (Σ items_new), `last_run` (max created_at), `state`. **4 stati** derivati con precedenza: `errored` (run_error sull'ultimo run) → `never-ran` (no runs + extracted 0) → `clean-0` (girato, sourced 0, extracted 0) → `all-duplicates` (sourced>0, new=0) → `ok`. Ordinamento invariato (vincitore in cima; righe a 0 in coda). `StrategyState` + `StrategyReportRow` estesi (server + web type). Full suite 126/126, typecheck pulito. (Il pass di `knownStrategies` da server/CLI è cablato in T12.)
- **files edited/created**: `src/db/runs.ts`, `web/src/api/types.ts`, `tests/report-honest.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S3
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "dopo un run dove la strategia rende 0, `reportByStrategy()` ritorna una riga per quella strategia con `extracted=0` (non l'assenza di riga)" — RED prima di joinare `runs`.
- **review_mode**: cli

### T12: Drill-down per sotto-fonte + parità CLI

- **depends_on**: [T1, T11]
- **location**: `src/db/runs.ts` (variante group-by `source_strategy, source_detail`), `src/server/app.ts` (`/api/report`), `src/eval/report.ts` (CLI)
- **description**: Aggiungi una vista per **sotto-fonte** (`source_detail`): rollup di default per strategia + breakdown opzionale (es. param/flag `?detail=1` su `/api/report` e `--detail` su `eval:report`). Le righe senza `source_detail` rendono "(non attribuito)". Mantieni `reportByStrategy` come **unica fonte** condivisa CLI/UI (invariante doc 06): la CLI deve riflettere le stesse colonne.
- **validation**: vitest: contatti con `source_detail` misti → il breakdown ritorna una riga per (`strategy`,`source_detail`) con conteggi corretti; senza param resta la vista per strategia.
- **status**: Done
- **log**: RED (`tests/report-subsource.test.ts`) → GREEN. Nuova `reportBySourceDetail()` (group-by `source_strategy, source_detail`; null → `(non attribuito)`). Server `/api/report?detail=1|true` → breakdown; default → `reportByStrategy(listStrategies().map(id))` (universo registry cablato qui, T11). CLI `eval:report --detail` + vista default arricchita (colonne `stato`/`sourced`/`nuovi` + legenda 4 stati). `reportByStrategy` resta l'unica fonte (doc 06). Smoke CLI: entrambe le viste renderizzano. Full suite 127/127, typecheck pulito.
- **files edited/created**: `src/db/runs.ts`, `src/server/app.ts`, `src/eval/report.ts`, `src/cli.ts`, `tests/report-subsource.test.ts` (nuovo)
- **backlog_item_id**: LE-IPR-S3
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "con `source_detail` in `('commenter','company-expansion')`, il breakdown espone due righe distinte con i conteggi giusti" — RED prima della query di drill-down.
- **review_mode**: cli

### T13: UI Report — colonne/stati nuovi + rate low-volume + sotto-fonte

- **depends_on**: [T11, T12]
- **location**: `web/src/routes/report.tsx`, `web/src/api/client.ts`, `web/src/api/types.ts`
- **description**: Rendi visibili `sourced`/`new`/`last_run` e i 4 stati zero/errore (mai-girata / 0-pulito / tutti-duplicati / errore); per `sent` sotto soglia mostra numeratore/denominatore invece di una percentuale fuorviante; aggiungi il drill-down per sotto-fonte (righe espandibili o vista `detail`). Estendi la legenda. Mantieni i banner empty/zero esistenti.
- **validation**: `agent-browser`: con DB seedato, la pagina mostra `influencer-post-respondents` anche a 0, distingue lo stato errore, e il drill-down elenca le sotto-fonti.
- **status**: Done
- **log**: GREEN (web build pulito + verifica `agent-browser` 0.27.0 su DB demo seedato in `/tmp`). `report.tsx` riscritta: colonne `Stato`/`Sourced`/`Nuovi`/`Ultimo run`; badge di stato a colori (`StateBadge`: ok=verde, clean-0/all-duplicates=amber, errore=rosso+riga rossastra, mai-girata=grigio); componente `Rate` che sotto soglia (`LOW_VOLUME=10` invii) mostra `n/inviate` invece di una % fuorviante; toggle "Dettaglio per sotto-fonte" ↔ "Vista per strategia" che carica `/api/report?detail=1` e rende la tabella sotto-fonte (`commenter`/`company-expansion`/`(non attribuito)`); legenda estesa; banner empty/no-outcomes preservati. Aggiunti `SubSourceReport` type + `api.reportDetail`. **Verifica visiva** (screenshot): i 4 stati distinti renderizzano, `influencer-post-respondents` compare con sourced=204, reply% low-volume mostra `1/3`/`2/6`, e il drill-down elenca commenter=5 + company-expansion=3. (Nota: il toggle è in fondo a destra e può finire clippato a viewport stretto; il click via ref off-screen può mancare — funziona con viewport adeguato; non è un bug funzionale.)
- **files edited/created**: `web/src/routes/report.tsx`, `web/src/api/client.ts`, `web/src/api/types.ts`
- **backlog_item_id**: LE-IPR-S3
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "in UID seedato a 0, la riga `influencer-post-respondents` è presente con stato leggibile (non assente)" — verifica `agent-browser`.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T14: Smoke reale + verifica end-to-end

- **depends_on**: [T8, T9, T10, T11]
- **location**: esecuzione manuale (no CI); eventuali fix in `src/apify/actors.ts`/mapper
- **description**: Con `APIFY_TOKEN` reale: `npm run cli -- pipeline --strategy influencer-post-respondents --limit 50`. Conferma > 0 commentatori reali, valida la forma del payload commenti contro il fixture (T4) e adegua `actors.ts`/mapper se i campi differiscono. Poi `npm run cli -- eval:report` e la UI report devono mostrare la strategia con i conteggi. Verifica che il geo-gate non azzeri tutto.
- **validation**: report (CLI + UI) mostra `influencer-post-respondents` con `extracted>0`; sotto-fonti popolate; nessuna regressione sulle altre strategie.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: LE-IPR-S1
- **backlog_item_url**: brain/specs/lead-engine/influencer-post-respondents/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: "un run reale limit=50 sui 2 influencer del seed estrae > 0 commentatori e la strategia compare nel report" — verifica manuale end-to-end.
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]
