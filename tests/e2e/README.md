# Server e2e (job fake) — guida per agent-browser

`npm run e2e:server` avvia **l'API vera** del CRM su un DB scratch, con i job che girano davvero
(processo figlio, mapper degli actor, scritture sul DB, esiti e `summary`) ma su **deps fixture-backed**
(`E2E_FAKE_JOBS=1`): nessuna chiamata ad Apify, a Claude o ad Apollo, nessun costo. I job Apollo passano dal
**client Apollo vero** (`src/apollo/client.ts`) con un `fetch` finto che serve le fixture `apollo-*.json`: stessi
body delle richieste, stessi errori e testi (`config:` / `actor:apollo:<op>:`) della produzione. Serve a validare il frontend
(T13–T19) e lo smoke end-to-end (T18) con `agent-browser`, compresi i percorsi non felici del FLOW.

Codice: `scripts/e2e-server.ts` (avvio, reset/seed), `src/jobs/fake-deps.ts` (deps fake),
fixture in `tests/fixtures/e2e/`, test in `tests/e2e-deps.test.ts`.

## Avvio

```bash
# Terminale 1 — API e2e (default :8790, accanto all'API reale su :8787)
npm run e2e:server
UI_PORT=8811 npm run e2e:server            # un'altra porta = un altro DB (worker in parallelo)

# Terminale 2 — frontend live contro il server e2e (Vite fa da proxy per /api)
API_URL=http://localhost:8790 npm --prefix web run dev -- --port 5180

agent-browser --session t14 open http://localhost:5180/settings
```

Se esiste `web/dist` il server e2e serve anche la SPA buildata (come `npm run api`): comodo per lo smoke,
ma può essere **vecchia** — ricostruiscila con `npm run ui:build` oppure usa Vite come sopra.

All'avvio il server:

- usa `DB_PATH` se impostato, altrimenti `$TMPDIR/crm-e2e-<porta>/crm.db`, e lo **azzera**;
- **rifiuta di partire** se `DB_PATH` sta in `data/` (es. `data/crm.db`, `data/sevedemo.db`): reset e seed
  cancellano tutto;
- **non legge `.env`** (config deterministica, chiavi reali mai usate) e imposta token e chiavi finti (Apify,
  Anthropic, Apollo), così `readiness` e le preview li vedono presenti; la riga di avvio li elenca
  (`Apollo: finto` / `Apollo: ASSENTE (E2E_NO_APOLLO=1)`);
- passa l'ambiente ai processi figli dei job (`DB_PATH`, `E2E_FAKE_JOBS=1`, …): lo ereditano da `process.env`.

| Variabile | Default | Effetto |
|---|---|---|
| `UI_PORT` | `8790` | Porta (e nome del DB scratch). |
| `DB_PATH` | `$TMPDIR/crm-e2e-<porta>/crm.db` | DB scratch, azzerato all'avvio. Mai in `data/`. |
| `E2E_FAKE_DELAY_MS` | `1000` | Latenza finta per chiamata "actor": rende visibili banner "in corso" e `aria-busy`. `0` = istantaneo. Vale per: lettura post (1 per sync), dipendenti (1 per sourcing), ogni profilo arricchito, ogni chiamata al modello (JSON non valido = 2 chiamate); nei job Apollo **una volta per operazione** (ricerca aziende, arricchimento, ricerca persone, match): una ricerca dura ~2 s, una pipeline ~4 s. |
| `E2E_NO_APIFY=1` | — | `APIFY_TOKEN` vuoto → blocco "APIFY_TOKEN mancante" nelle preview di sync, sourcing, arricchimento. |
| `E2E_NO_ANTHROPIC=1` | — | `ANTHROPIC_API_KEY` vuota → blocco nelle preview/avvii dell'analisi. |
| `E2E_NO_APOLLO=1` | — | `APOLLO_API_KEY` vuota → *"APOLLO_API_KEY mancante nel .env — nessun job avviato."* nelle 4 preview Apollo (arricchimento referenze, aziende simili, contatti, email via Apollo), readiness `apollo: false`. Il seed arricchisce comunque Acme. |
| `PRICE_PROFILE_DETAIL_USD`, `APOLLO_CREDIT_USD`, `APOLLO_MAX_COMPANY_PAGES`, `APOLLO_PEOPLE_PER_COMPANY`, `POSTS_PER_SYNC`, … | valori di `src/config.ts` | Passali nella shell (il `.env` è ignorato), es. `PRICE_PROFILE_DETAIL_USD=0.01` per la stima dell'arricchimento o `APOLLO_CREDIT_USD=0.1` per il "Costo stimato" delle preview Apollo (senza: "stima non disponibile"). |

