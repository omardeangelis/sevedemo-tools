---
domain: prospect-crm
type: flow
links:
  - "[[specs/prospect-crm/crm-foundation/PLAN|PLAN]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
created: 2026-09-16
updated: 2026-09-16
---

# Flow: CRM personale di prospecting LinkedIn (`crm-foundation`)

> Contratto di flusso per [[specs/prospect-crm/crm-foundation/PLAN|PLAN]] (che fa da spec: §1–§6 problem
> statement e modello dati, §12 story). Descrive **comportamento osservabile, stati e testi**, non
> implementazione. Copre le superfici in scope: Onboarding · Impostazioni (profilo, azienda, post, sync) ·
> ICP · Aziende · Inbox · Liste / Lista · Prospect. Il "come" (componenti, endpoint) è deciso nel PLAN;
> dove questo flow richiede un vincolo al PLAN lo segnala con **[→ PLAN Tn]**.

## Goal

Trasformare chi reagisce/commenta ai miei post e le persone delle aziende target in **liste per ICP** e
gestire il contatto di ogni persona (stato, touchpoint, export) **spendendo solo quanto ho visto in
anteprima**.
**Segnale di successo:** a DB vuoto, in una sessione, arrivo a un prospect in lista con un touchpoint
registrato passando da 3 job al massimo (sync, arricchimento/analisi, export); **ogni** job mostra prima
cosa farà e quanto costa e dopo un esito onesto (0 risultati ≠ errore); nessuna azione di scrittura è
silenziosa. Verifica con `agent-browser` (nessun runner FE, decisione di progetto).

## Personas

- **Omar (unico utente; founder/consulente + sviluppatore del tool).** *Esperto* del dominio (sa cos'è un
  ICP, cosa costa un actor Apify, come si scrive un DM) e del codice. Usa il tool **da solo, in locale,
  senza auth**, da desktop. Tollera densità e tabelle; non vuole tutorial, vuole **controllo**.
  - **Stato emotivo:** (1) *ansia da costo* — ogni job Apify/Claude è denaro reale; teme di lanciare due
    volte la stessa cosa o un job che esplode su un post virale; (2) *sovraccarico* — 100+ reazioni per
    post da triagiare, la maggior parte fuori ICP.
  - **JTBD:** "Quando pubblico e ricevo interazioni, voglio separare in pochi minuti chi è nel mio ICP da
    chi no, sapere *come* aprire la conversazione con i primi, e non perdere il filo dei contatti già
    fatti — anche se la stessa persona compare in più liste."
  - **Conseguenze di design:** etichette dense ma in italiano piano; bulk ovunque; preview costo
    obbligatoria; esiti con conteggi; niente automatismi che cambiano stato o assegnano liste al posto
    suo (D6, D8); nessuna conferma "sei sicuro?" su azioni reversibili.
  > Persona non definita in `brain/domains/prospect-crm/` (dominio in costruzione): questa
  > caratterizzazione deriva dal PLAN §2/§5 e dal brief; è l'assunzione su cui si progetta.

---

## Entry points

Nessuna precondizione di ruolo/permesso (single-user, no-auth). Tutte le route sono deep-linkabili; i
filtri delle tabelle vivono **nell'URL** (pattern `validateSearch` ereditato: reload/back preservano).

| Entry | Route | Precondizioni / comportamento |
|---|---|---|
| Home | `/` | Se `own_profile_url` **e** almeno un ICP esistono → redirect a `/inbox`. Altrimenti **Onboarding** (vedi A). |
| Impostazioni | `/settings` | Sempre. Sezioni: Profilo LinkedIn · La mia azienda · I miei post (sync) · Ultimi job. |
| ICP | `/icps`, `/icps/$id` | Sempre. `$id` inesistente → "ICP non trovato" + link a `/icps`. |
| Aziende | `/companies`, `/companies/$id` | Sempre. Dettaglio: anagrafica, ICP di riferimento, prospect collegati, azione "Cerca persone". |
| Inbox | `/inbox?q&source&post&status&page` | Sempre. Inbox = prospect senza lista e non `scartato` (derivato, mai colonna). |
| Liste | `/lists` | Sempre; card raggruppate per ICP; toggle "Mostra archiviate". |
| Lista | `/lists/$id?q&status[]&email&enriched&fit&page` | Conteggi per stato cliccabili → filtro. Lista archiviata → banner "Lista archiviata" (vedi Edge). |
| Prospect | `/prospects/$id?list=` | `?list` = lista di contesto (default del form touchpoint e dell'ICP per l'analisi). `$id` inesistente → "Prospect non trovato" + link a Inbox. |
| JobBanner (sidebar) | ogni pagina | Visibile quando esiste un job `running` o un esito non ancora letto; click → dettaglio esito. |
| Dialog Sync interazioni | da `/settings` **e** dall'empty state di `/inbox` | Stesso dialog (componente unico): l'Inbox vuota non deve rimandare a un'altra pagina per fare la cosa ovvia. |

---

## Happy path

### A. Primo avvio a DB vuoto → primo prospect in lista

