# 07 — Web UI

Interfaccia locale (niente auth) per consultare lo stato della pipeline e **correggere a mano**
selezioni e contatti prima dell'export. Due processi:

- **API**: Hono su Node (`src/server/index.ts`), porta `8787` (`UI_PORT`). Legge/scrive **lo stesso
  SQLite della CLI** — le modifiche fatte dalla UI finiscono negli export della CLI e viceversa.
- **Frontend**: React 19 + TanStack Router/Query + Tailwind 4 + Vite in `web/` (workspace npm
  separato), dev server su `5173` con proxy verso l'API.

```bash
npm run ui          # dev: API + Vite insieme (concurrently)
npm run ui:build    # builda web/dist
npm run api         # solo API; se web/dist esiste, serve anche la SPA su :8787
npm run seed:demo   # dati demo per provare la UI a DB vuoto (--force per riseminare)
```

In produzione locale l'API serve la SPA statica da `web/dist` (fallback `index.html` per il
routing client-side); in dev ci pensa Vite.

## Struttura del server

- `src/server/index.ts` — routing, validazione (regex data `YYYY-MM-DD`, schemi zod per i body),
  serving statico. Tutte le route API sotto il prefisso `/api`.
- `src/server/queries.ts` — le query SQL dedicate alla UI (liste, filtri, statistiche, modifica
  selezioni e contatti). Riusa dove possibile le funzioni di `db/` e `export/` (es. `toCsv`,
  `reportByStrategy`, `getById`).

## Endpoint

### Lettura

| Endpoint | Risposta |
|---|---|
| `GET /api/health` | `{ ok, db }` — path del DB in uso |
| `GET /api/stats` | dashboard: totale contatti, con email, conteggi per status e bucket, ultima run, n. selezioni, elenco strategie |
| `GET /api/runs` | tutte le righe di `runs`, più recenti prima |
| `GET /api/report` | **lo stesso `reportByStrategy()` di `eval:report`** (doc 06) — un'unica fonte, due viste |
| `GET /api/selections` | date con selezione + conteggio freelance/azienda |
| `GET /api/selections/:date` | gli item della selezione (contatto + `sel_bucket` + `rank`, ordinati per bucket e rank) |
| `GET /api/selections/:date/candidates?bucket=&q=` | contatti del bucket **non già in selezione** quel giorno (status scored/selected/exported, ordinati per fit, max 30) — il pool da cui pescare sostituti |
| `GET /api/contacts?q=&bucket=&status=&strategy=&sector=&minFit=&page=&pageSize=` | ricerca paginata (max 100/pagina), LIKE case-insensitive su nome/headline/azienda/email |
| `GET /api/contacts/:id` | dettaglio contatto |

### Modifica

| Endpoint | Effetto |
|---|---|
| `POST /api/selections/:date/contacts` `{contactId, bucket}` | aggiunge alla selezione con `rank = MAX(rank)+1` del bucket; `409` se già presente (vincolo `UNIQUE(date, contact_id)`) |
| `DELETE /api/selections/:date/contacts/:contactId` | rimuove e **rinumera i rank** del bucket in modo compatto (1..n) |
| `PATCH /api/contacts/:id` | aggiorna solo i campi in whitelist (anagrafica, bucket/sector/fit, bozza email, status) — validati con zod (`patchSchema`), enum coerenti con il resto del sistema |

### Export dal browser

`GET /api/selections/:date/export.csv` e `.json` — stessi formati della CLI (`toCsv`, `raw_json`
rimosso, `signals` deserializzato), serviti come download. Sempre una **vista** dello stato
corrente del DB: riflettono le modifiche manuali appena fatte.

## Pagine del frontend

| Pagina | Cosa mostra / permette |
|---|---|
| **Dashboard** | panoramica da `/api/stats` |
| **Selezioni** | apre una data, rimuove/aggiunge contatti pescando dal pool dei valutati, scarica CSV/JSON aggiornati |
| **Contatti** | ricerca e filtri; nel dettaglio si modificano anagrafica e bozza email |
| **Run** | storico estrazioni (tabella `runs`) |
| **Report strategie** | la tabella di `reportByStrategy()` (doc 06) |

## Note per chi sviluppa

- La UI **non lancia mai la pipeline**: estrazione, scoring ed email restano operazioni CLI. Il
  server è solo lettura + editing puntuale.
- `PATCH /api/contacts/:id` consente anche di cambiare `status`: usarlo con cognizione — ad es.
  riportare un contatto a `scored` lo rimette nel pool di `selectBucket` (doc 05).
- `addToSelection` non impone il target 20 né il cap per settore: i vincoli della selezione
  automatica non valgono per le modifiche manuali (per design: l'umano ha l'ultima parola).
- Niente auth e binding locale: non esporre la porta 8787 fuori dalla macchina.
