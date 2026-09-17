# sevedemo-tools — CRM di prospecting LinkedIn

CRM **personale e locale** (un solo utente, niente login) per trovare e seguire potenziali clienti su
LinkedIn:

- descrivi **la tua azienda** e uno o più **ICP** (profilo cliente ideale), con le **aziende di
  riferimento** con cui hai già trattato;
- generi prospect da **chi reagisce e commenta i tuoi post** (finiscono in **Inbox**) oppure **estrai le
  persone di un'azienda** filtrate per i ruoli dell'ICP (finiscono direttamente in una lista);
- organizzi i prospect in **liste per ICP** e gestisci il contatto: **stato**, **touchpoint** multipli,
  note, timeline;
- chiedi all'**AI** (Claude) — solo per questo — un riassunto del profilo, **3 angoli di apertura** e un
  **fit** leggero rispetto all'ICP;
- **esporti** una lista in CSV per il tuo tool email.

Ogni operazione a pagamento (Apify, Claude) mostra prima un'**anteprima** con conteggi, costo stimato e
blocchi: niente parte senza il tuo "Avvia".

## Setup

Serve Node ≥ 20.

```bash
pnpm install                # dipendenze della root (node_modules gestito da pnpm 10)
npm --prefix web install    # dipendenze del frontend (npm)
cp .env.example .env        # inserisci APIFY_TOKEN e ANTHROPIC_API_KEY
npm run ui                  # API su http://localhost:8787 + frontend su http://localhost:5173
```

Apri <http://localhost:5173>: la home è un onboarding in 3 passi finché non hai profilo, ICP e almeno un
prospect, poi porta all'Inbox.

Il database (`data/crm.db`) si crea da solo al primo avvio; `npm run db:init` lo crea o aggiorna senza
avviare nulla. Il vecchio `data/sevedemo.db` resta su disco ma non viene letto.

In alternativa al dev server: `npm run ui:build && npm run api` serve il frontend buildato direttamente
dall'API su <http://localhost:8787>.

## Flusso consigliato

1. **Impostazioni** → salva l'URL pubblico del tuo profilo LinkedIn e descrivi la tua azienda (nome,
   descrizione, offerta). L'analisi AI usa la descrizione per proporre angoli coerenti con ciò che vendi:
   se è vuota le anteprime lo segnalano.
2. **ICP** → crea almeno un ICP (ruoli target, settori, località, dimensione, pains, note) e aggiungi le
   **aziende di riferimento** da URL con l'esito (vinta, in trattativa, persa, riferimento).
