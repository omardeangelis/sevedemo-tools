# Smoke end-to-end profilo e servizi — M1a (own-profile-services T7)

Smoke funzionale con `agent-browser` della tappa **M1a** (invalidazione) del
[PLAN](../../brain/specs/prospect-crm/own-profile-services/PLAN.md): i due casi opposti di F7/F13, i due conteggi e il
blocco di F8, il badge che sparisce al rilascio e **ricompare** col testo nuovo (la metà di FLOW F.6 che appartiene
a questa tappa), C7/C9/C15 sui post. Server, seed e trigger: [README](README.md) (scenario own-profile-services del
seed). Nessuna chiamata ad Apify, Anthropic, Apollo o Cloudflare. Per ogni riga: **OK / attrito / bug**.

Ultima esecuzione: **2026-09-29** (T7). Esito: **17 righe OK**, nessun BLOCKER, nessun bug. Nessun segreto nei log
dei run (0 occorrenze dei token finti in log e dettagli di 20 run).

## Precondizioni e comandi

```bash
UI_PORT=8841 E2E_FAKE_DELAY_MS=200 npm run e2e:server
API_URL=http://localhost:8841 npm --prefix web run dev -- --port 5241 --strictPort
curl -s -X POST localhost:8841/api/e2e/seed        # own_profile: {truncated_post_id, complete_post_id, stale_id, analyzed_ids}

ab() { agent-browser --session op-t7 "$@"; }
ab open http://localhost:5241/ && ab set viewport 1280 1000
```

**Reset del badge (S5).** Il server e2e azzera il DB all'avvio e non passa dal backfill: la prova usa l'**entry reale**
`src/server/index.ts` su una copia scratch del DB e2e resa "pre-rilascio" (tutte le `subject_hash` a `NULL`, l'input
di Luca Bernardi diverso da oggi), con job e token finti:

```bash
DB_PATH=$TMPDIR/crm-smoke-reset/crm.db UI_PORT=8842 E2E_FAKE_JOBS=1 APIFY_TOKEN=e2e-finto ANTHROPIC_API_KEY=e2e-finto \
  APOLLO_API_KEY=e2e-finto DOTENV_CONFIG_PATH=/dev/null npx tsx src/server/index.ts   # serve anche web/dist
```

Processi fermati per PID (server: `npm` → `tsx` → `node`; Vite: `npm` → `vite`), sessioni chiuse con `ab close`.
Evidenze: `t7/NN-*.png` nella cartella scratch della sessione (non versionate).

### Gotcha di automazione (non bug del prodotto)

- Bottoni fuori viewport (Salva azienda, Arricchisci, Analizza… della barra dei selezionati): `ab click` risponde
  `✓ Done` senza cliccare. Sempre `ab scrollintoview @ref` prima.
- Un toast dell'esito copre la barra "Azioni sui selezionati": chiuderlo (`button[aria-label="Chiudi notifica"]`).
- In zsh le variabili non si spezzano in parole: `kill $PIDS` con più PID in una stringa fallisce; un PID per volta.

## Righe