Un solo job alla volta **per server**: i worker che lavorano in parallelo usano porte diverse.

## Endpoint di supporto

| Endpoint | Effetto |
|---|---|
| `POST /api/e2e/reset` | Svuota tutte le tabelle e riparte dagli id 1 → `{ok: true}`. `409 {code:'job_running'}` se un job è in corso. |
| `POST /api/e2e/seed` | Reset + **scenario base** + **scenario Apollo** (sotto) → `{profile_url, icp_id, list_id, company_id, sync_summary, prospects: [{id, full_name, linkedin_url, in_list}], apollo: {icp_id, list_id, reference_ids: {acme, beta, delta}, nolinkedin_company_id, other_icp_id, other_list_id, other_reference_ids: {key_conflict, not_found}, id_taken_prospect_id, email_target_prospect_ids}}`. Stesso `409` del reset. |

```bash
curl -s -X POST localhost:8790/api/e2e/reset
curl -s -X POST localhost:8790/api/e2e/seed
```

**Scenario base del seed** (id prevedibili, tutti `1`): profilo `https://www.linkedin.com/in/utente-demo-e2e`;
azienda utente "Officina Codice Srl" con descrizione e offerta; ICP 1 "CTO di PMI manifatturiere" con ruoli
CTO, Head of Engineering, VP Engineering, IT Manager (settori, località, dimensione, pains compilati);
azienda 1 "Ferronova Digitale Srl" (`company/ferronova-digitale-e2e`) come riferimento **vinta** dell'ICP;
lista 1 "CTO manifattura Nord Italia"; il sync di default già eseguito (**senza** riga in `jobs`: "Ultimi job"
vuoto, i 2 post risultano sincronizzati); **Luca Bernardi** e **Marco Ferri** in lista 1, gli altri 5 in Inbox.
Nessun arricchimento né analisi. Readiness completa: `/` reindirizza a `/inbox`.

**Scenario Apollo del seed** (dopo il base, id prevedibili; nessuna candidata, nessun job):

