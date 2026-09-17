# sevedemo-tools — CRM di prospecting LinkedIn

CRM **personale e locale** (un solo utente, niente login) per trovare e seguire potenziali clienti su
LinkedIn:

- descrivi **la tua azienda** e uno o più **ICP** (profilo cliente ideale), con le **aziende di
  riferimento** con cui hai già trattato;
- generi prospect da **chi reagisce e commenta i tuoi post** (finiscono in **Inbox**) oppure **estrai le
  persone di un'azienda** filtrate per i ruoli dell'ICP (finiscono direttamente in una lista);
- con **Apollo** (facoltativo) trovi **aziende simili** alle tue referenze, le vagli come **candidate**, ne
  cerchi i **contatti** e recuperi le **email di lavoro**;
- organizzi i prospect in **liste per ICP** e gestisci il contatto: **stato**, **touchpoint** multipli,
  note, timeline;
- chiedi all'**AI** (Claude) — solo per questo — un riassunto del profilo, **3 angoli di apertura** e un
  **fit** leggero rispetto all'ICP;
- **esporti** una lista in CSV per il tuo tool email.

Ogni operazione a pagamento (Apify, Claude, Apollo) mostra prima un'**anteprima** con conteggi, costo
stimato (per Apollo anche i crediti) e blocchi: niente parte senza il tuo "Avvia".

## Setup

Serve Node ≥ 20.

```bash
pnpm install                # dipendenze della root (node_modules gestito da pnpm 10)
npm --prefix web install    # dipendenze del frontend (npm)
cp .env.example .env        # inserisci APIFY_TOKEN e ANTHROPIC_API_KEY (e APOLLO_API_KEY se usi Apollo)
npm run ui                  # API su http://localhost:8787 + frontend su http://localhost:5173
```

Apri <http://localhost:5173>: la home è un onboarding in 3 passi finché non hai profilo, ICP e almeno un
prospect, poi porta all'Inbox.

Il database (`data/crm.db`) si crea da solo al primo avvio; `npm run db:init` lo crea o aggiorna senza
avviare nulla. Il vecchio `data/sevedemo.db` resta su disco ma non viene letto. Un database creato prima di
Apollo viene aggiornato al primo avvio, dopo una copia di sicurezza: vedi [Aziende](#aziende).

In alternativa al dev server: `npm run ui:build && npm run api` serve il frontend buildato direttamente
dall'API su <http://localhost:8787>.

## Flusso consigliato

1. **Impostazioni** → salva l'URL pubblico del tuo profilo LinkedIn e descrivi la tua azienda (nome,
   descrizione, offerta). L'analisi AI usa la descrizione per proporre angoli coerenti con ciò che vendi:
   se è vuota le anteprime lo segnalano.
2. **ICP** → crea almeno un ICP (ruoli target, settori, località, dimensione, pains, note) e aggiungi le
   **aziende di riferimento** da URL con l'esito (vinta, in trattativa, persa, riferimento).