| # | Riga (FLOW / criterio) | Passi | Esito |
|---|---|---|---|
| S1 | F13 — la persona cambiata dopo l'analisi (seed) | Scheda di Elena Sartori | **OK**: badge *da aggiornare* + *"Questa persona è cambiata dopo l'analisi."*; **Rianalizza** secondario (outline) |
| S2 | F7 — seed, nessun cambio | Schede di Luca Bernardi e Marco Ferri | **OK**: nessun badge, nessuna riga |
| S3 | F7 — modifica della mia azienda | Impostazioni → La mia azienda: *Di cosa si occupa* e *Cosa offri* cambiati, **Salva azienda** (*"Azienda salvata"*) | **OK**: Luca e Marco senza badge; Elena ancora col suo |
| S4 | F7, P-6 — ICP modificato e rinominato | ICP → nome *"CTO di PMI manifatturiere (Nord)"*, **Salva ICP** | **OK**: Luca e Marco senza badge; Elena invariata |
| S5 | F.6 — il reset al rilascio | Entry reale su copia pre-rilascio (vedi sopra) | **OK**: console *"Impronta della persona calcolata per 3 analisi dai dati di oggi…"*; Elena e Luca (col criterio vecchio "da aggiornare") **senza** badge |
| S6 | F.6, F13 — il badge ricompare | Scheda di Luca → **Arricchisci** → **Avvia arricchimento** (*"Arricchimento: 1 arricchito"*) | **OK**: badge + *"Questa persona è cambiata dopo l'analisi."*, **Rianalizza** secondario |
| S7 | F8 — selezione di tre già analizzate, casella spenta | Persone → Luca, Marco, Elena → **Analizza…** → ICP | **OK**: *"3 selezionati · 0 da analizzare"*, *"3 persone hanno già un'analisi per questo ICP: restano fuori."*, $0,00; **Avvia analisi** disabilitato con *"Nessuna persona da analizzare: tutte e 3 hanno già un'analisi per questo ICP. Per rifarle spunta «Includi chi è già analizzato»."* |
| S8 | F8 — casella **"Includi chi è già analizzato"** | Spunta nella stessa anteprima | **OK**: *"Da rifare: 3 · Input identico, saltate comunque: 0."*, stima ≈ $0,09, **Avvia** attivo. Dopo S3 nessuna analisi ha più l'input identico (rischio dichiarato in PLAN §12: la descrizione della casella non promette niente) |
| S9 | G-12 — zero da rifare | Giulia Marchetti e Paolo Ranieri analizzati con un job, poi selezionati + casella | **OK**: *"Da rifare: 0 · Input identico, saltate comunque: 2."*, **Avvia** disabilitato con *"Nessuna delle 2 ha dati diversi da quando è stata analizzata: non ci sarebbe nulla da rifare."* |
| S10 | F8, P-9 — precedenza casella > lista filtrata | T4: Lista 1 → **Analizza…** (prop `onlyMissing`) + casella | **OK**: *"Da rifare: 2"*: i parametri inviati hanno `onlyMissing: false` |
| S11 | C6 — post misti nel seed | DB e2e dopo il seed | **OK**: post 1 estratto troncato (301, `text_complete = 0`), post 2 integrale (252, `1`) |
| S12 | C7, C9 — il testo integrale arriva solo da un sync chiesto dall'utente | I miei post → **Sincronizza interazioni** → *Risincronizza tutto* → **Avvia sync** | **OK**: post 1 conservato intero (363, `1`); nessun sync partito da sé prima |
| S13 | C15 — I miei post (corpo e testo al passaggio del mouse) | I miei post dopo S12 | **OK**: corpo su 2 righe, `title` 301 e 252 caratteri (come prima del rilascio) |
| S14 | C15 — etichetta del post in Persone | Persone → **Altri filtri** → *Post* | **OK**: *"Migrare al cloud senza fermare la produzione: 5 …"* (48 + …) |
| S15 | C15 — fonti di righe e scheda | `GET /api/prospects` e scheda di Giulia Neri (reazione al post 1) | **OK**: righe ≤ 121, scheda 301 (estratto di prima) |
| S16 | C15 — anteprima di unione | `GET /api/prospects/21/merge-preview?otherId=20` (le due Giulia Neri) | **OK**: *"Reazione a 'Migrare al cloud senza fermare…'"* (30 caratteri) |
| S17 | G8 — testi nuovi in italiano; nessun segreto nei log | Tutti i testi introdotti da M1a; log e dettagli dei run delle due istanze | **OK** |

---

# Smoke M1b — servizi e campi del profilo (own-profile-services T12)

Percorso **D** del FLOW per intero con la **copy provvisoria** di PLAN §10, più la regressione delle ancore
`#profilo`/`#azienda` (G2, OQ-8), gli error path del FLOW che toccano la pagina e l'accessibilità (tastiera, focus,
live region). Stesso server e2e e stessi gotcha di sopra; nessuna chiamata esterna.

Ultima esecuzione: **2026-09-30** (T12, dopo `simplify`). Esito: **16 righe OK**, nessun BLOCKER. Corretti durante la
prova: il focus cadeva su `body` dopo un'aggiunta o un'eliminazione fallite (S27) e `#servizi` non scorreva alla card
(S18).

```bash
UI_PORT=8851 E2E_FAKE_DELAY_MS=300 npm run e2e:server
API_URL=http://localhost:8851 npm --prefix web run dev -- --port 5251 --strictPort
curl -s -X POST localhost:8851/api/e2e/seed          # nessun servizio; nome, descrizione e offerta senza provenienza
ab() { agent-browser --session op-t12 "$@"; }
ab open http://localhost:5251/people && ab set viewport 1280 1000
```