1. Apro `/` → **Onboarding** (non una dashboard). Titolo: **"Il tuo CRM di prospecting"**. Sotto, tre
   passi con stato (● da fare / ✓ fatto con riepilogo):
   - **1. Salva il tuo profilo LinkedIn e descrivi la tua azienda** → "Apri Impostazioni". Fatto quando
     `own_profile_url` è salvato (riepilogo: "linkedin.com/in/omar-…"). Se manca la descrizione azienda,
     il passo resta ✓ ma con nota: *"Descrizione azienda vuota: gli angoli AI saranno meno mirati."*
   - **2. Crea il tuo primo ICP** → "Crea ICP". Fatto quando esiste ≥1 ICP (riepilogo: nome + n. ruoli).
   - **3. Porta dentro le prime persone** — due bottoni, entrambi validi: **"Sincronizza le interazioni
     ai miei post"** (apre il dialog Sync, vedi B; disabilitato con hint se 1 non è fatto) **oppure**
     **"Aggiungi un'azienda e cerca le persone"** (porta a `/companies?add=1`, che apre il dialog "Azienda da URL", vedi D; disabilitato
     con hint se 2 non è fatto perché serve una lista/ICP).
   → I passi 1 e 2 sono indipendenti (si può fare 2 prima di 1); il 3 dipende da entrambi.
2. Impostazioni → **Profilo**: campo URL; salva → validazione server (`400` se non è un URL LinkedIn) →
   errore inline *"Inserisci l'URL pubblico del tuo profilo, es. https://www.linkedin.com/in/tuo-nome/"*.
   Ok → toast "Profilo salvato" e l'URL normalizzato mostrato sotto il campo. **Azienda**: nome,
   descrizione, offerta (facoltativi, hint: *"Usati dall'analisi AI per proporre angoli coerenti con ciò
   che vendi."*).
3. ICP → "Nuovo ICP" → form: nome (obbligatorio), descrizione, **ruoli target** (chip: Invio aggiunge),
   settori, località, dimensione azienda, pains, note. Salva → dettaglio ICP con sezione **"Aziende di
   riferimento"** vuota: *"Nessuna azienda di riferimento. Aggiungi le aziende con cui hai trattato bene:
   aiutano l'analisi AI a capire chi è davvero un buon fit."* → "Aggiungi da URL" (URL + esito:
   vinta/in trattativa/persa/riferimento + note).
4. Torno a `/` (o clicco la nav) → passo 3 attivo → **Sincronizza** (B) → job → Inbox popolata.
5. `/inbox` → seleziono le persone in ICP → **"Aggiungi a lista"** → dialog: nessuna lista esiste →
   il dialog offre **"Crea nuova lista"** inline (nome + ICP preselezionato se unico) → conferma →
   *"12 aggiunti a 'CTO startup IT' · lista creata"* + azione "Apri lista".
   **[→ PLAN T13/T15: `ListPicker` con creazione inline; senza, il primo triage è un vicolo cieco.]**
6. Apro un prospect dalla lista → cambio stato / registro touchpoint (F).
→ **Outcome:** almeno un prospect in una lista, con stato e una voce in timeline; `/` da ora reindirizza
a `/inbox`.

### B. Sync interazioni con preview costo ed esito onesto

1. Da `/settings` › "I miei post" (o dall'empty state dell'Inbox) clicco **"Sincronizza interazioni"**.
   Se il profilo manca il bottone è `disabled` con hint *"Salva prima il tuo profilo LinkedIn."*
2. Si apre il **dialog di anteprima** (`GET /api/sync/preview`). Contenuto, in quest'ordine:
   - **Profilo**: `linkedin.com/in/omar-…`
   - **Post**: *"Verranno letti gli ultimi 10 post (POSTS_PER_SYNC)."* Poi, se ci sono post noti:
     *"Post già sincronizzati: 7 (saltati) · Da sincronizzare: 3 (2 nuovi, 1 con sync più vecchio di 7
     giorni)."* Spunta **"Risincronizza tutto"** (`force`) con testo *"Rilegge anche i post già
     sincronizzati: costa di nuovo."*
   - **Stima**: se i conteggi dei post sono noti → *"Fino a ~412 reazioni e ~37 commenti (≈ $2,10)"*
     calcolata sui `reactions_count/comments_count` dei post da sincronizzare, con cap `REACTIONS_PER_POST`
     applicato per post. Se **non** sono noti (primo sync) → *"Stima non disponibile al primo sync. Limite
     massimo: 10 post × 300 reazioni = 3.000 reazioni (≈ $15). In pratica costa quanto le interazioni reali
     dei tuoi post."* + azione secondaria **"Aggiorna solo l'elenco dei post"** (job economico che
     scarica i post e i conteggi senza leggere le interazioni; al termine riapro il dialog e vedo la stima
     reale). **[→ PLAN T8: parametro `postsOnly` + regola di ri-sync esplicita, vedi report.]**
   - **Blocchi** (se presenti, sostituiscono il bottone Avvia): *"APIFY_TOKEN mancante nel .env"*,
     *"C'è già un job in corso (Sync interazioni, avviato 2 min fa)"*.
   - Bottoni: **"Avvia sync"** (primario) · "Annulla".
3. Avvio → `202` → il dialog si chiude, **JobBanner** in sidebar: *"Sync interazioni · in corso · 0:42"*.
   Posso navigare ovunque; la sezione "I miei post" mostra le righe con "sync in corso…" dove pertinente.
