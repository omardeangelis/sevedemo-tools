---
domain: prospect-crm
type: flow
links:
  - "[[specs/prospect-crm/people-first-crm/SPEC|SPEC]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
  - "[[specs/prospect-crm/apollo-lookalike/FLOW|apollo-lookalike FLOW]]"
created: 2026-09-18
updated: 2026-09-18
---

# Flow: CRM centrato su Persone e Aziende (`people-first-crm`)

> Contratto di flusso per [[specs/prospect-crm/people-first-crm/SPEC|SPEC]] (criteri A1…K5, citati tra
> parentesi). Descrive **comportamento osservabile, stati e testi**, non implementazione. **Sostituisce** del
> [[specs/prospect-crm/crm-foundation/FLOW|FLOW crm-foundation]] gli Entry points, A (onboarding), C (triage
> dell'Inbox) e i testi di Inbox, Prospect, "Configurazione" e "Ultimi job". Il resto di crm-foundation e di
> apollo-lookalike (`JobPreviewDialog`, esito a tre toni, `ListPicker` con creazione inline, `BulkBar`, cap 500,
> accessibilità) resta valido con le parole di A3 (tabella in fondo). **[→ PLAN]** = vincolo al piano. Le
> proposte e le open questions nate scrivendo questo FLOW sono decise nella SPEC (2026-09-18) e il corpo le
> presuppone (vedi "Open questions e proposte" in fondo).

## Goal

Trovare, aggiungere e seguire **qualunque persona**, conosciuta a un evento o portata dagli strumenti, da una
navigazione centrata su **Persone** e **Aziende**; sapere ogni mattina **cosa fare**; capire **perché** un run è
fallito.
**Segnale di successo** (verifica con `agent-browser` sul server e2e con job finti): (1) da qualunque pagina apro
la scheda di una persona nota in ≤ 3 azioni (⌘K, 2–3 lettere, Invio); (2) inserisco 5 persone dello stesso evento
senza lasciare il form né riscrivere il contesto, e nessuna finisce in Da smistare; (3) in Oggi chiudo o sposto le
prossime azioni scadute senza aprire le schede; (4) da un run fallito arrivo al log e a "Riprova…" con preview in
≤ 2 clic; (5) nel testo dell'interfaccia non compaiono "prospect"/"prospects" (il gruppo "Prospecting" è ammesso) né "Inbox".

## Personas

- **Omar (unico utente; founder/consulente + sviluppatore del tool).** Stessa persona di crm-foundation: *esperto*
  del dominio e del codice, desktop, vuole **controllo** e densità, non tutorial. Questa spec aggiunge momenti con
  bisogni opposti al prospecting a freddo:
  - **dopo un evento** (*ansia di perdere il contesto*): 5–10 biglietti da scrivere di fila prima di dimenticare
    *chi era quello del talk su Kubernetes*, senza doppioni di chi è già nel CRM;
  - **la mattina** (*paura di perdere un follow-up*): una pagina che dica chi richiamare oggi;
  - **quando un job fallisce** (*frustrazione*): oggi resta una riga d'errore e nessuna traccia;
  - **sempre** (*disorientamento*, "sono molto confuso"): non sa dove finisce una persona entrata in una lista.
  - **JTBD:** "Quando conosco qualcuno o un tool me lo porta, voglio ritrovarlo in un posto solo, sapere quando
    ricontattarlo e dire io se è in target, senza che un job cancelli quello che ho scritto."
  > Persona non definita in `brain/domains/prospect-crm/`: caratterizzazione derivata dalla SPEC (User input,
  > Context) e dai FLOW precedenti; è l'assunzione su cui si progetta.

---

## Entry points

Nessuna precondizione di ruolo (single-user, no-auth). Route deep-linkabili; filtri e viste **nell'URL** (reload
e back li conservano; valori invalidi → default). Route decise in SPEC Open Questions #2:

| Entry | Route | Precondizioni / comportamento |
|---|---|---|
| **Oggi** | `/` | ≥ 1 persona (anche scartata) → Oggi (H1), nessun redirect. 0 persone → **Onboarding** (H8, percorso H). Voce "Oggi" attiva in entrambi i casi. |
| **Persone** | `/people?view&q&status&list&source&post&company&icp&fit&next&contact&sort&page` | `view` ∈ `da_smistare` · `con_prossima_azione` · `scartate`; assente = **Tutte**, cioè tutte tranne le scartate (B1, B2). `status` = più stati separati da virgola (`scartato` solo in Scartate); `list` = id o `none`; `source` ∈ `post_reaction` · `post_comment` · `company_employees` · `apollo_people` · `manual`; `company` = id dell'azienda collegata; `next` ∈ `scaduta` · `oggi` · `7g` · `nessuna`; `contact` ∈ `email` · `linkedin` · `no_linkedin`; `sort` ∈ `recent` · `name` · `next_action` · `fit` · `comments_first` · `most_interactions`; default `recent`, e `next_action` nella vista Con prossima azione (B4, B8). |
| **Aggiungi persona** | `/people/new?company=<id>&name=<testo>` | **Pagina**, non dialog (Decisioni UX). `company` precompila e collega (C1, dalla scheda azienda); `name` precompila il nome (C1, I4). Nessuna precondizione (C11). |
| **Scheda persona** | `/people/$id?list=` | `?list` = lista di contesto (default di touchpoint e ICP, come oggi). Porta con sé la vista di provenienza (A7) **[→ PLAN: `?from=` o history state; deve sopravvivere al reload]**. Id inesistente o unito → "Persona non trovata" (E8). |
| Vecchia scheda | `/prospects/$id?list=` | Redirect `replace` a `/people/$id` con gli stessi parametri (A5). |
| Vecchia Inbox | `/inbox?q&source&post&icp&fit&status&sort&page` | Redirect `replace` a `/people?view=da_smistare` con gli stessi valori; se `status` contiene `scartato` → `view=scartate` senza il parametro `status` (A4). |
| Aziende · Azienda | `/companies?q&listId&add` · `/companies/$id?listId&page` | Invariate (A5). Nel dettaglio "Prospect collegati" diventa **Persone** (D5, D6). |
| Liste · ICP | `/lists`, `/lists/$id?…`, `/icps`, `/icps/$id` | Invariate (A5). |
| **Impostazioni** | `/settings` → redirect a `/settings/profile` (conserva `#profilo`, A5) | Tre sezioni con indirizzo (J1): `/settings/profile` **Profilo e azienda** (ancore `#profilo`, `#azienda`) · `/settings/posts` **I miei post** · `/settings/connections` **Connessioni**; sotto-navigazione a link sotto il titolo "Impostazioni". |
| **Strumento** | `/settings/connections/$tool?outcome=failed&page` | `$tool` ∈ `apify` · `apollo` · `anthropic`; altro → "Strumento non trovato". `outcome=failed` = filtro Falliti (J6). |
| **Run** | `/settings/connections/runs/$runId` | Indipendente dallo strumento: un run può averne due (J3). Id inesistente → "Run non trovato". **[→ PLAN: le analisi singole (J15) hanno un id di run nello stesso spazio dei job.]** |
| **Ricerca** | ⌘K (macOS) / Ctrl+K ovunque · bottone **Cerca** in sidebar | Dialog (I1–I5). Ignorata mentre è aperto un altro dialog; ⌘K a ricerca aperta la chiude. |
| JobBanner | sidebar, ogni pagina | Come oggi + **Dettagli del run** su ogni esito (J14) e **Riprova…** che apre la preview (J12). |