Gotcha di questa tappa: dopo una modifica al **server** il server e2e va riavviato (tsx non ricarica: la pagina
cadeva su `profile.readiness` assente); `ab wait --text` può restare appeso, meglio `ab wait <ms>`; tre `click()` JS
nello stesso tick valgono un clic solo (nessun render in mezzo): per i clic rapidi usare `ab click` separati.

| # | Riga (FLOW / criterio) | Passi | Esito |
|---|---|---|---|
| S18 | D.1 vuota, §10 (nessuna CTA di generazione) | `/settings/profile#servizi` | **OK**: *"Cosa vendi, un servizio per riga. L'ordine lo decidi tu."* · *"Nessun servizio. Aggiungine uno a mano."* · un solo bottone **Aggiungi servizio**, nessun "Genera" in pagina; la pagina scorre alla card |
| S19 | D.2, B2 — aggiunta col solo nome | **Aggiungi servizio** → *Fractional CTO* → **Salva servizio** | **OK**: dialog *"Aggiungi servizio"*, hint *"Basta il nome: il resto è facoltativo."*, campi Nome (obbligatorio) · A chi serve · Problema che risolve · Descrizione · Prove e risultati · Note, focus sul Nome; toast *"Servizio aggiunto: Fractional CTO"*, riga in fondo con *"scritto da te il 30 set"*, focus sulla riga |
| S20 | B2 — nome vuoto | **Salva servizio** a Nome vuoto | **OK**: *"Inserisci il nome del servizio."*, focus sul campo, `aria-invalid` |
| S21 | B10 — omonimi | *fractional  CTO* (con *A chi serve* compilato), poi *QUALITÀ* dopo *Qualità* | **OK**: *"Hai già un servizio con questo nome: «Fractional CTO». I nomi si distinguono a meno di maiuscole e spazi."* sotto il Nome, niente salvato, testi rimasti; stessa frase con «Qualità»; Esc rimette il focus su **Aggiungi servizio** |
| S22 | D.3, B4 — riordino | ↑ su *Formazione DevOps*, ↓ su *Fractional CTO*, tre ↑ di fila su *Assessment architetturale*, ricarico | **OK**: *"«Formazione DevOps» è ora 3 di 5."*, focus sul bottone premuto (anche arrivato in cima: `aria-disabled`); tre clic → posizione 2, schermo = DB; ordine uguale dopo ricarico |
| S23 | Error path — riordino fallito | `fail-next` `PUT /api/services/order`, poi ↓ | **OK**: *"Ordine non salvato: Errore interno (e2e)."* + ordine ripristinato a schermo e nel DB; l'avviso sparisce alla prossima scrittura riuscita (S24) |
| S24 | G7 — modifica e Dettagli | **Modifica «Assessment architetturale»** → Descrizione e Prove → **Salva servizio** → **Dettagli** | **OK**: *"Modifica servizio"* coi valori; toast *"Servizio salvato: Assessment architetturale"*, focus di nuovo su Modifica; Dettagli `aria-expanded` con Descrizione · Prove e risultati · Note |
| S25 | D.4, G7 — eliminazione con conferma (§10) | **Elimina «Fractional CTO»** da tastiera: Esc, poi Invio → Tab → Invio | **OK**: solo *"Eliminare il servizio «Fractional CTO»?"* (nessuna frase sulle analisi, niente "da rifare"), focus su **Annulla**, Esc rimette il focus su Elimina; toast *"Servizio eliminato: Fractional CTO."*, focus sulla riga che prende il posto |
| S26 | G9 — tutto da tastiera | Aggiungi (Invio nel Nome), Tab sull'↑ della riga nuova, Spazio | **OK**: riga nuova a fuoco, *"«Coaching tecnico» è ora 4 di 5."*, focus sul bottone |
| S27 | Error path — aggiunta ed eliminazione fallite | `fail-next` `POST /api/services` e `DELETE /api/services/<id>`; poi eliminazione già fatta da un'altra scheda | **OK**: *"Errore interno (e2e)."* / *"Servizio non eliminato: Errore interno (e2e)."* nel dialog, testi rimasti, focus sul bottone per riprovare (prima cadeva su `body`: corretto), il secondo tentativo riesce; già eliminato altrove ⇒ *"Il servizio «Workshop architettura» era già stato eliminato."* e riga tolta |
| S28 | G2, OQ-8 — regressione delle ancore | `/settings/profile#profilo` e `#azienda` da un'altra pagina, ricarico, `/settings#…`, link *profilo LinkedIn* e *descrizione della tua azienda* di Oggi | **OK**: focus su *"URL pubblico del tuo profilo"* nella card *"I tuoi indirizzi pubblici"* e su *"Di cosa si occupa"* in *"La mia azienda"*, sempre in vista |
| S29 | C11, B6 — sito | *il mio sito* → **Salva sito**, ricarico, poi `https://www.officinacodice.it/chi-siamo` | **OK**: toast *"Sito salvato"*, *"Non riesco a ricavare un dominio da questo indirizzo: il record d'impresa resterà non disponibile."* sotto il campo anche dopo ricarico (sparisce mentre lo correggi), *"scritto da te il 30 set"*; poi dominio `officinacodice.it` |
| S30 | B1, B6, G-11 — campi nuovi e legacy | Posizionamento · Prove e risultati · Tono di voce, **Salva azienda**, ricarico; poi solo *Di cosa si occupa* | **OK**: tre provenienze dopo ricarico, nome/descrizione/offerta senza (`filled_without_origin` 3); riscritta la descrizione dal form (che manda tutti i campi) ⇒ provenienza solo lì, conteggio **2** |
| S31 | B5 — profilo vuoto | `POST /api/e2e/reset`, `/settings/profile` | **OK**: nessun campo, nessun servizio, nessun errore; resta solo l'avviso di oggi *"Descrizione azienda vuota…"* (da `readiness`) |
| S32 | Error path — caricamento fallito | `fail-next` `GET /api/profile` ×2 | **OK**: ErrorBox *"Errore interno (e2e)."* + **Riprova**, sidebar usabile; Riprova ricarica le tre card |
| S33 | G8, §10 — testi in pagina | Tutti i testi introdotti da M1b | **OK**: tutti in italiano; copy provvisoria come §10 (tabella in IMPLEMENTATION-NOTES), nessun bottone di generazione, l'hint di Rianalizza e "Da completare" di Oggi invariati |