4. Fine job → toast persistente (resta finché non lo chiudo) con `result.summary` e azione:
   - **Esito pieno:** *"Sync completato: 3 post sincronizzati (7 già fatti) · 412 reazioni e 37 commenti
     lette · 288 nuovi prospect in Inbox · 61 già presenti (fonte aggiunta) · 12 senza profilo pubblico
     (saltati)."* → **"Apri Inbox"**.
   - **Esito zero, non errore (tono neutro):** *"Nessun post da sincronizzare: i 10 post sono già
     sincronizzati. Usa 'Risincronizza tutto' per rileggerli."* Nessun "Apri Inbox".
   - **Esito zero sospetto (warning, non errore):** se un post ha `reactions_count > 0` ma il job ha letto
     0 reazioni → *"0 reazioni lette da 3 post che ne dichiarano 412: probabile cambio dello schema
     dell'actor apimaestro/linkedin-post-reactions. I 3 post NON sono stati marcati come sincronizzati:
     il prossimo sync li riprende. Verifica l'actor prima di rilanciare."* **[→ PLAN T8: non marcare
     `last_synced_at` quando letto=0 e dichiarato>0.]**
   - **Esito parziale:** *"…· 1 post in errore (vedi 'I miei post')."* → nella tabella post la riga ha
     "Ultimo sync: errore" con tooltip del messaggio actor e azione "Riprova questo post" (= sync con
     `force` limitato al post). *Se non si vuole il per-post retry in v1, il tooltip basta: il prossimo
     sync lo riprende perché non è marcato sincronizzato.*
5. Tabella **"I miei post"**: data · excerpt · reazioni/commenti (dichiarati) · **prospect generati** ·
   ultimo sync (relativo) · stato (sincronizzato / da sincronizzare / errore). Ordinata per data desc.
→ **Outcome:** Inbox con i nuovi prospect, ognuno con ≥1 **fonte** visibile (reazione/commento + post).

### C. Triage dell'Inbox in bulk

1. `/inbox`: header *"Inbox · 288 da triagiare"* + *"Ultimo sync: 5 min fa"*. Tabella (paginata 50):
   ☐ · **Nome** + headline (link al dettaglio) · **Fonti** (icone: "reazione ×2", "commento", con tooltip
   "Ha commentato 'Anche noi stiamo migrando…' su <excerpt post>") · Azienda/ruolo · Stato · ✉ (con/senza
   email, testo alternativo) · Fit (se analizzato: "alto · CTO startup IT") · Catturato il.
   **Ordinamento default:** catturato desc; opzioni: "Commenti prima" (chi scrive vale più di chi clicca
   like), "Più interazioni".
   **Filtri** (`FilterBar` + chip, in URL): ricerca, fonte (reazioni/commenti), post (select dagli
   ultimi 10), stato, fit.
2. Selezione: checkbox per riga, **"Seleziona i 50 visibili"** e poi, se il filtro ha più righe, il link
   **"Seleziona tutti i 288 filtrati"** (cap 500 con avviso). La selezione è **per id** e sopravvive al
   cambio di filtro/pagina; contatore **"N selezionati"** sempre visibile nella `BulkBar` con "Deseleziona".
3. `BulkBar` (compare con ≥1 selezionato): **Aggiungi a lista** · **Scarta** · **Analizza…** · **Arricchisci…**.
   - **Aggiungi a lista** → dialog `ListPicker`: liste raggruppate per ICP (radio), **"Crea nuova
     lista"** inline. Conferma → best-effort per item → *"12 aggiunti a 'CTO startup IT' · 0 già presenti"*
     → le righe spariscono dall'Inbox, selezione azzerata, toast con "Apri lista".
   - **Scarta** → **senza conferma** (reversibile): `bulk/status → scartato` → *"37 scartati"* → spariscono.
     Recupero via toggle **"Mostra scartati"** (filtro) + bulk **"Ripristina"** (→ `nuovo`).
   - **Analizza…** → vedi H.  **Arricchisci…** → preview come E (senza ICP).
4. Ciclo tipico su 288 righe: filtro "Commenti" → seleziono tutti → Aggiungi a lista/Analizza; poi filtro
   "Reazioni" → scorro headline → seleziono i fuori-ICP → Scarta; il resto → Analizza per ICP → filtro
   "fit: alto" → Aggiungi a lista.
→ **Outcome:** *"Inbox pulita: tutte le interazioni sono state assegnate o scartate. Ultimo sync: 2 giorni
fa (10 post)."* + "Sincronizza di nuovo" · "Mostra scartati".

### D. Sourcing da azienda in una lista

1. Due ingressi equivalenti allo **stesso dialog**:
   - `/companies` → "Aggiungi azienda" → URL → azienda creata → dettaglio → **"Cerca persone"**.
   - `/lists/$id` → **"Aggiungi persone da un'azienda"** (sempre presente nell'header della Lista: porta a `/companies?listId=<id>`, dove incollo l'URL; `POST /api/companies/from-url`
     con `listId` = questa lista: "incolla e vai").
2. Dialog **"Cerca persone in Acme"**:
   - **Lista di destinazione** (`ListPicker`, preselezionata se vengo dalla lista; "Crea nuova lista"
     inline). Sotto: *"ICP: CTO startup IT"*.
   - **Ruoli** (chip precompilati da `target_roles` dell'ICP, editabili). Se l'ICP non ha ruoli →
     warning *"L'ICP non ha ruoli target: verranno estratte le prime N persone qualunque. Aggiungi ruoli
     qui o nell'ICP."* (non blocca).
   - **Località** (precompilata da `target_locations`, opzionale).
   - **Massimo persone** (default 50, `EMPLOYEES_PER_COMPANY`).
   - **Modalità** (radio con prezzo calcolato sul massimo): *Short — nome, headline, ruolo (≈ $0,22)* ·
     *Full — + esperienze e formazione: l'analisi AI non richiederà l'arricchimento (≈ $0,42)* ·
     *Full+email (≈ $0,62; prezzi con start fee $0,02 per run)*. Hint su Short: *"Per analizzarli dovrai arricchirli (costo aggiuntivo per
     persona)."* **[→ PLAN T9: in Full/Full+email marcare `enriched_at` se about/esperienze presenti.]**
   - Blocchi: token mancante, job in corso, lista archiviata.
   - **"Avvia ricerca"**.
