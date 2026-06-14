---
domain: lead-engine
type: plan
spec: italy-geo-gate
links:
  - "[[specs/lead-engine/italy-geo-gate/SPEC|italy-geo-gate]]"
  - "[[domains/lead-engine/03-extraction-strategies|03 — Strategie di estrazione]]"
  - "[[domains/lead-engine/04-enrichment-scoring|04 — Enrichment e scoring]]"
created: 2026-06-14
updated: 2026-06-14
---

# PLAN — Gate geografico Italia sull'estrazione (`italy-geo-gate`)

**Status:** Complete
**Execution mode (suggerito):** `sequential`. Lo spec è piccolo e quasi tutto il codice vive in
**un nuovo modulo** (`src/pipeline/geo-gate.ts`) + **due punti di wiring** (`src/db/contacts.ts`,
`src/pipeline/run.ts`). C'è una sola opportunità di parallelismo (T4 sul DB è indipendente dalla
catena T1→T2→T3 sul nuovo modulo); per un singolo worker conviene comunque procedere in ordine.

> **Read/cost-side, additivo.** Nessuna modifica di schema (lo status è `TEXT` libero: `rejected_geo`
> è un nuovo *valore*, non una colonna). Nessun cambio alla selezione 20+20, ai modelli, ai prompt di
> scoring, né alla logica di routing del bucket (resta di Claude). La people-search resta pinnata a
> `location:'Italy'` a monte; questo gate è il **controllo difensivo a valle** (cintura + bretelle).

---

## 1. Situazione iniziale

Il Lead Engine estrae ogni giorno profili LinkedIn per cold-email sul mercato **italiano**. Stato
attuale verificato in discovery:

- **Funnel** (`src/pipeline/run.ts`): `gather → persist → prefilter → enrichAndScore → selectBucket
  → draftMany → export`. `enrichAndScore(rows)` è il **chokepoint condiviso**: lo chiamano sia
  `runDaily` (`run.ts:162`) sia `runStrategy` (`run.ts:222`). Internamente fa
  `enrichProfiles (Apify) → updateEnrichment → getByIds → scoreMany (Claude Haiku)`.
- **Dove vive la località:**
  - **Pre-enrichment**: solo dentro `contacts.raw_json` (il payload grezzo harvestapi salvato da
    `upsertCandidate`). `mapProfileItem` (`src/strategies/people-search.ts:27`) conserva l'item
    integrale in `raw` ma **non** estrae oggi alcuna località. **OQ#2 RISOLTA con payload reale**:
    l'actor profile-search ("Short") **espone** la località come **`location.linkedinText`** (es.
    `{ "location": { "linkedinText": "Cyprus" }, "currentPositions": [{ "title": "Global Talent
    Acquisition Business Partner", … }] }`). Quel profilo è **esattamente il bug osservato** (recruiter
    → bucket azienda, basato a Cipro): col gate viene scartato **pre-enrichment**. Il pre-gate è quindi
    pienamente realizzabile, non un best-effort speculativo.
  - **Post-enrichment**: la colonna strutturata `contacts.location`, valorizzata da
    `updateEnrichment` (`src/db/contacts.ts:96`) dai campi dev_fusion `location` /
    `addressWithCountry` / `geoLocation` (`src/enrich/profile.ts:27`).
- **Upstream già pinnato**: `profileSearchInput` passa `location` (default `'Italy'`) a harvestapi
  (`src/apify/actors.ts:25`, `people-search.ts:83`). Ma nessun passo verifica l'esito → il bug
  osservato (bucket azienda con profili non italiani) conferma che il filtro dell'actor **non basta**.
- **Scoring** (`src/score/rubric.ts`) classifica per **ruolo**; riceve `Località` nel testo del
  profilo ma **non ha alcuna regola di esclusione geografica**.
- **Freshness / "non pagare due volte"**: `persist` (`run.ts:75`) mette in `toProcess` un profilo
  noto solo se `!isFresh(id)`; `isFresh` (`contacts.ts:76`) è `true` solo se `last_evaluated_at` è
  entro `FRESHNESS_DAYS` (default 90). **Solo `updateScore` setta `last_evaluated_at`** → un profilo
  scartato *prima* dello scoring resterebbe con `last_evaluated_at = NULL` e verrebbe **ri-arricchito
  (ri-pagato) ad ogni run**. È esattamente il rischio di OQ#3.
- **Visibilità a valle** (verificato): `selectBucket` (`select.ts:11`) richiede `status='scored'`;
  `listCandidates` (`queries.ts:97-99`) richiede `status IN ('scored','selected','exported')`. Quindi
  un profilo scartato dal gate (che **non raggiunge mai** `scored`) è **strutturalmente assente** da
  selezione, pool candidati UI ed export. `searchContacts` elenca tutti gli status: i profili
  scartati compaiono nella lista Contatti **come `rejected_geo`** (osservabile), mai come
  `selected`/`exported`.
- **Test harness**: root **vitest** (`tests/*.test.ts`), DB isolato via `tests/setup.ts`, import
  dinamici (`await import()`). Il repo testa **funzioni pure** (es. `mapProfileItem`,
  `normalizeLinkedinUrl`) e l'API; **non** testa l'orchestrazione `run.ts` (chiama actor/LLM reali).

## 2. Problema

Lo scoring assegna il bucket solo per ruolo e **non scarta i profili fuori dall'Italia**. Risultato:
bucket popolati da profili non italiani, **inutili per l'outreach** e già costati enrichment Apify
(il costo dominante del funnel), scoring e bozza email. Serve un **gate geografico Italia** lungo il
funnel che (a) tagli i profili fuori target **nel punto più economico** in cui la località è nota e
(b) garantisca che **nessun** contatto fuori dall'Italia raggiunga `selected`/`exported`, su **tutti
i bucket**, **forward-only**.

## 3. Forma della soluzione

