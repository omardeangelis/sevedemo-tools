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

# Flow — Export segmentato "solo email-ready"

Download CSV/JSON come **vista non distruttiva** dello stato del DB, ora segmentabile per presenza
email. Ogni riga espone un flag di **email-readiness** (`email_ready`) e l'operatore può scaricare
**solo i contatti con email** senza perdere gli altri. Vale su due superfici: gli export delle
**Selezioni** (preesistenti, ora parametrizzati) e i nuovi export della pagina **Contatti**. Estende il
passo export di [[05-selection-email-export]]; per il filtro a monte vedi [[segmentazione-presenza-email]].

**Trigger:** l'operatore attiva un controllo di export (link `<a download>`) su Contatti o sulla
Selezione del giorno.

**Attori:** il client (`csvUrl`/`jsonUrl` con opzioni, `contactsCsvUrl`/`contactsJsonUrl` in
`web/src/api/client.ts`), gli endpoint Hono di export (`src/server/app.ts`), il layer query
(`listContactsForExport` in `src/server/queries.ts`), la serializzazione CSV (`toCsv` + `emailReady` in
`src/export/csv.ts`) e JSON (`toJsonRow` + `isEmailReady` in `app.ts`).

```mermaid
flowchart TD
    A[Operatore attiva un export] --> B{Quale superficie?}
    B -- Contatti --> C[contactsCsvUrl/JsonUrl filtri correnti<br/>+ toggle locale 'solo email-ready' → email=with]
    B -- Selezione --> D[csvUrl/jsonUrl date<br/>full · oppure email:'with']
    C --> E[/api/contacts/export.csv|.json<br/>registrato PRIMA di /contacts/:id/]
    D --> F[/api/selections/:date/export.csv|.json?email=]
    E --> G[listContactsForExport: stesso WHERE, niente LIMIT/OFFSET]
    F --> H[righe selezione filtrate per email]
    G --> I[Per riga: flag email_ready]
    H --> I
    I --> J{Formato}
    J -- CSV --> K[colonna email_ready in coda alle COLUMNS]
    J -- JSON --> L[campo email_ready via toJsonRow<br/>signals parsato, raw_json droppato]
    K --> M[Download: vista non distruttiva<br/>nessuna mutazione di stato]
    L --> M
    M --> N[Senza-email non persi: scaricabili a parte<br/>separati dagli email-ready]
```

## Passi

1. **Scelta dello scope di export.**
   - **Contatti:** `contactsCsvUrl(filters)` / `contactsJsonUrl(filters)` rispecchiano i **filtri
     correnti** della lista; un **toggle locale "solo email-ready"** (useState) forza `email=with`
     sull'href senza toccare i filtri della pagina.
   - **Selezione:** download integrale, oppure «Solo email-ready (CSV)» → `csvUrl(date, { email: 'with' })`.
2. **Endpoint.** I nuovi `/api/contacts/export.csv|.json` sono registrati **prima** di `/contacts/:id`,
   altrimenti il param `:id` cattura `export.csv` (annotato nel codice). La paginazione è ignorata per
   gli export (`listContactsForExport` riusa lo stesso `WHERE` ma senza `LIMIT/OFFSET`).
3. **Flag per riga.** Ogni riga espone `email_ready`:
   - **CSV:** colonna `email_ready` **in coda** alle `COLUMNS` (non inserita nell'array `COLUMNS`),
     calcolata da `emailReady(row)` non-trim.
   - **JSON:** campo `email_ready` aggiunto da `toJsonRow` (che preserva il comportamento originale:
     `signals` parsato, `raw_json` droppato).
4. **Non distruttivo.** L'export resta una **vista** dello stato corrente del DB: nessuna mutazione al
   download (coerente con il comportamento attuale).
5. **Nessuno perso.** I contatti senza email non vengono persi: restano scaricabili (export integrale),
   separati dagli email-ready per i futuri flussi di enrichment.

## [Source: SPEC + IMPLEMENTATION-NOTES email-segmentation-filters]

- **OQ#2 risolta:** l'export "solo email-ready" è stato esteso **anche alla pagina Contatti**, non solo
  alle Selezioni.
- **`email_ready` raggiunge anche gli export CLI:** `toCsv` è condiviso con `exportContacts`
  (CLI/pipeline), quindi la colonna compare pure lì. Intenzionale/additivo; nessun test asseriva la
  forma del CSV, niente rotto.
- **Verifica:** vitest sulla forma dell'export (colonna `email_ready`, `export.json` con flag, endpoint
  Contatti con paginazione ignorata); smoke reale `export.json?email=with` → 14 righe tutte con
  `email_ready`. F2/F5 PASS via `agent-browser`.
- **Sorpresa operativa:** un server `npm run ui` di una sessione precedente serviva codice vecchio sulla
  porta 8787 (export 404 via `/contacts/:id`); prima della validazione browser va fatto uno smoke su
  `/api/contacts/export.csv` + `?email=` per confermare che l'API in ascolto sia quella nuova.
