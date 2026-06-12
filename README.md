# sevedemo-tools

Tool di supporto alla piattaforma **SeVedemo** (ricerca lavoro per freelance italiani).

## Tool #1 — Lead Engine

Estrae ogni giorno **40 contatti LinkedIn** qualificati per cold-email, in due bucket decisi dal
**ruolo** della persona (lo decide Claude, non la strategia di estrazione):

- **freelance (20)** — P.IVA / liberi professionisti in tech, design, marketing → *invito a cercare lavoro su SeVedemo*
- **azienda (20)** — decision maker, recruiter, headhunter, talent manager, HR, founder/CEO → *invito a pubblicare offerte su SeVedemo*

Flusso: estrae ~200 candidati via **Apify** → dedup → pre-filtro → enrichment → **Claude** classifica/ordina
→ tiene i migliori 20+20 → genera una **bozza email** per ciascuno → esporta CSV/JSON.

> 📚 La documentazione tecnica per sviluppatori è in [`docs/`](docs/README.md): architettura,
> database, strategie di estrazione, enrichment/scoring, selezione/email/export, evaluation e web UI.

### Setup

```bash
npm install
cp .env.example .env   # poi inserisci APIFY_TOKEN e ANTHROPIC_API_KEY
npm run db:init
```

### Comandi

```bash
# Elenca le strategie e il loro stato (attive / gated)
npm run cli strategies

# Run completo giornaliero → 20 + 20 + bozze email + export in exports/
npm run cli pipeline -- --daily

# Una singola strategia (per accumulare dati di confronto)
npm run cli pipeline -- --strategy freelance-people-search --limit 50

# Ri-esporta la selezione di un giorno
npm run cli export -- --date 2026-06-11

# Evaluation: importa gli esiti outreach e confronta le strategie
npm run cli eval:import outcomes.sample.csv
npm run cli eval:report
```

Output in `exports/` come `daily-<data>.csv|json` (e `strategy-<id>-<data>.csv|json` per le run singole).
Colonne CSV pronte per il tool email: nome, email, linkedin_url, bucket, role, sector, fit_score,
short_description, reason, company, phone, source_strategy, source_post_url, email_subject, email_body.

### Interfaccia web

Frontend locale (niente auth) per vedere run, report e selezioni, **modificare le liste** prima
dell'export e scaricarle direttamente dal browser.

```bash
npm install && npm --prefix web install   # prima volta
npm run ui                                # API (http://localhost:8787) + frontend dev (http://localhost:5173)
```

Pagine: **Dashboard** (panoramica), **Selezioni** (apri una data, rimuovi/aggiungi contatti dal pool
di valutati, scarica CSV/JSON aggiornati), **Contatti** (ricerca e filtri; nel dettaglio modifichi
anagrafica e bozza email), **Run** e **Report strategie**.

```bash
npm run ui:build && npm run api   # alternativa: build statica servita dall'API su :8787
npm run seed:demo                 # dati demo per provare la UI a DB vuoto (--force per riseminare)
```

La UI legge/scrive lo stesso SQLite della pipeline (`DB_PATH` per puntare a un DB diverso). Le
modifiche fatte dalla UI (liste e contatti) finiscono quindi anche negli export della CLI.

### Strategie di estrazione

| Strategia | Bucket atteso | Cookie | Stato |
|---|---|---|---|
| `freelance-people-search` | freelance | no | **attiva** |
| `decisionmaker-people-search` | azienda | no | **attiva** |
| `freelance-post-reactors` | misto | no | **attiva** (richiede `data/seeds/influencers.json`) |
| `influencer-followers` | freelance | sì | gated |
| `job-posters-annunci` | azienda | sì | gated |

Le strategie **cookie** restano disabilitate finché non valorizzi `LINKEDIN_LI_AT` nel `.env`. Quando
attive rispettano il cap conservativo `COOKIE_MAX_PROFILES` (default 100).

### Configurazione (seeds)

Modificabili senza ricompilare, in `data/seeds/`:
- `freelance-queries.json` — query people-search per il bucket freelance
- `decisionmaker-queries.json` — query people-search per il bucket azienda
- `influencers.json` — **da compilare**: URL dei profili influenti freelance (per reactors/followers)
- `job-search-urls.json` — URL ricerca annunci LinkedIn (per la strategia cookie sugli annunci)

### ⚠️ Note importanti

- **Input degli actor Apify**: gli schemi degli actor di terze parti possono cambiare. Se un actor dà
  errore di validazione input, adatta i campi in [`src/apify/actors.ts`](src/apify/actors.ts) (unico
  punto da toccare). Il mapping dell'output è già tollerante a nomi di campo diversi.
- **Chi applica a un annuncio NON è estraibile** (lista candidati privata): il bucket freelance usa
  proxy fattibili (ricerca per headline + reactors), non gli applicant.
- **Cookie LinkedIn**: usarlo significa agire da utente loggato → viola i ToS più direttamente e
  rischia il **ban dell'account**. Usa solo un account dedicato/sacrificabile e tieni i volumi bassi.
- **GDPR**: i contatti EU sono dati personali. Il DB salva provenienza (`source_strategy`,
  `first_seen_at`); l'outreach deve includere un opt-out. Non è consulenza legale.

### Costi indicativi
Scoring Claude (Haiku) ≈ $5/mese. Enrichment `dev_fusion` ≈ $2/giorno per 200 (ridotto dal pre-filtro).
Il costo dominante è Apify, non Claude.

Le people-search comprano **pagine intere** da 25 profili ($0.10/pagina harvestapi): per ogni run
usano solo le query necessarie a coprire il budget e ruotano il punto di partenza nel file di seed
(cursore in tabella `kv`), così run successivi pescano query e profili diversi. Le query non usate
fanno da riserva se le prime rendono poco.

### Stack
TypeScript + Node (`tsx`), SQLite (`better-sqlite3`), `apify-client`, `@anthropic-ai/sdk`, `zod`,
`p-limit`, `commander`. Interfaccia web: API locale **Hono** (`src/server/`) + **React 19**,
**TanStack Router/Query**, **Tailwind CSS 4**, **Vite** (`web/`).
