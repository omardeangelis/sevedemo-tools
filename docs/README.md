# Documentazione sevedemo-tools

Documentazione tecnica del **Lead Engine** (tool #1 della piattaforma SeVedemo), rivolta a sviluppatori
che devono lavorare sul codice. Per setup e comandi rapidi vedi il [README principale](../README.md).

## Cosa fa il sistema

Ogni giorno estrae **40 contatti LinkedIn** qualificati per cold-email, divisi in due bucket decisi
dal **ruolo** della persona (lo decide Claude, mai la strategia di estrazione):

- **freelance (20)** — P.IVA / liberi professionisti in tech, design, marketing → invito a cercare lavoro su SeVedemo
- **azienda (20)** — recruiter, talent, HR, founder, decision maker → invito a pubblicare offerte su SeVedemo

## Il funnel in una riga

```
~200 candidati (Apify) → dedup → persist → prefiltro keyword (120) → enrichment (Apify)
→ scoring (Claude Haiku) → selezione 20+20 → bozze email (Claude Sonnet) → export CSV/JSON
```

Tutto lo stato vive in **un unico SQLite** (`data/sevedemo.db`): la CLI lo scrive, la web UI lo
legge/modifica, gli export sono solo viste. Lo status di ogni contatto avanza
`new → enriched → scored → selected → exported` e ogni transizione è scritta da un passo preciso
della pipeline.

## Indice

| Documento | Contenuto |
|---|---|
| [01 — Architettura](01-architecture.md) | Stack, layout del repo, orchestrazione pipeline, configurazione, ciclo di vita degli status |
| [02 — Database](02-database.md) | Schema SQLite, tabelle, convenzioni di scrittura, chiave di dedup |
| [03 — Strategie di estrazione](03-extraction-strategies.md) | Interface `Strategy`, registry, le 5 strategie, rotazione delle query con cursore |
| [04 — Enrichment e scoring](04-enrichment-scoring.md) | Actor dev_fusion, classificazione con Claude (tool-use forzato), freshness |
| [05 — Selezione, email, export](05-selection-email-export.md) | `selectBucket`, cap per settore, bozze email con Sonnet, export CSV/JSON |
| [06 — Evaluation](06-evaluation.md) | Import esiti outreach, report per strategia, loop manuale |
| [07 — Web UI](07-web-ui.md) | API Hono, endpoint, frontend React, cosa può modificare la UI |

## Principi di design da conoscere prima di toccare il codice

1. **Il bucket lo decide Claude per ruolo, non la strategia.** Il campo `bucketHint` delle strategie
   è solo documentazione; la regola di routing vive nel system prompt di scoring
   (`src/score/rubric.ts`).
2. **L'URL LinkedIn normalizzato è la chiave di identità** in tutto il sistema (dedup in-memory,
   `UNIQUE` su `contacts.linkedin_url`, match dell'eval import). La normalizzazione vive in
   `src/util/fields.ts → normalizeLinkedinUrl`.
3. **Non si paga due volte lo stesso profilo.** `last_evaluated_at` + `FRESHNESS_DAYS` (default 90)
   evitano di ri-arricchire e ri-scorare profili già valutati; il cursore in tabella `kv` ruota le
   query di ricerca tra un run e l'altro; le people-search comprano pagine intere da 25 profili.
4. **Gli schemi degli actor Apify possono cambiare.** Gli input si adattano SOLO in
   `src/apify/actors.ts`; la lettura degli output è tollerante per design (`field(...)` multi-chiave).
5. **Best-effort ovunque.** Una strategia che fallisce, un profilo non arricchito, uno scoring o una
   bozza email andati male non fermano mai il run: warning a log e si prosegue.