---

# Smoke M2 — l'analisi nomina il servizio affine (own-profile-services T17)

Percorso **F** del FLOW con servizi scritti a mano: la riga *Servizio più affine* (F.1), il servizio rinominato,
eliminato e ricreato (F.2, F5), nessun segno da una modifica dell'utente (F.3, F7), la stima dichiarata e "stima non
disponibile" (F.4, F10, D5), la metà di **F.6** che appartiene a questa tappa (*"tre schede analizzate prima del
rilascio non mostrano la riga del servizio"*; l'altra metà, il badge che ricompare, è S5–S6 di M1a) e i testi
definitivi di M1b (PLAN §10). Stesso server e2e e stessi gotcha di sopra; nessuna chiamata esterna.

Ultima esecuzione: **2026-09-30** (T17, dopo `simplify`). Esito: **12 righe OK**, nessun BLOCKER, nessun bug. Nessun
segreto nei log (0 occorrenze dei token finti in dettagli e log di 5 run).

```bash
UI_PORT=8851 npm run e2e:server                    # poi PRICE_ANALYSIS_USD= UI_PORT=8851 npm run e2e:server per S44
API_URL=http://localhost:8851 npm --prefix web run dev -- --port 5251 --strictPort
curl -s -X POST localhost:8851/api/e2e/seed          # analisi del seed: Luca Bernardi, Marco Ferri, Elena Sartori
ab() { agent-browser --session op-t17 "$@"; }
ab open http://localhost:5251/people && ab set viewport 1280 1000
```

Gotcha di questa tappa: le intestazioni delle sezioni della card (*Riassunto*, *Servizio più affine*) sono in
maiuscolo via CSS, quindi `innerText` e `ab wait --text` le vedono in maiuscolo: i controlli leggono `textContent`.