| Id | Cosa | Stato |
|---|---|---|
| ICP **2** | **"HR tech Milano"** (esempio SPEC): ruoli CTO, Head of People · settori `hr tech` · dimensione `10-50` · località `Milano` | preview ricerca senza blocker: parole chiave `hr, saas, software, hr tech`, fasce `1-10 … 101-200`, località `Italy, Milano` |
| azienda **2** | **Acme HR Software Srl** — `acme-hr.example` + `company/acme-hr-software-e2e`, referenza vinta | **arricchita 7 giorni fa** (nucleo reale dell'arricchimento sulle fixture): software · saas · hr, 80 dipendenti, Milan/Lombardy |
| azienda **3** | **Beta Payroll Srl** — solo `beta-payroll.example`, referenza vinta | **da arricchire** (Apollo porta `company/beta-payroll-e2e`: "1 URL LinkedIn acquisito") |
| azienda **4** | **Delta People Srl** — solo `company/delta-people-e2e`, referenza in trattativa | **senza sito** (la ricerca la ritrova con `delta-people.example`: "1 referenza completata") |
| lista **2** | **"HR tech Milano — decisori"** (ICP 2, attiva) | prospect **8–18** senza email (Marta Ferrari … Federico Mancini) + **19 Carlo Gentile** (con email, id Apollo `e2e-id-preso`) |
| azienda **5** | **Paghe Semplici Srl** — solo `nolinkedin.example` | badge "Senza pagina LinkedIn"; nessuna referenza |
| ICP **3** | **"Software house Torino"** con lista **3** "Software house — CTO" | liste raggruppate per ICP nel dialog contatti dal dettaglio azienda (F12) |
| azienda **6** | **Conflitto Chiavi Srl** — `conflitto-chiavi.example` + `company/conflitto-chiavi-e2e`, referenza di ICP 3 | Apollo indica `company/conflitto-chiavi-apollo` → **chiavi in conflitto** (arricchimento e ricerca) |
| azienda **7** | **Non Trovata Srl** — `non-trovata.example`, referenza di ICP 3 | Apollo non la conosce → **non trovata** |

## Il dataset (persone e aziende fittizie)

### Sync interazioni — 2 post, 6 reazioni, 3 commenti

Primo sync di default: *"Sync completato: 2 post sincronizzati · 6 reazioni e 3 commenti letti · 7 nuovi
prospect in Inbox · 1 senza profilo pubblico (saltati)."* Rilanciato subito: esito zero neutro *"Nessun post da
sincronizzare: i 2 post sono già sincronizzati…"* (con "Risincronizza tutto" = `force` rilegge: 7 "già presenti").
Le date dei post sono relative a oggi (6 e 13 giorni fa).

| Persona | Fonte | URL dopo il sync | Arricchimento | Analisi (fixture) |
|---|---|---|---|---|
| **Giulia Marchetti** — CTO @ Ferronova Digitale | reazione LIKE (URL `/in/ACoAA…` + `reactor.urn`) **e** commento con slug sul post 1, stesso nome e headline → **1 prospect, 2 fonti** | `/in/giulia-marchetti-e2e` + `member_urn` | dati + email | **fit alto** |
| **Luca Bernardi** — Head of Engineering @ Trasporti Adrialog | commento post 1 ("…migrando a Kubernetes…") | slug | dati, senza email | **fit medio** |
| **Paolo Ranieri** — Direttore Amministrativo @ Molini Valdenza | reazione PRAISE post 1 | id membro (slug dopo l'arricchimento) | dati, email letta dall'About | **fit basso** |
| **Marco Ferri** — VP Engineering @ PagoLampo | reazione INTEREST post 1 (URL slug) | slug | dati + email | analisi di default (**medio**, con nome e headline) |
| **Sara Colombo** — Founder & CEO @ Studio Colombo Architetti | reazione EMPATHY post 2 | id membro | dati + email | **rifiuto** del modello |
| **Davide Greco** — IT Manager @ Conserve Solari | commento post 2 | slug | dati | **JSON non valido** (2 tentativi) |
| **Chiara Lombardi** — Talent Acquisition @ Reclutami Consulting | reazione LIKE post 2 | id membro | **senza dati** (profilo privato) | non analizzabile |
| "LinkedIn Member" | reazione post 2 senza profilo | — (scartata, `skipped_no_url`) | — | — |

Stati di riga dell'analisi attesi per lo stesso ICP: Giulia `alto`, Luca `medio`, Paolo `basso`, Marco
`medio`, Sara `rifiutata`, Davide `errore`, Chiara `non_arricchibile`. Nel job bulk su tutti e 7 (Marco non
ancora arricchito, gli altri sì): `analyzed 4 · refusals 1 · errors 1 · not_enrichable 1 · enriched_first 1`.

Chi non è in queste fixture (es. i dipendenti estratti in Short) viene arricchito con un **profilo
sintetico** costruito dai dati già salvati (About *"Profilo sintetico del server e2e…"*) e analizzato con
l'analisi di default (fit medio).

### Sourcing da azienda — qualunque URL `linkedin.com/company/<slug>`

- **Qualunque azienda**: 5 item → **4 persone** + 1 "LinkedIn Member" nascosto (`skipped_no_url`): Alessandro
  Conti (CTO), Federica Galli (Head of Engineering), Matteo Russo (Engineering Manager), Valentina Moretti
  (Responsabile Sistemi Informativi). Nome azienda = quello in anagrafica (o lo slug in parole); slug delle
  persone `<nome>-<slug-azienda>` e id membro derivato dallo slug: **persone diverse per ogni azienda**.
- **`company/ferronova-digitale-e2e`**: Giulia Marchetti (la stessa del sync: slug + id membro → *"1 già in
  archivio"*, esce dall'Inbox), Stefano Villa, Elena Rota.
- I **ruoli non filtrano** (risultato prevedibile); `maxItems` taglia. Modalità: **Short** = nome, headline,
  URL in forma id membro + `publicIdentifier` (nessun arricchimento); **Full** = + About ed esperienze →
  `marked_enriched`; **Full+email** = + email `@<slug-azienda>.example` (dove presente).
- Preview Short 50: `est_cost_usd 0.22`.

### Apollo — `tests/fixtures/e2e/apollo-*.json`

- **Ricerca aziende** (`apollo-search.json`, layout reale: niente settore/parole chiave/dipendenti/sede): **58**
  organizzazioni paginate per `perPage` → con 25: pagina 1 = 25, pagina 2 = 25, **pagina 3 = 8** (corta: ricerca
  esaurita); con 50: 50 + 8; con 100: 58 (esaurita subito). I filtri non filtrano (risultato prevedibile).
  Pagina 1 per l'ICP 2 appena seminato: *"25 lette · 21 nuove candidate · 1 già nota (non riproposta) · 1 con
  chiavi in conflitto (saltata) · 1 senza sito né pagina LinkedIn (saltata) · 2 senza pagina LinkedIn · 1
  referenza completata · 21 aziende arricchite · 1 pagina letta · 22 crediti usati."* + warning sul conflitto. Casi:
  Acme (già nota), Delta con il dominio (referenza completata), `nolinkedin.example` e Turni Facili (senza
  LinkedIn), "Studio Senza Sito" (senza chiavi), Conflitto Chiavi, **Ferronova Digitale** (referenza dell'ICP 1 →
  candidata normale, acquisisce `ferronova.example`), **Epsilon Paghe Cloud** (senza città né regione → "località
  non disponibile"). Punteggi tutti > 0 e nelle tre fasce: Gamma Welfare **0,75** (alto), Epsilon 0,69, …, Talenti
  in Rete 0,13 (basso). Rilancio con gli stessi filtri: "continuo dalla pagina 2"; dopo la pagina 3: "Ricerca esaurita
  (8 aziende su 25)". Pagina 2 contiene **Omega Paghe** (`omega-paghe.example` + `company/omega-paghe-e2e`, vedi
  ricette per l'unione).
- **Arricchimento** (`apollo-organizations.json`, `bulk_enrich` completo): tutte le aziende della ricerca + Beta;
  un dominio assente (es. `non-trovata.example` o uno inventato) = non trovata.
- **Ricerca persone** (`apollo-people.json`, senza URL LinkedIn né email): per **qualunque dominio** 4 persone modello
  (Tommaso Riva CTO, Irene Bassi Head of People, Noemi Sartori HR Business Partner **senza email**, Pietro Longo
  Talent Acquisition Lead) con slug `<nome>-<cognome>-<dominio-con-trattini>` → persone diverse per azienda. Il tetto
  per azienda taglia, i ruoli non filtrano.
  - **`gamma-welfare.example`** (Gamma Welfare, pagina 1): Alberto Ricci (nuovo) · **Marta Ferrari** (già in lista 2
    → "già in lista", email riempita) · persona **`senza-url`** Ludovica Neri (rivelata senza URL → "senza profilo
    LinkedIn (saltata)") · persona **`id-preso`** Beatrice Galli (id Apollo già di Carlo Gentile → "con id Apollo già
    assegnato") · Sofia Greco (senza email).
  - **`ferronova.example`** (dopo che la ricerca l'ha acquisito): **Giulia Marchetti** (dal sync → "già in archivio")
    ed Elena Rota (stesso slug del sourcing di Ferronova).
- **Match** (`apollo-match.json`, `matches[]` allineati + `credits_consumed`): per id (persone sopra) o per URL
  LinkedIn. Lista 2 con "Email via Apollo": *"8 email di lavoro trovate · 3 non disponibili · 1 già presente
  (saltata) · 10 crediti usati"* (Giorgia Bellini e Simone Grasso senza email, Elisa Caruso non abbinata). Inbox:
  Giulia Marchetti trovata, Davide Greco senza email, gli altri non abbinati.
- Esiti tipici: contatti su Gamma + Turni Facili + Paghe Semplici → *"13 persone lette in 3 aziende · 11 aggiunte
  (11 nuove, 0 già in archivio) · 1 già in lista · 1 senza profilo LinkedIn (saltata) · 1 con id Apollo già
  assegnato · 9 con email · 13 crediti usati"*; pipeline sulla pagina 1 → *"Contatti Apollo: 83 persone lette in 21
  aziende · 81 aggiunte …"*.

## Trigger dei percorsi non felici

### 1. `params.__fixture` del job

Accettato **solo** nel body di `POST /api/sync/interactions`, `POST /api/analyze` e `POST /api/lists/:id/analyze`
(il frontend non lo invia: da agent-browser usa `eval` + `fetch`, vedi le ricette). Resta nei `params`, quindi
**"Riprova" lo ripete**. Valori case-insensitive.

| `__fixture` | Sync interazioni | Analisi bulk |
|---|---|---|
| `EMPTY` | 0 post letti → `succeeded`, *"Nessun post trovato sul profilo <url>."* (neutro, nessun dato scritto) | arricchimento dei mancanti senza dati (→ non analizzabili); chi ha già dati viene analizzato |
| `FAIL` | `failed`: `actor:apimaestro/linkedin-profile-posts: Impossibile leggere i post di <url> (errore simulato dal server e2e (…)). Nessun dato modificato.` | `failed`: `actor:claude-opus-5: Chiamata al modello non riuscita: errore simulato dal server e2e (…)` — se c'è almeno un prospect da arricchire/analizzare (tutti saltati → `succeeded`) |
| `FAIL_ONCE` | come `FAIL` al primo avvio; **"Riprova" riesce** (stessi `params`: un job precedente con params identici è già fallito). Un `FAIL` precedente non conta. | idem |
| `WARN` | aggiunge un 3° post ("Checklist…", 12 reazioni dichiarate, 0 lette) → `succeeded` con **1 warning** *"0 reazioni lette da 1 post che ne dichiara 12…"*; quel post resta `to_sync` in `GET /api/posts` | — |
| `PARTIAL` | commenti del post 2 in errore → `succeeded` con `post_errors: 1` e *"· 1 post in errore (vedi 'I miei post')"*; in `GET /api/posts` il post 2 ha `sync_state: 'error'` e `sync_error` `actor:apimaestro/linkedin-post-comments-…` | — |

Nota: dopo un primo sync i post sono "freschi": `WARN` legge solo il post nuovo, `PARTIAL` richiede `force: true`
per rileggere il post 2.

### 2. Parole chiave nei dati (utilizzabili dalla UI, nessun `__fixture`)

Confronto per sottostringa, minuscolo, con gli spazi letti come trattini ("Acme Nodata" = `acme-nodata`).

| Dove | Parola | Effetto |
|---|---|---|
| **Slug del mio profilo** (Impostazioni), es. `linkedin.com/in/omar-fail` | `fail-once` · `fail` · `empty` · `warn` · `partial` | come `FAIL_ONCE` · `FAIL` · `EMPTY` · `WARN` · `PARTIAL` del sync |
| **Slug dell'azienda** (sourcing), es. `linkedin.com/company/acme-fail` | `fail-once` · `fail` · `empty` | `fail`: job `failed` `actor:harvestapi/linkedin-company-employees: errore simulato dal server e2e (…)` · `empty`: `succeeded`, *"Nessuna persona trovata in <azienda> con ruoli …. Amplia i ruoli…"* (neutro) · `fail-once`: fallisce, "Riprova" riesce |
| **Prospect da arricchire**: URL, nome, headline, azienda o ruolo | `nodata` | nessun dato → `no_data`, riga "non arricchibile"; con "Arricchisci e analizza" → `409 not_enrichable` |
| | `enrich-error` | errore del provider `actor:apimaestro/linkedin-profile-detail: errore simulato…`; se falliscono **tutti** i profili del job → job `failed`; con `enrichFirst` → `502 enrich_failed` |
| **Testo del profilo inviato al modello**: nome, headline, ruolo, azienda, località, About, esperienze, commenti | `e2e-refusal` | rifiuto → `502 {code:'refusal'}`, riga `rifiutata` |
| | `e2e-invalid-json` | JSON non valido due volte → `502 {code:'invalid_output'}`, riga `errore` |
| | `e2e-fit-alto` · `e2e-fit-medio` · `e2e-fit-basso` | analisi riuscita con quel fit |

Le parole si propagano: le persone estratte da `company/acme-nodata` hanno `acme-nodata` nello slug e arrivano
**senza dati** all'arricchimento; da `company/acme-enrich-error` l'arricchimento **fallisce**; da
`company/acme-e2e-refusal` l'analisi viene **rifiutata** (l'azienda è nella headline). Per un solo prospect,
modifica il campo About/headline/azienda dal dettaglio (`PATCH /api/prospects/:id`).

### 3. Job Apollo: parole `apollo-…` nei dati

Le route Apollo hanno body stretti: **`__fixture` non si può inviare** (vale solo nei test, che inseriscono la riga
`jobs` a mano: `tests/e2e-deps.test.ts`). Dalla UI si usano le parole chiave, cercate **a ogni chiamata Apollo** (stesse
regole: minuscolo, spazi = trattini) in:

- **nome dell'ICP** del job (arricchimento referenze, ricerca, contatti) e **nome della lista** (contatti, pipeline,
  email via Apollo su una lista) — rinomina da UI o con `PATCH /api/icps/:id` / `PATCH /api/lists/:id`: vale per
  tutte le chiamate del job;
- **chip dei filtri** della ricerca (parole chiave o località, es. aggiungi `apollo-partial`): solo la ricerca aziende;
- **dominio o nome dell'azienda** chiamata (arricchimento: i domini del lotto; contatti: l'azienda cercata e i suoi
  match), es. un'azienda con sito `apollo-fail.example`: fallisce solo quella chiamata;
- **nome, azienda, ruolo o URL del prospect** (email via Apollo: il lotto che lo contiene).

"Riprova" copia i `params`: con `apollo-fail-once` il secondo avvio riesce (come `FAIL_ONCE`).

| Parola (`__fixture` nei test) | Effetto per operazione Apollo | Arricchimento referenze | Aziende simili (+ pipeline) | Contatti | Email via Apollo |
|---|---|---|---|---|---|
| `apollo-empty` (`EMPTY`) | 0 risultati: ricerca `organizations: []`, `bulk_enrich` senza organizzazioni, persone `[]`, `matches` tutti `null` | tutte "non trovate" | zero neutro *"Nessuna azienda trovata con: … Allarga le fasce o togli la località."* | zero neutro *"Nessuna persona trovata in N aziende con ruoli …"* | *"0 email trovate · N non disponibili"* |
| `apollo-fail` (`FAIL`) | HTTP 500 su ogni chiamata → `ApolloProviderError` `actor:apollo:<op>: HTTP 500 (errore simulato dal server e2e …)` | `failed` `actor:apollo:organizations/bulk_enrich: … Nessun dato modificato.` | `failed` `actor:apollo:mixed_companies/search: … Nessun dato modificato.` | `failed` (sulla 1ª azienda) o parziale con l'errore in testa (su un'azienda successiva) | `failed` `actor:apollo:people/bulk_match: …` |
| `apollo-fail-once` (`FAIL_ONCE`) | come `apollo-fail` al primo avvio; "Riprova" (stessi `params`) riesce | idem | idem | idem | idem |
| `apollo-partial` (`PARTIAL`) | 429 oltre i tentativi (`ApolloRateLimitError`, `retry-after: 60`) alla **2ª** chiamata dell'operazione del ciclo | 2° lotto (≥ 11 referenze) in errore, gli altri proseguono: *"Errore Apollo (…limite di richieste raggiunto…): 2 referenze restano da arricchire"* | pagina 2 (servono **pagine ≥ 2**): `succeeded`, *"Limite Apollo raggiunto: letta 1 pagina su 2 (25 aziende). … continuo dalla pagina 2."*, `last_page 1`; in pipeline anche la 2ª azienda del passo contatti | 2ª azienda: *"Limite Apollo raggiunto: completata 1 azienda su N · …"* | 2° lotto (≥ 11 target, es. lista 2): *"Limite Apollo raggiunto: 10 email cercate su 11 · 7 trovate. Il restante resta "da cercare" …"* |
| `apollo-hourly` (`HOURLY`) | limite **orario** esaurito (`x-hourly-requests-left: 0`, `window: 'hourly'`) alla **2ª** chiamata di `bulk_enrich` / `bulk_match` | 2° lotto (≥ 11 referenze): *"Limite Apollo raggiunto: arricchite 10 referenze su 12; le altre restano da arricchire."* | arricchimento della pagina 1 al 2° lotto: *"Limite Apollo raggiunto durante l'arricchimento: 11 aziende nuove della pagina 1 senza dati Apollo …"*, `enriched 10`; pipeline: anche il 2° match | match della 2ª azienda: parziale come `apollo-partial` | come `apollo-partial` |
| `apollo-noscope` (`NOSCOPE`) | 403 sulla **ricerca persone** → `config: la chiave Apollo non ha i permessi per mixed_people/api_search: usa una master key …` | — | pipeline: `succeeded`, candidate salvate, warning *"config: … · Contatti non trovati. Le candidate sono salvate: usa 'Trova contatti' dopo aver sistemato la chiave."* | `failed` `config: … Nessun dato modificato.` | — |
| `apollo-badkey` (`BADKEY`) | 401 su ogni chiamata → `config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env.` | `failed` | `failed` | `failed` | `failed` |
| `apollo-unrecognized` (`UNRECOGNIZED`) | ricerca aziende con 5 item che nessun mapper riconosce | — | `succeeded` con warning *"Apollo ha risposto ma nessuna azienda è stata riconosciuta (5 dichiarate): verifica il provider. …"*, 0 candidate | — | — |

### Mappa FLOW → come ottenerlo

| Percorso (FLOW) | Come |
|---|---|
| B.4 esito pieno / zero neutro | sync di default / rilancio subito dopo (oppure `EMPTY`, profilo `…-empty`) |
| B.4 warning (0 letti, dichiarati > 0) | `WARN` o profilo `…-warn` |
| B.4 esito parziale (post in errore) | `PARTIAL` o profilo `…-partial` (+ `force` se già sincronizzato) |
| Actor fallisce interamente + "Riprova" | `FAIL` / `FAIL_ONCE`, profilo `…-fail` / `…-fail-once`, azienda `…-fail` |
| Token mancanti (blocchi in preview) | `E2E_NO_APIFY=1` / `E2E_NO_ANTHROPIC=1` all'avvio |
| Job già in corso (blocco / 409) | avvia un job e subito un secondo (con `E2E_FAKE_DELAY_MS` ≥ 1000) |
| D.3 sourcing a zero | azienda `…-empty` |
| E.2 "senza dati sul profilo" | Chiara Lombardi, oppure persone da `company/…-nodata` |
| E.4/H analisi: rifiutata, errore, non arricchibile | Sara Colombo, Davide Greco, Chiara Lombardi (o marcatori `e2e-…`) |
| Analisi singola "Arricchisci e analizza" | Marco Ferri (non arricchito dopo il sync) con `enrichFirst` |
| Stessa persona da più fonti (reazione + commento; reazione + dipendente) | Giulia Marchetti: sync, poi sourcing da `company/ferronova-digitale-e2e` |
| Descrizione azienda vuota → warning in preview analisi | non compilare "La mia azienda" (o reset) |

**apollo-lookalike** (seed; ICP 2 = "HR tech Milano", lista 2, ICP 3 = "Software house Torino"):

| Percorso (FLOW apollo-lookalike) | Come |
|---|---|
| Readiness Apollo in Impostazioni/home | seed (verde) · `E2E_NO_APOLLO=1` (rossa) |
| A.1 card "Mai eseguita" · 1b referenze *"3 referenze · 2 con sito (1 arricchita, 1 da arricchire) · 1 senza sito"* | `/icps/2` dopo il seed |
| A.1b "Arricchisci referenze" → *"1 referenza arricchita · 0 non trovate · 0 unioni · 1 URL LinkedIn acquisito"* | ICP 2 (Beta) |
| A.1b non trovata + chiavi in conflitto (esito e riga nella card) | ICP 3 → "Arricchisci referenze": *"0 arricchite · 1 non trovata (Non Trovata Srl) · … · 1 con chiavi in conflitto (Conflitto Chiavi Srl)"* |
| A.1b "Arricchisci con Apollo" dal dettaglio azienda (1 credito) | `/companies/5` (Paghe Semplici) o `/companies/3` (Beta) |
| A.2 preview: warning "Beta non è ancora arricchita", "Delta è senza sito", filtri con origini, "fino a 26" | `/icps/2` → "Trova aziende simili" |
| A.2 "Nessuna referenza arricchita: i filtri derivano solo dall'ICP" · "Nessuna lista attiva" | ICP 3 (nessuna arricchita) · un ICP nuovo senza liste |
| A.2 blocker "Tutti i filtri sono vuoti" | togli tutti i chip (`custom=1` senza valori) |
| A.3 successo pieno · "Vedi candidate" | ICP 2, 1 pagina da 25 |
| A.3 zero neutro | chip `apollo-empty` |
| D6 "continuo dalla pagina 2" · "Ricomincia" · "Ricerca esaurita (8 aziende su 25)" | rilancia con gli stessi filtri; dopo aver letto la pagina 3 |
| D14 "Ricerche precedenti" con fasce e "1 senza località" · "Riusa questi filtri" | dopo una o più ricerche (Epsilon = senza località) |
| B triage (per riga, bulk, empty state, "Trova contatti in queste N") | candidate dell'ICP 2 dopo A.3 |
| C contatti con "senza profilo LinkedIn", "id Apollo già assegnato", "già in lista", "già in archivio" | accetta **Gamma Welfare** (+ Ferronova, altre) → "Trova contatti" con lista 2 |
| C warning "già cercate per 'HR tech Milano — decisori' il <data>" · badge "già cercata il" | rilancia i contatti sulle stesse aziende |
| C.3 zero neutro | lista rinominata con `apollo-empty` |
| C / F12 dal dettaglio azienda con liste raggruppate per ICP | `/companies/5` (solo dominio) → "Trova contatti" (liste 1, 2, 3) |
| D email via Apollo: *"8 trovate · 3 non disponibili · 1 già presente"* · timeline | lista 2 → "Arricchisci…" → provider Apollo |
| D blocker "Nessun profilo da cercare con queste opzioni" | rilancia D sulla lista 2 senza "Riprova…" |
| E pipeline: due righe d'esito, candidate restano proposte | ICP 2 → spunta "Trova subito i contatti" con lista 2 |
| E spunta disabilitata "Crea una lista per questo ICP…" | un ICP senza liste |
| F azienda solo-dominio, badge, blocker "Estrai persone", URL a mano | `/companies/5`; `409` inline: incolla `https://www.linkedin.com/company/acme-hr-software-e2e` (è di Acme) → "Unisci in" |
| Error: chiave mancante (A, C, D) | `E2E_NO_APOLLO=1` |
| Error: 401 · 403 contatti · 403 in pipeline | `apollo-badkey` · lista/ICP con `apollo-noscope` (contatti → `failed`; pipeline → warning) |
| Error: rate limit A (pagina 2) · C/E (azienda 2) · D (lotto 2) · A.1b (lotto 2) | `apollo-partial` (A con pagine ≥ 2) · lista 2 rinominata `apollo-partial` (C, D) · 12 referenze + `apollo-hourly` (ricetta) |
| Error: 5xx prima di scrivere (`failed`) / dopo (parziale) · "Riprova" | `apollo-fail` nell'ICP/lista · sito `apollo-fail.example` su una azienda non prima · `apollo-fail-once` |
| Error: schema inatteso | chip `apollo-unrecognized` |
| Error: lista archiviata (C, D, E) · job già in corso | archivia la lista 2 · avvia una pipeline con `E2E_FAKE_DELAY_MS` ≥ 1000 e subito un secondo job |
| Edge: referenza di un altro ICP → candidata normale | Ferronova (referenza ICP 1) nella pagina 1 dell'ICP 2 |
| Edge: unione automatica (azienda solo-LinkedIn + solo-dominio) | ricetta Omega Paghe |

## Ricette agent-browser

```bash
# DB pulito prima di ogni scenario
curl -s -X POST localhost:8790/api/e2e/reset

# Job fallito senza passare dalla UI: il banner lo trova col polling di /api/jobs/current
agent-browser --session t14 eval "fetch('/api/sync/interactions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({__fixture:'FAIL_ONCE'})}).then(r=>r.status)"
agent-browser --session t14 snapshot -i        # banner "Errore" + bottone Riprova

# Stato atteso lato API, per le asserzioni
curl -s localhost:8790/api/jobs/current
curl -s 'localhost:8790/api/inbox?pageSize=100'

# Apollo: ricerca aziende simili dell'ICP 2 (1 pagina da 25), poi candidate
curl -s localhost:8790/api/icps/2/lookalike/preview | jq '.counts, .blockers'
curl -s -X POST localhost:8790/api/icps/2/lookalike -H 'content-type: application/json' \
  -d '{"pages":1,"perPage":25,"keywords":["hr","saas","software","hr tech"],"ranges":["1-10","11-20","21-50","51-100","101-200"],"locations":["Italy","Milano"]}'
curl -s 'localhost:8790/api/icps/2/candidates?status=proposta' | jq '.total'

# Rate limit alla pagina 2: chip `apollo-partial` e 2 pagine (FLOW "Rate limit — A")
curl -s -X POST localhost:8790/api/icps/2/lookalike -H 'content-type: application/json' \
  -d '{"pages":2,"perPage":25,"keywords":["hr","apollo-partial"],"ranges":[],"locations":[]}'

# Rate limit / scenari sui contatti o sull'email della lista 2: rinomina la lista (ricordati di ripristinarla)
curl -s -X PATCH localhost:8790/api/lists/2 -H 'content-type: application/json' -d '{"name":"HR tech Milano — decisori apollo-partial"}'

# 12 referenze con sito (A.1b rate limit): ICP "Blocco apollo-hourly" + 12 aziende della fixture come referenze
ICP=$(curl -s -X POST localhost:8790/api/icps -H 'content-type: application/json' -d '{"name":"Blocco apollo-hourly"}' | jq .id)
for d in omega-paghe assunzioni-digitali cedolino-facile team-pulse mentor-hub selezione-pro orari-chiari welfare-nord skill-map contratti-snelli hr-analytics-italia nuove-leve; do
  C=$(curl -s -X POST localhost:8790/api/companies -H 'content-type: application/json' -d "{\"website\":\"$d.example\"}" | jq .id)
  curl -s -X PUT localhost:8790/api/icps/$ICP/reference-companies/$C -H 'content-type: application/json' -d '{}' > /dev/null
done   # poi /icps/$ICP → "Arricchisci referenze": "Limite Apollo raggiunto: arricchite 10 referenze su 12"

# Unione automatica in ricerca: prima di leggere la pagina 2 crea le due metà di Omega Paghe
curl -s -X POST localhost:8790/api/companies -H 'content-type: application/json' -d '{"linkedin_url":"https://www.linkedin.com/company/omega-paghe-e2e"}'
curl -s -X POST localhost:8790/api/companies -H 'content-type: application/json' -d '{"website":"omega-paghe.example"}'
```

- Gli id ripartono da 1 dopo ogni reset/seed: nel seed Giulia è il prospect 1, la lista e l'ICP sono 1; lo scenario
  Apollo usa ICP 2–3, liste 2–3, aziende 2–7, prospect 8–19.
- `E2E_FAKE_DELAY_MS=0` rende i job quasi istantanei (resta l'avvio del processo figlio, ~1 s).
- Nessun dato reale: persone, aziende, URL ed email (`*.example`) sono inventati.
- Le fixture Apollo usano solo id `e2e-…`: mai una chiamata ad Apollo, nemmeno con una chiave vera nella shell
  (il server e2e la sovrascrive e le deps fake non usano la rete).
