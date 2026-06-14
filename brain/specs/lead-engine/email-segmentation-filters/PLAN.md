---
domain: lead-engine
type: plan
spec: email-segmentation-filters
links:
  - "[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]"
  - "[[specs/lead-engine/email-draft-guard/SPEC|email-draft-guard]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
  - "[[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]"
created: 2026-06-13
updated: 2026-06-13
---

# PLAN — Segmentazione per presenza email e filtri persistenti (`email-segmentation-filters`)

**Status:** Complete
**Execution mode (suggerito):** `parallel` a ondate. Tre task server indipendenti partono in
parallelo; il resto è incanalato in **due catene FE sequenziali** che insistono sullo stesso file
(`contacts.index.tsx` e `selections.$date.tsx`) e quindi non vanno parallelizzate tra loro.

> Read-side puro: nessuna modifica di schema, nessuna migrazione. La presenza email è derivata da
> `contacts.email`. Selezione automatica 20+20 invariata (segmentazione solo a valle).

---

## 1. Situazione iniziale

La web UI (API locale **Hono** in `src/server/`, porta 8787 + **React 19 + TanStack
Router/Query + Tailwind 4** in `web/`) consente di consultare contatti e correggere le selezioni
prima dell'export CSV/JSON verso il tool email. Stato attuale verificato in discovery:

- **Filtri Contatti in `useState`** (`web/src/routes/contacts.index.tsx:35-39`: `q`, `bucket`,
  `status`, `strategy`, `page`) → persi a ogni navigazione/reload. La `queryKey` di React Query
  (`contacts.index.tsx:43`) deriva già da quello stato.
- **Zero `validateSearch`/`useSearch` in tutto `web/`** (grep pulito): questa spec introduce il
  **primo** stato-nell'URL del frontend. Il router è creato in modo nudo
  (`web/src/main.tsx`: `createRouter({ routeTree })`).
- **`searchContacts`** (`src/server/queries.ts:116`) compone clausole WHERE; espone già
  `sector`/`minFit` che il client **non** usa. Nessun filtro email.
- **`listCandidates`** (`src/server/queries.ts:89`) + endpoint `/api/selections/:date/candidates`
  (`src/server/app.ts:106`): nessun filtro email.
- **Export selezione** `/api/selections/:date/export.csv|.json` (`src/server/app.ts:117,127`):
  nessun parametro; `toCsv` (`src/export/csv.ts:31`) ha un `COLUMNS` fisso (`csv.ts:6`) senza
  readiness; il JSON è mappato inline nel handler.
- **Vista Selezione** (`web/src/routes/selections.$date.tsx`): marker ✉ per riga già presente
  (emerald se email, grigio se assente, righe 120-128); `BucketPanel` (:70) e `AddPanel` (:155, query
  candidati :157).
- **`getStats().withEmail`** (`src/server/queries.ts:200`) conta `email IS NOT NULL AND email <> ''`.
- **`hasEmail`** (`src/util/fields.ts`, introdotto dalla spec #2 `email-draft-guard`) usa la
  definizione che **trimma** lo whitespace (`email.trim() !== ''`).
- **Test harness**: root **vitest** (`tests/*.test.ts`) con pattern `app.request()` su Hono
  (`tests/api.test.ts`), DB isolato via `tests/setup.ts`. **`web/` non ha test runner** (solo `tsc
  --noEmit` come `typecheck`).

## 2. Problema

Due limiti d'uso, da SPEC:

1. **Non si distingue chi è contattabile via email da chi no** su nessuna superficie → non è chiaro
   chi sia pronto per un flusso email e chi vada arricchito/contattato a mano.
2. **I filtri non persistono**: aprendo il dettaglio di un contatto e tornando indietro, o
   ricaricando, si ritrova la lista intera e si re-imposta tutto da capo.

## 3. Forma della soluzione

Segmentazione **read-side** per presenza email su **quattro superfici** + persistenza dei filtri
**nell'URL** (ambito sessione, via TanStack Router search params).

**Layer server (testabile a costo zero con vitest + `app.request`):**
- Parametro filtro email `email=with|without` (omesso = tutti) su `searchContacts`,
  `listCandidates` e i due export; predicato `email IS NOT NULL AND email <> ''` (parità
  `getStats`).
- Colonna/flag **`email_ready`** negli export (CSV + JSON), sempre presente.
- Nuovo endpoint **`/api/contacts/export.csv|.json`** che riusa i filtri di `searchContacts`
  (export del set filtrato della pagina Contatti).

**Layer client/UI (validato con `agent-browser`):**
- Filtri della pagina Contatti migrati da `useState` → **search params dell'URL** (sopravvivono a
  dettaglio↔lista, navigazione, reload; condivisibili via link; `page` incluso) + **filtro tri-state
  email** (tutti / con email / senza email).
- **Export Contatti**: pulsante download sul set filtrato corrente + **toggle "solo email-ready"**
  separato dal filtro di vista.
- **Vista Selezione (Outcome 4)**: conteggio per-bucket "pronti per email vs da arricchire",
  distinzione visiva, **segmento "Da arricchire"** dedicato dentro ciascun bucket, filtro email nel
  pool dell'`AddPanel`, e download **"solo email-ready"** dell'export selezione.

## 4. Decision ledger (risolto)