3. `202` → JobBanner. Fine:
   - *"Sourcing Acme completato: 43 persone lette · 38 aggiunte a 'CTO startup IT' (31 nuove, 7 già in
     archivio) · 2 già in lista · 3 senza profilo pubblico."* → "Apri lista".
   - Zero: *"Nessuna persona trovata in Acme con ruoli CTO, Head of Engineering. Amplia i ruoli o togli
     la località."* (neutro) → "Riprova con altri filtri" riapre il dialog con gli stessi valori.
4. Dettaglio azienda mostra i **prospect collegati** (con stato) e i job di sourcing fatti (data,
   ruoli, esito), così non rilancio per sbaglio la stessa ricerca.
→ **Outcome:** membri in lista con stato `nuovo`, fonte "dipendente di Acme", `company_id` collegato.

### E. Enrich / Analyze in bulk dalla Lista (preview costi, stati parziali)

1. `/lists/$id`: header con ICP, descrizione, **conteggi per stato come chip cliccabili** (filtro),
   contatori "arricchiti 18/24 · analizzati 12/24 · con email 9/24". Tabella come Inbox più colonne
   **Fit** e **Ultimo touchpoint**. `BulkBar`: **Cambia stato ▾** · **Rimuovi dalla lista** ·
   **Arricchisci…** · **Analizza…** · **Esporta…**. Nel menu header "Azioni sulla lista": le stesse
   tre su **tutta la lista filtrata** (default `onlyMissing`).
2. **Arricchisci…** → `JobPreviewDialog` (`GET /api/lists/:id/enrich/preview` + ids):
   *"24 selezionati · 17 da arricchire · 5 già arricchiti (saltati) · 2 tentati senza risultato negli
   ultimi 90 giorni (saltati)"* (finestra = `FRESHNESS_DAYS`, default 90) + spunta *"Riprova anche quelli
   senza risultato"* (parametro `retryFailed`, PLAN T10) + stima *"17 × $0,0X ≈
   $Y"* (se il prezzo non è configurato: *"stima non disponibile"*, mai un numero inventato).
   → Avvia → JobBanner → *"Arricchimento: 15 arricchiti (9 con email) · 2 senza dati sul profilo."*
   Nella tabella: ✉ aggiornato; i 2 senza dati mostrano "non arricchibile" (tooltip: data tentativo).
3. **Analizza…** → dialog in due parti:
   - **ICP** = quello della lista (riga fissa: *"Analisi per ICP: CTO startup IT"*).
   - **Anteprima** (`GET /api/lists/:id/analyze/preview`): *"24 selezionati · 9 da arricchire prima (≈ $A)
     · 22 da analizzare (≈ 22 × $0,03 = $0,66) · 2 già analizzate con gli stessi dati (saltate)"* + spunta
     *"Rianalizza anche quelle già fatte"* (`force`). Modello: *"claude-opus-5"*.
   - **Warning non bloccanti:** *"Descrizione della tua azienda vuota: angoli meno mirati. [Compila]"*;
     *"L'ICP non ha pains/descrizione: il fit sarà poco affidabile."*
   - **Blocchi:** *"ANTHROPIC_API_KEY mancante"*, job in corso.
   → Avvia → JobBanner con kind + durata (*"Analisi in corso · 1 min"*; nessun progresso parziale in v1,
   vedi OQ-8).
