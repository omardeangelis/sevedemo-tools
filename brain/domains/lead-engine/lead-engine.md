---
domain: lead-engine
type: index
links: []
created: 2026-06-12
updated: 2026-06-16
ingested: false
last_ingested: null
---

# Documentazione sevedemo-tools

Documentazione tecnica del **Lead Engine** (tool #1 della piattaforma SeVedemo), rivolta a sviluppatori
che devono lavorare sul codice. Per setup e comandi rapidi vedi il [README principale](../../../README.md).

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
legge/modifica, gli export sono solo viste. `contacts.status` rappresenta **solo lo stadio del dato**
(`new → enriched → scored`, più `discarded`/`rejected_geo`); il ciclo cold-email vive su
`daily_selection.state` (`in_review → exported`) ed eleggibilità/"già contattato" sono derivate dalla
membership in `daily_selection`. Vedi [[concepts/modello-stati-membership]].

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

## Flows (sintetizzati da docs-maintenance)

| Flow | Da spec | Status |
|---|---|---|
| [[flows/bozze-email-guard\|Bozze email con guard "senza indirizzo"]] | [[../../specs/lead-engine/email-draft-guard/SPEC\|email-draft-guard]] | Implemented |
| [[flows/segmentazione-presenza-email\|Segmentare per presenza email (tutte le superfici)]] | [[../../specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Implemented |
| [[flows/filtri-persistenti-url\|Persistenza dei filtri nell'URL (sessione)]] | [[../../specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Implemented |
| [[flows/export-email-ready\|Export segmentato "solo email-ready"]] | [[../../specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Implemented |
| [[flows/gate-geografico-italia\|Gate geografico Italia nel funnel]] | [[../../specs/lead-engine/italy-geo-gate/SPEC\|italy-geo-gate]] | Implemented |
| [[flows/enrichment-progressivo-email\|Enrichment progressivo on-demand (recupero email → bozza)]] | [[../../specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Implemented |
| [[flows/selezione-figlia-del-run\|Selezione figlia del Run (provenienza Run ↔ Selezione, export)]] | [[../../specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Implemented |
| [[flows/respondents-azienda-first\|Estrazione respondents (commentatori + taggati + espansione azienda)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |
| [[flows/gather-primaria-budget-riflusso\|Gather: primaria-first, budget dominante, riflusso, reclaim]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |
| [[flows/selezione-azienda-first\|Selezione azienda-first (priorità fonte primaria nel bucket azienda)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |

## Concepts (sintetizzati da docs-maintenance)

| Concetto | Da spec | Status |
|---|---|---|
| [[concepts/presenza-email\|Presenza email (`hasEmail` + segmentazione non-trim)]] | [[../../specs/lead-engine/email-draft-guard/SPEC\|email-draft-guard]] · [[../../specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Implemented |
| [[concepts/stato-filtri-url\|Stato dei filtri nell'URL (search params)]] | [[../../specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Implemented |
| [[concepts/classificazione-geografica\|Classificazione geografica della località (`classifyLocation`)]] | [[../../specs/lead-engine/italy-geo-gate/SPEC\|italy-geo-gate]] | Implemented |
| [[concepts/stato-rejected-geo\|Stato `rejected_geo` (tombstone geografico)]] | [[../../specs/lead-engine/italy-geo-gate/SPEC\|italy-geo-gate]] | Implemented |
| [[concepts/modello-stati-membership\|Modello degli stati (stadio-dato vs ciclo Selezione, membership-derived)]] | [[../../specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Implemented |
| [[concepts/run-come-esecuzione\|Run come esecuzione (`run_id`)]] | [[../../specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Implemented |
| [[concepts/enrichment-progressivo-apimaestro\|Enrichment progressivo (`apimaestro/linkedin-profile-detail`)]] | [[../../specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Implemented |
| [[concepts/strategia-influencer-post-respondents\|Strategia influencer-post-respondents (fonte primaria azienda-first)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |
| [[concepts/sotto-fonte-respondents\|Sotto-fonte (`source_detail`: commenter / tagged-person / company-expansion)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |
| [[concepts/espansione-azienda-decisionmaker\|Espansione-azienda a decision-maker (`company-expansion`)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |
| [[concepts/esito-strategia-onesto\|Esito strategia onesto (4 stati + drill-down sotto-fonte)]] | [[../../specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | Implemented |

## Contract & decisioni

- [[lead-engine-contract\|Domain contract]] — Owns / Does Not Own / Invarianti + mappa **capability ↔ provider seam**
- [[decisions/0001-confini-dominio-provider-seam\|ADR 0001]] — un solo dominio, confini sui provider seam, regola di graduazione (enrichment→Apollo, outreach→Brevo, evaluation→strategie dinamiche)

> [!note] Le pagine narrative **01–07** sono lo strato di *orientamento* (manuale migrato da `docs/`);
> i dettagli canonici e aggiornati vivono nei `flows/`/`concepts/` spec-driven e nel contract. Dove
> 01–07 e flows/concepts divergono, **vince il flow/concept** (le 01–07 sono allineate al remodel ma
> restano una panoramica).