| # | Riga (FLOW / criterio) | Passi | Esito |
|---|---|---|---|
| S34 | F.6, F9 — il giorno del rilascio, metà di questa tappa | Seed, zero servizi: schede di Luca Bernardi, Marco Ferri, Elena Sartori (analisi del seed) | **OK**: analisi presente, **nessuna** sezione *Servizio più affine* e nessun campo vuoto etichettato |
| S35 | B3, F7, F9 — servizi a mano | **Aggiungi servizio** ×2: *Assessment architetturale in 2 settimane* (A chi serve compilato), *Fractional CTO*; poi le tre schede | **OK**: servizi in ordine; le tre analisi restano senza sezione; nessun badge nuovo (Elena resta *"da aggiornare"* per l'About del seed, F13) |
| S36 | F.1, F2 — il servizio più affine | Scheda di Elena → **Rianalizza** | **OK**: *Servizio più affine* sotto il Riassunto: ***Assessment architetturale in 2 settimane** — Il primo dei tuoi servizi: analisi di esempio…*; badge sparito (analisi nuova); hint *"Rianalizza con il profilo e i servizi di oggi (≈ $0,03)."* (`t17/36-servizio-affine.png`) |
| S37 | F3 — risposta non riconducibile | About di Giulia Marchetti con `e2e-servizio-inesistente` → **Analizza** | **OK**: analisi salvata e mostrata, nessuna sezione, nessun errore; colonne `NULL` |
| S38 | F.2, F4, F5, F7 — servizio rinominato | **Modifica** → *Assessment in 2 settimane* → **Salva servizio**; scheda di Elena | **OK**: ***Assessment architetturale in 2 settimane** — non è più tra i tuoi servizi (nome di allora).* + il perché di allora; zero link/bottoni nella sezione, nessun invito a rifare, nessun badge; **Rianalizza** secondario (`outline`) |
| S39 | F5, edge case — ricreato col vecchio nome | **Aggiungi servizio** *assessment architetturale  in 2 settimane* (minuscolo, due spazi); scheda di Elena | **OK**: la sezione torna *"— Il primo dei tuoi servizi…"* (esistente): il confronto è quello di B10 |
| S40 | D.4, F5, F7, G9 — eliminazione con le due frasi | **Elimina** da tastiera (Invio, Tab, Invio) | **OK**: *"Eliminare il servizio «…»?"* + *"Le analisi che lo citano restano come sono e continueranno a mostrare questo nome. Nessuna analisi risulta da rifare: se ne vuoi una aggiornata la rifai tu."* (legata con `aria-describedby`), focus su **Annulla**; toast *"Servizio eliminato: …"*; la scheda torna *"non è più tra i tuoi servizi (nome di allora)."* |
| S41 | F.3, F7 — profilo modificato | Posizionamento e Tono di voce → **Salva azienda** | **OK**: `stale: false` per le quattro persone analizzate, nessun badge né riga *"Questa persona è cambiata…"* |
| S42 | F2, F3, F8 — analisi in blocco con servizi | Persone → Elena + Giulia → **Analizza…** → ICP → **Includi chi è già analizzato** → **Avvia analisi** | **OK**: *"2 selezionati · 2 da analizzare"*, *"Da rifare: 2 · Input identico, saltate comunque: 0."*, *"≈ $0,06"*; dopo il job Elena ha *Assessment in 2 settimane* (esistente), Giulia nessuno (marcatore) |
| S43 | §10, T16 — testi definitivi | `/settings/profile` | **OK**: *"Cosa vendi, un servizio per riga. L'ordine lo decidi tu: l'analisi e (in futuro) l'assistente ICP li leggono così."*; card azienda con un solo *"Usati dall'analisi AI e (in futuro) dall'assistente ICP. Tutti facoltativi."*; i tre hint dei campi nuovi letti via `aria-describedby`; nessun "Genera" (T30) |
| S44 | F.4, F10, D5 — stima non disponibile | Server e2e con `PRICE_ANALYSIS_USD=`; schede di Giulia (prima analisi), Elena (rianalisi), Paolo (senza dati); dialog in blocco su Elena | **OK**: *"… (stima non disponibile)."* nei tre rami; dialog *"Costo stimato: stima non disponibile"* + *"Prezzo dell'analisi non configurato (PRICE_ANALYSIS_USD): stima non disponibile."*; **Avvia** resta attivo (nessun blocco inventato) |
| S45 | G8 — testi in italiano; nessun segreto nei log | Testi di M2; `GET /api/runs/:id` e `/log` dei run | **OK**: tutti in italiano; 0 occorrenze dei token finti; il log dell'analisi dice *"Anthropic · analisi · Elena Sartori"* e non cita servizi né dati inviati |