3. **Porta dentro le persone**, in uno dei due modi:
   - **Sincronizza interazioni** (Impostazioni › I miei post, oppure dall'Inbox vuota): legge i tuoi
     ultimi post, chi ha reagito e chi ha commentato → prospect in **Inbox** con la fonte (reazione,
     commento). Al primo sync la stima non è disponibile: "Aggiorna solo l'elenco dei post" costa pochi
     centesimi e rende la stima reale. I post già sincronizzati non si ripagano (cooldown di 7 giorni,
     post più vecchi di 90 giorni mai, salvo "Risincronizza tutto").
   - **Sourcing da azienda** (Aziende → Aggiungi da URL → Estrai persone): scegli la lista, i ruoli
     (precompilati dall'ICP della lista), il numero massimo di persone e la modalità (Short, Full,
     Full+email) → le persone entrano **direttamente nella lista** con stato "Nuovo".
4. **Inbox** → triage in blocco: aggiungi a una lista (anche creandola al volo), scarta ("Mostra
   scartati" → Ripristina), arricchisci o analizza i prospect selezionati. Con più ICP ti chiede per quale
   analizzare.
5. **Liste** → una o più liste per ICP, archiviabili. Nella lista: conteggi per stato cliccabili, filtri
   salvati nell'URL, azioni in blocco (stato, rimuovi, arricchisci, analizza, esporta) e "Aggiungi persone
   da un'azienda".
6. **Arricchisci e analizza** (da lista, selezionati o singolo prospect), sempre passando dall'anteprima:
   - l'**arricchimento** legge about, esperienze ed email pubblica del profilo;
   - l'**analisi** richiede un profilo arricchito: in blocco arricchisce prima i mancanti, sul singolo
     prospect c'è "Arricchisci e analizza". Produce riassunto, 3 angoli motivati e fit (alto/medio/basso)
     con motivazione; diventa "da aggiornare" quando cambiano i dati del prospect, dell'ICP o della tua
     azienda.
7. **Prospect** → cambia stato (sempre a mano), registra i touchpoint (canale, direzione, data, testo,
   nuovo stato facoltativo) e le note, consulta timeline, fonti e analisi. Lo stato è **unico** per
   persona: vale in tutte le liste in cui compare.
8. **Export** → dalla lista, CSV con i filtri correnti o con i prospect selezionati. "Solo con email" è
   attivo di default, "Segna come 'contattato'" è facoltativo. Ogni export finisce nella timeline e si può
   riscaricare.

Stati: `nuovo → qualificato → da_contattare → contattato → risposto → in_conversazione →
chiuso_vinto | chiuso_perso | scartato`.

**Job.** Sync, sourcing, arricchimento e analisi in blocco sono job in background, **uno alla volta**. Il
banner nella sidebar mostra il job in corso e l'esito: zero risultati (neutro), avvisi, oppure errore con
la causa (`actor:` provider, `config:` configurazione, `process:` processo) e il bottone **Riprova**. Lo
storico è in Impostazioni › Ultimi job.

**CSV esportato** — colonne: `full_name, first_name, last_name, email, company, title, linkedin_url,
location, status, list, icp, fit, summary, angle_1, angle_2, angle_3, last_touchpoint_at, sources`
(UTF-8, senza BOM; le celle che sembrano formule vengono neutralizzate).

## Actor e costi indicativi

Nessun actor usa cookie o login LinkedIn. I prezzi sono le stime usate dalle anteprime
(`src/config.ts`): verifica le tariffe attuali su Apify e Anthropic.

| Operazione | Provider | Costo indicativo |
|---|---|---|
| Elenco dei miei post | `apimaestro/linkedin-profile-posts` | $5 / 1000 post (10 post ≈ $0,05) |
| Reazioni ai post | `apimaestro/linkedin-post-reactions` | $5 / 1000 reazioni, max 300 per post; pagine da 100 pagate intere |
| Commenti ai post | `apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies` | ≈ $5 / 1000 commenti, max 100 per post |
| Persone di un'azienda | `harvestapi/linkedin-company-employees` | Short $4, Full $8, Full+email $12 per 1000 persone **+ $0,02 per run** (50 persone Short ≈ $0,22) |
| Arricchimento profilo | `apimaestro/linkedin-profile-detail` | "stima non disponibile" finché `PRICE_PROFILE_DETAIL_USD` è vuoto |
| Analisi AI | Claude `claude-opus-5` (`ANALYSIS_MODEL`) | ≈ $0,03 per prospect (≈ 3k token in ingresso + 0,7k in uscita; limite di risposta 16 000 token) |

Il sourcing in modalità Full/Full+email marca già i prospect come arricchiti: non ripaghi l'arricchimento
per dati già comprati.

## Note su ToS, GDPR e dati

- **Niente cookie né login**: il profilo "collegato" è solo il tuo URL pubblico; gli actor leggono dati
  pubblici e il tuo account LinkedIn non viene mai usato. Lo scraping resta comunque contrario ai Termini
  di LinkedIn: uso **personale**, volumi bassi (i limiti per post e per azienda servono anche a questo).
- **GDPR**: i prospect nell'UE sono dati personali. Il CRM conserva la **provenienza** di ogni persona
  (reazione, commento, azienda), ma base giuridica e **opt-out** nell'outreach restano a tuo carico. Non è
  consulenza legale.
- **Dove vanno i dati**: tutto resta in `data/crm.db` sul tuo computer; escono solo le richieste ai
  provider (Apify per leggere LinkedIn, Anthropic per l'analisi, a cui arriva il profilo del prospect).
- **Nessuna autenticazione**: l'API è pensata per `localhost`, non esporla in rete.

## Variabili d'ambiente

Tutte facoltative in `.env` (vedi `.env.example`) tranne i due token; lette all'avvio da `src/config.ts`
(`UI_PORT` da `src/server/index.ts`). Per cambiarle riavvia `npm run ui`.

| Variabile | Default | A cosa serve |
|---|---|---|
| `APIFY_TOKEN` | — | Obbligatoria per sync, sourcing e arricchimento (senza, le anteprime mostrano un blocco). |
| `ANTHROPIC_API_KEY` | — | Obbligatoria per l'analisi AI. |
| `ANALYSIS_MODEL` | `claude-opus-5` | Modello dell'analisi. |
| `ANALYSIS_STRUCTURED` | `1` | `1` = structured outputs; `0` = prompt "solo JSON" + validazione, per modelli che non li supportano. |
| `POSTS_PER_SYNC` | `10` | Post del tuo profilo letti a ogni sync. |
| `POST_RECENCY_DAYS` | `90` | Post più vecchi non si risincronizzano (salvo "Risincronizza tutto"). |
| `SYNC_COOLDOWN_DAYS` | `7` | Un post già sincronizzato si rilegge solo dopo questi giorni. |
| `REACTIONS_PER_POST` | `300` | Massimo di reazioni lette per post. |
| `COMMENTS_PER_POST` | `100` | Massimo di commenti letti per post (1–100). |
| `EMPLOYEES_PER_COMPANY` | `50` | Numero massimo di persone proposto nel sourcing. |
| `EMPLOYEES_MODE` | `Short` | Modalità proposta nel sourcing: `Short`, `Full`, `Full+email`. |
| `ENRICH_CONCURRENCY` | `3` | Profili arricchiti in parallelo. |
| `FRESHNESS_DAYS` | `90` | Un arricchimento senza risultato si ritenta solo dopo questi giorni (salvo "Riprova anche quelli senza risultato"). |
| `PRICE_PROFILE_DETAIL_USD` | vuoto | Prezzo per profilo arricchito; vuoto = "stima non disponibile" nelle anteprime. |
| `DB_PATH` | `data/crm.db` | Percorso del database SQLite. |
| `UI_PORT` | `8787` | Porta dell'API. Se la cambi, avvia il frontend con `API_URL=http://localhost:<porta>` (proxy di Vite). |

## Provare la UI senza spendere: server e2e

`npm run e2e:server` avvia l'API vera su un **database temporaneo** (azzerato a ogni avvio, mai in
`data/`), con i job che girano davvero ma su **dati finti** da fixture: nessuna chiamata ad Apify o a
Claude, il `.env` viene ignorato.

```bash
npm run e2e:server                                      # API finta su http://localhost:8790
API_URL=http://localhost:8790 npm --prefix web run dev  # frontend contro l'API finta
curl -s -X POST localhost:8790/api/e2e/seed             # scenario pronto: profilo, ICP, lista, 7 prospect
curl -s -X POST localhost:8790/api/e2e/reset            # database vuoto
```

Dataset, scenari di errore (sync vuoto o fallito, analisi rifiutata, profili senza dati…) e ricette per
`agent-browser` sono in [`tests/e2e/README.md`](tests/e2e/README.md).

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run ui` | API + frontend in sviluppo. |
| `npm run api` | Solo API (serve anche `web/dist` se presente). |
| `npm run ui:build` | Build del frontend in `web/dist`. |
| `npm run db:init` | Crea/aggiorna lo schema del database (idempotente). |
| `npm run cli -- --help` | CLI di manutenzione (oggi solo `db:init`). |
| `npm run e2e:server` | API con job finti su database temporaneo. |
| `npm test` / `npm run test:watch` | Test del server (vitest). |
| `npm run typecheck` | TypeScript su `src/`, `tests/` e `scripts/`. |

## Struttura e stack

TypeScript + Node (`tsx`), SQLite (`better-sqlite3`), `apify-client`, `@anthropic-ai/sdk`, `zod`. API
locale **Hono** (`src/server/`) e frontend **React 19** + TanStack Router/Query + Tailwind CSS 4 + shadcn
(`web/`, Vite).

- `src/db/` — schema (13 tabelle) e repository; `src/db/identity.ts` riconosce la stessa persona arrivata
  da fonti diverse e unisce i doppioni.
- `src/server/routes/` — un router per risorsa; `src/server/jobs.ts` — controller dei job.
- `src/jobs/` — i quattro job (sync, sourcing, arricchimento, analisi) e le loro dipendenze reali/finte.
- `src/apify/actors.ts` — **unico punto** in cui si scrivono gli input degli actor: se un actor cambia
  schema, si corregge qui. `src/acquisition/mappers/` legge gli output in modo tollerante.
- `src/enrich/`, `src/analysis/`, `src/exports/` — arricchimento, analisi AI, export CSV.
- `scripts/e2e-server.ts`, `tests/` — server e2e e test.

Documentazione di progetto e regole per chi sviluppa: [`AGENTS.md`](AGENTS.md) e il knowledge base in
[`brain/`](brain/index.md) (dominio [`prospect-crm`](brain/domains/prospect-crm/prospect-crm.md), piano e
flussi UI in [`brain/specs/prospect-crm/crm-foundation/`](brain/specs/prospect-crm/crm-foundation/PLAN.md)).