| Decisione | Esito | Rationale |
|-----------|-------|-----------|
| Strategia di test FE (nuova, emersa in discovery) | **Logica read-side ⇒ vitest server** (`app.request`, RED→GREEN); **persistenza URL + UI ⇒ `agent-browser`**. Nessun runner FE aggiunto. | `web/` non ha test runner; aggiungere jsdom/RTL+router-harness è sproporzionato per un tool locale single-user. Il valore read-side è tutto server-side, dove l'harness è già forte. |
| OQ#1 — definizione "pronto per email" | **Sola presenza email** (`email` non null/non vuota). | Bozza e italianità garantite a monte da #2/#1; OQ#1 chiusa. |
| OQ#2 — superfici export | **Selezioni *e* Contatti** (nuovo `/api/contacts/export.*`). | L'utente ha esteso lo scope oltre la proposta della SPEC ("resta sulle Selezioni"). |
| OQ#2-forma — export Contatti | **Set filtrato corrente + toggle "solo email-ready"** separato dal filtro di vista; colonna `email_ready` sempre inclusa. | Il toggle, quando ON, forza `email=with` per il download a prescindere dalla tri-state di vista. |
| OQ#3 — ampiezza "da arricchire" | **Lista dedicata** → **segmento "Da arricchire" nella vista Selezione** (per bucket), oltre a filtro+conteggio. | L'utente ha scelto la lista dedicata; forma coerente con Outcome 4 (resta nella vista selezione, niente nuova route globale). |
| Definizione "con email" (coerenza) | `email IS NOT NULL AND email <> ''` (non-trim) per **filtro SQL** *e* **colonna `email_ready`** (JS). | Vincolo SPEC: parità con `getStats().withEmail`. Allinea filtro e readiness così nessuna riga è "con email" nel filtro ma `email_ready=false` nell'export. |
| Divergenza con `hasEmail` (trim) | **Accettata e documentata**; non si tocca `hasEmail` né `getStats`. | `hasEmail` (#2) trimma; qui si segue la parità `getStats` richiesta dalla SPEC. Il caso "email di soli spazi" è patologico (l'enrichment non lo produce). Unificare i tre predicati è tech-debt futuro, non questa spec. |
| Persistenza | **Solo pagina Contatti** (filtri + `page`) nell'URL. | Il filtro del pool `AddPanel` resta stato locale di componente (UI effimera, fuori da Outcome 2). |
| Plumbing gap `sector`/`minFit` | **Fuori scope**: si aggiunge **solo** `email` al client. | La SPEC lo nota ma non lo richiede; tenere il diff minimale. |

## 5. Assunzioni e vincoli

- **Read-side, nessuna mutazione**: gli export restano viste non distruttive dello stato del DB
  (vincolo SPEC). Nessun cambio a schema, selezione 20+20, modelli, prompt.
- **Contratto query-param unico** su tutte le superfici: `email=with` | `email=without` | omesso
  (= tutti). Stessa parola in server, client e URL.
- **Schema search-param Contatti** (`validateSearch`): `{ q?, bucket?, status?, strategy?, email?:
  'with'|'without', page? }`. I **default** (`q=''`, `page=1`, filtri vuoti) sono **omessi
  dall'URL** per URL puliti. Cambiare un filtro **azzera `page` a 1** (replica del `resetPage`
  odierno). La `queryKey` di React Query deriva dallo stato di ricerca.
- **`web/` non ha `zod`** (solo `@tanstack/react-router`): il `validateSearch` di F1 è una
  **funzione hand-rolled** (snippet in F1), non uno schema zod. Aggiungere zod a `web/` è fuori scope.
- **Sync `ContactFilters` server↔client**: S1 aggiunge `email` a `src/server/queries.ts`; C1 lo
  aggiunge a `web/src/api/types.ts`. Il gate `npm run typecheck` (root + web) cattura i
  disallineamenti tra i due tipi.
- **`email_ready`** rappresentato come booleano: `true`/`false` (CSV come testo, JSON come bool).
  Colonna additiva in coda al CSV → i consumatori esistenti non si rompono (rischio basso, annotato).
- **Determinismo dei test**: i nuovi test server seguono il pattern `tests/api.test.ts`
  (`createApp()`, `app.request`, seed via `db.prepare(...).run(...)` con DB temporaneo di
  `tests/setup.ts`). Nessuna dipendenza di rete.
- **`agent-browser`** disponibile come tool skill per la validazione delle superfici visive.

## 6. Findings dal codice (riassunto operativo)

| Punto | File:riga | Implicazione |
|-------|-----------|--------------|
| Filtri in `useState` + `resetPage` | `web/src/routes/contacts.index.tsx:35-48` | Migrazione completa a `validateSearch`/`useSearch`/`navigate`; mantenere reset di `page`. |
| Nessun search-param preesistente | `web/src/main.tsx`, grep `validateSearch` vuoto | Primo uso: definire lo schema sulla route `/contacts/`; rischio loop/redirect → schema con default e strip. |
| `searchContacts` WHERE builder | `src/server/queries.ts:116-161` | Aggiungere ramo `email`; riusare per il nuovo export (senza LIMIT/OFFSET). |
| `listCandidates` WHERE builder | `src/server/queries.ts:89-103` | Aggiungere ramo `email`. |
| Handler `/api/contacts` | `src/server/app.ts:137-153` | Parse `email` query; passthrough. |
| Handler candidates | `src/server/app.ts:106-115` | Parse `email` query; passthrough. |
| Export handlers | `src/server/app.ts:117-135` | Accettare `email`; iniettare `email_ready`. |
| `toCsv` / `COLUMNS` | `src/export/csv.ts:6-35` | `email_ready` è **derivato**, non è `keyof ContactRow`: aggiungere una colonna computata (header + cella) senza romperlo. |
| `hasEmail` (trim) | `src/util/fields.ts` | Predicato #2; **non** usato per la readiness di questa spec (vedi ledger). |
| Client `ContactFilters` | `web/src/api/types.ts:107-114` | Aggiungere `email?: 'with'|'without'`. |
| `api.candidates` / `csvUrl` / `jsonUrl` | `web/src/api/client.ts:53,74-80` | Aggiungere `email` a candidates; builder URL export con `email`/onlyReady; nuovi builder per export Contatti. |
| Marker ✉ + `BucketPanel`/`AddPanel` | `web/src/routes/selections.$date.tsx:70,120-128,155` | Outcome 4: conteggi, segmento "Da arricchire", filtro pool. Email già su ogni `SelectionItem`. |