### Architettura della sidebar (A1, A2, A6, I1)

```
SeVedemo
CRM personale                 ← non più "Prospect CRM" (A3)
[ Cerca…               ⌘K ]   ← bottone, fuori dall'elenco delle voci
Oggi
CONTATTI
  Persone               288   ← badge = persone da smistare
  Aziende
PROSPECTING
  Liste
  ICP
            ⋮
Impostazioni
[ JobBanner ]
```

- **Voce attiva = sezione della pagina**, anche nei dettagli (A6): `/` Oggi · `/people/*` Persone · `/companies/*`
  Aziende · `/lists/*` Liste · `/icps/*` ICP · `/settings/*` Impostazioni. "Contatti" e "Prospecting" sono
  etichette di gruppo, non link. Il bottone Cerca mostra "⌘K" su macOS, "Ctrl K" altrove.
- **Badge** (A2): numero delle persone da smistare (B3), formato italiano ("1.240"), **link a sé** verso
  `/people?view=da_smistare`, distinto da "Persone" (→ `/people`, Tutte); nome accessibile *"288 persone da
  smistare"*. A 0 sparisce. Si aggiorna a fine job e dopo ogni azione che cambia liste, stato o fonti.
- **Percorso** (A6) in testa a ogni dettaglio, segmenti link tranne l'ultimo: *"Persone › Mario Rossi"* · *"Aziende
  › Acme"* · *"Liste › Eventi autunno"* · *"ICP › CTO startup IT"* · *"Impostazioni › Connessioni › Apollo"* ·
  *"Impostazioni › Connessioni › Contatti Apollo del 18 set, 10:12"*.
- **Indietro nella scheda persona** (A7): da Persone (qualunque vista, filtri, pagina) o da link diretto c'è solo il
  percorso, il cui segmento **Persone** riporta a quella vista (link diretto: `/people`). Da lista, azienda o Oggi,
  davanti al percorso **"← CTO startup IT"** / **"← Acme"** / **"← Oggi"** riporta lì con filtri e pagina. Da ⌘K
  l'origine è la pagina da cui l'ho aperta, se è una di queste quattro; altrimenti vale come link diretto.

---

## Happy path

### A. Dopo un evento: più persone di fila, azienda, prossima azione (C1–C11, D2–D3, E1, G1)

Il 13 set Omar inserisce i contatti conosciuti il 12 set al DevFest Milano.

1. Oggi → **Aggiungi persona** → `/people/new`: **"Aggiungi persona"**, sottotitolo *"Bastano il nome e un
   recapito. Non avvia job e non costa nulla."* (C11). Focus su Nome. Quattro gruppi (`fieldset`), in ordine:
   **Persona** (Nome *(obbligatorio)* · Ruolo · Azienda · Località) · **Recapiti (almeno uno)** (Profilo LinkedIn ·
   Email · Telefono) · **Incontro** (Come vi siete conosciuti, placeholder *"es. DevFest Milano: talk sulla
   migrazione a Kubernetes, vuole una call a ottobre"* · Data dell'incontro, default oggi) · **Nel CRM** (Lista con
   `ListPicker`, default *"Nessuna lista"* · Stato iniziale, default Nuovo · Prossima azione: Data + Cosa fare)
   (C2). Bottoni: **Salva** (primario, Invio) · **Salva e aggiungi un'altra** · Annulla.
2. **Azienda** = combobox sulle aziende del CRM per nome, dominio o pagina LinkedIn (stesso componente di
   "Collega", D2): "Nuvola" → *"Nuvola Srl · nuvola.io"* → Invio → chip **"Collegata: Nuvola Srl"** (× per
   togliere). Senza corrispondenze resta **solo testo**, hint *"Non collegata: potrai collegarla dalla scheda."*
   (C2, D4); in fondo al menu **"Crea l'azienda 'Fabbrica Digitale'…"** → pannello inline Nome · Sito web · Pagina
   LinkedIn, hint *"Serve almeno il sito o la pagina LinkedIn."* → **Crea e collega** → toast *"Azienda creata:
   Fabbrica Digitale"*; sito o pagina già usati → *"fabbricadigitale.it è già di 'Fabbrica Digitale Srl'."* +
   **Collega quella** (C2, D3).
3. Luca Bassi · CTO · Nuvola · email · contesto · 12 set · lista "Eventi autunno" · prossima azione 1 ott
   *"Proporre la call"* → **Salva e aggiungi un'altra** (C4): toast *"Persona aggiunta: Luca Bassi"* con **Apri
   scheda**; il form si svuota tranne contesto, data, lista e stato iniziale, e in testa dice *"Restano per la
   prossima persona: 'DevFest Milano: talk…' · 12 set · lista 'Eventi autunno' · stato Nuovo."* + **Svuota tutto**;
   sotto i bottoni *"Aggiunte ora (1): Luca Bassi"* (link; si perde al reload); focus su Nome. Se il form è
   stato aperto dalla scheda di un'azienda (`?company=`), resta anche l'azienda e la riga lo dice: *"… · stato
   Nuovo · azienda Nuvola Srl"* (C4).
