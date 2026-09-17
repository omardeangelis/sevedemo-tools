# Server e2e (job fake) — guida per agent-browser

`npm run e2e:server` avvia **l'API vera** del CRM su un DB scratch, con i job che girano davvero
(processo figlio, mapper degli actor, scritture sul DB, esiti e `summary`) ma su **deps fixture-backed**
(`E2E_FAKE_JOBS=1`): nessuna chiamata ad Apify o a Claude, nessun costo. Serve a validare il frontend
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
- **non legge `.env`** (config deterministica, chiavi reali mai usate) e imposta token finti, così
  `readiness` e le preview li vedono presenti;
- passa l'ambiente ai processi figli dei job (`DB_PATH`, `E2E_FAKE_JOBS=1`, …): lo ereditano da `process.env`.

| Variabile | Default | Effetto |
|---|---|---|
| `UI_PORT` | `8790` | Porta (e nome del DB scratch). |
| `DB_PATH` | `$TMPDIR/crm-e2e-<porta>/crm.db` | DB scratch, azzerato all'avvio. Mai in `data/`. |
| `E2E_FAKE_DELAY_MS` | `1000` | Latenza finta per chiamata "actor": rende visibili banner "in corso" e `aria-busy`. `0` = istantaneo. Vale per: lettura post (1 per sync), dipendenti (1 per sourcing), ogni profilo arricchito, ogni chiamata al modello (JSON non valido = 2 chiamate). |
| `E2E_NO_APIFY=1` | — | `APIFY_TOKEN` vuoto → blocco "APIFY_TOKEN mancante" nelle preview di sync, sourcing, arricchimento. |
| `E2E_NO_ANTHROPIC=1` | — | `ANTHROPIC_API_KEY` vuota → blocco nelle preview/avvii dell'analisi. |
| `PRICE_PROFILE_DETAIL_USD`, `POSTS_PER_SYNC`, `REACTIONS_PER_POST`, … | valori di `src/config.ts` | Passali nella shell (il `.env` è ignorato), es. `PRICE_PROFILE_DETAIL_USD=0.01` per vedere la stima dell'arricchimento. |

Un solo job alla volta **per server**: i worker che lavorano in parallelo usano porte diverse.

## Endpoint di supporto

| Endpoint | Effetto |
|---|---|
| `POST /api/e2e/reset` | Svuota tutte le tabelle e riparte dagli id 1 → `{ok: true}`. `409 {code:'job_running'}` se un job è in corso. |
| `POST /api/e2e/seed` | Reset + **scenario base** (sotto) → `{profile_url, icp_id, list_id, company_id, sync_summary, prospects: [{id, full_name, linkedin_url, in_list}]}`. Stesso `409` del reset. |

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
```

- Gli id ripartono da 1 dopo ogni reset/seed: nel seed Giulia è il prospect 1, la lista e l'ICP sono 1.
- `E2E_FAKE_DELAY_MS=0` rende i job quasi istantanei (resta l'avvio del processo figlio, ~1 s).
- Nessun dato reale: persone, aziende, URL ed email (`*.example`) sono inventati.