## 7. Ricerca esterna

- **TanStack Router search params** (`validateSearch`, `Route.useSearch`, `navigate({ search })`):
  unico pezzo nuovo del frontend. Da consultare la doc primaria TanStack Router (via Context7 o
  web) in fase di implementazione di **F1** per: forma di `validateSearch`, coercizione/strip dei
  default, e pattern di update immutabile dello search state. Nessun'altra libreria nuova.

## 8. Dependency graph & waves

```
            ┌─────────────┐
Wave 1 ───► │ S1  S2  S3  │  (server, indipendenti, in parallelo)
            └──────┬──────┘
                   │
Wave 2 ───►   S4 (←S1,S3)      C1 (←S1,S2)      (in parallelo)
                   │                 │
Wave 3 ───►        │        F1 (←C1,S1) ────────────────── catena "contacts.*"
                   │        F3 (←C1) → F4 (←S2,C1,F3) → F5 (←S3,C1,F4)  ── catena "selections.*"
                   │
Wave 4 ───►        F2 (←F1,S4)        (catena "contacts.*", dopo F1)
```

- **Wave 1 (parallelo):** `S1`, `S2`, `S3` — funzioni/endpoint distinti, nessun conflitto di file.
- **Wave 2 (parallelo):** `S4` (riusa la WHERE di `searchContacts` + l'helper readiness CSV di S3),
  `C1` (plumbing client, contratto bloccato da S1/S2).
- **Wave 3 (parallelo *tra* le due catene, sequenziale *dentro* ciascuna):**
  - catena **contacts.\*** (stesso file `contacts.index.tsx`): `F1` → poi `F2` in Wave 4.
  - catena **selections.\*** (stesso file `selections.$date.tsx`): `F3` → `F4` → `F5`, serializzati
    via `depends_on` (F4←F3, F5←F4) anche se i loro prerequisiti server sono già pronti.
- **Wave 4:** `F2` (dopo `F1` e `S4`).

> ⚠️ I `depends_on` mescolano due tipi di edge: **dati/contratto** (es. F1←S1, F2←S4) e
> **serializzazione per-file** per evitare conflitti di merge su uno stesso file in worktree
> paralleli (F2←F1 su `contacts.index.tsx`; F4←F3 e F5←F4 su `selections.$date.tsx`, marcati con
> commento inline). Un esecutore che rispetta `depends_on` ottiene automaticamente l'ordine corretto.

## 9. Testing strategy

- **Server (S1–S4): vitest, RED→GREEN reale.** Nuovo file `tests/email-segmentation.test.ts` sul
  modello di `tests/api.test.ts` (`createApp()`, `app.request`, seed con `db.prepare().run()` su DB
  temporaneo). Ogni task ha un `tdd_target` che fallisce prima della modifica per il motivo giusto
  (parametro ignorato / endpoint 404 / colonna assente).
  - **Seed esplicito per S2/S3**: i test su candidates (S2) ed export selezione (S3) richiedono di
    inserire in `contacts` righe con `status='scored'` e `bucket` coerente, **miste per email**
    (`'a@b.com'`, `NULL`, `''`), **e** righe in `daily_selection` (`date, bucket, contact_id, rank`)
    per la data di test (vedi `getSelectionItems`/`listCandidates` per i campi attesi). S1 e S4
    seminano solo `contacts`. S2 ricorda che `listCandidates` esclude i contatti già in selezione.
- **Client plumbing (C1): solo type-level.** Validazione `npm --prefix web run typecheck`; il primo
  consumatore FE che compila è la prova. Nessun RED runtime (è plumbing di tipi/URL).
- **Frontend (F1–F5): `agent-browser`.** Niente runner FE (decisione del ledger). Ogni task FE
  definisce un `tdd_target` come **comportamento osservabile** da verificare via browser (es.
  filtri che sopravvivono a back/forward con URL coerente). `assigned_skills: [agent-browser]`.
- **Sanity gate per ogni task:** `npm run typecheck` (root, per i task server) **e/o** `npm --prefix
  web run typecheck` (per i task FE) + `npm test` (server) verde.

## 10. Rischi & mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| `validateSearch` è nuovo al codebase → typing/redirect-loop o URL sporchi di default | Schema con default espliciti e **strip dei default** dall'URL; ricerca doc primaria in F1; verifica back/forward + reload via browser. |
| Migrando i filtri all'URL, `queryKey` resta legata al vecchio `useState` → liste stale | `queryKey` derivata dallo **stato di ricerca** (`useSearch`); reset `page=1` al cambio filtro replicato. |
| `email_ready` non è `keyof ContactRow` → rompe il typing di `toCsv` | Colonna **computata** separata dal loop su `COLUMNS` (header + cella derivata da `r.email`), non un push in `COLUMNS`. |
| Incoerenza whitespace `hasEmail` (trim) vs filtro/readiness (non-trim) | Allineare **filtro e readiness su non-trim** (parità `getStats`, da SPEC); edge "soli spazi" patologico; divergenza documentata + nota tech-debt per unificazione futura. **Verificato**: `hasEmail` è usato **solo** in `src/email/draft.ts` (spec #2), mai nel filtering/readiness → divergenza contenuta e innocua. |
| Toggle "solo email-ready" export Contatti contraddittorio con filtro di vista `without` | Semantica fissata: toggle ON ⇒ **forza `email=with`** nel download (vince sul filtro di vista); OFF ⇒ usa l'`email` corrente di vista. |
| Colonna CSV `email_ready` aggiunta in coda rompe consumatori esterni | Additiva, ultima colonna; nessun rename/riordino delle esistenti; annotato. |
| Catene FE sullo stesso file in worktree paralleli → conflitti di merge | Serializzare F1→F2 e F3→F4→F5 (vedi §8). |

## 11. Validation gates

- **Dopo ogni task server (S1–S4):** `npm test` (nuovo test verde, RED→GREEN dimostrato) + `npm run
  typecheck` pulito.
- **Dopo C1:** `npm --prefix web run typecheck` pulito (più `npm run typecheck` root invariato).
- **Dopo ogni task FE (F1–F5):** `npm --prefix web run typecheck` + check `agent-browser` del
  `tdd_target` superato + re-read del relativo Acceptance Criterion della SPEC.
- **Gate finale di spec:** tutti e 4 gli Outcome riletti contro le superfici reali; suite server
  verde; typecheck root+web puliti.

## 12. Domande aperte

Nessuna bloccante. Tutte le OQ della SPEC sono risolte nel ledger (§4); OQ#2 e OQ#3 risolte con
opzione **più ampia** della proposta originale (export anche su Contatti; segmento "Da arricchire"
dedicato). Lo Status delle OQ nella SPEC è aggiornato a "Resolved → PLAN".

---

## Tasks

### S1: Filtro email su `searchContacts` + `/api/contacts`

- **depends_on**: []
- **location**: src/server/queries.ts, src/server/app.ts
- **description**: Aggiungere `email?: 'with' | 'without'` a `ContactFilters` (queries.ts) e un ramo WHERE: `with` → `email IS NOT NULL AND email <> ''`; `without` → `(email IS NULL OR email = '')`; assente → nessun vincolo. Nel handler `/api/contacts` (app.ts) leggere `c.req.query('email')`, accettare solo `with`/`without` (altrimenti ignorare), passare a `searchContacts`. Componibile con i filtri esistenti e la paginazione.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: RED → `app.request('/api/contacts?email=with')` ritornava 4 righe (param ignorato): `expected 4 to be 2`. GREEN dopo aver aggiunto `email?: 'with'|'without'` a `ContactFilters` + ramo WHERE (`email IS NOT NULL AND email <> ''` / `(email IS NULL OR email = '')`) in `searchContacts`, e parsing via helper `emailFilter()` nel handler `/api/contacts`. Verificata composizione con `bucket` e con `q` (q=`target`&email=without → total=1, solo la riga senza email; il ramo `email LIKE` di `q` non scavalca il filtro). Param invalido (`email=garbage`) ignorato → tutti. 2 test verdi, typecheck pulito.
- **files edited/created**: `src/server/queries.ts` (edit), `src/server/app.ts` (edit), `tests/email-segmentation.test.ts` (create — describe `/api/contacts email filter (S1)`)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: con un seed di contatti misti (alcuni con email, alcuni `email=NULL` e `email=''`), `app.request('/api/contacts?email=with')` ritorna **solo** righe con email non vuota e `total` coerente; `?email=without` solo quelle senza; `?email=with&bucket=freelance` compone. **Composizione con `q`**: `?q=<frammento-email>&email=without` esclude comunque ogni riga con email (il ramo `email LIKE` in `q` non scavalca il filtro). RED: parametro ignorato → le righe senza email compaiono lo stesso.
- **review_mode**: cli

### S2: Filtro email su `listCandidates` + `/api/selections/:date/candidates`

- **depends_on**: []
- **location**: src/server/queries.ts, src/server/app.ts
- **description**: Estendere `listCandidates(date, bucket, q, limit, email?)` con il medesimo predicato email di S1 (stessa parola `with`/`without`). Nel handler candidates (app.ts:106) leggere `c.req.query('email')` e passarlo. Mantenere l'ordinamento e il `limit` esistenti.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: RED → `candidates?bucket=freelance&email=with` ritornava 3 candidati (param ignorato): `expected length 1, got 3`. GREEN dopo aver esteso la firma `listCandidates(date, bucket, q, limit, email?)` con lo stesso predicato non-trim (su alias `c.email`) e passato `emailFilter(c.req.query('email'))` dal handler candidates. Verificato: `email=with`→1, `email=without`→2, nessun filtro→3 (con un contatto già in `daily_selection` correttamente escluso a prescindere). 3 test verdi, typecheck pulito.
- **files edited/created**: `src/server/queries.ts` (edit), `src/server/app.ts` (edit), `tests/email-segmentation.test.ts` (edit — describe candidates email filter (S2))
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: con contatti `scored` di un bucket misti per email e una selezione del giorno, `app.request('/api/selections/<date>/candidates?bucket=freelance&email=with')` ritorna **solo** candidati con email; `?email=without` solo senza. RED: parametro ignorato.
- **review_mode**: cli

### S3: `email_ready` + filtro email sull'export Selezione

- **depends_on**: []
- **location**: src/export/csv.ts, src/server/app.ts
- **description**: (a) In `toCsv` aggiungere una colonna **computata** `email_ready` (header in coda + cella `true`/`false` da `r.email != null && r.email !== ''`), senza inserirla in `COLUMNS` (non è `keyof ContactRow`). (b) Nei due handler export (app.ts:117,127) accettare `email=with|without` e filtrare le righe di `getSelectionItems(date)` con lo stesso predicato prima di serializzare. (c) Nel payload JSON aggiungere `email_ready: boolean` per riga. L'export resta vista non distruttiva. **Nota effetto collaterale intenzionale**: `toCsv` è usato anche da `exportContacts` (`src/export/csv.ts:50`, percorso CLI/pipeline — `src/cli.ts:73`, `src/pipeline/run.ts:190,231`) → la colonna `email_ready` comparirà **anche** negli export CLI. È **voluto** (coerenza CLI↔UI, additivo): nessun parametro opzionale, una sola code-path. Aggiornare le eventuali asserzioni di test CLI esistenti sul CSV se presenti.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: RED → header CSV non conteneva `email_ready` (last-column check) e `export.json` non esponeva il campo (`expected undefined to be true`). GREEN dopo: (a) colonna computata `email_ready` in `toCsv` (header `[...COLUMNS, 'email_ready']` + cella `csvCell(emailReady(r))`, helper `emailReady` non in COLUMNS); (b) entrambi gli handler export selezione filtrano `getSelectionItems(date)` con `filterByEmail(rows, emailFilter(...))` prima di serializzare; (c) JSON via nuovo `toJsonRow` che aggiunge `email_ready: boolean`. Verificato: CSV `email_ready` ultima colonna con 1 `true`/2 `false`; `export.csv?email=with` omette i senza email; `export.json` espone bool e filtra con `email=without`. Effetto collaterale `toCsv` (CLI/pipeline) confermato innocuo: full-suite 25/25 verde (nessun test asseriva la shape CSV). 5 test verdi, typecheck pulito.
- **files edited/created**: `src/export/csv.ts` (edit), `src/server/app.ts` (edit), `tests/email-segmentation.test.ts` (edit — describe export readiness+filter (S3))
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: per una selezione con righe miste: l'header CSV di `export.csv` contiene `email_ready` e le celle riflettono presenza/assenza; `export.csv?email=with` **omette** le righe senza email; `export.json` espone `email_ready` booleano per riga. RED: colonna `email_ready` assente e parametro `email` ignorato.
- **review_mode**: cli

### S4: Nuovo export filtrato della pagina Contatti `/api/contacts/export.csv|.json`

- **depends_on**: [S1, S3]
- **location**: src/server/queries.ts, src/server/app.ts
- **description**: Aggiungere `listContactsForExport(filters)` in queries.ts: stessa WHERE di `searchContacts` (inclusi `email`, `q`, `bucket`, `status`, `strategy`), **senza** LIMIT/OFFSET, stesso ordinamento. Nuovi handler `/api/contacts/export.csv` e `/api/contacts/export.json` (app.ts) che **parsano esplicitamente** `email`, `q`, `bucket`, `status`, `strategy` (come `/api/contacts`) e li passano a `listContactsForExport`; **ignorano `page`/`pageSize`** e ritornano sempre l'intero set filtrato (intenzionale: si esporta una lista curata, non una pagina). Riusano l'helper CSV con colonna `email_ready` di S3 e il mapping JSON. Content-Disposition `attachment; filename="contacts-<...>.csv|json"`.
- **validation**: `npm test` (nuovo test verde) + `npm run typecheck`.
- **status**: Done
- **log**: RED → `/api/contacts/export.json` ritornava 404 (`Endpoint inesistente.`): `expected 404 to be 200`. GREEN dopo: estratta la WHERE condivisa in `contactsWhere(f)` + costante `CONTACTS_ORDER`, aggiunto `listContactsForExport(f)` (stessa WHERE incl. email, niente LIMIT/OFFSET, stesso ORDER BY); nuovi handler `/api/contacts/export.csv|.json` registrati **prima** di `/contacts/:id` (altrimenti il param `:id` cattura `export.csv`), che riusano un helper condiviso `contactFiltersFromQuery(req)` (stesso parsing di `/api/contacts`) + `toCsv` (con `email_ready`) e `toJsonRow`. `Content-Disposition: attachment; filename="contacts-export.csv|json"`. Verificato: export ritorna l'intero set (35 righe nonostante `?pageSize=10&page=2` → paginazione ignorata), `?email=with`→30, `?status=scored&bucket=freelance` compone, JSON espone `email_ready` e filtra con `email=without`. 7 test verdi, typecheck pulito.
- **files edited/created**: `src/server/queries.ts` (edit), `src/server/app.ts` (edit), `tests/email-segmentation.test.ts` (edit — describe contacts export (S4))
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: `app.request('/api/contacts/export.csv')` ritorna CSV di tutti i contatti filtrati con colonna `email_ready`; `?email=with` filtra agli email-ready; `?status=scored&bucket=freelance` compone; `export.json` espone `email_ready`. RED: endpoint inesistente → 404 (`Endpoint inesistente.`).
- **review_mode**: cli

### C1: Plumbing client — tipo `email`, API e URL builder

- **depends_on**: [S1, S2]
- **location**: web/src/api/types.ts, web/src/api/client.ts
- **description**: (a) Aggiungere `email?: 'with' | 'without'` a `ContactFilters` (types.ts:107). (b) Estendere `api.candidates(date, bucket, q, email?)` (client.ts:53) per propagare `email`. (c) Cambiare la firma `csvUrl(date, options?: { email?: 'with'|'without' })` / `jsonUrl(date, options?)` (client.ts:74-80) e aggiungere i builder `contactsCsvUrl(filters: ContactFilters)`/`contactsJsonUrl(filters)` che serializzano i filtri via `qs` verso `/api/contacts/export.csv|.json`. (d) Esportare un helper puro `isEmailReady(email: string|null): boolean` (`email != null && email !== ''`, parità non-trim) riusabile dalla UI per conteggi e badge.
- **validation**: `npm --prefix web run typecheck` pulito.
- **status**: Done
- **log**: (a) Aggiunto `email?: 'with' | 'without'` a `ContactFilters` in `types.ts`, posizionato dopo `strategy` e prima di `page` (coerente con lo schema search-param di §5 e con la `ContactFilters` server di S1). (b) `api.candidates` ora accetta un 4° parametro opzionale `email?: 'with' | 'without'` e lo propaga via `qs({ bucket, q, email })` (il filtro è omesso dall'URL quando `undefined`, comportamento esistente di `qs()`). (c) `csvUrl`/`jsonUrl` hanno ora firma `(date, options?: { email?: 'with' | 'without' })` e appendono `?email=...` riusando `qs()`; aggiunti `contactsCsvUrl(filters)`/`contactsJsonUrl(filters)` che serializzano l'intero `ContactFilters` via `qs({ ...filters })` verso `/api/contacts/export.csv|.json`. (d) Esportato `isEmailReady(email: string | null): boolean` come `email != null && email !== ''` (non-trim, parità con `getStats().withEmail` e con la colonna `email_ready` del server). Gate `npm --prefix web run typecheck` pulito (vedi sotto). Nessun RED runtime: plumbing puro di tipi/URL — `reason_not_testable`: tipi e URL builder, la prova è il typecheck web pulito + il primo consumatore FE (F1–F5) che compila.
- **files edited/created**: `web/src/api/types.ts` (edit), `web/src/api/client.ts` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: i tipi/URL builder compilano e i consumatori FE (F1–F5) li importano senza errori; `isEmailReady` esportato. Nessun RED runtime: prova = `tsc --noEmit` su web pulito + primo consumatore FE che compila.
- **review_mode**: cli

### F1: Contatti — filtri nell'URL (persistenza) + filtro tri-state email

- **depends_on**: [C1, S1]
- **location**: web/src/routes/contacts.index.tsx
- **description**: Definire `validateSearch` sulla route `/contacts/` come **funzione hand-rolled** (`web/` non ha zod), che coerce/strip i default così non finiscono nell'URL:
  ```ts
  type ContactSearch = { q?: string; bucket?: string; status?: string; strategy?: string; email?: 'with' | 'without'; page?: number };
  const validateSearch = (s: Record<string, unknown>): ContactSearch => {
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
    const n = Number(s.page);
    return {
      q: str(s.q), bucket: str(s.bucket), status: str(s.status), strategy: str(s.strategy),
      email: s.email === 'with' || s.email === 'without' ? s.email : undefined,
      page: Number.isInteger(n) && n > 1 ? n : undefined, // default 1 ⇒ omesso
    };
  };
  ```
  Sostituire i `useState` (righe 35-39) con `Route.useSearch()` + `Route.useNavigate()`; ogni cambio filtro fa `navigate({ search: (prev) => ({ ...prev, <campo>: v || undefined, page: undefined }) })` (azzera `page`). `queryKey`/`queryFn` derivano dallo search state e passano `email` ad `api.contacts`. Aggiungere il `<select>` tri-state email (Tutti / Con email / Senza email) accanto agli altri filtri. Verificare contro la doc TanStack Router (Context7/web) la forma esatta attesa da `createFileRoute({ validateSearch })`.
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done — codice + validazione `agent-browser` (Wave 3) passata ✅
- **log**: Confermata via Context7 (`/tanstack/router`, v1.170) la forma di `createFileRoute({ component, validateSearch })` con `validateSearch` come funzione hand-rolled `(input) => OutputSearch` (no zod in `web/`), `Route.useSearch()`/`Route.useNavigate()` e l'updater immutabile `navigate({ search: (prev) => ({ ...prev, ... }) })`. Aggiunto il tipo `ContactSearch` + la funzione `validateSearch` (helper `str()` per i campi stringa, `email` ammesso solo `with`/`without`, `page` intero `>1` altrimenti `undefined` ⇒ default 1 strippato dall'URL) e registrata su `createFileRoute('/contacts/')({ component, validateSearch })`. Rimossi i 5 `useState` (q/bucket/status/strategy/page) → ora derivati da `Route.useSearch()`; `page = search.page ?? 1`. Helper `setFilter(field, value)` → `navigate({ search: (prev) => ({ ...prev, [field]: value || undefined, page: undefined }) })` (azzera la pagina a 1 a ogni cambio filtro), cablato su input `q` + select `bucket`/`status`/`strategy`/`email`; paginazione via `goToPage(p)` che scrive `page` nell'URL (omesso quando `<=1`). `queryKey`/`queryFn` derivano dallo search state e passano `email` ad `api.contacts`. Aggiunto il `<select>` tri-state email (`EMAIL_OPTIONS`: Tutti/Con email/Senza email → ''/with/without) accanto agli altri filtri, stessa `selectCls`. Evidenza: `npm --prefix web run typecheck` pulito (esce 0, nessun errore). `routeTree.gen.ts` **non** rigenerato (i tipi di `validateSearch` si inferiscono dal sito `createFileRoute`; il generatore non li tocca; assente da `git status`). `reason_not_testable`: nessun runner FE in `web/` (solo `tsc`); il `tdd_target` è comportamento browser-observable, verificato via `agent-browser` in Wave 3.
- **files edited/created**: `web/src/routes/contacts.index.tsx` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: impostando `bucket=freelance` + email "con email" e spostandosi a **pagina 2**, aprendo il dettaglio di un contatto e tornando indietro (e dopo un reload) **filtri *e* pagina corrente restano applicati** e l'URL porta `?bucket=freelance&email=with&page=2`; il filtro tri-state restringe lista e conteggio e **azzera la pagina a 1**; copiando l'URL in una nuova scheda si riottiene la stessa lista filtrata. (Verifica via `agent-browser`.)
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### F2: Contatti — export del set filtrato + toggle "solo email-ready"

- **depends_on**: [F1, S4]
- **location**: web/src/routes/contacts.index.tsx
- **description**: Aggiungere alla pagina Contatti i controlli di download (CSV/JSON) che usano `contactsCsvUrl/contactsJsonUrl` con i filtri di search correnti, più un **toggle "solo email-ready"** che, quando attivo, forza `email=with` nell'URL di download (a prescindere dalla tri-state di vista); quando spento usa l'`email` corrente. Il toggle è **stato locale di componente (`useState`), non persistito nell'URL**: incide **solo** sulla costruzione dell'href di download, non sul filtro di vista né sulla lista mostrata. Il download è un `<a href download>` come negli export selezione.
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done — codice + validazione `agent-browser` (Wave 3) passata ✅
- **log**: Aggiunti i controlli di download CSV/JSON come `<a href download>` nelle `actions` del `PageHeader` (stile `btn.primary`/`btn.ghost` come gli export selezione), con href costruiti da `contactsCsvUrl(exportFilters)`/`contactsJsonUrl(exportFilters)`. Aggiunto il toggle "solo email-ready" come **stato locale** `useState(false)` (`onlyEmailReady`), reso come `<input type="checkbox">` con `<label>` accanto ai download. `exportFilters` deriva dai filtri di search correnti (`q`/`bucket`/`status`/`strategy`) ma per `email` usa `onlyEmailReady ? 'with' : email`: quando il toggle è ON forza `email=with` nell'href di download a prescindere dalla tri-state di vista (anche se la vista è su `without`); quando è OFF usa l'`email` corrente. Il toggle incide **solo** sull'href di download — non sullo search state/URL né sulla lista mostrata (la `queryKey`/`queryFn` restano legate al solo `email` di vista). Evidenza: `npm --prefix web run typecheck` pulito. `reason_not_testable`: nessun runner FE in `web/`; il `tdd_target` (href + download) è browser-observable, verificato via `agent-browser` in Wave 3.
- **files edited/created**: `web/src/routes/contacts.index.tsx` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: con un filtro di vista attivo, il link "Scarica CSV" punta a `/api/contacts/export.csv?<filtri correnti>`; attivando "solo email-ready" l'href diventa `...?...&email=with` anche se la vista era su "senza email"; il file scaricato contiene la colonna `email_ready`. (Verifica via `agent-browser` su href + un download.)
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### F3: Selezione — conteggi pronti/da-arricchire, distinzione visiva, segmento "Da arricchire"

- **depends_on**: [C1]
- **location**: web/src/routes/selections.$date.tsx
- **description**: In `BucketPanel` mostrare per ciascun bucket il conteggio "pronti per email (con email) vs da arricchire (senza email)" usando `isEmailReady`. Rendere i due insiemi visivamente distinti nella lista (oltre al ✉ già presente, righe 120-128). Estrarre i senza-email in un **segmento "Da arricchire"** dedicato dentro il pannello del bucket (sezione separata dai "pronti"). Nessun cambio dati: `email` è già su ogni `SelectionItem`.
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done — codice + validazione `agent-browser` (Wave 3) passata ✅
- **log**: Importato `isEmailReady` dal client. In `BucketPanel` le `rows` sono partizionate in `ready = rows.filter(c => isEmailReady(c.email))` e `toEnrich = rows.filter(c => !isEmailReady(c.email))`. Aggiunta una barra conteggi sotto l'header del bucket con due pill: "✉ N pronti per email" (verde, `bg-emerald-50 text-emerald-700`) e "M da arricchire" (ambra, `bg-amber-50 text-amber-700`). La lista è ora resa in due segmenti distinti: (1) "Pronti per email · N" (titoletto verde, righe su sfondo bianco neutro; placeholder se vuoto), (2) **segmento dedicato "Da arricchire · M"** reso solo se `toEnrich.length > 0`, visivamente distinto con sfondo ambra tenue (`bg-amber-50/40`), bordo superiore ambra, titoletto ambra e una riga di hint ("Senza email: da arricchire o contattare a mano prima dell'invio."). Per evitare duplicazione della markup di riga (e il `useMutation remove`), la `<li>` è stata estratta in un componente `SelectionRow({ c, onRemove, removing })` riusato da entrambi i segmenti — il marker ✉ esistente (emerald/grigio) è preservato dentro la row. La distinzione visiva va quindi **oltre** il solo ✉ (sezioni separate, sfondo/bordo/titolo a colori, pill di conteggio). Evidenza: `npm --prefix web run typecheck` pulito (exit 0). `reason_not_testable`: nessun runner FE in `web/` (solo `tsc`); il `tdd_target` è comportamento browser-observable, verificato via `agent-browser` in Wave 3.
- **files edited/created**: `web/src/routes/selections.$date.tsx` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: aprendo una Selezione con righe miste, ogni bucket mostra "N pronti · M da arricchire" coerenti col contenuto, i senza-email appaiono in un segmento "Da arricchire" separato e sono visivamente distinguibili dai pronti. (Verifica via `agent-browser`.)
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### F4: Selezione — filtro email nel pool dell'`AddPanel`

- **depends_on**: [S2, C1, F3]  <!-- F3 = edge di serializzazione su selections.$date.tsx -->

- **location**: web/src/routes/selections.$date.tsx
- **description**: In `AddPanel` (:155) aggiungere un controllo filtro per presenza email (tutti / con email / senza email) che passa `email` ad `api.candidates`; includere `email` nella `queryKey` dei candidati (:158). Stato locale di componente (non URL — fuori da Outcome 2).
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done — codice + validazione `agent-browser` (Wave 3) passata ✅
- **log**: In `AddPanel` aggiunto stato **locale** `const [email, setEmail] = useState<'' | 'with' | 'without'>('')` (non URL — fuori da Outcome 2). Reso un `<select>` tri-state (costante `EMAIL_FILTER_OPTIONS`: Tutti `''` / Con email `with` / Senza email `without`) accanto all'input di ricerca, avvolti in un `<div className="flex gap-2">`; il select riusa `inputCls` con `w-auto shrink-0` per non rubare spazio all'input. La `queryKey` dei candidati ora include `email` (`['candidates', date, bucket, q, email]`) e `queryFn` chiama `api.candidates(date, bucket, q, email || undefined)` — `''` (Tutti) viene normalizzato a `undefined` così il param è omesso dall'URL (`qs()` già strippa gli `undefined`). Il filtro si combina con la ricerca testuale `q` (entrambi nella queryKey, entrambi passati all'API). Evidenza: `npm --prefix web run typecheck` pulito (exit 0). `reason_not_testable`: nessun runner FE in `web/`; il `tdd_target` è browser-observable, verificato via `agent-browser` in Wave 3.
- **files edited/created**: `web/src/routes/selections.$date.tsx` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: nel pannello "+ Aggiungi", selezionando "con email" il pool elenca solo candidati con email; "senza email" solo quelli senza; combinato con la ricerca testuale. (Verifica via `agent-browser`.)
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### F5: Selezione — download export "solo email-ready"

- **depends_on**: [S3, C1, F4]  <!-- F4 = edge di serializzazione su selections.$date.tsx -->
- **location**: web/src/routes/selections.$date.tsx
- **description**: Accanto ai download "Scarica CSV"/"JSON" (righe 41-48) aggiungere il controllo "solo email-ready" che usa `csvUrl(date, { email: 'with' })`/`jsonUrl(...)`; il download integrale resta disponibile e include comunque la colonna `email_ready` (da S3).
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done — codice + validazione `agent-browser` (Wave 3) passata ✅
- **log**: Nelle `actions` del `PageHeader` (dopo i due download integrali "⬇ Scarica CSV" / "JSON", che restano invariati) aggiunto un separatore verticale (`<span className="mx-1 h-5 w-px bg-slate-200">`) e due nuovi `<a href download>`: "⬇ Solo email-ready (CSV)" → `csvUrl(date, { email: 'with' })` e "JSON" → `jsonUrl(date, { email: 'with' })`, entrambi stile `btn.ghost` con `title` esplicativo. Gli href generati sono `/api/selections/<date>/export.csv?email=with` e `.json?email=with` (il server di S3 filtra i contatti senza email). Il download integrale resta disponibile e include la colonna `email_ready` (da S3). Evidenza: `npm --prefix web run typecheck` pulito (exit 0). `reason_not_testable`: nessun runner FE in `web/`; il `tdd_target` (href + download) è browser-observable, verificato via `agent-browser` in Wave 3.
- **files edited/created**: `web/src/routes/selections.$date.tsx` (edit)
- **backlog_item_id**: email-segmentation-filters
- **backlog_item_url**: brain/specs/lead-engine/email-segmentation-filters/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: il controllo "solo email-ready" produce un href `/api/selections/<date>/export.csv?email=with` e il file scaricato esclude i contatti senza email; il download integrale contiene la colonna `email_ready`. (Verifica via `agent-browser` su href + un download.)
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

---

## Backlog sync

Nessun tracker esterno (Linear/GitHub Issues) è cablato per questo flusso: la "backlog" del dominio
sono le spec in `brain/specs/lead-engine/`, indicizzate in
[[specs/lead-engine/lead-engine-specs|lead-engine-specs]]. L'**epic** è questa SPEC; tutti i task
puntano ad essa via `backlog_item_id: email-segmentation-filters` (`relation_mode: body-links`).
Nessun item creato/modificato. Lo Status della spec nella mappa resta **Draft** finché non
implementata. Le OQ#1–#3 della SPEC sono marcate "Resolved → PLAN" (vedi §4).
