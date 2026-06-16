---
domain: lead-engine
type: concept
links: []
created: 2026-06-12
updated: 2026-06-16
ingested: false
last_ingested: null
---

# 02 — Database

Unico file SQLite (`data/sevedemo.db`, override con `DB_PATH`), aperto da `src/db/index.ts` con
`journal_mode = WAL`. **Lo schema viene applicato all'import del modulo** (`CREATE TABLE IF NOT
EXISTS`): qualunque entry point che tocchi il DB lo inizializza, `db:init` è solo un comando
esplicito. CLI e web UI condividono lo stesso file: le modifiche fatte dalla UI finiscono negli
export della CLI e viceversa.

## Tabelle

### `contacts` — l'entità centrale

Una riga per persona, identità = `linkedin_url` (`UNIQUE NOT NULL`, sempre normalizzato da
`normalizeLinkedinUrl`: `https://www.linkedin.com/in/<slug>` lowercase, senza query/hash/slash finale).

| Gruppo | Colonne | Scritte da |
|---|---|---|
| Identità | `linkedin_url`, `full_name`, `headline` | strategia (upsert) + enrichment |
| Anagrafica arricchita | `about`, `location`, `email`, `phone`, `company` | enrichment |
| Scoring | `role`, `bucket`, `sector`, `fit_score`, `short_description`, `score_reason`, `signals` (json) | Claude Haiku via `updateScore` |
| Provenienza | `source_strategy`, `source_post_url` | strategia (mai sovrascritte) |
| Email | `email_subject`, `email_body` | Claude Sonnet via `updateEmail` (o UI) |
| Stato | `status` (`new\|enriched\|scored\|discarded\|rejected_geo` — solo stadio-dato), `first_seen_at`, `last_evaluated_at`, `last_enrichment_attempt_at`, `last_enrichment_actor` | pipeline |
| Audit | `raw_json` (payload actor; sovrascritto dall'enrichment) | strategia + enrichment |

Indici su `status`, `bucket`, `source_strategy`.

`source_strategy` è il filo che permette l'evaluation: accompagna il contatto dall'estrazione fino
all'outcome e non viene mai modificato.

### `runs` — telemetria di estrazione

Una riga per strategia per run: `run_date`, `strategy`, `items_in` (candidati grezzi resi da
`source`), `items_new` (quanti erano davvero nuovi), `cost_estimate` (predisposto, oggi sempre 0).
Utile per capire quando un seed si sta esaurendo (`items_in` alto ma `items_new` che crolla).

### `daily_selection` — i 40 del giorno (figlia del Run)

`(date, bucket, contact_id, rank, run_id, state)` con `UNIQUE(date, contact_id)`. `rank` = posizione
1..20 in ordine di fit dentro il bucket. `run_id` lega la Selezione all'esecuzione di `runDaily` che
l'ha generata ([[concepts/run-come-esecuzione]]); `state` è il **ciclo proprio** della Selezione
(`in_review → exported`, default `in_review`) — è qui, **non** sul contatto, che vive lo stato
cold-email ([[concepts/modello-stati-membership]]). È una tabella **editabile**:
`saveSelection(date, rows, runId)` la sostituisce per data (DELETE + INSERT in transazione,
`state='in_review'`) e la UI aggiunge/rimuove righe prima dell'export; l'azione "Esporta" porta
`state` a `exported`. La **membership** in questa tabella è ciò che deriva eleggibilità e "già
contattato" (`selectBucket` esclude i membri).

### `kv` — stato persistente tra i run

Semplice `key TEXT PRIMARY KEY, value TEXT`. Oggi contiene solo i **cursori di rotazione delle
query** (`query-cursor:<file>.json`, vedi doc 03). Accesso via `kvGet`/`kvSet` (`src/db/kv.ts`),
upsert con `ON CONFLICT(key) DO UPDATE`.

### `outcomes` — esiti dell'outreach

Una riga per contatto (`UNIQUE(contact_id)`): `strategy`, `sent_at`, flag `opened/replied/
positive_reply/converted` (interi 0/1), `notes`. Popolata da `eval:import` (vedi doc 06).

## Convenzioni di scrittura — leggere prima di modificare

Le direzioni dei `COALESCE` non sono casuali, codificano chi "vince":

| Funzione | Semantica | SQL |
|---|---|---|
| `upsertCandidate` (`contacts.ts:40`) | **backfill**: il dato esistente vince, il nuovo riempie solo i buchi | `COALESCE(colonna, ?)` |
| `updateEnrichment` (`contacts.ts:96`) | **refresh**: il dato nuovo vince se presente, altrimenti si tiene il vecchio | `COALESCE(?, colonna)` |
| `upsertOutcome` (`runs.ts:68`) | **mai retrocedere**: i flag usano `MAX(vecchio, nuovo)` — un re-import non trasforma un "ha risposto" in "non ha risposto"; i testi usano `COALESCE(excluded.X, outcomes.X)` | misto |
| `updateScore` (`contacts.ts:132`) | **sovrascrittura piena** + timbro `last_evaluated_at = now` | UPDATE secco |

Altre regole:

- **Le metriche non si materializzano mai.** `reportByStrategy()` (`runs.ts:107`) aggrega al volo a
  ogni lettura (CLI e UI). Non aggiungere tabelle di metriche precalcolate senza un motivo forte.
- **`last_evaluated_at` governa la freshness**: viene scritto solo da `updateScore`. `isFresh(id,
  days)` decide se un profilo ripescato dalle strategie rientra nel funnel o viene saltato.
- **`raw_json` non esce mai dagli export** (rimosso nel JSON, assente dal CSV): è solo audit interno.
- Query con liste di id usano placeholder dinamici (`getByIds`); tutto il resto è prepared statement.