Un **doppio gate** geografico, entrambi dentro il chokepoint condiviso `enrichAndScore` (così
`runDaily` *e* `runStrategy` lo ereditano con una sola modifica), più un nuovo status terminale
`rejected_geo` per il tombstoning.

**Nuovo modulo puro e testabile `src/pipeline/geo-gate.ts`:**
- `classifyLocation(loc): 'italy' | 'foreign' | 'unknown'` — euristica deterministica, **senza
  dipendenze**, case-insensitive, **match per token/word-boundary** (non substring nudo, per non
  leggere "India" dentro "Indiana"). **Procedura ordinata (l'ordine conta)**:
  1. **token-paese estero** presente (lista completa dei paesi del mondo, ~195 + varianti:
     usa/us/u.s.a., uk/u.k., uae, cyprus, …) → `'foreign'`. La presenza di un paese estero
     **domina**: cattura es. `"San Marino, California, United States"` → estero (qui "San Marino" è la
     città californiana qualificata da "United States").
  2. **token-paese Italia** presente — `italy`/`italia`/`italie`/`italien`/`repubblica italiana`
     **+ le enclavi** `San Marino` (`repubblica di san marino`) e `Città del Vaticano`
     (`vatican`/`vatican city`/`holy see`/`santa sede`), incluse per **decisione D8** — → `'italy'`.
  3. **regione / città italiana** presente (milano/milan, roma/rome, torino/turin, napoli, bologna,
     firenze/florence, lombardia/lombardy, lazio, …) → `'italy'`.
  4. **città estera maggiore** presente (london, paris, madrid, …) senza segnale Italia → `'foreign'`.
  5. altrimenti → `'unknown'` (vuoto / nessun token riconosciuto).
  ⚠️ La lista-paesi estera dev'essere **completa**, non "i paesi comuni": la località di people-search
  è spesso solo il **paese** (es. `"Cyprus"`) — se non è in lista cade in `'unknown'` → tenuto dal
  pre-gate → enrichment pagato inutilmente. È statica e a bassa manutenzione (i paesi non cambiano).
- `locationFromRaw(raw): string | undefined` — estrattore **tollerante** dal payload grezzo
  harvestapi profile-search. **Path primario confermato dal payload reale: `location.linkedinText`**;
  fallback tolleranti per altre forme (`location` stringa, `location.parsed.text`, `geoLocation`,
  `addressWithCountry`, `addressWithoutCountry`, riusando `field(...)`); `undefined` se assente.
- `applyGeoGate(rows, mode): { kept, rejected }` — **partizione pura** (no DB, no I/O) con le due
  policy decise:
  - `mode='pre'` (pre-enrichment, **conservativo**): località = `locationFromRaw(raw_json)`; scarta
    **solo** se `classifyLocation === 'foreign'`; `italy`/`unknown` proseguono all'enrichment.
  - `mode='post'` (post-enrichment, **autoritativo/strict**): località = `classifyLocation(row.location)`;
    **tiene solo** `'italy'`; `'foreign'` **e** `'unknown'` vengono scartati (AC#1).
- `runGeoGatePre(rows)` / `runGeoGatePost(rows)` — wrapper "impuri" che: chiamano `applyGeoGate`,
  **tombstonano** i `rejected` via `markRejectedGeo`, **loggano** il conteggio, e ritornano i `kept`.
  Wrappati in `try/catch` **fail-open** (errore del gate → warning + passano tutte le righe), coerente
  col principio "best-effort ovunque".

**Wiring DB `src/db/contacts.ts`:**
- `markRejectedGeo(id)` — setta `status='rejected_geo'` **e** stampa `last_evaluated_at = nowIso()`,
  così la freshness esistente salta il profilo nei run futuri (no ri-enrichment, no ri-pagamento).

**Wiring funnel `src/pipeline/run.ts` (dentro `enrichAndScore`):**
- **Gate pre-enrichment**: `rows = runGeoGatePre(rows)` **prima** di `enrichProfiles(urls)`.
- **Gate post-enrichment**: dopo `updateEnrichment` + `getByIds(refreshed)`, `refreshed =
  runGeoGatePost(refreshed)` **prima** di `scoreMany`.

## 4. Decision ledger (risolto)

| # | Decisione | Esito | Rationale |
|---|-----------|-------|-----------|
| D1 | Gate pre-enrichment: costruirlo ora o rimandare (OQ#2)? | **Costruire entrambi i gate ora.** Il pre-gate legge `raw_json` in modo tollerante. | È l'unica cosa che può tagliare il costo Apify; quando l'actor non espone la località è un **no-op sicuro** (tutto `unknown` → prosegue). Rischio basso. |
| D2 | Località **ignota dopo** enrichment: tenere o scartare? (AC#1 vs OQ#1) | **Scartare (strict).** Il gate post-enrichment passa **solo** `'italy'`. | Lettura stretta di AC#1 ("ogni selected/exported è riconducibile all'Italia") + "correttezza sul volume". dev_fusion quasi sempre ritorna il paese → falsi negativi rari. |
| D3 | Tombstone dei profili scartati? (OQ#3) | **Tombstone**: status `rejected_geo` + `last_evaluated_at`. | Senza, i profili scartati *post-enrichment* (con `last_evaluated_at = NULL`) verrebbero ri-arricchiti e ri-pagati ad ogni run. Riusa il meccanismo di freshness esistente. |
| D4 | Osservabilità degli scarti (AC#5) | **Log console per run**, conteggi separati pre/post. | "log o telemetria" da SPEC; nessun cambio schema; coerente con lo stile di logging del funnel. |
| D5 | Euristica "Italia" | **Funzione pura deterministica** token-based (paese + regioni/città IT vs paesi/città esteri), match per word-boundary, lista espandibile. | Niente dipendenze/IP geolocalizzazione; testabile RED→GREEN; tarabile osservando i conteggi loggati. |
| D6 | Punto di inserimento | **Dentro `enrichAndScore`** (chokepoint condiviso). | Copre `runDaily` **e** `runStrategy` con una sola modifica; il pre-gate sta prima di `enrichProfiles`, il post-gate tra `updateEnrichment` e `scoreMany`. |
| D7 | Pre-gate vs post-gate policy | **Pre = scarta solo su `foreign`** (conservativo, non spreca la chance di arricchire un `unknown` italiano); **Post = tiene solo `italy`** (strict). | Massimizza il risparmio Apify senza falsi negativi pre-enrichment; correttezza garantita al gate finale. |
| D8 | Perimetro "Italia": includere **San Marino** e **Città del Vaticano**? | **Sì → `italy`**: enclavi italofone interamente dentro il territorio italiano e nello stesso mercato. La collisione con la città californiana "San Marino" è risolta dalla precedenza "paese-estero domina" (§3 step 1). | Decisione dell'owner (lead italofoni nelle enclavi restano validi per l'outreach italiano). **Non** è un gate linguistico generale (Non-Goal invariato): è l'estensione esplicita del confine a due micro-stati enclave nominati. |
| OQ#1 | Località assente/non determinabile | **Risolta → D2/D7**: `unknown` **prosegue** al pre-gate (non scartato su assenza) ma **viene scartato** al post-gate (strict). | — |
| OQ#2 | harvestapi Short espone la località? | **RISOLTA con payload reale: sì → `location.linkedinText`** (la località è spesso il solo paese, es. `"Cyprus"`). Il pre-gate è pienamente realizzabile; di qui la lista-paesi **completa** in D5. | — |
| OQ#3 | Tombstone vs scarto senza traccia | **Risolta → D3**: tombstone `rejected_geo` + `last_evaluated_at`. | — |

## 5. Assunzioni e vincoli

- **Forward-only**: nessuna ripulitura dei non-italiani già in DB/export (Non-Goal). Il gate vale
  solo per i profili processati d'ora in poi.
- **Nessun cambio di schema**: `rejected_geo` è un nuovo valore di `status` (colonna `TEXT`); nessuna
  migrazione, nessuna nuova colonna/indice. La scelta D4 (log) evita di toccare la tabella `runs`.
- **Nessun cambio a**: routing del bucket (resta di Claude), prompt di scoring, selezione 20+20,
  modelli, export. Il gate è puramente un layer difensivo additivo.
- **Best-effort / fail-open**: un errore nel gate non ferma il run; `classifyLocation` /
  `locationFromRaw` sono **totali** (non lanciano mai) e i runner sono in `try/catch` che, in caso di
  errore, lascia passare le righe con un warning.
- **Definizione di "Italia" = località**: geografica, non anagrafica/linguistica (un profilo basato
  in Italia con nome/nazionalità esteri **resta**; la classificazione guarda la stringa di località,
  non il nome).
- **Test**: tutta la logica decisionale è in funzioni pure/DB-backed testabili con vitest; il wiring
  in `run.ts` resta sottile (l'orchestrazione che chiama actor/LLM non è unit-testata, coerente col
  repo). Seed DB via `db.prepare().run()` con il DB temporaneo di `tests/setup.ts`, import dinamici.
- **`rejected_geo` e la UI**: nessuna modifica UI necessaria (Non-Goal: i filtri UI sono un'altra
  spec). I profili `rejected_geo` non compaiono in pool/selezione/export per costruzione; nella lista
  Contatti compaiono con quello status (osservabile).

## 6. Findings dal codice (riassunto operativo)

| Punto | File:riga | Implicazione |
|-------|-----------|--------------|
| Chokepoint condiviso | `src/pipeline/run.ts:112-145`, chiamato da `:162` (daily) e `:222` (strategy) | Inserire i due gate qui copre entrambi i path CLI con una modifica. |
| Località post-enrichment | `src/db/contacts.ts:96-120`, `src/enrich/profile.ts:27` | `contacts.location` è la fonte autoritativa per il gate post (campi `location`/`addressWithCountry`/`geoLocation`). |
| Località pre-enrichment | `src/strategies/people-search.ts:27-47` (`raw: item`), `contacts.raw_json` | Il pre-gate deve **parsare `raw_json`** e leggere la località in modo tollerante (OQ#2: forma incerta). |
| Freshness lega il tombstone | `src/db/contacts.ts:76-83` (`isFresh`), `:132-150` (`updateScore` setta `last_evaluated_at`) | Tombstone DEVE stampare `last_evaluated_at`, altrimenti il profilo scartato viene ri-arricchito ogni run. |
| Visibilità a valle | `src/pipeline/select.ts:11-13`, `src/server/queries.ts:97-99` | `rejected_geo` (mai `scored`) è escluso da selezione/pool/export per costruzione. AC#4 ✓. |
| Upstream pin | `src/apify/actors.ts:25-33`, `people-search.ts:83` | `location:'Italy'` resta (cintura); il gate è le bretelle. Nessuna modifica qui. |
| Scoring per ruolo | `src/score/rubric.ts:5-22` | **Non** si tocca: il gate è esterno allo scoring (Non-Goal: routing invariato). |
| Pattern test funzioni pure | `tests/extraction-mapping.test.ts` | Modello per i test di `classifyLocation`/`locationFromRaw`/`applyGeoGate`. |
| Pattern test DB | `tests/setup.ts`, `tests/api.test.ts` | Modello per i test di `markRejectedGeo`/`runGeoGatePre|Post` (seed `contacts`, asserisci status). |

## 7. Ricerca esterna

- **Nessuna nuova libreria.** L'euristica geografica è una funzione pura interna (lista-paesi
  completa + token Italia), deliberatamente senza servizi di geolocalizzazione/IP.
- **Forma del campo località confermata (OQ#2)** da un payload reale profile-search "Short":
  `location.linkedinText` (valore tipico = **solo il paese**, es. `"Cyprus"`; il resto dell'item ha
  `firstName`/`lastName`/`currentPositions[0].title|companyName` come già mappa `mapProfileItem`). Da
  questo discende la scelta D5 di una **lista-paesi completa** lato `foreign` (un paese non in lista
  cadrebbe in `unknown` e scapperebbe al pre-gate). Nota: la fonte del **post-gate** è invece la
  colonna piatta `contacts.location` riempita da dev_fusion (`location`/`addressWithCountry`), forma
  diversa già gestita leggendo direttamente la colonna.

## 8. Dependency graph & waves

```
Wave 1 ──► T1 classifyLocation ─┐         T4 markRejectedGeo (DB, indipendente)
                                 │
Wave 2 ──► T2 locationFromRaw ───┤  (stesso file: T1→T2→T3 serializzati)
                                 │
Wave 3 ──► T3 applyGeoGate ◄─────┘
                 │
Wave 4 ──► T5 runGeoGatePre/Post  ◄── (T3 + T4)
                 │
Wave 5 ──► T6 wiring in enrichAndScore  ◄── (T5)
```

- **Parallelismo possibile**: `T4` (su `src/db/contacts.ts`) è indipendente dalla catena
  `T1→T2→T3→T5` (su `src/pipeline/geo-gate.ts`) e può essere svolto in parallelo.
- **Serializzazione per-file**: `T1`, `T2`, `T3`, `T5` insistono sullo **stesso file**
  (`geo-gate.ts`) → vanno in ordine (edge di serializzazione, oltre che di dati).
- **Join**: `T5` dipende da `T3` (partizione) **e** `T4` (tombstone); `T6` dipende da `T5`.

## 9. Testing strategy

- **vitest, RED→GREEN reale** su tutte le funzioni pure e DB-backed. Nuovo file
  `tests/italy-geo-gate.test.ts` (import dinamici; per i test DB, seed via `db.prepare().run()` sul DB
  temporaneo di `tests/setup.ts`).
- **T1–T3 (pure)**: input/output diretti, nessun DB. Coprire i tre esiti (`italy`/`foreign`/`unknown`),
  i casi Italian-city-only, gli esteri, l'edge word-boundary ("Indiana" ≠ India), vuoto/null, e le
  forme di payload di `locationFromRaw`. Coprire **entrambe** le policy di `applyGeoGate` (pre tiene
  `unknown`, post lo scarta).
- **T4–T5 (DB)**: seed `contacts` con `raw_json`/`location` misti, invocare i runner, asserire (a) il
  set `kept` corretto e (b) che le righe scartate abbiano `status='rejected_geo'` e `last_evaluated_at`
  non nullo (tombstone verificabile + interazione con `isFresh`).
- **Seed template** (colonne `NOT NULL` obbligatorie su `contacts`: `linkedin_url`, `first_seen_at`;
  `status` default `'new'` — vedi schema `src/db/index.ts:7-32` e l'esempio `tests/api.test.ts`):
  ```ts
  db.prepare(
    `INSERT INTO contacts (linkedin_url, first_seen_at, status, location, raw_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('https://www.linkedin.com/in/test-1', nowIso(), 'enriched',
        'Milano, Lombardia, Italia',                              // per il post-gate
        JSON.stringify({ location: { linkedinText: 'Milano' } })); // per il pre-gate
  ```
  Per i test del **pre-gate** valorizzare `raw_json`; per il **post-gate** valorizzare `location`.
  Un `raw_json` `NULL` o non-JSON deve risultare in `unknown` (→ prosegue, non scartato dal pre-gate).
- **T6 (wiring)**: l'orchestrazione `enrichAndScore` chiama actor/LLM reali → **non** unit-testata
  (coerente col repo). Prova = `npm run typecheck` + suite intera verde + lettura che conferma che
  `runGeoGatePre` precede `enrichProfiles` e `runGeoGatePost` precede `scoreMany` (nessuna riga
  `foreign`/`unknown` può raggiungere `scoreMany`).
- **Sanity gate per ogni task**: `npm test` (nuovo test verde, RED→GREEN dimostrato) + `npm run
  typecheck` pulito.

### Matrice edge-case (tutti i casi da coprire nei test)

**`classifyLocation(loc)` — T1**

| Input | Atteso | Perché |
|-------|--------|--------|
| `'Milano, Lombardia, Italia'` | `italy` | token-paese |
| `'Italy'` · `'ITALIA'` · `'  italia  '` | `italy` | case-insensitive + trim |
| `'Roma'` · `'Rome'` · `'Milan'` · `'Firenze'` · `'Florence'` | `italy` | città IT (forma IT **ed** EN) |
| `'Lombardia'` · `'Sicily'` · `'Toscana'` | `italy` | regione IT |
| `'Greater Milan Metropolitan Area'` | `italy` | contiene città IT |
| `'Cyprus'` | `foreign` | **paese-only — caso bug reale** |
| `'San Francisco, California, United States'` | `foreign` | paese estero |
| `'London, United Kingdom'` · `'USA'` · `'U.S.'` · `'UAE'` | `foreign` | varianti/abbreviazioni |
| `'Indiana, United States'` | `foreign` | **word-boundary**: "india" non matcha dentro "indiana" → vince "United States" |
| `'Somalia'` | `foreign` | "mali" non matcha dentro "somalia" (boundary), Somalia in lista |
| `'Lugano, Switzerland'` | `foreign` | Svizzera, anche se italofona (paese estero, step 1) |
| `'San Marino'` · `'Repubblica di San Marino'` | `italy` | **enclave italofona (D8)** |
| `'Città del Vaticano'` · `'Vatican City'` · `'Holy See'` | `italy` | **enclave italofona (D8)** |
| `'San Marino, California, United States'` | `foreign` | **collisione**: paese estero "United States" domina sull'enclave (step 1) |
| `'Milano, then London'` (conflitto) | `italy` | nessun paese estero presente → vince la città IT (step 3) |
| `''` · `null` · `undefined` · `'Remote'` · `'Earth'` | `unknown` | vuoto / nessun token riconosciuto |

**`locationFromRaw(raw)` — T2**

| Input | Atteso |
|-------|--------|
| `{ location: { linkedinText: 'Cyprus' } }` | `'Cyprus'` (path primario reale) |
| `{ location: 'Milano, Italia' }` | `'Milano, Italia'` (forma stringa) |
| `{ location: { parsed: { text: 'Roma' } } }` | `'Roma'` (fallback) |
| `{ geoLocation: 'X' }` · `{ addressWithCountry: 'X' }` · `{ addressWithoutCountry: 'X' }` | `'X'` (fallback, nell'ordine di precedenza) |
| `{ location: { linkedinText: '' } }` · `{ location: {} }` · `{ location: null }` | `undefined` (vuoto = assente) |
| `{}` · `null` · `undefined` · `'stringa'` · `42` | `undefined` (totale, mai throw) |
| **payload dev_fusion** `{ experience: …, source: { location: 'Milano' } }` | `undefined` (**comportamento voluto, bloccato da test** — vedi nota scope in T2) |

**`applyGeoGate(rows, mode)` — T3**

| Scenario riga | `mode='pre'` | `mode='post'` |
|---------------|--------------|---------------|
| IT (raw/location italiana) | kept | kept |
| estero | rejected | rejected |
| unknown (nessuna località) | **kept** | **rejected** |
| `raw_json = NULL` | kept (unknown) | n/a |
| `raw_json` JSON non valido (`'{bad'`) | kept (try/catch → unknown) | n/a |
| input `[]` | `{ kept: [], rejected: [] }` | idem |
| ordine delle righe | preservato | preservato |

**`markRejectedGeo(id)` — T4**

| Scenario | Atteso |
|----------|--------|
| contatto `enriched`, `last_evaluated_at = NULL` | `status='rejected_geo'` + `last_evaluated_at` valorizzato; `isFresh(id,90) === true` |
| doppia chiamata | idempotente: resta `rejected_geo`, nessun errore |
| `id` inesistente | nessun throw (UPDATE su 0 righe) |

**`runGeoGatePre/Post(rows)` — T5**

| Scenario | Atteso |
|----------|--------|
| batch misto | ritorna **solo** i kept; i rejected hanno `status='rejected_geo'` nel DB |
| tutti esteri | ritorna `[]`; tutti tombstonati |
| input vuoto `[]` | ritorna `[]`; **nessuna** scrittura DB |
| **fail-open** | se un passo interno lancia (es. `markRejectedGeo` mockata a throw), ritorna `rows` **intatte** + warning loggato (best-effort; nessuna riga persa) |

> Ogni task implementa la propria fetta di questa matrice nel suo RED→GREEN; nessun caso resta
> scoperto. I casi "comportamento voluto" (dev_fusion → `undefined`, pre tiene `unknown`) sono
> **bloccati da test** per impedire regressioni che li "correggano" per errore.

## 10. Rischi & mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| **Lista-paesi `foreign` incompleta** → un paese estero non in lista (es. "Cyprus") cade in `unknown`, il pre-gate lo tiene e si paga l'enrichment inutilmente | Usare una **lista completa dei paesi del mondo** (statica, ~195 + varianti), non "i comuni"; il post-gate lo cattura comunque (correttezza salva, solo costo); conteggi loggati per spotare i miss. |
| **Falso negativo**: italiano con località solo-città non in lista → `unknown` → post-gate strict lo scarta | Includere token-paese **e** una lista curata di regioni/città IT; dev_fusion di norma include il paese; conteggi loggati per tarare la lista; **annotare come tech-debt** la manutenzione della lista. |
| **Falso positivo**: estero con token italian-sounding | Match per **word-boundary**, non substring; preferire segnali a livello di paese; coperto da test (es. "Indiana"). |
| Tombstone non interagisce con freshness → ri-enrichment | `markRejectedGeo` stampa `last_evaluated_at`; test su `isFresh` post-tombstone. |
| Errore nel gate ferma il run | `classifyLocation`/`locationFromRaw` totali; runner in `try/catch` **fail-open** con warning. |
| `rejected_geo` perde righe in superfici inattese | Verificato: escluso da selezione/pool/export per costruzione; compare solo nella lista Contatti come status osservabile. Nessuna modifica UI in questa spec. |
| Doppio path (`runDaily`/`runStrategy`) divergente | Gate dentro `enrichAndScore` (unico chokepoint) → entrambi coperti senza duplicazione. |

## 11. Validation gates

- **Dopo ogni task (T1–T5):** `npm test` (nuovo test verde, RED→GREEN dimostrato) + `npm run
  typecheck` pulito.
- **Dopo T6:** `npm run typecheck` pulito + **suite intera verde** (nessuna regressione) + re-read
  degli Acceptance Criteria contro `enrichAndScore`.
- **Gate finale di spec:** tutti gli AC riletti; in particolare AC#1 (solo Italia in selected/exported),
  AC#2 (scarto nel punto più economico: pre se località nel raw, post altrimenti), AC#3 (italiano con
  nome estero mantenuto), AC#4 (assenza da selezione/export/pool), AC#5 (conteggio loggato), AC#6
  (pin upstream + difesa downstream), AC#7 (gate non allentato per 20+20).

## 12. Domande aperte

Nessuna. **Tutte e tre le OQ sono risolte** (§4): OQ#1 e OQ#3 per decisione; **OQ#2 risolta da un
payload reale** → la località è esposta come `location.linkedinText` (spesso il solo paese, es.
`"Cyprus"`), quindi il pre-gate è pienamente realizzabile e la lista `foreign` dev'essere completa
(D5). Resta solo la normale taratura della lista di token in fase di implementazione (osservabile dai
conteggi loggati), non una domanda aperta.

---

## Tasks

### T1: `classifyLocation` — euristica pura Italia/estero/ignoto

- **depends_on**: []
- **location**: src/pipeline/geo-gate.ts (create), tests/italy-geo-gate.test.ts (create)
- **description**: Creare `src/pipeline/geo-gate.ts` con `export function classifyLocation(loc: string | null | undefined): 'italy' | 'foreign' | 'unknown'`. Euristica deterministica, case-insensitive, **match per token/word-boundary** (non substring nudo). Implementa la **procedura ordinata di §3**: **(1)** token-paese **estero** presente (lista completa dei paesi del mondo, ~195 + varianti: usa/us/u.s.a., uk/u.k., uae, cyprus, …) → `'foreign'` (**domina**: cattura "San Marino, California, United States" → estero); **(2)** token-paese **Italia** — `italy`/`italia`/`italie`/`italien`/`repubblica italiana` **+ le enclavi** `San Marino` (`repubblica di san marino`) e `Città del Vaticano`/`vatican`/`vatican city`/`holy see`/`santa sede`, per **decisione D8** — → `'italy'`; **(3)** regione/città italiana (milano/milan, roma/rome, torino/turin, napoli, bologna, firenze/florence, lombardia/lombardy, lazio, veneto, piemonte, …) → `'italy'`; **(4)** città estera maggiore (london/paris/madrid/…) senza segnale Italia → `'foreign'`; **(5)** altrimenti `'unknown'`. La lista-paesi estera dev'essere **completa**, perché la località è spesso il **solo paese** (es. `"Cyprus"`); un paese non in lista cadrebbe in `'unknown'` e scapperebbe al pre-gate. Funzione **totale** (mai throw).
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: 2026-06-14 — RED (modulo assente → 10 test falliti) → GREEN (10/10). `classifyLocation` con procedura ordinata di §3 + lista-paesi completa (~195 + abbreviazioni + nomi IT). Match per token/word-boundary via `tokenize()` (`\p{L}` Unicode-aware, accenti inclusi). `npm run typecheck` pulito.
- **files edited/created**: src/pipeline/geo-gate.ts (create), tests/italy-geo-gate.test.ts (create)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: `classifyLocation('Milano, Lombardia, Italia') === 'italy'`; `classifyLocation('San Francisco, California, United States') === 'foreign'`; **`classifyLocation('Cyprus') === 'foreign'`** (paese-only dal payload reale — il caso bug); `classifyLocation('Milan') === 'italy'` (città-only in lista); `classifyLocation('Indiana, United States') === 'foreign'` (word-boundary: "india" non matcha dentro "indiana"); **`classifyLocation('San Marino') === 'italy'`** e **`classifyLocation('Città del Vaticano') === 'italy'`** (enclavi, D8); **`classifyLocation('San Marino, California, United States') === 'foreign'`** (collisione: il paese estero domina); `classifyLocation('') === 'unknown'` e `classifyLocation(null) === 'unknown'`. RED: la funzione non esiste / ritorna `'unknown'` per `'Cyprus'` o per una stringa chiaramente italiana, oppure classifica la città californiana "San Marino" come `'italy'`. **Edge-case completi: §9 matrice (case-insensitive, trim, regioni/città IT, varianti estere, word-boundary, enclavi+collisione, vuoto/null).**
- **review_mode**: cli

### T2: `locationFromRaw` — estrattore tollerante dal payload grezzo

- **depends_on**: [T1]  <!-- stesso file geo-gate.ts: edge di serializzazione -->
- **location**: src/pipeline/geo-gate.ts, tests/italy-geo-gate.test.ts
- **description**: Aggiungere `export function locationFromRaw(raw: unknown): string | undefined` in `geo-gate.ts`. Estrae una stringa di località dal payload harvestapi profile-search in modo **tollerante** (riusa `field(...)` da `src/util/fields.ts`). **Path primario confermato dal payload reale: `location.linkedinText`** (es. `{ "location": { "linkedinText": "Cyprus" } }`). **Ordine di precedenza dei campi**: `location.linkedinText` → `location` (se stringa) → `location.parsed.text` → `geoLocation` → `addressWithCountry` → `addressWithoutCountry`. Ritorna `undefined` se nessun campo località è presente o se il valore è stringa vuota (coerente con `field`). Funzione **totale** (mai throw; input non-oggetto → `undefined`).
  ⚠️ **Scope deliberato (edge `raw_json` sovrascritto)**: `locationFromRaw` mira **solo** all'item della *people-search*. Dopo l'enrichment, `updateEnrichment` (`src/db/contacts.ts:96-119`) **sovrascrive** `raw_json` con il payload dev_fusion `{ experience, source: <item> }`, dove la località è annidata sotto `source` con forma piatta (`source.location`), **non** sotto `location.linkedinText`. Non inseguire quella forma qui: il pre-gate gira **prima** dell'enrichment (quando `raw_json` è ancora l'item search → il path c'è); per i profili già arricchiti la fonte autoritativa è la **colonna** `contacts.location` letta dal post-gate. Su un payload dev_fusion `locationFromRaw` ritorna quindi `undefined` (→ `unknown` → il pre-gate lascia passare, il post-gate decide). Questo comportamento va **bloccato con un test** (vedi §9 matrice), non "corretto".
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: 2026-06-14 — RED (6 test falliti) → GREEN (16/16). `locationFromRaw` con precedenza `location.linkedinText` → location-stringa → `parsed.text` → fallback top-level (`geoLocation`/`addressWithCountry`/`addressWithoutCountry`); dev_fusion (`source.location`) → `undefined`, bloccato da test. typecheck pulito.
- **files edited/created**: src/pipeline/geo-gate.ts (edit), tests/italy-geo-gate.test.ts (edit)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: sul **payload reale** `locationFromRaw({ location: { linkedinText: 'Cyprus' }, currentPositions: [...] }) === 'Cyprus'`; `locationFromRaw({ location: { linkedinText: 'Roma, Lazio, Italia' } }) === 'Roma, Lazio, Italia'`; gestisce anche `location` stringa, `addressWithCountry`, `geoLocation`; `locationFromRaw({}) === undefined` e `locationFromRaw(null) === undefined`. RED: ritorna `undefined` per `location.linkedinText` presente. **Edge-case completi: §9 matrice (forma stringa, `parsed.text`, fallback, vuoto→undefined, input non-oggetto, e il caso dev_fusion→`undefined` bloccato da test).**
- **review_mode**: cli

### T3: `applyGeoGate` — partizione pura con le due policy

- **depends_on**: [T2]  <!-- stesso file geo-gate.ts + usa T1,T2 -->
- **location**: src/pipeline/geo-gate.ts, tests/italy-geo-gate.test.ts
- **description**: Aggiungere `export function applyGeoGate(rows: ContactRow[], mode: 'pre' | 'post'): { kept: ContactRow[]; rejected: ContactRow[] }` in `geo-gate.ts`. **Pura** (nessun DB/I/O). `mode='pre'`: per ogni riga, località = `locationFromRaw(parsed)` dove `parsed` viene da `JSON.parse(row.raw_json)` in **try/catch** (`raw_json` `NULL` o JSON non valido → trattato come `unknown`, **non** scartato); scarta **solo** se `classifyLocation === 'foreign'`; `italy`/`unknown` → `kept`. `mode='post'`: località = `classifyLocation(row.location)`; **tiene solo** `'italy'`; `'foreign'` e `'unknown'` → `rejected`. Importa `ContactRow` da `src/db/contacts.js`.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: 2026-06-14 — RED (5 test falliti) → GREEN (21/21). `applyGeoGate` partizione pura; `pre` tiene IT+unknown e scarta solo foreign (raw_json NULL/JSON-invalido → unknown via try/catch), `post` strict tiene solo italy; ordine preservato; input vuoto ok. typecheck pulito.
- **files edited/created**: src/pipeline/geo-gate.ts (edit), tests/italy-geo-gate.test.ts (edit)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: dati tre `ContactRow` finti — uno con `raw_json` località italiana, uno estera, uno senza località — `applyGeoGate(rows, 'pre')` mette in `kept` l'italiano **e** l'ignoto, in `rejected` **solo** l'estero; `applyGeoGate(rows, 'post')` (con `row.location` italiana/estera/null) mette in `kept` **solo** l'italiano, in `rejected` estero **e** ignoto. RED: partizione errata (es. il pre scarta l'`unknown`, o il post tiene l'`unknown`). **Edge-case completi: §9 matrice (`raw_json` NULL/JSON-invalido → unknown → kept nel pre; input vuoto; ordine preservato).**
- **review_mode**: cli

### T4: `markRejectedGeo` — tombstone DB con stamp di freshness

- **depends_on**: []
- **location**: src/db/contacts.ts, tests/italy-geo-gate.test.ts
- **description**: Aggiungere `export function markRejectedGeo(id: number): void` in `src/db/contacts.ts` che esegue `UPDATE contacts SET status = 'rejected_geo', last_evaluated_at = ? WHERE id = ?` con `nowIso()`. Lo stamp di `last_evaluated_at` è **essenziale**: fa sì che `isFresh` salti il profilo nei run futuri (no ri-enrichment/ri-pagamento, OQ#3). Indipendente dalla catena `geo-gate.ts` (file diverso): parallelizzabile con T1–T3.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: 2026-06-14 — RED (2 test falliti) → GREEN (23/23). `markRejectedGeo` setta `status='rejected_geo'` + `last_evaluated_at=nowIso()`; verificato che `isFresh(id,90)` diventa `true` (no ri-enrichment futuro), idempotente, no-op su id inesistente. typecheck pulito.
- **files edited/created**: src/db/contacts.ts (edit), tests/italy-geo-gate.test.ts (edit)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: seminato un contatto con `status='enriched'` e `last_evaluated_at=NULL`, dopo `markRejectedGeo(id)` la riga ha `status='rejected_geo'` e `last_evaluated_at` non nullo, e `isFresh(id, 90)` ritorna `true`. **Intento**: `isFresh === true` ⇒ in `persist` il ramo `!isFresh(id)` è falso ⇒ il profilo **non** rientra in `toProcess` ⇒ niente ri-enrichment nei run futuri (OQ#3). RED: funzione assente / `last_evaluated_at` resta `NULL` (⇒ `isFresh` falso ⇒ ri-processato). **Edge-case completi: §9 matrice (idempotenza su doppia chiamata; `id` inesistente → nessun throw).**
- **review_mode**: cli

### T5: `runGeoGatePre` / `runGeoGatePost` — partizione + tombstone + log, fail-open

- **depends_on**: [T3, T4]
- **location**: src/pipeline/geo-gate.ts, tests/italy-geo-gate.test.ts
- **description**: Aggiungere in `geo-gate.ts` `export function runGeoGatePre(rows: ContactRow[]): ContactRow[]` e `export function runGeoGatePost(rows: ContactRow[]): ContactRow[]`. Ciascuno: chiama `applyGeoGate(rows, mode)`, per ogni riga in `rejected` invoca `markRejectedGeo(r.id)`, **logga** il conteggio (es. `console.log` `  → geo-gate (pre|post): scartati N fuori Italia`), ritorna `kept`. Avvolgere il corpo in `try/catch`: in caso di errore, **warning + ritorna `rows` intatte** (fail-open, "best-effort ovunque"). Importare `markRejectedGeo` da `../db/contacts.js`.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: 2026-06-14 — RED (5 test falliti) → GREEN (28/28). `runGeoGatePre/Post` via helper `runGeoGate(rows, mode)`: partiziona, tombstona i rejected, logga il conteggio, ritorna i kept; `try/catch` fail-open (warning + `rows` intatte) verificato mockando `markRejectedGeo` a throw. Input vuoto → nessuna scrittura DB (spy non chiamato). typecheck pulito.
- **files edited/created**: src/pipeline/geo-gate.ts (edit), tests/italy-geo-gate.test.ts (edit)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: seminati in `contacts` profili misti (raw_json IT/estero/assente per il pre; `location` IT/estero/NULL per il post), `runGeoGatePre(rows)` ritorna **solo** i kept attesi e le righe scartate risultano `status='rejected_geo'` nel DB; idem `runGeoGatePost(rows)` con la policy strict. RED: le righe scartate restano `status` precedente o vengono ritornate tra i kept. **Edge-case completi: §9 matrice (tutti esteri → `[]`; input vuoto → nessuna scrittura DB; fail-open: `markRejectedGeo` mockata a throw ⇒ ritorna `rows` intatte + warning).**
- **review_mode**: cli

### T6: Wiring dei due gate in `enrichAndScore`

- **depends_on**: [T5]
- **location**: src/pipeline/run.ts
- **description**: In `enrichAndScore` (`src/pipeline/run.ts:112-145`):
  **(a) Pre-gate** — subito dopo la guardia `if (rows.length === 0) return []` (`run.ts:113`), inserire `rows = runGeoGatePre(rows)`. La riga successiva `const urls = rows.map(...)` (`run.ts:116`) userà **automaticamente** le righe filtrate — **nessun ricalcolo separato di `urls`**. Se dopo il gate `rows` è vuoto i passi seguenti operano su array vuoti senza danni; facoltativo un `if (rows.length === 0) return []` aggiuntivo subito dopo il pre-gate.
  **(b) Post-gate** — dopo il loop `updateEnrichment` e `const refreshed = getByIds(rows.map(r=>r.id))` (`run.ts:123`), inserire `const gated = runGeoGatePost(refreshed)`. Poi **threadare `gated` ovunque al posto di `refreshed`/`rows`** a valle: `scoreMany(gated)` (`run.ts:125`) **e — punto critico — il return finale a `run.ts:144`**, oggi `getByIds(rows.map(r=>r.id)).filter(r=>r.status==='scored')`, che deve diventare `getByIds(gated.map(r=>r.id)).filter(...)`. ⚠️ **Se il return resta su `rows`, le righe tombstonate rientrano nel set ritornato e finiscono nell'export di `runStrategy` → viola AC#1/AC#4.**
  Importare i runner da `./geo-gate.js`. Nessuna modifica ai call-site di `runDaily`/`runStrategy`: entrambi ereditano via `enrichAndScore` (in `runDaily` la selezione interroga il DB direttamente — già ripulito dai tombstone; in `runStrategy` l'export usa il **valore di ritorno**, ripulito dal fix su `run.ts:144`). Non toccare routing/prompt/selezione.
- **validation**: `npm run typecheck` pulito + **suite intera verde** (nessuna regressione).
- **status**: Done
- **log**: 2026-06-14 — wiring applicato. (a) `rows = runGeoGatePre(rows)` dopo la guardia vuota + guardia aggiuntiva; `urls` usa le righe filtrate. (b) `const gated = runGeoGatePost(refreshed)` dopo `updateEnrichment`, threadato in `scoreMany(gated)`. (c) return finale cambiato in `getByIds(gated.map(r=>r.id)).filter(status==='scored')` — fix critico anti-leak nei tombstone per l'export di runStrategy. Orchestrazione non unit-testata (chiama Apify/Anthropic): provata da typecheck pulito + suite intera verde (8 file, 53 test) + lettura del flusso.
- **files edited/created**: src/pipeline/run.ts (edit)
- **backlog_item_id**: italy-geo-gate
- **backlog_item_url**: brain/specs/lead-engine/italy-geo-gate/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: wiring (orchestrazione che chiama actor/LLM reali → non unit-testata, coerente col repo). Prova: `npm run typecheck` pulito + suite intera verde; lettura che conferma che `runGeoGatePre` è invocato **prima** di `enrichProfiles` e `runGeoGatePost` **prima** di `scoreMany`, così nessuna riga `foreign`/`unknown` raggiunge lo scoring/la selezione. `reason_not_unit_tested`: orchestrazione con dipendenze esterne (Apify/Anthropic).
- **review_mode**: cli

---

## Backlog sync

Nessun tracker esterno (Linear/GitHub Issues) è cablato per questo dominio: la "backlog" sono le spec
in `brain/specs/lead-engine/`, indicizzate in [[specs/lead-engine/lead-engine-specs|lead-engine-specs]].
L'**epic** è questa SPEC; tutti i task puntano ad essa via `backlog_item_id: italy-geo-gate`
(`relation_mode: body-links`). Nessun item esterno creato/modificato.

- Voce nella mappa `lead-engine-specs.md`: aggiornata a **Implemented — vedi IMPLEMENTATION-NOTES**
  (era Draft → Draft — PLAN pronto durante il planning).
- OQ della SPEC: tutte e tre **Resolved** (vedi §4). OQ#2 confermata in implementazione: il pre-gate
  legge `location.linkedinText` dal `raw_json` di people-search (`locationFromRaw`).
- Manutenzione della lista di token geografici di `classifyLocation`: **non** trasformata in file
  `tech-debt/` (nessun drift durevole oggi). Da creare solo se i conteggi loggati `geo-gate (pre|post)`
  di un run reale mostrano falsi negativi ricorrenti. Registrata come osservazione in
  IMPLEMENTATION-NOTES (§Out of Scope).
