---
domain: lead-engine
type: spec
status: draft
links:
  - "[[domains/lead-engine/lead-engine|lead-engine]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
  - "[[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]"
created: 2026-06-13
updated: 2026-06-13
---

# Spec: Segmentazione per presenza email e filtri persistenti

---

## User input

> La piattaforma dovrebbe permettermi più facilmente di filtrare i candidati anche in base al fatto se abbiano una mail o no. In generale filtrare i contatti non persiste i filtri usati e tornando indietro si ha sempre la lista per intero.

> il terzo punto va diviso in diversi outcome:
> - Voglio poter dividere le estrazioni e i contatti per chi ha una mail e chi non ce l'ha.
> - Voglio che i filtri siano persistenti, così da non doverli settare di continuo.
> - Poter estrapolare e inserire in flussi di email solo i contatti giusti e per gli altri poter in futuro sviluppare flussi di ulteriore enrichment.
> - Vedere anche nelle selezioni se l'utente ha la mail o no così da avere una visione chiara su chi sia pronto per essere inserito in un flusso di mail e chi vada contattato manualmente / arricchito

Chiarimenti raccolti prima della stesura:

- **Persistenza filtri**: solo nella sessione corrente (stato nell'URL: sopravvive a navigazione, back/forward, reload ed è condivisibile via link; si azzera alla chiusura del browser).
- **Selezione automatica**: invariata, basata sul fit. La presenza email è **solo segmentazione a valle**, non influenza i 20+20.
- **Export**: un **singolo export filtrabile** (flag di email-readiness + possibilità di scaricare solo gli email-ready), non file separati.
- **Superfici** della segmentazione/filtro per presenza email: pagina Contatti, pool candidati delle Selezioni, vista Selezione del giorno, export/download.

---

## Context

La web UI consente di consultare i contatti e correggere le selezioni prima dell'export verso il tool email (handoff via CSV/JSON, nessuna integrazione diretta). Due limiti emersi nell'uso:

1. **Non si distingue chi è contattabile via email da chi no.** L'email è un campo best-effort dell'enrichment: molti contatti ne sono privi. Oggi nulla permette di filtrare/segmentare per presenza email, quindi non è chiaro chi sia "pronto per un flusso di mail" e chi vada arricchito o contattato a mano.
2. **I filtri non persistono.** Nella pagina Contatti i filtri vivono in stato locale di React: aprendo il dettaglio di un contatto e tornando indietro, o ricaricando, si ritrova la lista intera e si devono re-impostare ogni volta.

Questa spec dà all'operatore (oggi Omar in test, domani un operatore SeVedemo non tecnico) la capacità di **segmentare per presenza email** su tutte le superfici rilevanti e di **non perdere i filtri** navigando, così da estrapolare verso i flussi email solo i contatti effettivamente contattabili e tenere da parte gli altri per futuri flussi di enrichment.

È la terza di tre spec progressive ed è collegata alle altre due: la spec #1 (gate Italia) e la spec #2 (niente bozza senza email) riducono il rumore a monte; questa spec rende **visibile e azionabile** la distinzione "pronto per email vs da arricchire".

---

## Non-Goals

- Costruire i **flussi di enrichment** per i contatti senza email: qui si rende solo identificabile/segmentabile l'insieme "da arricchire"; gli enrichment veri sono lavoro futuro.
- Integrazione diretta con il tool email esterno: l'handoff resta l'export CSV/JSON.
- Cambiare la **selezione automatica** 20+20 (resta fit-based; deciso).
- Persistenza dei filtri **tra sessioni** o per-utente (niente localStorage, niente account/auth): solo stato di sessione nell'URL.
- Validazione della sintassi dell'email: si considera solo presenza/assenza (coerente con la spec #2).
- Il gate geografico Italia (spec #1) e il guard di costo sulle bozze (spec #2).

---

## Acceptance Criteria

**Outcome 1 — Filtrare/dividere contatti ed estrazioni per presenza email**

- Nella pagina Contatti è disponibile un filtro per presenza email con tre stati: tutti / con email / senza email.
- Applicando "con email" la lista mostra solo contatti con email valorizzata; "senza email" solo quelli senza; il conteggio totale riflette il filtro.
- Il filtro per presenza email è componibile con i filtri esistenti (testo, bucket, status, strategia) e con la paginazione.
- "Con email" / "senza email" usano la stessa definizione del resto del sistema: email presente = non `null` e non stringa vuota.

**Outcome 2 — Filtri persistenti (ambito sessione)**

- I filtri impostati nella pagina Contatti sopravvivono a: apertura del dettaglio di un contatto e ritorno alla lista, navigazione verso un'altra pagina e ritorno, reload della pagina.
- Lo stato dei filtri è riflesso nell'URL: copiando/condividendo l'URL si riottiene la stessa lista filtrata.
- Alla chiusura e riapertura del browser i filtri si azzerano (comportamento di sessione, non persistente tra sessioni).
- La pagina corrente di paginazione fa parte dello stato persistito insieme ai filtri.

**Outcome 3 — Estrapolare verso i flussi email solo i contatti giusti**

- L'export di una selezione (CSV/JSON) può essere scaricato in modalità **solo email-ready**, includendo unicamente i contatti con email.
- L'export espone un'informazione di **email-readiness** per riga (flag/colonna), così che anche l'export integrale renda distinguibili i contattabili dai non contattabili.
- I contatti senza email **non** vengono persi: restano scaricabili/consultabili (per i futuri flussi di enrichment), separati dagli email-ready.
- L'export resta una **vista** dello stato corrente del DB (nessuna mutazione di stato all'atto del download), coerente con il comportamento attuale.

**Outcome 4 — Visibilità email nelle selezioni**

- Nella vista della Selezione del giorno è mostrato, per ciascun bucket, il conteggio "pronti per email (con email) vs da arricchire (senza email)".
- I contatti con e senza email sono visivamente distinguibili nella lista della selezione (oltre all'icona ✉ già presente per riga).
- Nel pool candidati da cui si pescano i sostituti (AddPanel delle Selezioni) è possibile filtrare per presenza email.

---

## Constraints

- Niente auth, single-user locale: la persistenza dei filtri non può appoggiarsi a stato utente lato server → lo stato di sessione vive nell'URL (TanStack Router è già in uso nel frontend).
- CLI e web UI condividono lo stesso SQLite; la segmentazione è **read-side**: la presenza email è derivabile da `contacts.email` senza modifiche di schema obbligatorie.
- L'export deve restare una vista non distruttiva dello stato del DB.
- Coerenza terminologica: "con email" usa la stessa condizione già adottata in `getStats().withEmail`.

---

## Technical Notes

Osservazioni dalla discovery (stato attuale, non scelte di design):

- I filtri della pagina Contatti vivono in `useState` (`web/src/routes/contacts.index.tsx`: `q`, `bucket`, `status`, `strategy`, `page`) → persi a ogni navigazione/reload. TanStack Router supporta lo stato nell'URL (search params): è la sede naturale per la persistenza di sessione.
- `searchContacts` (`src/server/queries.ts`) compone clausole WHERE; un predicato di presenza email rispecchia quelli esistenti (`email IS NOT NULL AND email <> ''`, già usato in `getStats`).
- Il tipo client `ContactFilters` (`web/src/api/types.ts`) oggi omette `sector`/`minFit` che il backend già supporta e non ha alcun filtro email: c'è un gap di plumbing API↔client↔UI da chiudere.
- Il pool candidati `listCandidates` ed endpoint `/api/selections/:date/candidates?bucket=&q=` necessiterebbero di un parametro di filtro email.
- Gli export `/api/selections/:date/export.csv|.json` (`csvUrl`/`jsonUrl` in `web/src/api/client.ts`) oggi non accettano parametri: per il download "solo email-ready" serve un parametro di filtro.
- La pagina Selezione (`web/src/routes/selections.$date.tsx`) mostra già un marker ✉ per riga (emerald se email presente, grigio se assente): l'outcome 4 vi aggiunge conteggi e distinzione netta.
- `getStats().withEmail` esiste già per il conteggio in dashboard.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | "Pronto per email" = sola presenza dell'email, oppure deve includere anche bozza generata (`email_subject`/`email_body` non vuoti) e/o italianità (spec #1)? Proposta: qui "pronto" = ha email; bozza e italianità sono garantite a monte dalle spec #2/#1. | Definizione di email-readiness nelle viste/export | Omar | Open |
| 2 | Il download "solo email-ready" serve anche per i risultati filtrati della pagina Contatti, o l'export resta solo sulle Selezioni (come oggi)? Proposta: resta sulle Selezioni — l'export è sempre vista di una selezione. | Superfici di export | Omar | Open |
| 3 | I "da arricchire" (senza email) vanno mostrati come segmento/lista dedicata già ora, o basta poterli filtrare e contare? Proposta: basta filtro + conteggio; nessuna pagina dedicata in questa spec. | Ampiezza dell'outcome 4 | Omar | Open |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Persistenza filtri via **URL, ambito sessione** (no cross-session, no auth) | Single-user locale; TanStack Router già in uso rende l'URL la sede naturale e dà in più la condivisibilità del link |
| **Selezione automatica invariata** (fit-based); email = segmentazione a valle | Mantiene la semantica della pipeline; i lead ad alto fit senza email non vengono sacrificati ma instradati a futuri flussi di enrichment |
| **Singolo export filtrabile** con flag email-readiness (no file separati) | Un'unica fonte/vista, più semplice da mantenere; il filtro copre il caso "solo contatti giusti" senza duplicare artefatti |
| Filtro/segmentazione email su **tutte e quattro le superfici** | L'operatore deve avere la stessa visione coerente ovunque scelga e sposti i contatti |
| "Con email" = email non nulla e non vuota | Riusa la definizione già adottata in `getStats().withEmail`, coerenza in tutto il sistema |