4. Fine → *"Analisi completata: 19 analizzate · 9 arricchite prima · 2 saltate (dati identici) · 1
   rifiutata dal modello · 1 errore (risposta non valida dopo 1 tentativo) · 2 non analizzabili (profilo
   senza dati)."* → "Apri lista".
   **Stati parziali visibili per riga** (colonna Fit): `alto/medio/basso` (badge + testo) · "—" non
   analizzato · **"rifiutata"** (tooltip: *"Il modello ha rifiutato di analizzare questo profilo. Puoi
   riprovare o scrivere il messaggio a mano."*) · **"errore"** (tooltip con messaggio) · **"non
   arricchibile"**. Filtro `fit` include queste tre voci per poter selezionare e **riprovare solo i
   falliti** (stesso bottone Analizza: senza analisi salvata non serve `force`).
   **[→ PLAN T11: counts `not_enrichable`; attività `analysis` con `meta.error` per refusal/JSON invalido
   così la riga e la timeline lo mostrano.]**
→ **Outcome:** la lista è ordinabile per fit; posso filtrare `fit: alto` + `stato: nuovo` → Cambia stato →
`qualificato` / `da_contattare`.

### F. Gestione del contatto sul Prospect

1. `/prospects/$id?list=L`. **Header:** nome · headline · azienda/ruolo · link "Apri su LinkedIn" (esterno)
   · **StatusSelect** (select dei 9 stati con label italiana, colore + testo) · **badge delle liste** di
   appartenenza (link) o badge *"In Inbox"* con azione "Aggiungi a lista".
   Se il prospect è in **≥2 liste**: sotto lo stato la nota *"Lo stato è unico per persona: cambiarlo qui
   vale in tutte le liste (CTO startup IT, Fintech)."*
2. **Cambio stato:** scelgo dallo select → popover "Nota (opzionale)" + "Conferma" → `POST status` →
   badge aggiornato, timeline con *"Stato: nuovo → qualificato"*. Nessuna macchina a stati: ogni
   transizione è permessa (D6); `scartato` su un prospect senza liste lo toglie dall'Inbox.
3. **Colonna sinistra:** anagrafica editabile (email, telefono, azienda, ruolo; salva inline) · **Fonti**
   (una riga per source: *"Reazione 👍 a 'Excerpt post…' · 3 set"*, *"Commento su '…': 'Anche noi stiamo
   migrando…'"*, *"Dipendente di Acme (ricerca del 12 set)"*) · About ed esperienze (da `raw_json`) o
   *"Profilo non arricchito"*.
4. **Colonna destra:** `AnalysisCard` (vedi E/H per gli stati) con **"Copia"** su riassunto e su ogni
   angolo (toast "Copiato") · **Timeline** (desc; icona per kind; canale/direzione; chip lista; testo
   espandibile) — vuota: *"Nessuna attività. Registra il primo touchpoint qui sotto o cambia lo stato."*
5. **TouchpointForm** (in fondo alla colonna destra, sempre visibile): canale (email · DM LinkedIn ·
   commento LinkedIn · chiamata · altro) · direzione (default **in uscita**; "in entrata" per le risposte)
   · data/ora (default adesso) · **lista di contesto** (default: `?list`; se una sola membership → quella;
   se più liste e nessun `?list` → obbligatoria; se nessuna → "nessuna") · testo del messaggio
   (**facoltativo**: registrare "ho mandato un DM" senza incollare il testo è legittimo) · nota ·
   **"Nuovo stato"** (default *"nessun cambio"*; hint contestuale: in uscita e stato < `contattato` →
   *"Suggerito: Contattato"*; in entrata → *"Suggerito: Risposto"*; mai applicato in automatico).
   Submit → `201` → timeline con 1 o 2 voci (touchpoint + eventuale cambio stato, stessa transazione) →
   badge stato aggiornato → form ripulito ma canale e lista mantenuti (uso ripetuto).
→ **Outcome:** la storia del contatto è leggibile in un colpo d'occhio: stato in alto, ultimo touchpoint
in cima alla timeline, angoli a portata di copia.

### G. Export CSV con filtri e `markContacted` opt-in

1. Da `/lists/$id`: **"Esporta…"** nella `BulkBar` (se ho una selezione) o nel menu header (lista
   filtrata). Dialog **"Esporta CSV"**:
   - **Ambito** (riga fissa): *"12 selezionati"* oppure *"Lista filtrata: stato da_contattare · con email
     (24)"* (chip dei filtri correnti in sola lettura; per cambiarli chiudo il dialog).
   - **"Solo con email"** — default **ON** (l'export serve agli email tool, D7); sotto, conteggio vivo:
     *"Verranno esportati 18 prospect (6 senza email esclusi)."*
   - **"Segna come 'contattato' i prospect esportati"** — default **OFF**; hint: *"Registra un cambio
     stato per ciascuno. Attivalo se invii subito dopo l'export: evita di ri-esportarli la prossima
     volta filtrando per stato."*
   - Blocchi: 0 prospect nell'ambito → bottone disabilitato *"Nessun prospect da esportare con questi
     filtri"*.
   - **"Esporta 18 prospect"**.
2. `POST` → `201 {id, count, download_url}` → il browser scarica il CSV → toast *"18 esportati · CSV
   scaricato"* (+ *"· segnati come contattati"* se opt-in). In ogni prospect esportato compare
   l'attività **"Esportato (lista CTO startup IT, export #7)"**.
3. Nella pagina lista, sezione **"Export precedenti"**: data · filtri · conteggio · "Scarica di nuovo".
→ **Outcome:** file con le colonne di PLAN T12 (angoli e riassunto inclusi se analizzati); la lista
riflette lo stato scelto.

### H. Analisi dall'Inbox con più ICP

1. In `/inbox` seleziono N → **"Analizza…"** → dialog:
   - **Passo ICP**: se esiste **un solo ICP** → riga fissa *"ICP: CTO startup IT (unico)"*, nessuna
     scelta richiesta. Se **più ICP** → radio con nome + 1 riga di descrizione; nessun default (il fit
     dipende dall'ICP: scegliere per me sarebbe un automatismo). Se **zero ICP** → blocco *"Crea prima un
     ICP: l'analisi calcola il fit rispetto a un ICP."* + link.
   - **Anteprima** identica a E.3 (`to_enrich`, `to_analyze`, costo, warning azienda vuota).
2. Fine job → toast come E.4. La colonna **Fit** in Inbox mostra *"alto · CTO startup IT"* (fit + ICP
   dell'ultima analisi); il filtro `fit` in Inbox chiede/mostra anche l'ICP quando ce n'è più d'uno.
3. Filtro `fit: alto` → seleziono tutti → **Aggiungi a lista**: il `ListPicker` **preseleziona** la lista
   dell'ICP appena usato se è l'unica di quell'ICP; altrimenti evidenzia il gruppo di quell'ICP.
   L'assegnazione resta un mio clic (D8).
→ **Outcome:** l'Inbox si svuota per fit invece che per headline, con un costo visto prima.

---

## Error paths

Per **ogni** scrittura (salva, cambia stato, touchpoint, aggiungi/rimuovi, avvia job, esporta) esiste un
esito visibile: successo (invalidate + toast dove non è ovvio dalla UI) o errore inline/toast. Mai
silenzio.

| Trigger / fallimento | Comportamento visibile | Recupero |
|---|---|---|
| Profilo mancante e avvio sync (bottone o deep-link `POST`) | Bottone `disabled` con hint; se il job parte comunque → `failed` in ≤1 s con *"Salva il tuo profilo LinkedIn nelle Impostazioni"* | Link a `/settings#profilo` |
| `APIFY_TOKEN` / `ANTHROPIC_API_KEY` mancanti | La **preview** lo rileva come blocco **prima** dell'avvio: *"APIFY_TOKEN mancante nel .env — nessun job avviato"*. Avvia disabilitato | Configura `.env`, riavvia il server, riapri il dialog |
| Job già in corso (`409`) | Preview mostra il blocco *"C'è già un job in corso: <kind>, avviato <min> fa"*; su race al `POST` → toast con lo stesso testo | Attendere; il banner mostra quando finisce |
| Actor fallisce **interamente** (es. profile-posts) | Job `failed`: *"Impossibile leggere i post di <url> (actor apimaestro/linkedin-profile-posts: <messaggio>). Nessun dato modificato."* Banner rosso persistente | **"Riprova"** nel banner (stessi parametri) |
| Actor fallisce su **alcuni item** (post/azienda) | Job `succeeded` con `post_errors`/`errors` nel summary; righe con "errore" + tooltip; dati degli altri item salvati | Il prossimo sync riprende i post non marcati; "Riprova" per-item se implementato |
| Actor cambia schema → 0 letti ma dichiarati > 0 | Esito **warning** (non `failed`): testo B.4; post non marcati sincronizzati | Verificare l'actor; il retry non paga due volte i post ok |
| Processo figlio muore (pid morto) | Job `failed`: *"Job interrotto senza esito. I dati scritti fino all'interruzione restano validi."* | "Riprova" |
| Analisi singola: refusal | `AnalysisCard`: *"Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano."*; nessuna analisi salvata; attività `analysis` con errore in timeline | "Riprova" (stesso bottone) |
| Analisi singola: JSON non valido dopo il retry | `AnalysisCard`: *"Risposta del modello non valida (2 tentativi). Riprova tra poco."* | "Riprova" |
| Analisi singola su prospect non arricchito | Bottone dice **"Arricchisci e analizza"** con costo doppio; se l'arricchimento non torna dati → *"Profilo senza dati pubblici: analisi non possibile. Puoi compilare a mano About/ruolo e riprovare."* | Edit anagrafica → Riprova |
| Analisi singola mentre un job è `running` | Consentita (è sincrona, non un job) **purché** l'eventuale arricchimento sia fatto inline lato server; altrimenti `409` con testo del job in corso **[→ PLAN T11 `enrichFirst` sincrono]** | Attendere / Riprova |
| Bulk add: item già in lista | Conteggiato *"già presenti"*, non errore | Nessuna azione |
| Bulk (add/status/scarta): item fallisce (rete/500) | *"10 riusciti · 2 errori"* con nomi; gli altri restano applicati; la selezione **conserva solo i falliti** | "Riprova i falliti" |
| URL azienda non LinkedIn / non `company` | Errore inline *"Inserisci un URL del tipo linkedin.com/company/<nome>"* | Correggi |
| Azienda duplicata (`409` con id) | Inline *"Azienda già presente: apri Acme"* (link); nessuna riga creata | Vai al dettaglio esistente |
| Elimina ICP con liste (`409`) | Bottone "Elimina" disabilitato con hint *"Ha 2 liste: archiviale o spostale prima"*; su race → toast uguale | Archivia le liste |
| Export fallisce (500) | `ErrorBox` nel dialog, nessuna riga `exports` né attività (transazione) | "Riprova" |
| Export con 0 prospect | Bottone disabilitato + testo esplicito; non è un errore | Cambia filtri / spunta |
| Salvataggio profilo con URL non valido (`400`) | Inline sotto il campo; valore non salvato | Correggi |
| Caricamento pagina fallisce (API giù) | `ErrorBox` + **"Riprova"** al posto della tabella; nav sempre usabile | Riprova |
| Deep-link a id inesistente | Pagina *"<Entità> non trovato"* con link alla lista padre | Naviga |
| Deep-link con filtri non validi nell'URL | `validateSearch` scarta i valori invalidi → default (invariante ereditato) | Trasparente |

## Edge cases

- **DB vuoto ma profilo/ICP presenti** (es. dopo reset dati): `/` → `/inbox` con empty state *"Nessuna
  interazione ancora. Sincronizza i tuoi post: vedrai qui chi ha reagito o commentato."* + **"Sincronizza
  ora"** (dialog B) + link *"oppure cerca persone in un'azienda"*.
- **Inbox vuota per filtri**: *"Nessun prospect corrisponde ai filtri."* + "Pulisci". Diverso
  dall'Inbox davvero vuota.
- **Liste senza ICP**: `/lists` vuota → *"Prima crea un ICP: ogni lista appartiene a un ICP."* + link;
  "Nuova lista" disabilitato con hint.
- **Lista vuota**: *"Lista vuota. Aggiungi persone dall'Inbox (seleziona → Aggiungi a lista) o cerca
  persone in un'azienda."* + bottone "Aggiungi persone da un'azienda".
- **Stessa persona da più fonti** (reazione + commento; reazione + dipendente): **un** prospect, N
  `sources`; la riga mostra tutte le icone; il dettaglio le elenca. Se il sourcing la mette in lista,
  esce dall'Inbox anche se era arrivata dal sync.
- **Stessa persona in 2+ liste**: lo stato è **globale** (D4): in lista B la vedo `contattato` anche se
  il touchpoint è nato in A; il chip lista sulla voce di timeline dice dove. Rimuoverla da una lista non
  tocca stato né timeline; rimossa dall'**ultima** lista torna in Inbox con il suo stato (colonna Stato
  in Inbox rende visibile il caso).
- **Prospect `scartato` con membership**: resta in lista (filtro stato lo isola); non compare mai in
  Inbox. Ripristino = cambio stato manuale.
- **Post virale (1.000+ reazioni)**: cap `REACTIONS_PER_POST` (300) applicato **per post** e dichiarato
  nella preview (*"limite 300 per post"*); il summary dice *"limite raggiunto su 1 post"*.
- **Reactor senza `profile_url`** (privati/anonimi): scartati, conteggiati *"senza profilo pubblico"*.
  Se la quota è > 50% dei letti, il summary aggiunge *"Molte reazioni senza profilo pubblico: valutare un
  actor alternativo"* (PLAN §15).
- **Post più vecchi di `POST_RECENCY_DAYS`**: mai risincronizzati senza `force`; la tabella post li
  mostra come "archiviato (oltre 90 giorni)".
- **Analisi "stantia"**: prospect ri-arricchito dopo l'analisi (`input_hash` diverso) → `AnalysisCard`
  mostra *"Il profilo è cambiato dopo l'analisi."* + "Rianalizza". Il bulk `onlyMissing` **non** le
  ricalcola (costo); `force` sì.
- **Analisi per un ICP diverso**: prospect in lista A (ICP X) analizzato per X; aggiunto a lista B (ICP
  Y) → in B la colonna Fit mostra "—" finché non lo analizzo per Y; il dettaglio mostra l'analisi per
  ICP corrente (`?list`) con switch tra le analisi esistenti.
- **Sourcing in modalità Short** e poi "Analizza": la preview conta i membri come "da arricchire prima":
  l'utente vede il doppio costo che il dialog di sourcing aveva anticipato.
- **Lista archiviata** (`archived_at`): nascosta da `/lists` (toggle "Mostra archiviate"); deep-link
  apre con banner *"Lista archiviata"*; azioni di job (arricchisci/analizza/sourcing) disabilitate,
  lettura/export permessi. *Assunzione: `PATCH /api/lists/:id {archived_at}`; nessun'altra semantica.*
- **Job avviato e pagina cambiata/ricaricata**: il banner si ricostruisce da `GET /api/jobs/current`;
  l'esito arriva comunque (toast al primo polling che lo vede `succeeded|failed`). Un esito non letto
  resta nel banner finché non lo chiudo.
- **Due tab del browser**: entrambe vedono lo stesso job (polling); la seconda che prova ad avviare
  riceve il blocco/`409`.
- **Analisi singola lunga (Opus + thinking, 20–60 s)**: bottone con spinner e testo *"Analisi in corso…
  può richiedere fino a un minuto, fino a tre se serve anche l'arricchimento"*; la pagina resta navigabile; se torno, la card mostra il risultato.
- **Touchpoint registrato due volte per errore**: azione "Elimina" sulla voce di timeline (solo
  `touchpoint`/`note`, mai `status_change`/`export`/`analysis`; `DELETE /api/activities/:id`, PLAN T5/T16).
- **Slug LinkedIn cambiato dalla persona**: due prospect distinti finché nessuna fonte li collega (identità =
  URL normalizzato + id membro). *(Steering 2026-09-16)* L'unione è **automatica** quando una fonte porta
  entrambe le chiavi (sourcing con slug + id membro, arricchimento che risolve l'id nello slug) e, nel sync,
  quando una reazione solo-id e un commento solo-slug hanno stesso nome e headline; la timeline conserva tutto.
  Nessuna unione manuale in UI.
- **Selezione "tutti i filtrati" oltre il cap 500**: *"Selezionati i primi 500 di 812: affina i filtri
  per il resto."*
- **Export ripetuto della stessa lista**: consentito; nuova riga in "Export precedenti"; la timeline del
  prospect accumula attività `export` (utile per capire quante volte è finito in un tool).

## Decisioni UX

- **Onboarding = tre passi con stato, non dashboard.** A DB vuoto una dashboard è vuota e ansiogena; i tre
  passi rendono esplicito l'ordine reale delle dipendenze (profilo/ICP → acquisizione). Il passo 3
  offre **entrambe** le fonti (sync e azienda): il sourcing non è un "avanzato".
- **Preview obbligatoria e uniforme per ogni job** (`JobPreviewDialog` unico: sync, sourcing, enrich,
  analyze). Forma dei dati: conteggi per voce, stima costo **o** "non disponibile" (mai un numero
  inventato), warning non bloccanti, blocchi (token, profilo, job in corso, lista archiviata). Il momento
  di massima ansia è il clic "Avvia": tutto ciò che può fallire per configurazione deve fallire **prima**,
  gratis.
- **Esito a tre toni**: successo (con conteggi), **zero neutro** (nessun post/nessuna persona: non è un
  errore, niente rosso), **warning** (0 letti con dichiarati > 0: probabile actor rotto, dati protetti).
  Il rosso è solo per `failed` con messaggio attribuito (actor, config, processo).
- **Aggiorna solo l'elenco dei post** come azione economica separata (raccomandata): trasforma la stima
  del primo sync da "massimo teorico" a numero reale. Costo: un `if` nel job; beneficio: fiducia al
  primo clic pagato. Se scartata, resta il testo del massimo teorico.
- **Creazione lista inline nel `ListPicker`** (Aggiungi a lista, Sourcing, Analizza→Aggiungi). Rimuove il
  vicolo cieco "seleziono 30 → non ho liste → perdo la selezione".
- **Scarta senza conferma, reversibile** (toggle "Mostra scartati" + "Ripristina"). Una conferma su 100
  clic al giorno è attrito puro; la reversibilità sostituisce la conferma. Nessun toast "Annulla" (YAGNI:
  richiederebbe memorizzare gli stati precedenti eterogenei).
- **Selezione per id, "seleziona i visibili" e poi "tutti i filtrati" (cap 500)**. Con 288 righe
  paginate 50, il triage per pagina è insostenibile; il cap protegge da bulk accidentali su migliaia.
- **Stato globale per persona, visibile e spiegato** (nota in header quando ≥2 liste; chip lista sulle
  attività). È la conseguenza di D4/D5 e va detta, non nascosta.
- **Testo del touchpoint facoltativo; "nuovo stato" mai automatico ma suggerito** (P8/D6): la
  suggestione contestuale abbassa i clic senza togliere il controllo.
- **Analisi singola sincrona con arricchimento inline** ("Arricchisci e analizza" = una chiamata):
  evita che l'azione più frequente sul dettaglio collida con il "un solo job alla volta".
- **Fit sempre etichettato con l'ICP** in Inbox (dove più ICP convivono); nella Lista è implicito.
- **Export: "solo con email" ON, `markContacted` OFF**, con il workflow raccomandato nel testo: filtra
  `da_contattare` → esporta con "segna contattato" → la prossima volta i già inviati non ricompaiono.
  Evita un filtro "già esportato" (YAGNI).
- **Nessun per-row "Analizza"/"Arricchisci" in tabella**: bulk (anche di 1) + dettaglio coprono il caso;
  meno icone per riga = tabella leggibile a 100+ righe.
- **Rinviato (YAGNI):** undo toast; scorciatoie tastiera j/k; lazy-load infinito; drag&drop tra liste;
  merge **manuale** di prospect duplicati (quella automatica per chiavi c'è, steering 2026-09-16); suggerimento automatico di lista dal
  fit; per-post retry se il tooltip basta.

## Accessibilità

UI operativa (non vetrina), stessa asticella del flow precedente del repo:

- **Dialog** (Radix `ui/dialog`): focus trap, `Escape` chiude, focus iniziale sul primo controllo utile
  (radio lista / campo URL), **restore focus** sul bottone che l'ha aperto; titolo via `aria-labelledby`;
  il blocco/errore della preview è in un `role="alert"`.
- **JobBanner**: `role="status"` (`aria-live="polite"`) per in-corso ed esiti; il testo dell'esito è
  leggibile senza colore (prefisso "Completato/Attenzione/Errore").
- **Contatore selezione** ("N selezionati") in live region; checkbox di riga con `aria-label`
  *"Seleziona <nome>"*; "Seleziona i visibili" è un checkbox di header con stato indeterminato.
- **Stati e fit**: `StatusBadge`/fit badge con **testo** sempre presente (mai solo colore); ✉ con testo
  alternativo "con email / senza email"; icone fonte con `aria-label` ("reazione", "commento",
  "dipendente") e tooltip anche da tastiera (focus).
- **Form**: errori inline associati via `aria-describedby`; `aria-invalid` sul campo; Invio invia il
  form; nel campo chip (ruoli) Invio aggiunge il chip e non invia il form (dichiararlo con hint).
- **Bottoni asincroni**: `aria-busy` durante analisi/arricchimento singoli; testo che cambia
  ("Analisi in corso…"), non solo spinner.
- **Timeline**: lista semantica (`<ol>`), ogni voce con data leggibile e `datetime`; "espandi testo"
  come bottone con `aria-expanded`.
- **Copia negli appunti**: bottone con `aria-label` *"Copia angolo 1"* e conferma in live region.
- **Ordine di tab** nelle tabelle: checkbox → nome (link) → azioni; le azioni di riga non sono
  hover-only (invariante ereditato: mai `opacity-0` su controlli attivi).

## Open questions

> Stato al 2026-09-16: le OQ-1…5 e OQ-8 sono **risolte nel PLAN** (rev. 2) e restano qui solo come traccia
> della decisione; OQ-6 e OQ-7 restano aperte ma non bloccanti.

- **OQ-1 — Regola di ri-sync dei post recenti.** ✅ Risolta (PLAN P6/T8): un post già sincronizzato si
  rilegge solo con `force`, oppure se `last_synced_at` è più vecchio di `SYNC_COOLDOWN_DAYS` (default 7)
  **e** il post è entro `POST_RECENCY_DAYS` (default 90); oltre 90 mai, salvo `force`. La preview dichiara
  i post "da sincronizzare" vs "saltati (recenti)". Il testo di B.2 è quindi definitivo.
- **OQ-2 — "Aggiorna solo l'elenco dei post"** (`postsOnly`). ✅ Risolta: sì, parametro di T8, proposto al
  primo sync quando la stima non è disponibile.
- **OQ-3 — Prezzo per profilo dell'arricchimento.** ✅ Risolta: costante `PRICE_PROFILE_DETAIL_USD` in
  config (T3), `null` finché non valorizzata → la preview mostra "stima non disponibile" (T10).
- **OQ-4 — Cancellazione di un'attività.** ✅ Risolta: `DELETE /api/activities/:id` limitato a
  `touchpoint|note` (T5), azione "Elimina" nella timeline (T16).
- **OQ-5 — Archiviazione liste.** ✅ Risolta: `PATCH /api/lists/:id {archived_at}`; archiviata = nascosta
  + job rifiutati come `blocker`; nessun effetto su membri/stati (T5).
- **OQ-6 — Default "Solo con email" ON nell'export**: coerente con D7 (email tool); se Omar esporta anche
  per DM LinkedIn, valutare un toggle "Destinazione: email tool / altro" che imposta il default. Aperta,
  non bloccante (default ON in T15).
- **OQ-7 — Retry per-post nel sync** (B.4 "Riprova questo post"): in v1 solo tooltip; il retry naturale
  è il prossimo sync (post non marcato). Aperta, non bloccante.
- **OQ-8 — Progresso del job bulk** ("12/22"). ✅ Risolta: non in v1; il banner mostra kind + durata
  (PLAN §5 fuori scope, §15).