4. URL LinkedIn già noto → **all'uscita dal campo** (locale, gratis) il pannello (C7): *"Questo profilo LinkedIn è
   già nel CRM: Marco Riva — Head of Engineering · Beta (commento del 2 set) · Apri scheda. Non si crea un
   doppione."* con l'opzione **"Aggiungi l'incontro a Marco Riva"** e il riepilogo (C9): *"Salvando, Marco Riva
   riceve la fonte 'Aggiunta a mano' del 12 set, la nota 'Come vi siete conosciuti' e la lista 'Eventi autunno'.
   Gli altri campi del form non lo modificano."* Se servono: *"Ha già una prossima azione (25 set · Richiamare):
   verrà sostituita da quella del form."* · *"Ha già la fonte 'Aggiunta a mano' (5 giu): resta quella, il nuovo
   incontro si registra come nota."* Scelta l'opzione → **Salva e aggiungi un'altra** → toast *"Incontro aggiunto a
   Marco Riva"*; in "Aggiunte ora" *"Marco Riva (incontro)"*. Marco esce da Da smistare (B3), il badge scende.
5. Email già usata (C8; l'email non è una chiave, E1) → *"Questa email è già di: Anna Bianchi — Marketing · Beta;
   Ufficio Beta. Scegli come procedere."* Radio, **nessuna preselezionata**: **Aggiungi l'incontro a Anna Bianchi**
   · **Aggiungi l'incontro a Ufficio Beta** · **Crea comunque una nuova persona**.
6. Nome uguale a una persona senza LinkedIn né email in comune (C10) → avviso **non bloccante** *"Esiste già una
   persona con questo nome: Sara Conti — CFO · Pagamenti Srl (Apri scheda)."* con l'opzione **Aggiungi l'incontro
   a Sara Conti**, non preselezionata, e lo stesso riepilogo di A.4 più *"L'email e il telefono del form non si
   copiano: aggiungili dalla sua scheda."* (C9). Se è lei → scelgo l'opzione → **Salva** → si apre la scheda di
   Sara Conti con il toast *"Incontro aggiunto a Sara Conti"*. Se non è lei → **Salva** senza scegliere → scheda
   della nuova persona, toast *"Persona aggiunta: Sara Conti"* (C4).
→ **Outcome:** ogni persona nuova ha in Fonti **"Aggiunta a mano · incontro del 12 set"** e in timeline la nota
datata 12 set (C5); è nella lista; uno stato iniziale diverso da Nuovo scrive un cambio di stato (C6, K1); nessuna
in Da smistare (B3); nessun job, nessuna spesa (C11, K2).

### B. Ritrovare un contatto da qualunque pagina (I1–I5, B1–B7, A7)

1. Dalla lista "CTO startup IT" premo **⌘K** → dialog *"Cerca persone e aziende"*, cursore nel campo (I1); con 1
   carattere *"Scrivi almeno 2 caratteri."*
2. "giu" → risultati mentre scrivo, al più 5 per gruppo (I3): **Persone** *"Giulia Neri"* / *"CFO · Pagamenti
   Srl"* · *"Giulia Verdi"* + **Scartata** / *"Marketing · Beta"* (I2); **Aziende** *"Giunti Editore"* /
   *"giunti.it"*; **Vedi tutte le persone per 'giu'** → `/people?q=giu` (con ≥ 1 persona trovata); **Aggiungi 'giu'
   come persona** → `/people/new?name=giu`, sempre ultima voce (I4). Senza risultati: *"Nessun risultato per
   'giu'."* sopra questa sola voce.
3. ↓ Invio → scheda: **"← CTO startup IT"** + *"Persone › Giulia Neri"*; voce Persone attiva.
4. **"Chi ho conosciuto al DevFest?"** → ⌘K "devfest": in Persone compaiono Luca Bassi, Sara Conti e Marco Riva,
   perché il testo cerca anche in "Come vi siete conosciuti" (B5, I2) → **Vedi tutte le persone per 'devfest'** →
   `/people?q=devfest`. Senza ricordare evento né nome: Fonte *Aggiunta a mano*, **Altri filtri** › Azienda, o
   testo "pagamenti" (nome, headline, ruolo, azienda, email, telefono, URL LinkedIn, contesto dell'incontro: B5).
   Righe (B7): ☐ · Nome + headline/ruolo · Fonti
   (tooltip *"Aggiunta a mano · incontro del 12 set"*) · Azienda (link se collegata) · Stato · Liste o *"Nessuna
   lista"* (A3) · Prossima azione · Fit (con un ICP) · Aggiunta il. Dalla scheda, **Persone** riporta a vista,
   filtri e pagina (A7).
5. Testo che trova anche scartate (B6): sopra la tabella *"Anche 2 persone scartate corrispondono a 'giu'."* +
   **Mostrale** → `/people?view=scartate&q=giu`.
→ **Outcome:** ogni persona si apre in ≤ 3 azioni, anche se è in una lista o scartata, e le persone di un evento
si ritrovano dal suo nome.

### C. Smistare dopo un sync: Da smistare (B2, B3, B9, A2, A3, E11)

1. Fine sync → toast e banner *"Sync completato: 3 post sincronizzati (7 già fatti) · 412 reazioni e 37 commenti
   letti · 288 nuove persone da smistare · 61 già presenti (fonte aggiunta)."* → **Apri Da smistare** · **Dettagli
   del run**. Il badge mostra **288**.
2. `/people?view=da_smistare`. Viste (link, B2) *"Tutte 1.528 · Da smistare 288 · Con prossima azione 12 · Scartate
   37"* (conteggi con i filtri attivi); sotto *"Chi arriva dai tuoi strumenti e non è in nessuna lista. Ultimo
   sync: 5 min fa."* Azioni: **Sincronizza interazioni** (senza profilo disabilitato, *"Salva prima il tuo profilo
   LinkedIn."*) · **Aggiungi persona**.
3. Triage come crm-foundation C.2–C.4 ("Commenti prima", "Seleziona i 50 visibili" → "tutte le 288 filtrate", cap
   500). **BulkBar** (B9): **Aggiungi a lista** · **Scarta** · **Cambia stato ▾** · **Arricchisci…** ·
   **Analizza…**; nella vista Scartate **Ripristina** (→ Nuovo) al posto di Scarta. Esiti: *"12 aggiunte a 'CTO
   startup IT' · 0 già presenti. Le trovi in Tutte e nella lista."* · *"37 scartate. Le ritrovi in Scartate."*
   (senza conferma). Le righe escono dalla vista, il badge scende. Nella preview di Arricchisci/Analizza chi non ha
   LinkedIn è contato a parte, *"3 senza LinkedIn: escluse"*, fuori stima (E11).
→ **Outcome:** *"Niente da smistare: hai messo in lista o scartato tutte le persone arrivate dai tuoi
strumenti."* + *"Ultimo sync: 2 giorni fa (10 post)."* + **Sincronizza interazioni** · **Vedi le scartate**; il
badge sparisce (A2).

### D. Iniziare la giornata da Oggi (H1–H7, G3–G6)

1. `/` → **Oggi**, sottotitolo *"giovedì 18 settembre"*, azione **Aggiungi persona** (H6). Dall'alto:
   - **Avvisi** (solo se presenti, una riga ciascuno). Configurazione (H7): *"Da completare: profilo LinkedIn ·
     descrizione della tua azienda · un ICP · APOLLO_API_KEY nel .env"*, ogni voce è un link (`#profilo`,
     `#azienda`, `/icps`, `/settings/connections`) con accanto **Nascondi** (tooltip *"Torna se cambia cosa
     manca."*): la voce resta nascosta finché l'insieme delle voci mancanti non cambia (H7). Run falliti (H5),
     **una riga per run**:
     *"Ultimo run fallito per Apollo: Contatti Apollo, oggi 10:12 — chiave Apollo rifiutata (401)."* + **Vedi
     dettagli**; un run che conta per due strumenti dà una sola riga (*"…per Apify e Anthropic: Analisi…"*).
   - **Da fare (3)** (H2): scadute dalla più vecchia, poi di oggi. Riga: **"Scaduta · lun 15 set"** / **"Oggi"**
     (testo, G3) · *"Richiamare per la demo"* · **Mario Rossi** (link, origine Oggi) · *"Acme"* · **Fatto** ·
     **Rimanda ▾**. Nessun limite di righe.
   - **In arrivo · prossimi 7 giorni (2)** (H3), per data: *"ven 19 set · Anna Bianchi · Beta · Follow-up dopo
     l'evento"*.
   - **Da smistare** (H4): *"288 persone da smistare"* + **Apri Da smistare**; a 0 *"Niente da smistare."*
   - **Ultime persone aggiunte** (H4): 10 righe *"Luca Bassi · Nuvola · Aggiunta a mano · ieri"* + **Vedi tutte in
     Persone**.
2. **Fatto** (G4), senza conferma → la riga esce; toast *"Fatto: 'Richiamare per la demo' (Mario Rossi)"* con
   **Imposta la prossima** (dialog *"Prossima azione per Mario Rossi"*). Timeline: *"Prossima azione completata:
   Richiamare per la demo"*. Stato e liste invariati (G6).
3. **Rimanda ▾** (G5): **Domani (ven 19 set)** · **Tra una settimana (gio 25 set)** · **Scegli una data…**, date
   contate da oggi, anche per le scadute (G5) → la riga passa in In arrivo; toast *"Rimandata a ven 19 set"*.
→ **Outcome:** scadenze chiuse o spostate senza aprire schede. L'elenco completo è in Persone › **Con prossima
azione**, ordinato di default per prossima azione, le più vicine prima (B8). Sezioni vuote (H6): *"Niente da fare
oggi. Qui compaiono le prossime azioni scadute e di oggi."* · *"Nessuna prossima azione nei prossimi 7 giorni."*

### E. Il mio fit per ICP accanto all'AI, e la prossima azione in scheda (F1–F9, G1–G3)

1. Scheda → card **"Fit e analisi AI"** (ex "Analisi AI") con il selettore **ICP** in testa (default di oggi).
   Riga del fit per l'ICP scelto: *"Non analizzata"* · *"AI: medio"* (+ *"da aggiornare"* solo qui, F8) · **"Tuo:
   alto · AI: medio"** (F4) · *"Tuo: alto · AI: errore"* con l'errore dell'AI sempre visibile sotto (F4).
2. **Imposta il mio fit** (F1) → form inline: radio *"Il tuo fit per 'CTO startup IT'"* **Alto · Medio · Basso** +
   *"Motivazione (facoltativa)"* → **Salva fit**; vale anche per chi non è mai stato arricchito o analizzato o non
   ha LinkedIn. Toast *"Fit impostato: alto (tuo)"*; timeline (F7) *"Fit (tuo) per 'CTO startup IT': nessuno →
   alto"* + motivazione. **Cambia il mio fit** (timeline *"medio → alto"*); **Rimuovi il mio fit** (F6), senza
   conferma → *"Fit rimosso: vale di nuovo l'analisi AI"*, timeline *"alto → nessuno"*. **Rianalizza** cambia solo
   l'AI (F5).
3. Tabelle Persone, Lista, Azienda con un ICP scelto (implicito se ce n'è uno solo): colonna **Fit** *"alto · tuo"*
   · *"medio · AI"* · *"rifiutata · AI"* · *"errore · AI"* · *"non arricchibile"* · *"non analizzata"*; stessi
   valori nel filtro (F3); ordinamento *"Fit (tuo o AI)"*; export CSV con fit effettivo + origine *tuo/AI* (F2).
   Senza ICP (F9): *"Il fit si esprime rispetto a un ICP: crea il primo ICP per impostarlo."* + **Crea ICP**.
4. **Prossima azione** in testata (G1, G3): *"Scaduta · lun 15 set — Richiamare per la demo"* + **Fatto** ·
   **Rimanda ▾** · **Modifica** (dentro: **Rimuovi prossima azione**); vuota: *"Nessuna prossima azione."* +
   **Imposta prossima azione** (Data obbligatoria con **Domani** · **Tra una settimana**; Cosa fare facoltativo,
   *"es. Mandare la proposta"*). Nel form touchpoint un blocco **Prossima azione** vuoto = nessun cambio, con
   *"Attuale: 25 set · Richiamare. Compila per sostituirla."* (G2).
5. **Elimina ICP** (F10): la conferma conta i fit che spariscono: *"Si cancellano anche i suoi riferimenti, le
   candidate, le analisi e i 7 fit che hai impostato per questo ICP; aziende e persone restano."* (senza fit tuoi
   la frase sui fit non c'è).
→ **Outcome:** il mio giudizio vince in colonna, filtro, ordinamento e CSV; l'AI resta leggibile accanto.

### F. LinkedIn su una persona manuale già trovata da un job → Unisci (E2–E8, E11, E12)

1. Scheda di Giulia Neri (aggiunta a mano, solo email: E2): **Aggiungi profilo LinkedIn** al posto di "Apri su
   LinkedIn" (E12); **Arricchisci** e **Analizza** disabilitati con *"Serve il profilo LinkedIn: aggiungilo per
   arricchire o analizzare questa persona."* (E11).
2. **Aggiungi profilo LinkedIn** → focus sul campo dell'Anagrafica → incollo l'URL → **Salva**. È già di un'altra
   persona (E5) → nulla salvato; sotto il campo *"Questo profilo LinkedIn è già di Giulia Neri — CFO · Pagamenti Srl
   (reazione del 3 set) · Apri scheda. Non salvato."* + **Unisci Giulia Neri in questa persona…** · **Annulla la
   modifica**.
3. Dialog **"Unisci Giulia Neri (#812) in questa scheda"** (E6): *"Resta questa persona. Giulia Neri #812
   scompare: i suoi link risponderanno 'Persona non trovata'."* · **Confluiscono** *"1 fonte (Reazione a 'Abbiamo
   migrato…') · 0 liste · 2 attività · 1 analisi (CTO startup IT, fit medio)"* · **Profilo LinkedIn** (E7)
   *"linkedin.com/in/giulia-neri-123 (quello che stai salvando), con l'id membro di #812"* · **Si aggiungono da
   #812** *"headline, località"* · tabella **Valori in conflitto** (Campo · Resta · Si perde), es. *"Stato ·
   Qualificato · Nuovo"*, più anagrafica, prossima azione e fit tuo per ICP se in conflitto · *"L'unione non si può
   annullare."* **Annulla** (focus iniziale) · **Unisci**.
4. **Unisci** → toast *"Persone unite: resta Giulia Neri"*; la scheda mostra **Apri su LinkedIn**, Arricchisci e
   Analizza attivi, Fonti "Aggiunta a mano" + "Reazione", timeline di entrambe, stato invariato senza nuova voce
   (E8); il LinkedIn diventa di sola lettura, *"Il profilo LinkedIn arriva da una fonte dei tuoi strumenti: non si
   modifica."* (E3). #812 era in Da smistare: ora no (B3).
5. Varianti. URL libero → salvato, *"Profilo LinkedIn aggiunto"*, correggibile finché c'è solo la fonte a mano
   (E3). Email di altre persone (E5) → *"Questa email è anche di: Mario Rossi (Apri scheda)."* + **Unisci Mario
   Rossi in questa persona…** · **Salva comunque**. Due profili LinkedIn diversi (E7) → niente Unisci: *"Mario
   Rossi ha un altro profilo LinkedIn (linkedin.com/in/mrossi): sono due persone distinte e non si possono
   unire."* In Unisci i valori che stavo salvando contano come valori della persona tenuta (E6): nell'anteprima
   l'email appena scritta compare in "Resta".

### G. Run fallito: Connessioni → log → Riprova con preview (J2–J15, H5)

1. Ingressi: riga di Oggi (H5) · **Dettagli del run** su toast e banner (J14) · Impostazioni › **Connessioni**.
2. `/settings/connections`, sottotitolo *"Gli strumenti esterni che il CRM usa, con i loro run e i log. Le chiavi
   si impostano nel file .env: dopo una modifica riavvia il server."* Una card per strumento (J2): **Apify** —
   *"Abilita: sync delle interazioni, persone di un'azienda, arricchimento dei profili."*; **Apollo** —
   *"Abilita: aziende simili, contatti ed email di lavoro."*; **Anthropic** — *"Abilita: analisi AI delle persone
   (riassunto, angoli, fit dell'AI)."* In ognuna: *"APOLLO_API_KEY · Configurata"* / *"… · Mancante: aggiungila al
   .env e riavvia il server."*; ultimo run *"oggi 10:12 · Fallito"* con (J5) *"Ultimo run fallito: chiave Apollo
   rifiutata (401). 'Configurata' vuol dire solo che la chiave è presente."* (o *"Nessun run ancora."*); *"23 run"*
   · **Vedi run**.
3. `/settings/connections/apollo`: **Tutti · Falliti** (J6); Operazione · Avvio · Durata · Esito · Riassunto, dal
   più recente. Operazioni: *Sync interazioni · Solo elenco post · Persone di un'azienda · Arricchimento (Apify) ·
   Arricchimento (Apollo) · Analisi · Analisi singola · Arricchimento aziende (Apollo) · Aziende simili (Apollo) ·
   Contatti Apollo*. Esiti (J4): **Completato** · **Completato con avvisi** · **Fallito** · **In corso**.
4. `/settings/connections/runs/57`, *"Contatti Apollo · 18 set, 10:12"* + esito: **Parametri** (J7) *"Lista: CTO
   startup IT · 12 aziende · Ruoli: CTO, Head of Engineering · Seniority: tutte · Massimo 10 persone per azienda"* ·
   **Tempi** · **Esito** (riassunto, conteggi, warning) · **Errore** *"config: chiave Apollo rifiutata (401).
   Verifica APOLLO_API_KEY nel .env."* + *"Conta come fallito per: Apollo"* (o *"L'errore non nomina uno
   strumento: conta per Apify e Anthropic"*, J4) · **Log** (J8) `10:12:03 Avvio: Contatti Apollo su 12 aziende` ·
   `10:12:04 Apollo · ricerca persone · Acme` · `10:12:05 Errore Apollo (401) su Acme` · `10:12:05 Fine:
   fallito`; mai chiavi, token o corpi (J10).
5. Sistemo il `.env`, riavvio, **Riprova…** (hint *"Apre l'anteprima con gli stessi parametri: conteggi, stima e
   blocchi ricalcolati adesso."*) → `JobPreviewDialog` del kind titolato *"Riprova: Contatti Apollo"*, stessi campi
   e bottone d'avvio (J12, K2) → nuovo run nel banner; il fallito resta nello storico. Stesso percorso da banner e
   toast.
6. Run in corso: le righe compaiono da sole, *"In corso: il log si aggiorna da solo."* (J9). I log restano finché
   esiste il run (J11). Oltre 5.000 righe, sopra il log: *"Log troncato: superava le 5.000 righe. Vedi l'inizio e la
   fine; omesse 3.214 righe centrali."* e nel punto del taglio la riga `… 3.214 righe omesse …` (avvio, esito ed
   errore finale sempre visibili, J11); run precedenti al rilascio: *"Log non disponibile per questo run."*
   Analisi singola fallita (J13): nessun Riprova, *"Le analisi singole si rilanciano dalla scheda della persona."* +
   **Apri la scheda di Mario Rossi**.
→ **Outcome:** dal segnale al log in ≤ 2 clic; nessuna spesa senza preview.

### H. Primo avvio a CRM vuoto (H8, B10, C11)

1. `/` senza persone → **Onboarding** *"Porta dentro le prime persone"*, sottotitolo *"Il CRM è vuoto. Scegli da
   dove partire: puoi usare tutte e tre le strade."* Tre card:
   - **Aggiungi una persona a mano** — *"Chi hai conosciuto a un evento o di persona: bastano il nome e un
     recapito."* → **Aggiungi persona** (sempre attivo).
   - **Sincronizza le interazioni ai tuoi post** — *"Chi ha reagito o ha commentato i tuoi ultimi post LinkedIn."*
     → **Sincronizza** (dialog di crm-foundation B); senza profilo disabilitato, *"Serve il tuo profilo LinkedIn."*
     + **Salva il profilo** (`/settings/profile#profilo`).
   - **Cerca le persone di un'azienda** — *"Le persone con i ruoli del tuo ICP in un'azienda target."* →
     **Aggiungi un'azienda** (`/companies?add=1`); senza ICP disabilitato, *"Serve un ICP: le persone trovate
     entrano in una lista dell'ICP."* + **Crea ICP**.
   Sotto, lo stesso promemoria *"Da completare: …"* di Oggi.
2. **Aggiungi persona** → percorso A → la prima persona apre la sua scheda; da lì "Oggi" è la home Oggi (H1).
3. Persone a CRM vuoto (B10): *"Il CRM è vuoto."* + le stesse tre azioni con gli stessi requisiti.
→ **Outcome:** la prima persona nel CRM in meno di un minuto, senza configurare nulla.

### I. Persona ↔ azienda (D1–D7)

1. Scheda persona, riga **Azienda** (D1, D4): collegata → *"Acme"* (link) + **Cambia azienda** · **Scollega**, e se
   impostata a mano *"Collegata da te: i job non cambiano questo collegamento."* (D7); solo testo → *"Acme Srl · non
   collegata"* + **Collega a un'azienda**; vuota → *"Nessuna azienda"* + **Collega a un'azienda**.
2. **Collega** → dialog *"Collega Mario Rossi a un'azienda"*, ricerca *"Cerca per nome, sito o pagina LinkedIn"*
   precompilata col testo dell'azienda (D2) → **Collega** → toast *"Azienda collegata: Acme"*; nessun risultato →
   *"Nessuna azienda trovata per 'acme'."* + **Crea 'acme' come nuova azienda** (D3, come A.2).
3. **Scollega**, senza conferma → *"Azienda scollegata: resta 'Acme' come testo."*; la persona esce da Persone di
   Acme, le sue fonti restano (D5).
4. Scheda azienda, **Persone (12)** (D5, D6): solo le collegate; **Aggiungi persona** (`/people/new?company=<id>`) ·
   **Collega una persona esistente** (un risultato collegato altrove dice *"Ora collegata a Beta: collegandola qui
   lascia Beta."*) · **Estrai persone**. Vuota: *"Nessuna persona collegata ad Acme. Aggiungi chi conosci, collega
   una persona già nel CRM o estrai le persone con i ruoli del tuo ICP."*

---

## Error paths

Ogni scrittura ha un esito visibile (toast dove non è ovvio, errore inline dove nasce); mai silenzio. Dopo un
errore i valori inseriti restano (C3).

| Trigger / fallimento | Comportamento visibile | Recupero |
|---|---|---|
| Nome vuoto (C3) | *"Inserisci il nome."*; focus sul primo campo errato | Correggi |
| Nessun recapito (C3) | Sul gruppo Recapiti: *"Serve almeno un recapito: profilo LinkedIn, email o telefono."* | Compilane uno |
| URL LinkedIn non di una persona (C3) | *"Non è il profilo di una persona: usa un URL del tipo https://www.linkedin.com/in/nome-cognome/"* | Correggi |
| Email malformata (C3) | *"Email non valida (es. nome@azienda.it)."* | Correggi |
| Cosa fare senza data (G1) | *"Scegli la data della prossima azione."* | Data o svuota |
| URL LinkedIn già nel CRM (C7), anche per race al salvataggio | Pannello di A.4; nulla creato | Aggiungi l'incontro / cambia URL |
| Email già usata, nessuna scelta (C8) | Sul gruppo: *"Scegli se aggiungere l'incontro a una persona esistente o crearne una nuova."* | Scegli |
| Persona di "Aggiungi l'incontro" sparita (unita da un job) | *"Marco Riva non è più nel CRM (forse unito a un'altra persona): ricontrollo i doppioni."*; pannello ricalcolato | Riscegli |
| Lista del form archiviata nel frattempo | *"La lista 'X' è archiviata: scegline un'altra."* | Altra lista |
| Salvataggio fallito (rete, 500) | *"Salvataggio non riuscito: <messaggio>. I dati inseriti sono ancora qui."* | Salva di nuovo |
| Uscita dal form con dati (Annulla, nav, chiusura tab) | *"Uscire senza salvare? I dati inseriti andranno persi."* **Resta** (focus) · **Esci senza salvare** | — |
| Crea azienda senza chiavi / chiave già usata (D3) | *"Serve almeno il sito o la pagina LinkedIn."* / *"acme.it è già di 'Acme Robotica'."* + **Collega quella** | Compila / collega |
| Azienda scelta sparita (unita) | *"Azienda non trovata: forse è stata unita a un'altra. Cercala di nuovo."* | Ricerca |
| LinkedIn di un'altra persona in modifica (E5) | Nulla salvato; pannello di F.2 | Unisci / annulla |
| Svuotare il LinkedIn (E3) | *"Il profilo LinkedIn non si può rimuovere."*; con fonti dei job il campo è di sola lettura col motivo | — |
| Svuotare email e telefono senza LinkedIn (E4) | *"Serve almeno un recapito: senza profilo LinkedIn tieni l'email o il telefono."* | Ripristina |
| Unisci: l'altra persona sparita / 500 | Nel dialog (`role="alert"`): *"Giulia Neri #812 non è più nel CRM (forse unita da un job). Nessuna modifica."* / ErrorBox | Chiudi / riprova |
| Fit, prossima azione, collega/scollega: scrittura fallita | Errore accanto al controllo; valori conservati | Riprova |
| Fatto/Rimanda su una prossima azione cambiata altrove | Toast *"Questa prossima azione è già stata completata o cambiata: aggiorno la lista."* + refetch | — |
| Ricerca fallita | *"Ricerca non riuscita."* + **Riprova**; testo conservato | Riprova |
| Riprova con blocchi / job in corso / race 409 (J12) | Preview con blocchi e avvio disabilitato; race → toast *"C'è già un job in corso: <kind>, <n> min fa."* | Sistema / attendi |
| Log non aggiornabile durante un run | *"Log non aggiornato: nuovo tentativo tra pochi secondi."*; righe viste restano | Automatico |
| Run / strumento inesistente | *"Run non trovato"* / *"Strumento non trovato"* + **Vai a Connessioni** | Naviga |
| Persona inesistente o unita (E8) | *"Persona non trovata"* + *"Il link potrebbe essere sbagliato, oppure la persona è stata unita a un'altra."* + **Vai a Persone** | Naviga |
| Caricamento pagina fallito | ErrorBox + **Riprova**; sidebar e ⌘K usabili | Riprova |

## Edge cases

- **Scartata con prossima azione:** fuori da Oggi e da Con prossima azione (H2, H3, B1); la scheda dice *"Persona
  scartata: la prossima azione non compare in Oggi."* Portando a Scartato chi ne ha una, il popover di stato avvisa
  *"Ha una prossima azione (25 set): non comparirà più in Oggi."* (bulk: *"3 persone selezionate hanno una prossima
  azione…"*), senza rimuoverla (K3). "Aggiungi l'incontro" a uno scartato avvisa *"Marco Riva è scartato: la
  prossima azione non comparirà in Oggi finché non cambi lo stato."* (stato invariato, C9).
- **Da smistare è derivato (B3, K4):** una persona a mano tolta da tutte le liste non ci torna; una dei job che
  riceve "Aggiunta a mano" (C9, Unisci) ne esce. Filtro impossibile nella vista (Da smistare + Fonte *Aggiunta a
  mano*): *"Le persone aggiunte a mano non passano da Da smistare."*
- **Dati impostati a mano (D8, D9):** accanto all'etichetta *"a mano"*, tooltip *"Scritto da te: i job non lo
  sovrascrivono."*; email svuotata a mano *"vuota · svuotata a mano"*, contata a parte nella preview Apollo solo
  email: *"2 con email svuotata a mano: escluse"*. Un job che trova una persona a mano per URL (E10) aggiorna solo i
  campi mai toccati, aggiunge la fonte e rende il LinkedIn di sola lettura (E3). Le unioni automatiche (E9) non
  hanno UI: la superstite mostra i valori a mano più recenti.
- **Form:** l'azienda creata dal form resta anche se la persona non si salva; `?name=` vale solo al primo
  caricamento; `?company=<id inesistente>` → campo vuoto + *"Azienda non trovata: forse è stata unita a
  un'altra."*; lo stesso incontro registrato due volte dà due note e una fonte.
- **Date:** una prossima azione con data passata mostra *"Data passata: comparirà come scaduta."* (non blocca);
  "oggi", "scaduta" e "In arrivo" si ricalcolano quando la pagina torna visibile o si ricarica (fuso del computer).
- **Selezione:** cambiando vista si azzera (il bulk vale per ciò che vedo); resta tra pagine e filtri della stessa
  vista. Più ICP senza ICP scelto: niente colonna Fit, filtro *"Fit: scegli prima l'ICP"* (come oggi).
- **Run di più strumenti (J3, J4):** compare nella pagina di ciascuno; se l'errore ne nomina uno, negli altri la
  riga dice *"Fallito · errore di Anthropic"* e non accende né l'avviso di Oggi né la riga rossa di Connessioni.
  Un'analisi singola lanciata mentre un job gira è un run "In corso" di Anthropic; banner e "un job alla volta"
  restano intatti (J15). I riassunti dei run conclusi prima del rilascio si mostrano come sono stati scritti,
  anche con "prospect" o "Inbox" (eccezione di A3).
- **⌘K:** il browser non la riceve (Firefox e Safari la usano per la barra di ricerca); con 10.000 persone i
  risultati arrivano entro 300 ms e, mentre arrivano, restano i precedenti con *"Ricerca…"*.
- **Due tab:** Fatto, fit o collega in una, l'altra si allinea al refetch; i conflitti usano i toast della tabella.

## Decisioni UX

- **Aggiungi persona = pagina, non dialog.** In un dialog Esc o un clic fuori perdono una dozzina di campi; la
  pagina ha un URL per le precompilazioni, regge il ciclo "Salva e aggiungi un'altra" e il guard d'uscita.
- **Doppioni controllati all'uscita dal campo**, prima di scrivere il resto; il server resta la verità (race).
  **"Aggiungi l'incontro" è una scelta nel form + i soliti due bottoni:** un solo modo di salvare; il riepilogo dice
  cosa si scrive sulla persona esistente e cosa no (C9). **Un solo picker d'azienda** (form, Collega, Cambia) con
  creazione alle regole di D3.
- **Onboarding a tre strade, non tre passi:** la strada manuale non ha prerequisiti; profilo e ICP diventano
  requisiti scritti sulla strada che li richiede.
- **Badge = link separato:** "Persone" serve a trovare (Tutte), il numero a smistare. **Conteggi delle viste con i
  filtri attivi** (senza filtri sono i totali): dicono dove sono i risultati prima di cambiare vista; il badge è
  sempre il totale. Viste come **link con `aria-current`**, non tab: vivono nell'URL.
- **Filtri primari visibili** (Cerca, Stato, Lista, Fonte, Prossima azione), gli altri in **Altri filtri** (Post,
  Azienda, ICP, Fit, Recapiti); i chip mostrano sempre tutti i filtri attivi. **Scarta/Ripristina diretti +
  Cambia stato ▾**: il triage resta a un clic.
- **Oggi: azioni prima, contesto dopo;** avvisi in cima perché rari e bloccanti, raggruppati per run. **Fatto senza
  conferma, con "Imposta la prossima"**: dopo un follow-up il gesto naturale è programmare il successivo. **Rimuovi**
  (errore, dentro Modifica, niente timeline) ≠ **Fatto** (completato). **Rimanda conta da oggi.**
- **Fit in una card "Fit e analisi AI"** con l'ICP in testa; origine sempre scritta ("tuo"/"AI"); Rimuovi senza
  conferma (la timeline conserva il valore). **Marcatore "a mano"** sui campi: rende visibile D8/D9 prima della
  domanda "perché l'arricchimento non ha aggiornato il ruolo?".
- **Unisci solo da E5, con anteprima e focus su Annulla;** nessun "Unisci con…" libero (Non-Goal).
- **Connessioni con salute onesta** (J5): "Configurata" non basta se l'ultimo run è fallito. **Riprova…** con i
  puntini: apre un dialog, non spende. `/settings` porta alla prima sezione di J1.
- **Rinviato (YAGNI):** scorciatoia per "Salva e aggiungi un'altra"; Aggiungi persona dalla Lista (la lista si
  sceglie nel form); Fatto/Rimanda nella tabella Persone; legame "riprova di #41" tra run; voce di timeline per
  l'unione; "Aggiunte ora" persistente.

## Accessibilità

Stessa asticella di crm-foundation (dialog Radix con focus trap e restore, `role="alert"` per blocchi ed errori,
stati mai solo a colore, nessun controllo solo al passaggio del mouse); in più:

- **Sidebar:** `nav aria-label="Navigazione principale"`, gruppi con intestazione (`role="group"` +
  `aria-labelledby`), `aria-current="page"` sulla sezione anche nei dettagli; badge = link *"288 persone da
  smistare"*. **Percorso:** `nav aria-label="Percorso"` con `ol`, ultimo elemento `aria-current="page"`; il link
  indietro si legge *"Torna a CTO startup IT"* (freccia `aria-hidden`).
- **Ricerca:** bottone con `aria-keyshortcuts="Meta+K Control+K"`; dialog modale con `role="combobox"`
  (`aria-expanded`, `aria-controls`, `aria-activedescendant`) e `listbox` a gruppi etichettati; "Scartata" come
  testo; numero di risultati in live region polite (*"3 persone, 1 azienda"*); Esc chiude e riporta il focus (I5).
- **Aggiungi persona:** `fieldset`/`legend` per i quattro gruppi; *"(obbligatorio)"* scritto; errore di Recapiti sul
  `fieldset` via `aria-describedby`; salvando con errori focus sul primo campo errato; i pannelli doppioni compaiono
  in `role="status"` e, salvando senza scelta, il focus va al gruppo di scelta; dopo "Salva e aggiungi un'altra"
  focus su Nome e live region *"Persona aggiunta: Luca Bassi. Il form è pronto per la prossima."*; il combobox
  azienda segue il pattern della ricerca.
- **Promemoria di Oggi:** ogni **Nascondi** ha il nome *"Nascondi il promemoria: APOLLO_API_KEY nel .env"*; dopo il
  clic il focus va alla voce successiva o al titolo della pagina.
- **Prossima azione:** stato in testo (G3) con `<time datetime>`; date con `input type="date"`; bottoni col nome
  completo (*"Fatto: Richiamare per la demo, Mario Rossi"*); dopo Fatto/Rimanda il focus va al Fatto della riga
  successiva, o al titolo della sezione se vuota (lezione di TD-4).
- **Fit:** `radiogroup` con legend che nomina l'ICP. **Unisci:** tabella con `caption` *"Valori in conflitto"*,
  "Resta"/"Si perde" come testo, focus iniziale su Annulla. **Viste:** conteggio nel nome (*"Da smistare, 288"*).
- **Log:** `ol` con `aria-live="off"` (non `role="log"`, che annuncerebbe ogni riga); stato del run in
  `role="status"`; orari in `<time>`; esiti con prefisso testuale (Completato / Completato con avvisi / Fallito /
  In corso).

## Testi che cambiano (A3)

| Oggi | Diventa |
|---|---|
| "Inbox", "Apri Inbox", "Vai all'Inbox", "Inbox · N da triagiare" | "Da smistare", "Apri Da smistare", "Vai a Persone", vista Da smistare |
| Badge "In Inbox" nella scheda | *"Nessuna lista"* + **Aggiungi a lista** |
| Marchio "Prospect CRM" | *"CRM personale"* |
| "Prospect non trovato", "Prospect collegati", "Prospect generati", "Catturato il" | *"Persona non trovata"*, *"Persone"*, *"Persone"*, *"Aggiunta il"* |
| Esito sync "N nuovi prospect in Inbox" | *"N nuove persone da smistare"* |
| "Nessun prospect corrisponde ai filtri", "Esporta N prospect", "Nessun prospect da analizzare" | *"Nessuna persona corrisponde ai filtri."*, *"Esporta N persone"*, *"Nessuna persona da analizzare"* |
| Operazione "Sourcing da azienda" | *"Persone di un'azienda"* |
| Sezioni "Configurazione" e "Ultimi job" | Connessioni (J1) |
| Didascalie `sr-only` ("Prospect in Inbox", "Prospect della lista X") | *"Persone da smistare"*, *"Persone della lista X"* |
| Riassunti dei run conclusi prima del rilascio | Invariati: si mostrano come sono stati scritti (eccezione di A3) |

## Open questions e proposte

Le open questions (OQ-1…OQ-4) e le proposte di modifica (P1…P11) nate scrivendo questo FLOW sono state decise
il 2026-09-18 e sono registrate nel Decision Log e nelle Open Questions della
[[specs/prospect-crm/people-first-crm/SPEC|SPEC]]: il FLOW le presuppone. Nessuna domanda aperta.
