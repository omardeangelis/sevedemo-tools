---
domain: lead-engine
type: contract
ingested: true
last_ingested: 2026-06-16
links:
  - "[[domains/lead-engine/lead-engine]]"
  - "[[domains/lead-engine/decisions/0001-confini-dominio-provider-seam]]"
  - "[[domains/lead-engine/concepts/modello-stati-membership]]"
created: 2026-06-16
updated: 2026-06-16
---

# Lead Engine — Domain Contract

Confini del dominio `lead-engine` (tool #1 di SeVedemo): cosa possiede, cosa **non** possiede, e gli
invarianti che valgono trasversalmente a tutte le sue capability. È **un solo dominio** per **un solo
tool**: gli stadi (acquisition → enrichment → scoring → selection/outreach → evaluation) sono
**capability** della stessa pipeline, non domini separati — vedi la regola di graduazione in
[[decisions/0001-confini-dominio-provider-seam]].

## Owns

Il dominio possiede l'intera pipeline di generazione lead **as built**, su un unico SQLite
(`data/sevedemo.db`):

- **Acquisition** — estrazione candidati da LinkedIn via actor Apify (le 5 strategie, registry, gating
  cookie, rotazione query). Concept: [[03-extraction-strategies]].
- **Enrichment (come dato)** — completamento del contatto (about, email, company, location) via actor
  Apify; batch `dev_fusion` nel run + on-demand `apimaestro` per il recupero email. Concept:
  [[enrichment-progressivo-apimaestro]], flow [[enrichment-progressivo-email]].
- **Scoring / qualification** — giudizio bucket + fit via Claude Haiku (rubric, tool-use forzato).
  Concept: [[classificazione-geografica]] (gate geo), pagina [[04-enrichment-scoring]].
- **Selection** — i 40 del giorno (`selectBucket`, cap per settore), Selezione figlia del Run con ciclo
  proprio. Flow [[selezione-figlia-del-run]], concept [[run-come-esecuzione]].
- **Email drafting** — bozze cold-email via Claude Sonnet (`draftMany`, prompt di prodotto). Flow
  [[bozze-email-guard]].
- **Export** — CSV/JSON come **vista** dello stato corrente (contratto col tool email). Flow
  [[export-email-ready]].
- **Evaluation (read-model)** — import esiti outreach (`outcomes`) e report comparativo per strategia,
  oggi manuale. Pagina [[06-evaluation]].
- **Web UI** — superficie locale di consultazione e correzione manuale (Hono + React). Pagina
  [[07-web-ui]], concetti [[stato-filtri-url]], [[presenza-email]].
- **Contacts kernel** — la tabella `contacts` e la sua identità/anagrafica/stati; `runs`,
  `daily_selection`, `kv`, `outcomes`. Pagina [[02-database]].

## Does Not Own

- **L'invio email e il lifecycle del contatto** — oggi il dominio si **ferma all'export CSV**; l'invio e
  la gestione del lifecycle del contatto sono delegati a un tool esterno (oggi manuale, in roadmap
  **Brevo**). Razionale in [[decisions/0001-confini-dominio-provider-seam]].
- **Gli internals del provider di enrichment** — il dominio possiede la *capability* enrichment e la sua
  shape `Enrichment`, **non** il provider: oggi Apify, in roadmap potenzialmente **Apollo** o altro. Il
  dettaglio provider-specifico vive dietro l'adapter `src/apify/actors.ts` (anti-corruption layer).
- **La sorgente degli esiti outreach** — gli esiti nascono **fuori dal repo** (tool email esterno);
  il dominio possiede solo il match (`source_strategy`/email) e l'aggregazione (`reportByStrategy`).
- **La selezione automatica/dinamica delle strategie** — oggi il budget è diviso **equamente**; usare
  l'evaluation per pesare le strategie è roadmap, non implementato.
- **Scheduling** — non esiste cron/daemon nel repo: "daily" è convenzione, l'operatore decide quando.
- **Auth / multi-tenant / esposizione remota** — fuori scope per design (locale, single-user).

## Invariants

Valgono per tutte le capability; un cambiamento che li viola va discusso, non fatto di soppiatto:

- **Identità = `linkedin_url` normalizzato** (`normalizeLinkedinUrl`): chiave di dedup, `UNIQUE`,
  match dell'eval. Unico punto: `src/util/fields.ts`.
- **`contacts.status` = solo stadio del dato** (`new → enriched → scored → discarded → rejected_geo`);
  il ciclo cold-email vive su `daily_selection.state` (`in_review → exported`); eleggibilità e "già
  contattato" sono **derivate dalla membership**; `pronto`/`da arricchire` sono **derivati**, mai status.
  Canonico: [[modello-stati-membership]].
- **Freshness anti-spesa** — non si paga due volte lo stesso profilo: `last_evaluated_at` (scoring) e
  `last_enrichment_attempt_at` (enrichment progressivo), entrambi gated da `FRESHNESS_DAYS`.
- **Direzioni dei `COALESCE` non casuali** — backfill (`upsertCandidate`), refresh (`updateEnrichment`/
  `applyProgressiveEnrichment`), mai-retrocedere (`upsertOutcome`). Vedi [[02-database]].
- **SQLite è l'unica fonte di verità; gli export sono sempre viste**, mai fonte.
- **Best-effort con isolamento per item** — una strategia/profilo/scoring/bozza che fallisce non ferma
  il run; fail-fast solo su configurazione (token/seed).
- **Max una cold-email per contatto** — garantito per costruzione dalla membership (`exported` non
  ri-bersagliati né rientrano in un Run).
- **No cookie-gated nel set attivo** — nessun uso di `LINKEDIN_LI_AT` nella fascia "attiva ora".
- **Adattamento provider in un solo punto** — gli schemi input degli actor si toccano solo in
  `src/apify/actors.ts`; la lettura output è tollerante (`field(...)`).

## Capability ↔ provider seam

Tabella di orientamento; il razionale e la **regola di graduazione** (quando una capability diventa
dominio a sé) sono in [[decisions/0001-confini-dominio-provider-seam]].

| Capability | Provider oggi | Seam futuro (roadmap) | Diventa dominio quando… |
|---|---|---|---|
| Acquisition | Apify (LinkedIn) | altre sorgenti | servono più sorgenti con modelli divergenti |
| Enrichment | Apify (`apimaestro`/`dev_fusion`) | **Apollo** o altro | atterra un secondo provider dietro l'adapter |
| Scoring | Claude Haiku | (stabile) | — (resta core) |
| Outreach + lifecycle | in-repo (Sonnet + CSV) | **Brevo** (invio + lifecycle) | l'integrazione Brevo viene costruita |
| Evaluation | manuale (`reportByStrategy`) | scelta **dinamica** strategie | l'evaluation smette di essere read-only |
