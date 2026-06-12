---
domain: lead-engine
type: spec
status: implemented
links:
  - "[[domains/lead-engine/lead-engine|lead-engine]]"
  - "[[domains/lead-engine/01-architecture|01 — Architettura]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
created: 2026-06-12
updated: 2026-06-12
---

# Spec: Controllo pipeline dalla web UI — lancio run, stato ed erase dati

---

## User input

> vorrei che ci fosse un modo da UI per lanciare lo script e per fare erase complete dei dati, in modo che possa testare in una prima fase le estrazioni direttamente dalla UI.
>
> La ui dovrebbe peremttere di avviare il flusso. Poi se richiede molto tempo perché non è immediato, di ricevere una notifica quando è pronto in UI / sapere che un flusso è in corso.
>
> Al momento chi usa questo strumento se non fosse una persona tecnica non avrebbe modo di interagire con il flusso se non vedendo export già pronti.

Scope confermato in chiarimento: dalla UI si lancia solo il run daily completo (niente strategie singole né parametri); l'erase copre database + `exports/` conservando i seed; le notifiche sono solo in-app, anche per i fallimenti.

---

## Context

Oggi il run daily (estrazione → enrichment → scoring → selezione → export) si lancia solo da CLI; la web UI mostra i risultati ma non permette di avviare nulla. Un operatore non tecnico può solo consultare export già pronti, senza alcun modo di interagire con il flusso.

Questa spec dà all'operatore (oggi Omar in fase di test, domani un operatore SeVedemo non tecnico) il controllo minimo del ciclo di vita dalla UI: avviare il run daily, sapere che è in corso, sapere quando e come è finito, e azzerare completamente i dati per ripetere i test da zero.

---

## Non-Goals

- Lancio di strategie singole o run con parametri dalla UI: si avvia solo il run daily completo.
- Scheduling automatico (cron, run ricorrenti): l'avvio resta una decisione manuale.
- Notifiche su canali esterni (email, push, Slack): solo in-app.
- Erase selettivo (solo contatti, solo exports, …): esiste solo l'erase completo.
- Streaming dei log di pipeline o progresso dettagliato per fase: basta lo stato in corso / completato / fallito.
- Gestione di run concorrenti multipli: al massimo un run alla volta.
- Autenticazione o permessi sulla UI.

---

## Acceptance Criteria

**Avvio del run**

- Dalla UI l'operatore può avviare il run daily completo con un'azione esplicita, senza usare terminale o CLI.
- Con un run già in corso non è possibile avviarne un altro: l'azione è disabilitata o rifiutata con motivazione visibile.
- Un'attivazione accidentale ripetuta (doppio click, doppio submit) non produce due run.

**Run in corso**

- Mentre il run è in corso, lo stato "run in corso" è visibile da ogni pagina della UI, non solo da quella in cui è stato avviato.
- Lo stato sopravvive a ricarica della pagina e riapertura del browser: tornando sulla UI a run ancora attivo, l'operatore lo vede in corso.
- Il run prosegue lato server anche se l'operatore chiude il browser.

**Notifica di esito**

- A run completato con successo, in UI compare una notifica di esito con accesso diretto al risultato (selezione/export del giorno).
- A run fallito, in UI compare una notifica di errore con un'indicazione comprensibile a un non tecnico di cosa è andato storto.
- La notifica raggiunge l'operatore anche se sta guardando un'altra pagina della UI; se la UI era chiusa al momento della fine, l'esito dell'ultimo run è comunque visibile al ritorno.

**Erase completo**

- Dalla UI l'operatore può azzerare tutti i dati prodotti dal sistema: contatti, selezioni giornaliere, storico run, outcomes, stato dei cursori di rotazione query e i file in `exports/`.
- I file seed di configurazione (query di ricerca, influencer, job URLs) non vengono toccati.
- L'erase chiede una conferma esplicita prima di eseguire ed è chiaramente segnalato come irreversibile.
- L'erase non è eseguibile mentre un run è in corso.
- Dopo l'erase la dashboard riflette lo stato vuoto (zero contatti, nessuna selezione, nessun run) e il run daily successivo riparte da zero, inclusa la rotazione delle query dall'inizio.

---

## Constraints

- Un run daily reale consuma credito Apify (~2 $/run) e chiamate LLM: l'avvio deve essere deliberato e non ripetibile per errore.
- Il run dura minuti, non secondi: lo stato in corso e la notifica devono coprire l'intera durata, incluse le attese delle API esterne.
- UI e CLI condividono lo stesso database SQLite: introdurre il lancio da UI non deve impedire il lancio da CLI già esistente.

---

## Technical Notes

Osservazioni dalla discovery (stato attuale, non scelte di design):

- `runDaily()` è oggi una funzione batch one-shot invocata da CLI; nel sistema non esiste alcun meccanismo di job, stato run o notifica.
- La tabella `runs` registra telemetria solo a run concluso (post-hoc); non traccia run in corso.
- L'API della UI (Hono, porta 8787) e la CLI leggono e scrivono lo stesso file `data/sevedemo.db` (con file WAL `-shm`/`-wal`).
- I dati da azzerare vivono nelle tabelle `contacts`, `runs`, `daily_selection`, `kv` (cursori di rotazione), `outcomes`, più i file in `exports/`.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | La UI deve rilevare e segnalare anche run avviati da CLI in parallelo, o in fase di test si assume un solo canale di lancio? | Indicatore "run in corso" | Omar | Resolved — un solo canale (UI) in fase test, decisione D4 del PLAN |
| 2 | L'erase completo resterà disponibile anche oltre la fase di test, o andrà rimosso/protetto quando lo strumento sarà usato in produzione? | Visibilità e protezione dell'azione | Omar | Open |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Dalla UI si lancia solo il run daily completo, senza strategie singole né parametri | Fase di test: serve il percorso più semplice; i casi avanzati restano su CLI |
| Erase = tutte le tabelle dati + `exports/`, seed preservati | I seed sono configurazione manuale, non dati prodotti; "ripartire da zero" implica anche cursori e outcomes |
| Notifiche solo in-app, anche per i fallimenti | Run nell'ordine di minuti, l'operatore resta tipicamente sulla dashboard; canali esterni rimandati |
| Un solo run alla volta | Evita doppia spesa Apify/LLM e conflitti di scrittura sugli stessi dati |
