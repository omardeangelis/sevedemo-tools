---
domain: lead-engine
type: flow
status: implemented
ingested: true
last_ingested: 2026-06-14
links:
  - "[[specs/lead-engine/email-segmentation-filters/SPEC]]"
  - "[[specs/lead-engine/email-segmentation-filters/IMPLEMENTATION-NOTES]]"
created: 2026-06-14
updated: 2026-06-14
---

# Flow — Segmentare per presenza email (tutte le superfici)

Filtro/segmentazione **read-side** per presenza email, coerente su tutte e quattro le superfici della
web UI: pagina **Contatti**, **pool candidati** (AddPanel delle Selezioni), **vista Selezione del
giorno** ed **export**. Nessuna modifica di schema: la presenza è derivata da `contacts.email`. La
[[05-selection-email-export|selezione automatica 20+20]] resta invariata — questa è segmentazione **a
valle**,
non influenza il fit. Vedi il concetto [[presenza-email]] per la definizione del predicato e
[[stato-filtri-url]] per come il filtro Contatti viene persistito.

**Trigger:** l'operatore sceglie uno stato del filtro email tri-state (**tutti / con email / senza
email**) su una qualsiasi superficie.

**Attori:** le route React (`web/src/routes/contacts.index.tsx`, `web/src/routes/selections.$date.tsx`),
il client API (`api.candidates`, gli URL di export in `web/src/api/client.ts`), gli endpoint Hono
(`src/server/app.ts`), il layer query (`searchContacts`, `listCandidates`, `listContactsForExport` +
l'helper condiviso `contactsWhere` in `src/server/queries.ts`), il predicato di
[[presenza-email|presenza email]] non-trim.

```mermaid
flowchart TD
    A[Operatore sceglie email tri-state<br/>tutti / con / senza] --> B{Quale superficie?}
    B -- Contatti --> C[client → /api/contacts?email=with|without]
    B -- Pool candidati --> D[api.candidates → /api/selections/:date/candidates?email=]
    B -- Selezione del giorno --> E[righe già caricate<br/>partizione client-side]
    C --> F[contactFiltersFromQuery legge email]
    D --> F
    F --> G[contactsWhere applica il predicato<br/>with: email IS NOT NULL AND email &lt;&gt; ''<br/>without: email IS NULL OR email = '']
    G --> H[Componibile con q / bucket / status / strategia + paginazione]
    H --> I[Lista + conteggio filtrati]
    E --> J[isEmailReady per riga → ready / toEnrich]
    J --> K[Conteggi per bucket: ✉ N pronti / M da arricchire]
    K --> L[Segmento dedicato Da arricchire + distinzione visiva]
    I --> M[Vista segmentata coerente:<br/>stesso predicato ovunque]
    L --> M
```

## Passi

1. **Selezione del filtro.** L'operatore sceglie uno dei tre stati. Il vocabolario di query è identico
   su tutti gli endpoint: `email=with` (solo con email), `email=without` (solo senza), **parametro
   omesso = tutti**.
2. **Contatti** (`contacts.index.tsx`): il valore vive nei search param dell'URL ([[stato-filtri-url]]);
   il client chiama `/api/contacts?email=…`. Server: `contactFiltersFromQuery(req)` legge `email`,
   `contactsWhere(f)` aggiunge la clausola WHERE. Il filtro è **componibile** con testo, bucket, status,
   strategia e con la paginazione (stesso `WHERE`, `ORDER BY CONTACTS_ORDER`).
3. **Pool candidati** (AddPanel in `selections.$date.tsx`): stato locale tri-state passato in
   `api.candidates(date, bucket, q, email)` e incluso nella `queryKey`; `listCandidates(…, email)`
   applica il ramo email su `c.email`.
4. **Selezione del giorno** (`selections.$date.tsx`): le righe del giorno sono partizionate client-side
   con `isEmailReady` in `ready` / `toEnrich`; per ciascun bucket compaiono i conteggi
   «✉ N pronti per email» (verde) e «M da arricchire» (ambra), un **segmento dedicato "Da arricchire"**
   e la distinzione visiva per riga (oltre al marker ✉ preesistente).
5. **Predicato unico (non-trim).** Tutte le superfici di filtro usano la stessa condizione SQL —
   `email IS NOT NULL AND email <> ''` per "con", `(email IS NULL OR email = '')` per "senza" — scelta
   per **parità con `getStats().withEmail`** (Constraint della SPEC), non `hasEmail` (che fa trim). Vedi
   la divergenza nota in [[presenza-email]].
6. **Esito terminale:** vista segmentata coerente su ogni superficie; i contatti senza email non sono
   rimossi né riclassificati — restano consultabili e instradabili a futuri flussi di enrichment
   (Non-Goal della SPEC). L'export segmentato è il flow gemello [[export-email-ready]].

## [Source: SPEC + IMPLEMENTATION-NOTES email-segmentation-filters]

- **Ondate di esecuzione (parallel):** la logica server (S1–S4) è stata implementata da un'unica lane
  (owner del cluster `src/server/*` + `src/export/csv.ts` + test), perché i task condividevano gli
  stessi file; le lane FE sono state serializzate per il gate `tsc` di `web/`.
- **Refactor per riuso:** estratti `contactsWhere()` + `CONTACTS_ORDER` (condivisi da `searchContacts` e
  `listContactsForExport`) e `contactFiltersFromQuery()`. Comportamento invariato, coperto dai test.
- **Verifica:** server via vitest (`tests/email-segmentation.test.ts`, 25/25 verde; smoke reale
  `email=with`→36 / `without`→98); FE via `agent-browser` contro l'app reale (conteggi Selezione:
  freelance 3/17, azienda 11/9 — tutti PASS).
- **Gap noto (fuori scope):** `sector`/`minFit` restano non esposti nel client `ContactFilters`; questa
  spec ha aggiunto solo `email`. Vedi [[stato-filtri-url]].