3. **Porta dentro le persone**, in uno di questi modi:
   - **Sincronizza interazioni** (Impostazioni › I miei post, oppure dall'Inbox vuota): legge i tuoi
     ultimi post, chi ha reagito e chi ha commentato → prospect in **Inbox** con la fonte (reazione,
     commento). Al primo sync la stima non è disponibile: "Aggiorna solo l'elenco dei post" costa pochi
     centesimi e rende la stima reale. I post già sincronizzati non si ripagano (cooldown di 7 giorni,
     post più vecchi di 90 giorni mai, salvo "Risincronizza tutto").
   - **Sourcing da azienda** (Aziende → aggiungi da URL LinkedIn → Estrai persone): scegli la lista, i
     ruoli (precompilati dall'ICP della lista), il numero massimo di persone e la modalità (Short, Full,
     Full+email) → le persone entrano **direttamente nella lista** con stato "Nuovo". Serve l'URL LinkedIn
     dell'azienda.
   - **Aziende simili con Apollo** (pagina ICP, card "Aziende simili (Apollo)"): dai alle referenze il
     sito web (dettaglio azienda) → **Arricchisci referenze** → **Trova aziende simili** → vaglia le
     **candidate** (Accetta, Scarta, Riproponi) → **Trova contatti…** sulle accettate: le persone entrano
     **direttamente nella lista** scelta con la fonte "Apollo · <azienda>". Con "Trova subito i contatti
     nelle aziende trovate" ricerca e contatti sono un solo job (le aziende restano da vagliare). Poi, se
     servono, le email via Apollo (passo 6). Crediti e limiti in [Apollo](#apollo).
4. **Inbox** → triage in blocco: aggiungi a una lista (anche creandola al volo), scarta ("Mostra
   scartati" → Ripristina), arricchisci o analizza i prospect selezionati. Con più ICP ti chiede per quale
   analizzare.
5. **Liste** → una o più liste per ICP, archiviabili. Nella lista: conteggi per stato cliccabili, filtri
   salvati nell'URL, azioni in blocco (stato, rimuovi, arricchisci, analizza, esporta) e "Aggiungi persone
   da un'azienda".
6. **Arricchisci e analizza** (da lista, selezionati o singolo prospect), sempre passando dall'anteprima:
   - l'**arricchimento** con Apify legge about, esperienze ed email pubblica del profilo; con Apollo cerca
     solo l'email di lavoro (vedi [Arricchimento](#arricchimento));
   - l'**analisi** richiede un profilo arricchito con Apify: in blocco arricchisce prima i mancanti, sul
     singolo prospect c'è "Arricchisci e analizza". Produce riassunto, 3 angoli motivati e fit
     (alto/medio/basso) con motivazione; diventa "da aggiornare" quando cambiano i dati del prospect,
     dell'ICP o della tua azienda.
7. **Prospect** → cambia stato (sempre a mano), registra i touchpoint (canale, direzione, data, testo,
   nuovo stato facoltativo) e le note, consulta timeline, fonti e analisi. Lo stato è **unico** per
   persona: vale in tutte le liste in cui compare.
8. **Export** → dalla lista, CSV con i filtri correnti o con i prospect selezionati. "Solo con email" è
   attivo di default, "Segna come 'contattato'" è facoltativo. Ogni export finisce nella timeline e si può
   riscaricare.

Stati: `nuovo → qualificato → da_contattare → contattato → risposto → in_conversazione →
chiuso_vinto | chiuso_perso | scartato`.

**Job.** Sync, sourcing, arricchimento, analisi in blocco e i job Apollo (arricchimento aziende, aziende
simili, contatti) sono job in background, **uno alla volta**. Il banner nella sidebar mostra il job in corso
e l'esito: zero risultati (neutro), avvisi, oppure errore con la causa (`actor:` provider, `config:`
configurazione, `process:` processo) e il bottone **Riprova**, che prima ricontrolla i blocchi di
configurazione (chiave mancante, lista archiviata…) e, se ce ne sono, li mostra senza ripartire. Un job
Apollo fermato a metà (limite di richieste, errore del provider) tiene quanto ha già salvato e chiude come
riuscito con un avviso; fallisce solo se non ha salvato nulla. Lo storico è in Impostazioni › Ultimi job.

**CSV esportato** — colonne: `full_name, first_name, last_name, email, company, title, linkedin_url,
location, status, list, icp, fit, summary, angle_1, angle_2, angle_3, last_touchpoint_at, sources`
(UTF-8, senza BOM; le celle che sembrano formule vengono neutralizzate).

## Aziende

Un'azienda si riconosce da **due chiavi**: l'**URL LinkedIn** della pagina aziendale e il **dominio** del
sito web. Ne serve almeno una e ciascuna appartiene a una sola azienda (come l'id organizzazione Apollo).

- **Solo dominio**: un'azienda creata da sito o dominio (o trovata da Apollo senza LinkedIn) mostra il badge
  "Senza pagina LinkedIn"; "Estrai persone" resta bloccato finché non inserisci l'URL LinkedIn
  nell'anagrafica.
- **Dominio**: ricavato dal sito, minuscolo, senza schema, porta, percorso, query e `www.`; gli altri
  sottodomini restano (`shop.acme.it` ≠ `acme.it`); i siti su piattaforme condivise (`linkedin.com`,
  `facebook.com`, `instagram.com`, `google.com`, `wixsite.com`) non danno un dominio. Cambiare URL LinkedIn o
  dominio azzera i dati Apollo dell'azienda.
- **Doppioni a mano**: creare o modificare un'azienda con una chiave già usata risponde "Azienda già
  presente" con il link all'altra, senza scrivere nulla. Dal dettaglio, **"Unisci in <azienda>"** dopo una
  conferma che elenca cosa si perde: l'altra azienda sparisce e la superstite ne eredita referenze,
  candidature, prospect e fonti (irreversibile).
- **Unioni automatiche**: se Apollo riporta insieme URL LinkedIn e dominio di due aziende che avevi separate,
  i job le uniscono (resta quella con l'URL LinkedIn) e lo dicono nell'esito; se le chiavi salvate sono in
  conflitto con quelle di Apollo l'azienda si salta con un avviso.

**Aggiornamento del database.** Al primo avvio dopo l'aggiornamento (anche con `npm run db:init`), un
database creato prima di Apollo viene migrato: prima una copia consistente accanto al file,
`data/crm.db.bak-<data e ora>`, poi, in un'unica transazione, aziende a doppia chiave con il dominio
ricavato dal sito, fonti e job con i nuovi tipi, colonne Apollo dei prospect. Se due aziende hanno lo
stesso dominio, lo tiene quella creata prima e il log lo segnala. Se qualcosa fallisce il server **non
parte**, il database resta com'era e il messaggio indica il percorso della copia. Se un job risulta ancora
in esecuzione l'aggiornamento è rifiutato senza modifiche: attendi che finisca (o fermalo) e riavvia. Le
copie contengono dati personali e sono ignorate da git (`data/`, `*.bak-*`).

## Arricchimento

Due provider, scelti con il radio **Provider** del dialog "Arricchisci…" (lista, Inbox, dettaglio
prospect; default Apify):

- **Apify — profilo completo** (`apimaestro/linkedin-profile-detail`): about, esperienze, formazione ed
  email pubblica. Rende il prospect **arricchito**, requisito dell'analisi AI.
- **Apollo — solo email di lavoro** (`people/bulk_match` per id Apollo o URL LinkedIn): cerca solo i
  prospect **senza email** e salva email di lavoro e, se mancano, titolo e azienda; mai email personali né
  telefoni. **Non** rende il prospect arricchito: l'analisi richiede comunque Apify. Chi resta senza email
  risulta "email non disponibile" e si ricerca solo dopo `FRESHNESS_DAYS` (salvo "Riprova anche quelli
  senza risultato").

Le scritture di Apollo possono rendere **da aggiornare** le analisi esistenti: l'AI legge titolo, azienda
e fonti del prospect (compresa "Apollo · <azienda>") e settore, dimensione e sede delle aziende di
riferimento, che l'arricchimento Apollo delle aziende riempie se vuoti.

## Actor e costi indicativi

Nessun actor usa cookie o login LinkedIn. I prezzi sono le stime usate dalle anteprime
(`src/config.ts`): verifica le tariffe attuali su Apify e Anthropic. Apollo si paga in crediti: vedi
[Apollo](#apollo).

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

## Apollo

Facoltativo: senza `APOLLO_API_KEY` le funzioni Apollo mostrano un blocco e il resto del CRM funziona.
Impostazioni e onboarding mostrano se la chiave c'è (solo la presenza, non i permessi).

**Piano e chiave.** Serve un piano Apollo **a pagamento** (il piano gratuito non è supportato) con una
**master key**, oppure una chiave con il permesso di ricerca persone via API (`mixed_people_api_search`).
I permessi si scoprono al primo job che li usa: chiave rifiutata (401) o senza permessi (403) → errore
`config:` con il rimedio (job fallito, oppure esito parziale con avviso se aveva già salvato qualcosa, come
le candidate di una pipeline).

**Crediti.** Le anteprime mostrano sempre i crediti stimati; il costo in dollari solo se imposti
`APOLLO_CREDIT_USD` (altrimenti "stima non disponibile"). Mai email personali né telefoni.

| Operazione | Endpoint Apollo | Crediti | Stima in anteprima |
|---|---|---|---|
| Arricchisci referenze (o una singola azienda) | `organizations/bulk_enrich` | 1 per azienda trovata; una trovata non si ripaga, una non trovata si ritenta dopo `FRESHNESS_DAYS` | 1 per azienda da arricchire |
| Trova aziende simili | `mixed_companies/search` + `organizations/bulk_enrich` | 1 per pagina **+ 1 per ogni azienda nuova**, arricchita nello stesso job (la ricerca non restituisce settore, parole chiave, dipendenti né sede, che servono al punteggio) | fino a pagine + pagine × dimensione (25 · 50 · 100): 1 pagina da 25 = fino a 26 |
| Trova contatti | `mixed_people/api_search` + `people/bulk_match` | ricerca 0 (non restituisce l'URL LinkedIn) **+ 1 per persona rivelata** con il match, email di lavoro inclusa; ricercare un'azienda già cercata ripaga il match | fino a aziende con dominio × persone per azienda |
| Pipeline (simili + contatti) | tutti i precedenti | somma dei due | 1 pagina da 25, 10 persone per azienda: fino a 26 + 250 |
| Email di lavoro (Arricchisci → Apollo) | `people/bulk_match` | 1 per persona trovata | 1 per prospect da cercare |

Le aziende simili partono da filtri derivati dalle referenze arricchite e dall'ICP (parole chiave, fasce di
dipendenti, località), modificabili nel dialog; il punteggio è deterministico (parole chiave 50 %,
dimensione 30 %, località 20 %). Rilanciare con gli stessi filtri e la stessa dimensione di pagina continua
dalla pagina successiva ("Ricomincia dalla pagina 1" per ripartire).

**Limiti di richieste.** Apollo limita ogni endpoint per minuto, ora e giorno. Letti con la chiave usata
per lo smoke del 2026-09-17 (il tuo piano può differire: lo smoke li stampa): arricchimento aziende e match
persone 20/min, 100/ora, 600/24 h; ricerche aziende e persone 50/min, 200/ora, 600/24 h. Arricchimento e
match portano al massimo 10 elementi per richiesta. Il client (`src/apollo/client.ts`):

- dopo ogni risposta legge `x-minute-requests-left`, `x-hourly-requests-left` e `x-24-hour-requests-left`
  dell'endpoint;
- minuto esaurito → **attende** la fine della finestra (fino a 60 s) e prosegue; ora o giorno esauriti →
  **si ferma subito** senza chiamare;
- risposta 429 → attende `retry-after` (al massimo 60 s; 5 s se manca) e ritenta, **3 tentativi in tutto**,
  poi `actor:apollo:<operazione>: limite di richieste raggiunto`;
- timeout di 30 s per richiesta, non ritentato; chiave e dati delle risposte non finiscono mai nei messaggi.

Quando il client si ferma, il job tiene quanto già salvato e chiude con esito parziale e avviso (fallito
solo se non aveva ancora salvato nulla).

`APOLLO_RATE_LIMIT_PER_MINUTE` serve solo agli avvisi delle anteprime: il ritmo reale segue gli header.
Variabili: `APOLLO_API_KEY`, `APOLLO_MAX_COMPANY_PAGES` (3), `APOLLO_PEOPLE_PER_COMPANY` (10),
`APOLLO_RATE_LIMIT_PER_MINUTE` (20), `APOLLO_CREDIT_USD` (vuoto), dettagli in
[Variabili d'ambiente](#variabili-dambiente).

**Verifica preliminare.** Prima dell'uso reale, con la chiave nel `.env`, un dominio aziendale e un profilo
LinkedIn di persona reali:

```bash
npm run apollo:smoke -- --domain acme.it --linkedin https://www.linkedin.com/in/<slug>        # solo il piano
npm run apollo:smoke -- --domain acme.it --linkedin https://www.linkedin.com/in/<slug> --yes  # ≈ 4 crediti
```

Senza `--yes` stampa costo atteso e chiamate previste ed esce (codice 2) senza chiamare Apollo. Con `--yes`
chiama una volta ciascuna operazione con le stesse richieste dei job: arricchimento dell'azienda (1
credito), una pagina di ricerca aziende (1), ricerca persone (0), match di al massimo 2 persone, per id della
prima trovata e per l'URL LinkedIn (fino a 2). Per ogni chiamata stampa esito HTTP, permesso (ok/NEGATO),
header di limiti e crediti, rimedio in caso d'errore e campi restituiti, poi un riepilogo (codice 0 se tutto
riesce, 1 altrimenti): confronta i crediti con la dashboard Apollo. Le risposte grezze finiscono in
`tests/fixtures/apollo/raw/` (ignorata da git), le copie anonimizzate in `tests/fixtures/apollo/smoke/`:
**rivedile a mano prima di committarle** (il repo è pubblico).

## Note su ToS, GDPR e dati

- **Niente cookie né login**: il profilo "collegato" è solo il tuo URL pubblico; gli actor leggono dati
  pubblici e il tuo account LinkedIn non viene mai usato. Lo scraping resta comunque contrario ai Termini
  di LinkedIn: uso **personale**, volumi bassi (i limiti per post e per azienda servono anche a questo).
- **GDPR**: i prospect nell'UE sono dati personali, anche quelli arrivati da Apollo. Il CRM conserva la
  **provenienza** di ogni persona (reazione, commento, azienda, Apollo), ma base giuridica e **opt-out**
  nell'outreach restano a tuo carico. Non è consulenza legale.
- **Dove vanno i dati**: tutto resta in `data/crm.db` sul tuo computer; escono solo le richieste ai
  provider (Apify per leggere LinkedIn, Anthropic per l'analisi, a cui arriva il profilo del prospect,
  Apollo per aziende e contatti, a cui arrivano domini, filtri di ricerca e id Apollo o URL LinkedIn delle
  persone di cui cerchi l'email).
- **Nessuna autenticazione**: l'API è pensata per `localhost`, non esporla in rete.

## Variabili d'ambiente

Tutte facoltative in `.env` (vedi `.env.example`) tranne `APIFY_TOKEN` e `ANTHROPIC_API_KEY`; lette
all'avvio da `src/config.ts` (`UI_PORT` da `src/server/index.ts`). Per cambiarle riavvia `npm run ui`.

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
| `FRESHNESS_DAYS` | `90` | Un arricchimento senza risultato (Apify, email Apollo, azienda non trovata su Apollo) si ritenta solo dopo questi giorni (salvo "Riprova anche quelli senza risultato" / "Ritenta anche le non trovate"). |
| `PRICE_PROFILE_DETAIL_USD` | vuoto | Prezzo per profilo arricchito; vuoto = "stima non disponibile" nelle anteprime. |
| `APOLLO_API_KEY` | vuoto | Chiave Apollo (piano a pagamento: master key o permesso di ricerca persone). Senza, le funzioni Apollo mostrano un blocco. |
| `APOLLO_MAX_COMPANY_PAGES` | `3` | Tetto di pagine per ricerca di aziende simili (1–100; il dialog ne propone 1). |
| `APOLLO_PEOPLE_PER_COMPANY` | `10` | Persone proposte per azienda in "Trova contatti" (1–100). |
| `APOLLO_RATE_LIMIT_PER_MINUTE` | `20` | Richieste al minuto oltre le quali le anteprime avvisano (minimo 1); il client segue comunque gli header di Apollo. |
| `APOLLO_CREDIT_USD` | vuoto | Prezzo in USD di un credito Apollo; vuoto = "stima non disponibile" nelle anteprime. |
| `DB_PATH` | `data/crm.db` | Percorso del database SQLite. |
| `UI_PORT` | `8787` | Porta dell'API. Se la cambi, avvia il frontend con `API_URL=http://localhost:<porta>` (proxy di Vite). |

## Provare la UI senza spendere: server e2e

`npm run e2e:server` avvia l'API vera su un **database temporaneo** (azzerato a ogni avvio, mai in
`data/`), con i job che girano davvero ma su **dati finti** da fixture: nessuna chiamata ad Apify, a Claude
o ad Apollo, il `.env` viene ignorato.

```bash
npm run e2e:server                                      # API finta su http://localhost:8790
API_URL=http://localhost:8790 npm --prefix web run dev  # frontend contro l'API finta
curl -s -X POST localhost:8790/api/e2e/seed             # scenario pronto: profilo, ICP, lista, prospect + scenario Apollo
curl -s -X POST localhost:8790/api/e2e/reset            # database vuoto
```

`E2E_NO_APOLLO=1 npm run e2e:server` parte senza chiave Apollo (blocchi nelle anteprime Apollo). Gli esiti
non felici dei job Apollo si ottengono dalla UI con parole come `apollo-empty`, `apollo-fail`,
`apollo-partial` o `apollo-noscope` nel nome dell'ICP o della lista, nei filtri della ricerca o nel sito di
un'azienda.

Dataset, scenari di errore (sync vuoto o fallito, analisi rifiutata, profili senza dati, limiti e permessi
Apollo…) e ricette per `agent-browser` sono in [`tests/e2e/README.md`](tests/e2e/README.md).

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run ui` | API + frontend in sviluppo. |
| `npm run api` | Solo API (serve anche `web/dist` se presente). |
| `npm run ui:build` | Build del frontend in `web/dist`. |
| `npm run db:init` | Crea/aggiorna lo schema del database (idempotente). |
| `npm run cli -- --help` | CLI di manutenzione (oggi solo `db:init`). |
| `npm run e2e:server` | API con job finti su database temporaneo. |
| `npm run apollo:smoke -- --domain … --linkedin … [--yes]` | Verifica reale di chiave, crediti e limiti Apollo (vedi [Apollo](#apollo)). |
| `npm test` / `npm run test:watch` | Test del server (vitest). |
| `npm run typecheck` | TypeScript su `src/`, `tests/` e `scripts/`. |

## Struttura e stack

TypeScript + Node (`tsx`), SQLite (`better-sqlite3`), `apify-client`, `@anthropic-ai/sdk`, `zod`; Apollo via
`fetch`. API locale **Hono** (`src/server/`) e frontend **React 19** + TanStack Router/Query + Tailwind CSS 4
+ shadcn (`web/`, Vite).

- `src/db/` — schema (14 tabelle), migrazione dei database esistenti e repository; `src/db/identity.ts`
  riconosce la stessa persona arrivata da fonti diverse e unisce i doppioni, `src/db/company-identity.ts`
  fa lo stesso per le aziende.
- `src/server/routes/` — un router per risorsa; `src/server/jobs.ts` — controller dei job.
- `src/jobs/` — i sette job (sync, sourcing, arricchimento, analisi, arricchimento aziende, aziende simili,
  contatti Apollo) e le loro dipendenze reali/finte.
- `src/apify/actors.ts` — **unico punto** in cui si scrivono gli input degli actor: se un actor cambia
  schema, si corregge qui. `src/acquisition/mappers/` legge gli output in modo tollerante.
- `src/apollo/requests.ts` — **unico punto** delle richieste Apollo; `client.ts` gestisce limiti e
  ritentativi, `mappers/` legge le risposte in modo tollerante, `similarity.ts` calcola filtri e punteggio.
- `src/enrich/`, `src/analysis/`, `src/exports/` — arricchimento, analisi AI, export CSV.
- `scripts/e2e-server.ts`, `scripts/apollo-smoke.ts`, `tests/` — server e2e, smoke Apollo e test.

Documentazione di progetto e regole per chi sviluppa: [`AGENTS.md`](AGENTS.md) e il knowledge base in
[`brain/`](brain/index.md) (dominio [`prospect-crm`](brain/domains/prospect-crm/prospect-crm.md), piani e
flussi UI in [`brain/specs/prospect-crm/crm-foundation/`](brain/specs/prospect-crm/crm-foundation/PLAN.md) e
[`brain/specs/prospect-crm/apollo-lookalike/`](brain/specs/prospect-crm/apollo-lookalike/PLAN.md)).
