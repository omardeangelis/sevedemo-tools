---
domain: prospect-crm
type: flow
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC|SPEC]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/people-first-crm/FLOW|people-first-crm FLOW]]"
  - "[[specs/prospect-crm/apollo-lookalike/FLOW|apollo-lookalike FLOW]]"
  - "[[chore/roadmap-apollo-icp-assistant-profilo|roadmap Apollo · assistente ICP · anagrafica]]"
created: 2026-09-20
updated: 2026-10-03
---

# Flow: Profilo e servizi dalle fonti pubbliche (`own-profile-services`)

> Contratto di flusso per [[specs/prospect-crm/own-profile-services/SPEC|SPEC]] (criteri A1…H8, citati tra
> parentesi). Descrive **comportamento osservabile, stati e testi**, non implementazione. **Estende**
> [[specs/prospect-crm/people-first-crm/FLOW|people-first-crm]] (sezione Impostazioni in tre pagine,
> Connessioni, run e log, promemoria di Oggi, `JobBanner` con **Riprova…**) e
> [[specs/prospect-crm/apollo-lookalike/FLOW|apollo-lookalike]] (`JobPreviewDialog`, crediti dichiarati anche
> senza prezzo, esito a tre toni): quanto è già stabilito lì vale qui e non si ripete, se non dove cambia.
> **[→ PLAN]** = vincolo per il piano. I valori numerici degli esempi (10 pagine, 12 post, importi) sono
> illustrativi: quelli veri arrivano dalle Open Questions della SPEC.
> H1, H2 e H7 (emendamenti al contract del dominio, alla guida di progetto e al significato del derivato
> `stale`) e H8 sono lavoro di documentazione: non hanno superficie utente propria e non compaiono qui, se non
> attraverso i criteri che li causano (F7, F13). Tutti i testi qui scritti sono quelli che l'utente legge, in
> **italiano** (E13, G8).
>
> **Revisione 2026-10-03 — revisione della proposta** (mandato dell'utente dopo la prima generazione reale,
> [[specs/prospect-crm/own-profile-services/UX-REVIEW|UX-REVIEW]] round 2026-10-03). Riscritte: Goal (segnale 1, 2
> e 6), Entry points (`#proposta`, JobBanner), architettura della pagina (riga 2), A.5–A.7, C, E.1, E.2 (+ E.2b),
> le righe della proposta in Error paths, Edge cases, Friction notes, Accessibilità e Testi, OQ-5/OQ-6 nelle
> Decisioni chiuse, e una sezione nuova di Open questions. Il modello nuovo in una riga: **ogni voce si decide
> da sola — Applica, Modifica o Rifiuta —, ogni decisione si annulla dalla sua riga, e la proposta si chiude da sé
> quando non resta niente da decidere.** Integra i findings 1, 2, 3, 4, 5, 6, 11, 17, 19, 20, 21 del round
> 2026-10-02 (decisioni dell'utente dello stesso giorno).

## Goal

Avere **in un posto solo chi sono e cosa vendo** — profilo, azienda estesa e servizi — ricavato dalle mie
superfici pubbliche (profilo LinkedIn, sito, miei post) e **applicato solo dove decido io**,
così che l'analisi delle persone sappia dire **quale dei miei servizi c'entra** con quella persona.

**Segnale di successo** (verifica con `agent-browser` sul server e2e con job finti): (1) da profilo vuoto, una
generazione, un **Rifiuta** sulla voce che non mi va e un **Applica le N voci rimaste** riempiono profilo e servizi
senza scrivere a mano nemmeno un campo, e la proposta si chiude da sé;
(2) alla seconda generazione, su un profilo che ho corretto a mano, le voci da decidere stanno in cima, **l'azione
di massa non tocca** nessuna parola scritta da me e un conflitto si chiude anche tenendo il mio testo; (3) da `/settings/profile` leggo quali fonti sono
state lette e quali no, con il motivo, e quanti post sono stati letti per intero, **senza aprire il log di un
run**; (4) nessuna spesa parte senza anteprima, ed escludere una fonte cambia conteggi e stima sotto i miei
occhi; (5) la scheda di una persona nomina un servizio, e un servizio eliminato resta leggibile senza errori;
(6) *(revisione 2026-10-03)* in ogni momento la testata della proposta dice quante voci ho deciso e quante ne
restano, ogni riga decisa dice in parole cosa è successo (applicata, con le mie modifiche, rifiutata) e si annulla
dalla sua riga, e dopo un ricarico il conto è ancora quello.

## Personas

- **Omar (unico utente; founder/consulente + sviluppatore del tool).** Stessa persona dei FLOW precedenti:
  *esperto* del dominio, desktop, lavora da solo in locale, vuole controllo e densità, non tutorial. Qui
  attraversa **due momenti con bisogni opposti**:
  - **Primo giro, profilo vuoto** (*fretta, fastidio per la compilazione*): "so cosa vendo, non voglio
    riscriverlo in sette caselle". Vuole un bottone, una proposta e un'applicazione in blocco; accetta di
    correggere dopo. JTBD: *"Voglio che il CRM legga quello che ho già pubblicato e lo trasformi in un profilo,
    invece di farmi compilare un modulo."*
  - **Giri successivi, profilo già curato** (*protettivo verso le proprie parole + ansia da costo*): ha
    riscritto posizionamento e servizi a mano e teme che una rigenerazione gli sovrascriva il lavoro o gli
    riproponga le stesse cose. JTBD: *"Voglio vedere solo cosa cambierebbe, decidere voce per voce, e sapere
    prima quanto costa."*
  - **Conseguenze di design:** proposta sempre e mai sovrascrittura; voci invariate nascoste con il conteggio;
    conflitti in cima e fuori dalle azioni di massa; ogni voce si può rifiutare, e un conflitto si chiude anche
    tenendo il proprio testo (revisione 2026-10-03); costo per fonte prima dell'avvio; esito per fonte scritto
    nella pagina, non solo nel log.
  > Persona non definita in `brain/domains/prospect-crm/`: caratterizzazione derivata dalla SPEC (Context,
  > "Per chi") e dai FLOW precedenti; è l'assunzione su cui si progetta.

---

## Entry points

Nessuna precondizione di ruolo (single-user, no-auth). Route deep-linkabili; le ancore già esistenti
continuano a funzionare (G2). **Nessun link apre da solo un dialog che spende**: le ancore portano al bottone.

| Entry | Route | Precondizioni / comportamento |
|---|---|---|
| **Profilo e azienda** | `/settings/profile` | Sezione esistente, estesa (G1). Ancore: `#profilo` (focus sul campo del profilo LinkedIn, come oggi) · `#azienda` (focus su "Di cosa si occupa", come oggi) · **`#genera`** (focus sul bottone della generazione) · **`#servizi`** · **`#proposta`** (presente solo con una proposta **aperta**, cioè con almeno una voce da decidere; *rev. 2026-10-03:* l'ancora mette il **focus sul titolo** della sezione, come `#genera` fa col bottone; senza proposta aperta l'ancora non trova nulla e la pagina resta in cima con la card della generazione che dice *"Nessuna proposta in attesa."*). |
| `/settings` | → `/settings/profile` | Redirect esistente, conserva l'ancora (A5 di `people-first-crm`). |
| **Genera profilo e servizi** | dialog dalla card `#genera` | Anteprima `JobPreviewDialog`. Il bottone è **sempre attivo** anche con blocker (la card ne anticipa il motivo in una riga, il dialog lo scrive e disabilita **Avvia**: G3, G4, convenzione di `apollo-lookalike`). |
| **Promemoria di Oggi** | `/` → `/settings/profile#genera` | Voce *"genera profilo e servizi"* nell'elenco "Da completare", solo se il profilo non è **mai** stato generato **e** non esiste nessun servizio (G6). |
| **Connessioni** | `/settings/connections` | Quarta card **Cloudflare** accanto ad Apify, Apollo e Anthropic (A3, H2). |
| **Strumento Cloudflare** | `/settings/connections/cloudflare?outcome=failed&page` | `$tool` accetta il nuovo valore; i run della generazione compaiono qui e negli strumenti delle **fonti scelte** (A6). **[→ PLAN: `$tool` valida oggi tre id: `cloudflare` non validato ⇒ "Strumento non trovato".]** |
| **Run della generazione** | `/settings/connections/runs/$runId` | Parametri (fonti scelte, senza segreti: A7), esito per fonte, log riga per riga (D10, D11). |
| **Scheda persona** | `/people/$id` → card "Fit e analisi AI" | Riga **Servizio più affine** quando l'analisi l'ha prodotta (F2–F5, F9). |
| **JobBanner** | sidebar, ogni pagina | Nuovo kind **"Genera profilo e servizi"**; link d'esito **Rivedi la proposta** (*rev. 2026-10-03:* solo finché **quella** proposta è aperta; chiusa, sostituita o "Nessuna novità" ⇒ il link non c'è) e **Dettagli del run**; **Riprova…** sui falliti con gli stessi parametri (D12). |

### Architettura della pagina `/settings/profile`

Dall'alto, una colonna sola per ciò che si legge in orizzontale (A3 di questo elenco è l'unica novità
strutturale rispetto a oggi):

```
Impostazioni › Profilo e azienda
1. Card  «Genera profilo e servizi»            #genera     ← stato, costo anticipato, CTA
2. Sezione «Proposta del 20 set»               #proposta   ← solo se aperta (e come riepilogo finché resti sulla
                                                              pagina dopo l'ultima decisione); sopra i campi che cambia
3. Card  «I tuoi indirizzi pubblici»           #profilo    ← profilo LinkedIn + sito (input, mai proposti)
4. Card  «La mia azienda»                      #azienda    ← solo campi generabili
5. Card  «I miei servizi»                      #servizi    ← tabella ordinata, CRUD a mano
```

Perché così: **una pagina sola** tiene chi sono, cosa vendo e da dove viene ciascun valore (B1, B7: una sola
lettura porta profilo, servizi, provenienza e data dell'ultima generazione); la proposta è la decisione pendente
e sta **sopra** i campi che modificherebbe; i due indirizzi
(input della generazione, **mai** proposti: E2) stanno in una card a sé, così "cosa il CRM legge" e "cosa il
CRM può proporre" sono separati a vista. Le card 3 e 4 non stanno più affiancate: i campi nuovi sono testi
lunghi. **[→ PLAN: oggi `/settings/profile` è una griglia a due colonne con due card; il titolo della card
`#profilo` cambia, l'`id` del campo e l'ancora no.]**

---

## Happy path

### A. Primo giro: profilo vuoto → una generazione → un rifiuto e "Applica le N voci rimaste" (B5, D1–D5, E1, E8, G5, G6)

Il 20 set Omar apre il CRM: profilo LinkedIn salvato, azienda con nome e due righe scritte mesi fa, nessun
servizio, nessuna generazione.

1. In **Oggi**, promemoria *"Da completare: descrizione della tua azienda · genera profilo e servizi · un ICP"*
   → clic su **genera profilo e servizi** → `/settings/profile#genera`, focus sul bottone.
2. Card **"Genera profilo e servizi"**: riga di stato *"Mai generato."* e testo *"Il CRM legge le tue superfici
   pubbliche — profilo LinkedIn, sito e i tuoi post — e ti propone chi
   sei, cosa vendi e i tuoi servizi. Niente viene scritto finché non applichi tu."* CTA **"Genera profilo e
   servizi…"** (i puntini = apre l'anteprima, non spende). Sotto, la riga che anticipa lo stato delle fonti:
   *"Pronte 2 fonti su 3: profilo LinkedIn · i miei post. Sito non impostato."*
3. **"Genera profilo e servizi…"** → anteprima (percorso B) → **Avvia** → il banner mostra *"In corso: Genera
   profilo e servizi"* con **Dettagli del run**; la pagina resta usabile.

> **Revisione 2026-10-03** (passi 4–7): la proposta si decide voce per voce con tre verbi (Applica · Modifica ·
> Rifiuta), ogni decisione si annulla dalla riga, l'avanzamento è sempre scritto, la proposta si chiude da sé.

4. Fine job: toast e banner **Completato** — *"Proposta pronta: 11 voci da decidere · fonti lette 2 su 3 · 12
   post per intero (30 solo estratto, non usati)."* Il numero conta le **differenze** dal profilo di oggi, non le
   voci prodotte dal modello (finding 2 del 2026-10-02). Link: **Rivedi la proposta** · **Dettagli del run**.
5. **Rivedi la proposta** → `/settings/profile#proposta`, **focus sul titolo** della sezione (mai sul link del
   banner). Testata, dall'alto:
   - titolo *"Proposta del 20 set, 10:12"*; sotto *"Da 2 fonti su 3."* (con *"· 1 voce lasciata fuori perché senza
     fonte"* quando c'è, E6: mai la parola "scartata", che sembrerebbe una tua decisione);
   - **avanzamento**: *"Decise 0 di 11"* con una barra sottile accanto (decorativa: il dato è nel testo);
   - la riga di E14, **solo** se ci sono campi compilati senza provenienza ancora da decidere, e li **nomina**
     (finding 5): *"Nome e Di cosa si occupa sono compilati da prima del 20 set: «Applica tutte le 11 voci» li
     sostituisce. Il testo attuale è nella loro riga."*; su un profilo davvero vuoto, al suo posto, *"Non hai
     scritto nulla a mano in questi campi: puoi applicare tutto e correggere dopo."*;
   - una riga di azioni (finding 21): **Applica tutte le 11 voci** — l'unico bottone primario della sezione — ·
     **Rifiuta le 11 voci da decidere…**;
   - una frase sola che spiega il modello: *"Decidi voce per voce: Applica, Modifica o Rifiuta. Ogni decisione si
     annulla dalla sua riga; la proposta si chiude quando non resta niente da decidere."*
6. **Le righe** (dettaglio nel percorso C): nome del campo, stato in testo, fonti; poi il testo **proposto** —
   per un campo vuoto non si scrive *"Ora: vuoto"* (finding 20) —; poi tre azioni, sempre nello stesso ordine:
   **Applica** · **Modifica** · **Rifiuta**, nessuna più forte delle altre.
   La proposta dice *"Nome: Omar De Angelis"*: è il nome della persona, non quello dell'attività. **Rifiuta** →
   la riga si chiude **dove sta**, in una riga sola, *"Nome — rifiutato: resta «Officina Codice»"* con
   **Annulla**; il focus va al titolo della voce **successiva**; la live region dice *"Rifiutato: Nome. Restano 10
   voci da decidere."*; l'avanzamento diventa *"Decise 1 di 11 · ne restano 10"* e il bottone di massa
   *"Applica le 10 voci rimaste"*. Nessun toast per una decisione singola: la riga cambia sotto gli occhi.
7. **Applica le 10 voci rimaste** → le righe si chiudono **al loro posto** (*"Tono di voce — applicato"*,
   *"Di cosa si occupa — applicato · prima: «Sviluppo software su misura…»"*); toast *"Applicate 10 voci: 5 campi
   e 5 servizi."* (finding 19). Non resta niente da decidere, quindi **la proposta si chiude da sé**: la testata
   diventa il **riepilogo** — *"Proposta del 20 set, 10:12 · chiusa"*, *"Hai deciso tutte le 11 voci: 10 applicate
   · 1 rifiutata."*, link **Vedi il profilo aggiornato** (→ `#azienda`, focus sul titolo della card) —; il focus
   va al titolo del riepilogo e la live region dice *"Proposta chiusa: hai deciso tutte le voci."* Le righe
   decise restano visibili, ognuna con **Annulla**, **finché resti sulla pagina**; a un nuovo caricamento la
   sezione non c'è più e la card della generazione lo dice al passato (E.1).
   La card **La mia azienda** mostra i valori con il marcatore *"dalla proposta del 20 set"* sotto ogni campo
   (B6); *Nome* resta *"Officina Codice"* senza provenienza (E14); i 5 servizi sono in **I miei servizi**
   nell'ordine in cui la proposta li ha elencati (B4, riordinabile).
→ **Outcome:** profilo e servizi compilati senza scrivere niente e senza accettare ciò che non va; la proposta non
resta "in attesa" per una voce rifiutata; la card della generazione dice *"Ultima generazione: 20 set, 10:12 ·
fonti lette: profilo LinkedIn, i miei post"* (G5); la voce *"genera profilo e servizi"* sparisce da Oggi (G6); le
analisi già fatte restano esattamente come sono — nessun badge, nessun invito a rifarle (F7, percorso F).

### B. L'anteprima con tre fonti: costo per fonte, esclusioni, blocchi (D2–D9, C4, C5, C11, A4)

1. Dialog **"Genera profilo e servizi"**, sottotitolo *"Legge le fonti che scegli e le fa elaborare una volta
   sola. Controlla fonti e costo prima di avviare."*
2. **Fonti da leggere** — le tre superfici pubbliche (C1), con in testa la riga *"Si legge solo ciò che è
   pubblico: nessun login, nessun cookie."* (C2, C3). `fieldset` con una spunta per fonte **disponibile**, tutte
   accese, ciascuna con il suo costo in chiaro (D3, D4, D9):
   - ☑ **Profilo LinkedIn** — *"linkedin.com/in/omar-deangelis · 1 lettura con Apify (≈ $0,01)"*; se letto di
     recente: *"già letto il 18 set: entro la finestra di freschezza non si ripaga"* e la spunta è spenta con
     accanto **"Rileggilo comunque"** (C4; vedi OQ-1).
   - ☑ **Sito** — *"officinacodice.it · fino a 10 pagine con Cloudflare (nessun costo in denaro: è una delle 5
     letture al giorno del piano gratuito)"* e, sotto, *"Dalla pagina iniziale seguendo i link del sito, fino a 10
     pagine."* (C5; nessun filtro sui percorsi: la verifica reale di A8 ha letto 7 pagine su 7).
   - ☑ **I miei post** — *"12 post con testo integrale (30 hanno solo l'estratto: non entrano)"* (C8); nessun
     costo.
   - Riga non escludibile, sempre ultima: **Elaborazione AI (Anthropic)** — *"Una elaborazione delle fonti
     lette · Modello: <ANALYSIS_MODEL>"*.
3. **Non disponibili (2)** — elenco quieto sotto le spunte, senza checkbox (non c'è niente da decidere), una riga
   per fonte con il motivo e dove si risolve (D8): *"Sito — nessun sito impostato. Aggiungilo in «I tuoi
   indirizzi pubblici»."* · *"Sito — CLOUDFLARE_API_TOKEN mancante nel .env. Vai a Connessioni."* (A4) ·
   *"Sito — l'indirizzo salvato non è un sito. Correggilo in «I tuoi indirizzi pubblici»."* (C11) · *"Profilo LinkedIn — APIFY_TOKEN
   mancante nel .env."* · *"I miei post — nessun post con testo integrale: i post sincronizzati prima di oggi
   hanno solo l'estratto. Sincronizza di nuovo per conservarlo."* (C7, C9). **Ogni avviso del server compare
   una volta sola:** quelli che nominano una fonte stanno in questa riga, gli altri nel riquadro giallo
   standard. **[→ PLAN: `JobPreviewDialog` mostra `warnings` in blocco; questo kind li instrada per fonte.]**
4. **Anteprima** (riassunto al posto dei conteggi grezzi): *"Fonti da leggere: 3 su 3 · Pagine del sito: fino a
   10 · Post con testo integrale: 12"*. Poi la riga standard **Costo stimato**:
   *"≈ $0,06 = profilo LinkedIn ≈ $0,01 + elaborazione ≈ $0,05"*; se un pezzo non ha prezzo
   configurato → **"stima non disponibile"** con le unità che restano vere: *"stima non disponibile — 1 lettura
   del profilo e 1 elaborazione; imposta PRICE_PROFILE_GENERATION_USD nel .env per vedere il costo"* (D5, mai un
   numero inventato).
5. **Escludere una fonte** (D9): togliere la spunta a *Profilo LinkedIn* → l'anteprima diventa *"Fonti da
   leggere: 2 su 3"* e il costo *"≈ $0,05"*; una live region annuncia *"Anteprima
   aggiornata: 2 fonti, costo stimato ≈ $0,05."*
6. **Avvisi gialli** (non di fonte): *"C'è una proposta del 18 set con 3 voci ancora da decidere: una nuova
   generazione la sostituisce. Le voci già applicate restano; quelle rifiutate possono essere riproposte."* (D8,
   E11; *rev. 2026-10-03*: compare solo con una proposta **aperta** — una proposta tutta decisa non è "in attesa" —
   e dice quante voci restano; per la seconda frase vedi OQ-R1).
7. **Blocchi** (rosso, **Avvia** disabilitato): *"ANTHROPIC_API_KEY mancante nel .env: senza l'elaborazione la
   generazione non può partire. Vai a Connessioni."* (D6) · *"Nessuna fonte disponibile: imposta il profilo
   LinkedIn o il sito, oppure sincronizza i tuoi post."* (D7) · *"Hai escluso tutte le fonti: scegline almeno
   una."* · *"C'è già un job in corso: Analisi, 2 min fa."* (D1).
→ **Outcome:** l'avvio è una decisione presa su poche righe leggibili, non su un modulo; il costo è per fonte
e la stima non è mai inventata.

### C. Giri successivi: la proposta su un profilo curato a mano (E3–E14, H5)

> **Revisione 2026-10-03** — riscritto da capo. Ogni voce da decidere ha **tre verbi** (accetta · modifica ·
> rifiuta, sempre in quest'ordine); una voce decisa diventa una riga sola che dice cosa è successo e ha **Annulla**;
> la testata porta l'avanzamento; le azioni di massa sono due, **Applica le N voci senza conflitto** (E8) e
> **Rifiuta le N voci da decidere…** (E12, al posto di "Scarta la proposta…"); la proposta si chiude da sé.
> Superati: "Applicato ora", il toggle globale degli invariati, *"Una voce che non applichi resta qui finché non la
> scarti…"*, OQ-5 ("Tieni il mio" rinviato).

Il 4 ott, dopo aver riscritto posizionamento e due servizi a mano, Omar rigenera. Nell'esempio la proposta ha
**6 voci da decidere** — campi: *Posizionamento* (in conflitto), *Tono di voce* (nuovo), *Cosa offri* (modificato);
servizi: *Fractional CTO* (in conflitto), *Assessment architetturale in 2 settimane* (nuovo), *Sviluppo a progetto*
(modificato) — e **4 invariate** (*Nome*, *Di cosa si occupa*, *Prove e risultati*, il servizio *Formazione*).

1. La card **Genera profilo e servizi** lo avvisa **prima di spendere**: *"4 campi su 7 e 2 servizi li hai
   scritti a mano: una nuova proposta li mostra come conflitti e non li sovrascrive."* (H5). Stessa frase nel
   sottotitolo del dialog.
2. **Testata.** Esito → **Rivedi la proposta** (focus sul titolo). *"Proposta del 4 ott, 09:40"* · *"Da 3 fonti su
   3 · 1 voce lasciata fuori perché senza fonte."* (E5, E6) · avanzamento *"Decise 0 di 6 · 2 in conflitto"*.
   Azioni, su una riga: **Applica le 4 voci senza conflitto** (primario) · **Rifiuta le 6 voci da decidere…**;
   sotto il primo, legato con `aria-describedby`, *"I 2 conflitti restano fuori: decidili uno per uno."* (E8). La
   riga di E14 compare solo per i campi senza provenienza **ancora da decidere** e li nomina (finding 5; qui non c'è).
   Le azioni di massa ci sono solo con **almeno 2** voci da decidere: con una sola bastano i bottoni della sua riga,
   e l'avanzamento dice *"Resta 1 voce da decidere"*.
3. **Due gruppi**, mai una lista sola: **Campi del profilo · 3 da decidere · 3 invariati** e **Servizi · 3 da
   decidere · 1 invariato** (il conteggio cambia con le decisioni: *"· 1 deciso"*). Dentro ogni gruppo: le voci da
   decidere (**In conflitto → Nuovo → Modificato**: prima ciò che chiede un giudizio), poi le voci già decise (una
   riga ciascuna), poi la riga degli invariati.
4. **Riga di un campo da decidere** (E3, E4, E5): intestazione = nome del campo · stato in **testo** · fonti; poi i
   testi; poi le tre azioni. Nessuna azione di riga è primaria: il solo primario della sezione è l'azione di massa.
   - Nuovo: *"**Tono di voce** · Nuovo · da: sito, i miei post"* → solo **Proposta** (niente *"Ora: vuoto"*) →
     **Applica** · **Modifica** · **Rifiuta**.
   - Modificato: *"**Cosa offri** · Modificato · da: sito"* → **Ora** e **Proposta** uno sopra l'altro (i testi
     sono paragrafi: affiancarli li spezza), la proposta con un bordo a sinistra → **Applica** · **Modifica** ·
     **Rifiuta**. Se il valore di oggi è senza provenienza (E14) lo stato lo dice: *"Modificato · compilato da prima
     del 2 ott: l'azione di massa lo sostituisce"*.
   - In conflitto: *"**Posizionamento** · In conflitto con ciò che hai scritto a mano · scritto da te il 28 set ·
     da: sito, profilo LinkedIn"* → **Ora** e **Proposta** → **Sostituisci il tuo testo** · **Modifica** · **Tieni
     il tuo testo**; sotto, *"Fuori dalle azioni di massa."* (E9). Tenere il proprio testo è una decisione come le
     altre, non un'attesa: la voce si chiude.
5. **Riga di un servizio da decidere** (E4, E7; il nome è la chiave del confronto, B10):
   - Nuovo: *"**Assessment architetturale in 2 settimane** · Nuovo · da: sito, i miei post"* con i campi proposti
     (Descrizione · A chi serve · Problema · Prove) → **Aggiungi il servizio** · **Modifica…** · **Rifiuta**; hint
     *"Si aggiunge in fondo a «I miei servizi»: l'ordine lo decidi tu."* (B4).
   - Modificato: *"**Sviluppo a progetto** · Modificato · da: sito"* e una sintesi al posto di *"2 campi su 4"*:
     *"Cambiano descrizione e a chi serve · invariati: nome, problema, prove."* Per ogni campo che cambia **Ora** →
     **Proposta**; un campo oggi vuoto mostra solo *"Si aggiunge: …"* (finding 20). In coda *"I campi che la
     proposta non nomina restano come sono."* (E7) → **Aggiorna il servizio** · **Modifica…** · **Rifiuta**.
   - In conflitto: *"**Fractional CTO** · In conflitto · scritto da te il 28 set"*, con una sintesi che separa ciò
     che si aggiunge da ciò che si perde: *"Riempie 3 campi vuoti · cambia «A chi serve», scritto da te."* →
     **Sostituisci con la proposta** · **Modifica…** · **Tieni il tuo servizio**; sotto, *"Fuori dalle azioni di
     massa."* (E8, E9).
6. **Modifica prima di applicare.**
   - **Campo — in riga, senza dialog.** Il blocco **Proposta** diventa una casella di testo etichettata *"Il tuo
     testo per «Cosa offri»"*, già compilata con la proposta e con il focus dentro; **Ora** resta visibile sopra (si
     legge e si copia). Sotto, legato in `aria-describedby`: *"Si salva come scritto da te: la prossima generazione
     lo mostrerà come conflitto invece di sovrascriverlo."* Bottoni: **Applica il tuo testo** · **Annulla** (torna
     alla riga com'era, focus su **Modifica**). Applicato → la voce si chiude come *"applicato con le tue modifiche"*
     e il campo prende la provenienza *"scritto da te il 4 ott"* (H5). Un testo identico alla proposta vale come
     **Applica** (provenienza "dalla proposta").
   - **Servizio — nel dialog dei servizi** (lo stesso di D.2), già compilato: per un nuovo, nome e campi proposti;
     per uno esistente, i tuoi valori con sopra i campi proposti (le Note restano le tue). Titolo *"Modifica prima di
     aggiungere"* / *"Modifica prima di aggiornare «Fractional CTO»"*; bottone **Aggiungi il servizio** / **Aggiorna
     il servizio**. Salvato → *"applicato con le tue modifiche"*, provenienza *"scritto da te"*. Chiuso senza
     salvare → focus su **Modifica…**. È anche il modo di tenere il tuo *"A chi serve"* e prendere il resto.
7. **Righe decise** — una riga, lo stato e la conseguenza **in parole** (le icone ✓ ✕ sono decorative), **Annulla**
   a destra:
   - *"**Tono di voce** — applicato"* + il testo applicato su una riga (si apre per intero);
   - *"**Cosa offri** — applicato · prima: «Assessment tecnico di due settimane…»"*: il testo sostituito resta
     **visibile e selezionabile** finché la proposta è aperta, anche dopo un ricarico (decisione 4 del 2026-10-02,
     resa persistente);
   - *"**Cosa offri** — applicato con le tue modifiche · prima: «…»"*;
   - *"**Posizionamento** — hai tenuto il tuo testo"* · *"**Tono di voce** — rifiutato: il campo resta vuoto"* ·
     *"**Nome** — rifiutato: resta «Officina Codice»"*;
   - *"**Assessment architetturale in 2 settimane** — aggiunto in fondo a «I miei servizi»"* · *"**Sviluppo a
     progetto** — aggiornato: descrizione, a chi serve"* · *"**Fractional CTO** — hai tenuto il tuo servizio
     com'è"* · *"**Formazione** — rifiutato: non è stato aggiunto"*.
   **Annulla** riporta la voce **da decidere, al suo posto**, ricalcolata adesso (P-12). Se era applicata torna il
   valore di prima **con la sua provenienza** (*"scritto da te il 28 set"*), un servizio aggiunto si toglie, uno
   aggiornato riprende i campi di prima. Focus sul titolo della voce riaperta; live region *"Di nuovo da decidere:
   Cosa offri."* Durante la visita una voce decisa **resta dove era** (niente salti sotto il cursore); a un nuovo
   caricamento le decise stanno dopo le voci da decidere del loro gruppo.
8. **Invariati** — in fondo a ogni gruppo una riga sola: *"Invariati (3): Nome, Di cosa si occupa, Prove e
   risultati"* + **Mostra** (`aria-expanded`). Aperti, ogni voce è una riga *"**Nome** · uguale al tuo: «Officina
   Codice»"* (un testo solo, non due copie identiche: finding 20), senza azioni. Un gruppo con soli invariati mostra
   solo questa riga, mai un riquadro vuoto. Una voce che diventa invariata perché l'hai scritta a mano uguale alla
   proposta passa qui ed esce dal conto delle voci da decidere.
9. **Applica le 4 voci senza conflitto** → le 4 righe si chiudono al loro posto; toast *"Applicate 4 voci: 2
   campi e 2 servizi. Restano 2 conflitti."*; il focus va al **primo conflitto**; live region *"Applicate 4 voci.
   Restano 2 voci da decidere, 2 in conflitto."*; avanzamento *"Decise 4 di 6 · ne restano 2, 2 in conflitto"*.
   Se le voci da decidere sono **solo** conflitti, l'azione è disabilitata — l'etichetta perde il numero, *"Applica le
   voci senza conflitto"* — con il motivo accanto e in `aria-describedby`: *"Le 2 voci rimaste cambierebbero testi
   scritti da te: decidile una per una."* Una voce
   aperta in **Modifica** resta fuori dal conteggio e dall'azione: *"1 voce in modifica resta fuori."*
10. **Tieni il tuo testo** su *Posizionamento* → *"Posizionamento — hai tenuto il tuo testo"*; **Sostituisci con la
    proposta** su *Fractional CTO* → *"Fractional CTO — aggiornato · prima: A chi serve «Startup che hanno appena
    chiuso il seed.»"*. Non resta niente: la proposta **si chiude** e la testata diventa il riepilogo (come A.7):
    *"Hai deciso tutte le 6 voci: 5 applicate · 1 rifiutata. 4 erano già uguali al tuo profilo."*
11. **Rifiuta le 6 voci da decidere…** (E12: un'azione sull'intera proposta, con conferma perché è costata denaro,
    nessun valore toccato) → conferma *"Rifiutare le 6 voci da decidere?"* — *"Profilo e servizi restano come sono,
    compresi i 2 testi in conflitto. Le voci che hai già applicato non cambiano. Puoi annullare ogni rifiuto dalla
    sua riga finché resti su questa pagina; dopo, per riaverle serve una nuova generazione, con la sua spesa."*
    **Annulla** (focus) · **Rifiuta le 6 voci**. Toast *"Rifiutate 6 voci: non è stato scritto niente. La proposta è
    chiusa."*; focus sul titolo del riepilogo (*"Hai deciso tutte le 6 voci: 6 rifiutate."*). Con una voce sola il
    testo va al singolare: *"Rifiutare la voce da decidere?"* (finding 17).
→ **Outcome:** una rigenerazione su un profilo curato si legge dalla testata (quante, quali conflitti), ogni voce si
chiude con un gesto — anche un "no" — e nessuna parola scritta da Omar se ne va senza che lui lo decida e possa
annullarlo; ciò che è già giusto è contato e nominato, non ripetuto; la proposta non resta mai "in attesa" senza
niente da decidere.

> **[→ PLAN] Cosa chiede al server la revisione 2026-10-03** (comportamento, non implementazione):
> - **Le decisioni sono un dato della proposta**, salvato con lei (colonna additiva su `profile_proposals`, migrazione
>   idempotente senza ricostruzione): per ogni voce, la decisione (applicata · applicata con modifiche · rifiutata),
>   quando, lo stato che aveva in quel momento, il valore scritto e **il valore di prima con la sua provenienza**
>   (serve a *"prima: …"* e ad **Annulla**). Le voci senza decisione restano ricalcolate a ogni lettura (P-12).
> - **"Aperta" è derivata**: almeno una voce da decidere che non sia invariata. Nessuna colonna di stato; la riga non
>   si cancella più quando è tutta decisa (resta l'ultima proposta finché una nuova generazione non la sostituisce,
>   E11). `pending_proposal` = l'ultima, se aperta; il profilo porta anche l'esito dell'ultima chiusa (conteggi per
>   la frase al passato in E.1).
> - **Azioni sulla voce**: applica (com'è oggi, + un valore modificato ⇒ provenienza *scritto da te*); rifiuta (una
>   voce, oppure tutte quelle da decidere: è E12); annulla (rimette il valore di prima e la sua provenienza, toglie un
>   servizio aggiunto; rifiutato con un codice proprio se il campo o il servizio è cambiato dopo la decisione). Ogni
>   risposta restituisce la proposta ricalcolata, aperta o chiusa, con i conteggi della testata.
> - **Generazione**: l'esito conta le differenze (voci da decidere, conflitti); zero differenze ⇒ *"Nessuna novità"*,
>   tono neutro, nessun **Rivedi la proposta** e nessuna proposta aperta (E.2b). Le voci tolte dal sistema si dicono
>   "lasciate fuori".

### D. I servizi a mano, in qualsiasi momento (B2, B3, B4, B10, G7)

1. Card **I miei servizi** (`#servizi`): *"Cosa vendi, un servizio per riga. L'ordine lo decidi tu: l'analisi e
   (in futuro) l'assistente ICP li leggono così."* Tabella: **Ordine** (↑ ↓) · **Nome** · **A chi serve** ·
   **Problema** · **Provenienza** (*"scritto da te il 28 set"* / *"dalla proposta del 20 set"*, B6) · azioni
   **Modifica** · **Elimina**. Descrizione, prove e note si aprono con **Dettagli** sulla riga. Vuota:
   *"Nessun servizio. Aggiungine uno a mano, o generalo dalle tue fonti pubbliche."* + **Aggiungi servizio** ·
   **Genera profilo e servizi…**
2. **Aggiungi servizio** → dialog: **Nome** *(obbligatorio)* · A chi serve · Problema che risolve · Descrizione
   · Prove e risultati · Note. Hint: *"Basta il nome: il resto è facoltativo."* (B2) → **Salva servizio** →
   toast *"Servizio aggiunto: Fractional CTO"*, riga in fondo, focus sulla riga nuova.
3. **↑ ↓** riordinano subito (nessun salvataggio a parte): live region *"«Fractional CTO» è ora 2 di 5."*; il
   focus resta sul bottone premuto.
4. **Elimina** → conferma *"Eliminare il servizio «Assessment architetturale»?"* — *"Le analisi che lo citano
   restano come sono e continueranno a mostrare questo nome (F5). Nessuna analisi risulta da rifare: se ne
   vuoi una aggiornata la rifai tu (F7)."* **Annulla** (focus) · **Elimina servizio** → toast *"Servizio
   eliminato: Assessment architetturale."*
→ **Outcome:** i servizi vivono anche senza generazione (B3), e ogni modifica dichiara la conseguenza sulle
analisi prima di essere fatta — che oggi è: nessuna.

### E. Esito onesto e Cloudflare in Connessioni (C12–C14, D10–D14, A3–A9, G5)

> **Revisione 2026-10-03** (punti 1, 2, 2b): la tabella descrive **il run**, la frase d'esito segue la vita della
> proposta (aperta → chiusa, al passato), "Rivedi la proposta" vive solo finché la proposta è aperta, una generazione
> senza differenze non lascia niente in attesa (findings 1, 2 e 11 del 2026-10-02).

1. **Nella pagina, non nel log** (G5): la card della generazione tiene l'esito dell'**ultimo run** (non l'ultima
   lettura di ogni fonte) in una tabella **una riga per fonte** — *"Esito dell'ultima generazione per fonte"*:
   **Fonte · Esito · Dettaglio**
   - *"Profilo LinkedIn · letta · 20 set, 10:12"*, oppure, se ripresa senza rileggerla, *"Profilo LinkedIn ·
     ripresa · lettura del 18 set, senza costo"*
   - *"Sito · non letta · nessun sito impostato"* (C13, ogni "non letta" con il suo motivo; letto:
     *"Sito · letta · 7 pagine su 10"*); esclusa nell'anteprima: *"Sito · esclusa da te"*
   - *"I miei post · letta · 12 per intero, 30 solo estratto (non usati)"* (C8)
   e sotto: *"1 voce lasciata fuori perché senza fonte."* (E6) · *"Elaborazione: <modello>"*, oppure
   *"Elaborazione: non chiamata"* quando nessuna fonte ha prodotto contenuto (D14) · **Vedi il run** (per il log
   riga per riga) · **Genera di nuovo…**. Nella riga di stato in alto, *"fonti lette"* elenca solo le fonti lette o
   riprese **in quel run**.
   - **Con una proposta aperta** la tabella si chiude in una riga, *"Fonti: profilo LinkedIn letta · sito non
     letto · i miei post letti"* + **Esito per fonte** (`aria-expanded`), e la card dice *"Proposta in attesa: 4 voci
     da decidere."* con il link **Rivedi la proposta** (focus sul titolo della sezione): così la proposta comincia
     nella prima schermata invece che sotto la tabella (a 1280 × 900 oggi parte a ~700 px).
   - **Frase d'esito**, che segue la proposta: aperta → *"Proposta pronta: 6 voci da decidere, 2 in conflitto ·
     fonti lette 3 su 3 · 12 post per intero (30 solo estratto, non usati)."*; chiusa → al passato, *"Proposta del 4
     ott chiusa: 4 applicate · 1 con le tue modifiche · 1 rifiutata."*; sostituita da una generazione più recente →
     vale quella più recente; senza differenze → E.2b. Mai *"Proposta pronta"* accanto a *"Nessuna proposta in
     attesa."*
2. **Toast e banner** dicono le stesse cose in una riga (nessuna informazione vive solo nel log): *"Proposta
   pronta: 6 voci da decidere, 2 in conflitto · fonti lette 3 su 3 · 12 post per intero (30 solo estratto)."* + gli
   avvisi per fonte. Il numero conta le **differenze** dal profilo, non le voci prodotte. Link **Rivedi la
   proposta** solo finché **quella** proposta è aperta: decisa tutta, rifiutata in blocco o sostituita, il link
   sparisce (resta **Dettagli del run**). Il toast d'esito di una generazione **sostituisce** quello della
   generazione precedente invece di impilarsi sopra.
2b. **Nessuna novità** (OQ-3 del 2026-10-02, opzione a): se nessuna voce proposta differisce dal profilo di oggi,
   l'esito è **neutro** — *"Nessuna novità: la proposta coincide con il tuo profilo (6 voci uguali)."* —, senza
   **Rivedi la proposta**, e **nessuna proposta resta aperta**: niente sezione, niente da rifiutare, nessun avviso
   *"C'è una proposta…"* nella prossima anteprima. Se prima c'era una proposta aperta, questa la sostituisce comunque
   (E11): le sue voci già applicate restano.
3. **Nessuna fonte ha prodotto contenuto** (D13, D14): esito **neutro** (grigio, non rosso) — *"Nessuna fonte ha
   prodotto contenuto: il modello non è stato chiamato, nessuna spesa di elaborazione. La proposta del 18 set
   resta com'era."* con, per ciascuna, il motivo.
4. **Proposta povera** (attrito noto): esito neutro *"Proposta povera: 2 campi e nessun servizio. Le fonti lette
   dicono poco di cosa vendi."* + tre uscite, tutte gratis: **Aggiungi il sito** · **Sincronizza i post** (i
   nuovi conservano il testo integrale, C7) · **Scrivi un servizio a mano**.
5. **Connessioni** (A3): quarta card **Cloudflare** — *"Abilita: lettura del tuo sito per la generazione del
   profilo."*; stato *"CLOUDFLARE_ACCOUNT_ID · CLOUDFLARE_API_TOKEN · Configurata"* oppure *"CLOUDFLARE_API_TOKEN
   · Mancante: aggiungila al .env e riavvia il server."* (A4: manca **almeno una** delle due ⇒ non configurata,
   e la card dice **quale**); sotto, come per gli altri, *"«Configurata» vuol dire solo che la chiave è
   presente."* quando l'ultimo run è fallito per Cloudflare (A5) · **Vedi run**. **[→ PLAN: la card di uno
   strumento oggi mostra **una** variabile; Cloudflare ne ha due, e l'identificativo dell'account non è un
   segreto (A7).]** **[→ PLAN: quattro card in `lg:grid-cols-3` lasciano la quarta sola su una riga: rivedere
   la griglia.]**
6. **Run della generazione**: compare nella pagina di ogni strumento che le fonti scelte usano; *"Genera profilo
   e servizi · 4 ott, 09:40"*. **Parametri**: *"Fonti: profilo LinkedIn · sito (fino a 10 pagine) · post (12
   con testo integrale)"* — mai il token (A7). **Log** (D10, D11), una riga per chiamata a uno
   strumento, senza contenuti: `09:40:02 Avvio: Genera profilo e servizi su 3 fonti` · `09:40:03 Apify · profilo
   · omar-deangelis` · `09:40:09 Cloudflare · sito · officinacodice.it` · `09:40:24 Anthropic · elaborazione del profilo` · `09:40:39 Fine: completato`.
7. **Una fonte che fallisce non ferma le altre** (C12): esito **Attenzione** *"Proposta pronta da 2 fonti su 3 ·
   Sito non letto: Cloudflare ha rifiutato la lettura, superato il limite di browser del piano gratuito (10
   minuti al giorno). Riprova domani o passa al piano a pagamento."* (Constraints: parole, non codici).
8. **Verifica manuale prima del primo uso** (A8): documentata nel README come per Apollo (`npm run
   apollo:smoke`), la lancia l'utente con conferma esplicita e riporta pagine lette, forma del contenuto,
   consumo dichiarato e l'errore leggibile in caso di permessi insufficienti. Il README dice anche quale
   permesso serve al token, quale piano basta per questo uso e cosa succede quando si superano i limiti (A2):
   sono le parole che l'utente ritrova negli avvisi del job. Senza credenziali non parte
   nessuna chiamata e nient'altro del CRM si blocca (A9).
→ **Outcome:** cosa è stato letto, cosa no e perché si legge in `/settings/profile`; il log resta per il
dettaglio, non per l'informazione essenziale.

### F. L'analisi nomina il servizio più affine (F1–F13)

1. Scheda di una persona → card **"Fit e analisi AI"**. Con almeno un servizio, sotto il riassunto compare
   **Servizio più affine**: *"**Assessment architetturale in 2 settimane** — ha un gestionale del 2011 e cita la
   migrazione al cloud nei suoi post."* (F2). Nessuna riga se l'analisi non l'ha prodotta: senza servizi, con
   una risposta non riconducibile a un servizio, o per le analisi fatte prima del rilascio (F3, F9) — mai un
   campo vuoto etichettato.
2. **Servizio eliminato o rinominato** (F4, F5): *"Servizio più affine: **Assessment architetturale** — non è
   più tra i tuoi servizi (nome di allora)."*, testo normale, nessun errore, nessun link. **Nessun invito a
   rifare l'analisi**: sarebbe un avviso innescato da una modifica dei servizi, cioè esattamente ciò che F7
   vieta. Il fatto si legge, la decisione resta dell'utente.
3. **Profilo, servizi o ICP cambiati** (F7): sulla scheda della persona **non cambia niente**. Niente badge
   **"da aggiornare"**, niente riga *"Il profilo è cambiato dopo l'analisi."*, nessun invito a rifarla:
   l'analisi resta quella, con la sua data.
3b. **La persona è cambiata dopo l'analisi** (F13): questo la scheda lo dice, ed è l'unico caso in cui lo dice.
   Il badge sul fit dell'AI resta, e la riga cambia parole perché cambia il soggetto: non più *"Il profilo è
   cambiato dopo l'analisi."* ma *"Questa persona è cambiata dopo l'analisi."* Il testo **non attribuisce** il
   cambio a un gesto ("l'hai arricchita", "ne hai corretto i dati"): nell'input entrano anche le sue
   interazioni con i miei post, quindi un re-sync può muoverlo e il CRM non sa dire chi l'ha causato. Dice che
   è cambiato, non chi. È un'informazione, non una richiesta: nessun bottone diventa primario per questo (vedi
   il punto 4) e nessuna anteprima la trasforma in spesa (punto 5).
4. **Rianalizza** resta sempre disponibile, come azione secondaria e con il costo dichiarato (F10, F11):
   l'hint sotto il bottone mostra la stima **corrente** — *"Rianalizza con il profilo e i servizi di oggi
   (≈ $0,04)."* — e **"stima non disponibile"** quando non è calcolabile (D5 vale anche qui). Il bottone
   rifà l'analisi anche a dati identici, come già oggi. Accanto al fit, modello e data dell'ultima analisi
   (F12, già presenti oggi). **[→ PLAN: la stima dell'analisi è oggi un prezzo fisso scritto nel testo;
   allargando il contesto va ricalcolata, non riscritta a mano.]** **[→ PLAN: oggi la prominenza del bottone
   dipende da `stale` (`variant={latest && !stale ? 'outline' : 'default'}`): resta secondario in ogni caso,
   anche quando la persona è cambiata — F13 informa, non spinge.]**
5. **Anteprima di un'analisi in blocco** (F8): chi ha già un'analisi per quell'ICP è fuori dai conteggi, su una
   lista come su una selezione, **anche se è cambiato** — *"128 persone hanno già un'analisi per questo ICP:
   restano fuori."* Per includerle si spunta la casella che il dialog **già ha**, con parole nuove:
   **"Includi chi è già analizzato"** (oggi *"Rianalizza anche quelle già fatte"*), spenta di default. Spuntandola
   conteggi, avvisi e stima si aggiornano prima di avviare, e l'anteprima distingue i due gruppi:
   *"Da rifare: 12 · Input identico, saltate comunque: 116."* Se sono zero e 128, lo dice invece di far partire
   un job che non fa niente: *"Nessuna delle 128 ha dati diversi da quando è stata analizzata: non ci sarebbe
   nulla da rifare."* **[→ PLAN: oggi la casella manda `force: true` (ripaga anche a input identico); diventa
   "includi chi è già analizzato" (`onlyMissing: false`), così l'impronta continua a saltare gli identici — F11.
   Oggi su una selezione il job rianalizza da sé chi ha l'input cambiato: quel comportamento implicito sparisce
   e la casella lo rende esplicito.]**
6. **Il giorno del rilascio** (F6): nessuna rianalisi è proposta e nessun servizio affine compare — campi nuovi
   vuoti e nessun servizio ⇒ né il contesto né ciò che si chiede al modello cambiano. Una cosa **cambia** una
   volta sola e va detta: l'impronta della persona nasce dai dati di oggi, quindi le analisi che al momento del
   rilascio mostrano "da aggiornare" perdono il badge, e lo riprendono al primo arricchimento o alla prima
   correzione successiva. Verifica sullo smoke: tre schede analizzate prima del rilascio non mostrano la riga
   del servizio; poi si arricchisce una di quelle persone e il badge ricompare con il testo nuovo.
→ **Outcome:** l'analisi dice quale servizio c'entra; il passato resta leggibile, nessuna mia modifica lo segna,
e l'unico avviso che resta parla della persona — senza spendere da sé.

---

## Error paths

Ogni scrittura ha un esito visibile (toast dove non è ovvio, errore inline dove nasce); mai silenzio. Dopo un
errore i valori inseriti restano.

| Trigger / fallimento | Comportamento visibile | Recupero |
|---|---|---|
| `ANTHROPIC_API_KEY` mancante (D6) | Anteprima: blocco *"ANTHROPIC_API_KEY mancante nel .env: senza l'elaborazione la generazione non può partire."* + **Vai a Connessioni**; **Avvia** disabilitato | Chiave nel `.env`, riavvia il server, riapri |
| Nessuna fonte disponibile (D7) | Blocco *"Nessuna fonte disponibile: imposta il profilo LinkedIn o il sito, oppure sincronizza i tuoi post."*; la card lo anticipa in una riga (G4) | Salva un indirizzo o sincronizza |
| Tutte le fonti escluse a mano | Blocco *"Hai escluso tutte le fonti: scegline almeno una."* | Riaccendi una spunta |
| Job già in corso (D1) | Blocco *"C'è già un job in corso: Analisi, 2 min fa."*; race al `POST` → toast con lo stesso testo, dialog aperto | Attendi la fine (banner) |
| Credenziali Cloudflare mancanti o rifiutate (A4, A5, C12) | Fonte *Sito* fra le **Non disponibili** con la variabile che manca; se la chiave è presente ma rifiutata il job prosegue e l'esito dice *"Sito non letto: Cloudflare ha rifiutato le credenziali (401). Verifica CLOUDFLARE_API_TOKEN nel .env."* attribuito a **Cloudflare** (A6) | Sistema il `.env`, riavvia, **Riprova…** |
| Limite del piano Cloudflare superato (Constraints) | Esito **Attenzione**: *"Sito non letto: superato il limite di browser del piano gratuito (10 minuti al giorno). Riprova domani o passa al piano a pagamento."* Le altre fonti sono state lette | Riprova più tardi |
| Sito senza contenuto utile (C14) | Fonte *"Sito · letta, nessun contenuto utile"* + motivo (*"pagina vuota, consenso obbligatorio o blocco"*) e *"Nessun valore è stato dedotto dal sito."* | Indirizzo di una pagina con testo, o scrivi a mano |
| `APIFY_TOKEN` o profilo mancanti (D8) | Fonte *Profilo LinkedIn* fra le Non disponibili con il motivo e il link; la generazione parte dalle altre | Token o URL, poi rigenera |
| Nessun contenuto da nessuna fonte (D14) | Esito **neutro**, modello non chiamato, nessuna proposta creata, quella aperta resta intatta (decisioni comprese) | Sistema una fonte, rigenera |
| Risposta del modello non conforme (Constraints) | Job **fallito**: *"Il modello ha risposto in una forma inattesa: nessuna proposta creata. Riprova."* — mai un profilo a metà | **Riprova…** (stessa anteprima) |
| Generazione fallita (D12) | Banner rosso + **Riprova…**: stessa anteprima, **stesse fonti scelte**, conteggi e blocchi ricalcolati adesso | Riprova o correggi |
| Qualsiasi azione su una proposta non più corrente (E11; *rev. 2026-10-03*) | *"Questa proposta non è più quella corrente: la pagina si aggiorna."* + refetch; niente scritto; **focus sul titolo** della proposta nuova, o sul titolo della card della generazione se non ce n'è una aperta (mai `body`) | Rileggi la nuova |
| Applica su un servizio eliminato nel frattempo | *"Il servizio «X» non è più nel CRM: la voce torna «Nuovo»."*; confronto ricalcolato; focus sul titolo della voce | Riapplica se vuoi |
| Voce cambiata dopo che l'hai vista (campo riscritto a mano altrove, *rev. 2026-10-03*) | *"La voce è cambiata dopo che l'hai vista: ora è «In conflitto»."* sotto la riga; niente scritto; la riga si ridisegna nel nuovo stato, focus sul suo titolo | Decidi di nuovo |
| Voce già decisa in un'altra scheda (*rev. 2026-10-03*) | *"Questa voce l'hai già decisa in un'altra scheda: la pagina si aggiorna."*; la riga mostra la decisione registrata | Nessuno, o **Annulla** |
| Applica, Rifiuta, Tieni o Sostituisci falliti (rete, 500; *rev. 2026-10-03*) | Errore sotto le azioni della riga (`role="alert"`): *"Non applicato: <messaggio>."* / *"Non rifiutato: <messaggio>."*; la riga resta da decidere, le altre invariate; **il focus resta sul bottone premuto** (durante l'attesa `aria-disabled` + `aria-busy`, mai `disabled`: finding 6) | Ripeti il gesto |
| Azione di massa fallita (*rev. 2026-10-03*) | Errore sotto la riga delle azioni: *"Voci non applicate: <messaggio>. Nessuna voce è cambiata."*; focus sul bottone | Ripeti |
| **Annulla** su una voce applicata che è cambiata dopo (*rev. 2026-10-03*) | Sotto la riga: *"«Cosa offri» è cambiato dopo che l'hai applicato: per cambiarlo usa «La mia azienda»."* con il link al campo (focus sul campo); per un servizio *"Il servizio «X» è cambiato dopo che l'hai aggiunto: modificalo o eliminalo da «I miei servizi»."*; la decisione resta | Modifica dalla card |
| **Annulla** fallito (rete, 500; *rev. 2026-10-03*) | *"Decisione non annullata: <messaggio>."* sotto la riga; focus sul bottone | Ripeti |
| **Modifica**: testo vuoto o uguale a quello di oggi (*rev. 2026-10-03*) | Sotto la casella (`role="alert"`, `aria-invalid`): *"Scrivi un testo, oppure annulla la modifica e scegli «Rifiuta»."* / *"È uguale al testo di oggi: niente da applicare. Se va bene così, annulla la modifica e scegli «Rifiuta»."* (su un conflitto «Tieni il tuo testo», UX-REVIEW dopo l'implementazione, bug 6); niente scritto, il testo resta nella casella | Correggi o rifiuta |
| **Modifica…** di un servizio: nome già usato (B10) | L'errore inline del dialog dei servizi (riga sotto); niente scritto, la voce resta da decidere | Cambia nome |
| Nome del servizio duplicato (B10) | Inline sotto il campo: *"Hai già un servizio con questo nome: «Assessment Architetturale». I nomi si distinguono a meno di maiuscole e spazi."* Nulla salvato | Cambia nome o modifica l'esistente |
| Nome del servizio vuoto (B2) | *"Inserisci il nome del servizio."*, focus sul campo | Compila |
| Salvataggio del profilo fallito | Come oggi: errore sotto il campo, i testi restano nel form | Salva di nuovo |
| Sito che non è un indirizzo web (C11) | Sotto il campo: *"Questo non sembra l'indirizzo di un sito: la generazione non potrà leggerlo."* (non blocca il salvataggio); nell'anteprima il sito è fra le Non disponibili | Correggi o ignora |
| **Rifiuta le N voci da decidere…** fallito (*rev. 2026-10-03*, era "Scarto della proposta fallito") | Nel dialog (`role="alert"`): *"Voci non rifiutate: <messaggio>."*; il dialog resta aperto, focus sul bottone di conferma; nessuna voce cambia | Riprova |
| Riordino dei servizi fallito | *"Ordine non salvato: <messaggio>."* + ordine ripristinato | Riprova |
| Strumento o run inesistente | *"Strumento non trovato"* / *"Run non trovato"* + **Vai a Connessioni** | Naviga |
| Caricamento della pagina fallito | `ErrorBox` + **Riprova**; sidebar e ⌘K restano usabili | Riprova |

## Edge cases

- **Proposta aperta e nuova generazione** (E11; *rev. 2026-10-03*): l'anteprima avvisa con il numero delle voci
  ancora da decidere; la nuova proposta **sostituisce** la vecchia e non tocca nulla di ciò che era già stato
  applicato. Le decisioni della vecchia non passano alla nuova: una voce rifiutata può tornare (OQ-R1). Unica
  eccezione: se nessuna fonte produce contenuto la proposta aperta resta intatta, decisioni comprese (D14).
- **Confronto ricalcolato a ogni lettura** (P-12; *rev. 2026-10-03*): "nuovo / modificato / invariato / in
  conflitto" si decide **quando apri la proposta**, non quando è stata creata, per le voci **da decidere**. Così un
  servizio eliminato, rinominato o corretto a mano dopo la generazione compare nello stato giusto senza errori. Una
  voce **decisa** invece è il ricordo di un gesto: resta *"applicato"* / *"rifiutato"* anche se poi cambi quel
  campo a mano (e allora **Annulla** non si può più: vedi Error paths). La sezione si aggiorna **senza ricaricare**
  quando campi o servizi cambiano nella stessa pagina (finding 8 del 2026-10-02).
- **Ritorno a una proposta decisa a metà** (*rev. 2026-10-03*): le decisioni sono salvate con la proposta. Dopo un
  ricarico, un'altra pagina o un riavvio la testata dice ancora *"Decise 3 di 6 · ne restano 3"*, le righe decise
  stanno dopo quelle da decidere con il loro stato e **Annulla**, e il testo sostituito (*"prima: …"*) è ancora lì.
- **La proposta si chiude da sé** (*rev. 2026-10-03*): è "aperta" finché almeno una voce è da decidere — dato
  derivato, non uno stato da impostare. Si chiude con l'ultima decisione, con il rifiuto in blocco, o quando le voci
  rimaste diventano invariate perché le hai scritte a mano uguali. Chiusa, non è più "in attesa" (niente avviso
  nell'anteprima, niente **Rivedi la proposta**, niente `#proposta`); resta salvata finché una nuova generazione non
  la sostituisce, e la card la racconta al passato.
- **Annulla dopo la chiusura** (*rev. 2026-10-03*): nel riepilogo che resta sulla pagina dopo l'ultima decisione,
  **Annulla** su una riga **riapre** la proposta (la voce torna da decidere, la testata torna all'avanzamento, la
  proposta torna "in attesa"). Dopo aver lasciato la pagina il riepilogo non c'è più e le decisioni sono definitive
  per l'interfaccia.
- **Voce in Modifica e azione di massa** (*rev. 2026-10-03*): una voce con la casella di testo aperta resta fuori
  da **Applica le N voci…** (che applicherebbe il testo proposto, non il tuo) e da **Rifiuta le N voci…**; la
  testata lo dice (*"1 voce in modifica resta fuori."*).
- **Rifiutare una voce di E14** (*rev. 2026-10-03*): il valore resta senza provenienza; alla prossima generazione
  il campo è ancora *"compilato da prima del …"*. Applicarla le dà la provenienza *"dalla proposta"*.
- **Provenienza che cambia natura** (B6, H5): un valore *applicato da una proposta* non è un conflitto; appena
  lo modifichi a mano diventa *scritto da te* e la proposta successiva lo mostrerà come conflitto. Il marcatore
  sotto ogni campo lo rende leggibile prima della domanda *"perché questa voce è in conflitto?"*.
- **Campo in modifica mentre applichi** (attrito da pagina unica): applicare *Posizionamento* (anche con
  **Modifica**) mentre il textarea della card ha testo non salvato non lo butta via — toast *"Applicato:
  Posizionamento. Avevi modifiche non salvate in quel campo: sono ancora nel form. Salva o ricarica la pagina."*
  È l'unico toast di una decisione singola (*rev. 2026-10-03*).
- **Profilo vuoto** (B5, B8): nessun campo e nessun servizio è obbligatorio; sync, arricchimento, analisi e ICP
  funzionano come oggi, e i consumatori di *"Di cosa si occupa"* e *"Cosa offri"* (contesto dell'analisi, avvisi
  di configurazione) si comportano come prima. Gli unici effetti visibili sono gli avvisi già esistenti (*"Descrizione azienda
  vuota…"*, TD-19) e la voce di Oggi (G6).
- **La mia azienda non è un'azienda del CRM** (B9): i suoi campi vivono nel profilo, e la generazione non crea
  né modifica righe in Aziende. Se Omar ha comunque creato la propria azienda in Aziende, resta un'azienda
  target e non c'è nessun legame. *(Fino al 2026-10-02 qui c'era il record d'impresa Apollo in sola lettura:
  tolto con la fonte, vedi SPEC Decision Log.)*
- **Post con testo integrale, viste brevi** (C15): "I miei post" resta su due righe **e il testo al passaggio
  del mouse resta breve** (tagliato, non l'intero post); l'anteprima di unione e l'etichetta della fonte
  nell'elenco delle persone restano come oggi. **[→ PLAN: oggi il `title` della riga è il testo conservato per
  intero: va tagliato dove si mostra.]**
- **Post misti** (C6, C8): 12 integrali e 30 estratti ⇒ la generazione usa i 12, l'anteprima e l'esito dicono
  entrambi i numeri, e nessuna ri-sincronizzazione parte da sé per recuperare i vecchi (C9).
- **Freschezza del proprio profilo** (C4): letto ieri ⇒ la spunta è spenta con il motivo; **"Rileggilo
  comunque"** riaccende la fonte e il costo torna nella stima (vedi OQ-1).
- **Servizi con lo stesso nome nella stessa proposta** (E6): il secondo non entra e l'esito lo conta —
  *"1 voce lasciata fuori: nome già proposto."* (*rev. 2026-10-03*: la parola "scartata" non si usa più; le voci
  tolte dal sistema sono "lasciate fuori", quelle a cui dici di no tu sono "rifiutate").
- **Servizio «modificato» con il nome scritto diversamente** (B10): la riga dice *"Corrisponde al tuo servizio
  «assessment architetturale» (il confronto ignora maiuscole e spazi). Il nome resta il tuo."* (vedi OQ-4).
- **Analisi e servizi** (F4, F5): le analisi conservano il **nome di allora**; eliminare o rinominare non
  riscrive niente. Un servizio rinominato e poi ricreato con il vecchio nome fa tornare la riga "esistente":
  è accettato, l'analisi cita testo, non un id.
- **Run di più strumenti** (A6): la generazione con tutte le fonti conta per Apify, Cloudflare e
  Anthropic; se fallisce, la card di ognuno mostra *"Fallito per Cloudflare"* e solo Cloudflare va in rosso.
  Con fonti escluse il run compare **solo** negli strumenti usati. **[→ PLAN: un errore `actor:<id>:` il cui id
  non contiene uno slash viene oggi attribuito ad Anthropic quando il run lo usa: serve una forma d'errore che
  nomini Cloudflare, altrimenti A6 non regge.]**
- **Due tab:** applicare in una e rigenerare nell'altra ⇒ la prima riceve *"Questa proposta non è più quella
  corrente"* e si aggiorna (focus sul titolo della nuova); decidere la stessa voce in due schede ⇒ la seconda riceve
  *"Questa voce l'hai già decisa in un'altra scheda"* e mostra la decisione registrata; il riordino dei servizi
  converge all'ultimo clic (nessun lock, azioni reversibili).
- **Job avviato e pagina cambiata/ricaricata:** il banner si ricostruisce da `/api/jobs/current`; l'esito arriva
  comunque e la sezione Proposta compare al rientro sulla pagina.
- **Deep-link `#proposta` senza proposta aperta:** nessuna sezione, la card della generazione dice *"Nessuna
  proposta in attesa."* e, se l'ultima è stata chiusa, la frase al passato (E.1); `#genera` con un blocco porta al
  bottone, non apre il dialog.
- **Riavvio del server con una proposta aperta** (H4): la proposta è un dato salvato, non uno stato della
  pagina: dopo un riavvio (o un `.env` sistemato e il server rilanciato) la sezione Proposta è ancora lì, con le
  stesse voci, **le stesse decisioni** (applicate, con modifiche, rifiutate) e lo stesso avanzamento. Nessuna
  lista, nessuno stato e nessun valore del profilo cambia nel frattempo (H3).
- **Migrazione sul database reale** (Constraints): all'apertura della pagina dopo l'aggiornamento i campi nuovi
  sono vuoti, i post esistenti sono marcati integrale/troncato secondo C6, nessun servizio affine compare e
  nessuna rianalisi è proposta (F6). L'unica differenza visibile è il badge "da aggiornare" che si azzera una
  volta sola dove c'era (percorso F.6). Nulla da fare per l'utente.

## Friction notes & decisioni UX

- **Tolto: il modulo a sette caselle come unica strada.** Il primo giro è un bottone e un'azione di massa; la
  compilazione a mano resta, ma non è più il percorso obbligato (B3, B5).
- **Tolto: le voci invariate dalla lista.** Restano contate e riapribili: senza questo, la seconda generazione su
  un profilo buono sarebbe un muro di righe identiche. Nascoste **con il conteggio**, mai in silenzio (E3 resta
  soddisfatto per chi apre il gruppo). *Rev. 2026-10-03:* non più un toggle globale nella testata, ma una riga in
  fondo a ogni gruppo che le **nomina** (*"Invariati (3): Nome, Di cosa si occupa, Prove e risultati"*): spesso
  basta il nome per sapere che va bene, senza aprire.
- **Ordine per decisione, non per struttura dei dati:** conflitti, poi nuovi, poi modificati, poi invariati.
  L'utente legge dall'alto finché ha qualcosa da decidere.
- **"Ora" e "Proposta" incolonnati in verticale**, non affiancati: posizionamento, prove e problema sono
  paragrafi; due colonne strette li spezzano e obbligano a leggere a zig-zag.
- **Il conflitto ha un verbo suo** ("Sostituisci il tuo testo"), non "Applica": la parola dice cosa si perde.
  E resta **fuori** dalle azioni di massa, con l'hint che lo dichiara prima del clic (E8, E9). *Rev. 2026-10-03:*
  ha anche il suo "no", **Tieni il tuo testo**: senza, l'ultimo conflitto si chiudeva solo perdendo il proprio testo
  o scartando l'intera proposta.
- **Rifiuto per voce** (*rev. 2026-10-03*, richiesta dell'utente): prima l'unico "no" era sull'intera proposta, con
  una conferma che parla di spesa; una voce sbagliata (*"Nome: Marta Fiorini"* al posto del nome dell'attività)
  restava "da rivedere" per sempre, e **Applica tutto** l'avrebbe scritta. Un rifiuto non scrive niente, quindi
  niente conferma: si annulla dalla riga.
- **Tre verbi, non due: Modifica sì** (*rev. 2026-10-03*). Il testo del modello è spesso quasi giusto. Senza
  Modifica, ritoccarlo voleva dire Applica → scorrere a «La mia azienda» → correggere → **Salva azienda**, e alla fine
  la provenienza diventava comunque "scritto da te"; un conflitto non si poteva fondere (tenere metà del mio e metà
  della proposta). In riga per i campi (una casella, nessun dialog) e nel dialog che già esiste per i servizi:
  costa uno stato di riga, non una superficie nuova. Il valore modificato è **scritto da te** (H5): la prossima
  generazione lo protegge.
- **Le righe decise restano al loro posto** (*rev. 2026-10-03*): prima una voce applicata saltava in fondo al
  gruppo, perdeva i suoi testi e finiva contata fra le "invariate nascoste" pur essendo visibile. Ora si chiude
  dov'è, dice in parole cosa è successo e cosa c'era prima, e si riordina solo al caricamento successivo.
- **La proposta si chiude da sé** (*rev. 2026-10-03*): quando non resta niente da decidere non c'è un "Chiudi" da
  premere né una proposta "in attesa" a vuoto (che faceva comparire l'avviso nell'anteprima e chiedeva uno scarto
  inutile). Il riepilogo resta sulla pagina per la visita in corso, così l'ultima decisione si può ancora annullare.
- **Un solo primario nella sezione** (*rev. 2026-10-03*): l'azione di massa. I bottoni di riga sono secondari e
  sempre nello stesso ordine (accetta · modifica · rifiuta), così si scorre la colonna senza leggere ogni etichetta;
  prima c'erano fino a otto bottoni neri uguali.
- **Nessun toast per le decisioni singole** (*rev. 2026-10-03*): la riga cambia sotto gli occhi e la live region lo
  dice; i toast restano per le azioni di massa, che cambiano righe fuori schermo.
- **"Applica tutto" diventa un'etichetta che dice quante e quali** (*rev. 2026-10-03*): *"Applica tutte le 11
  voci"* / *"Applica le 10 voci rimaste"* / *"Applica le 4 voci senza conflitto"*. Prima "tutto" non era vero con un
  conflitto, e serviva un hint di due righe per dirlo.
- **La granularità è il campo per il profilo e il servizio intero per i servizi** (E7): la provenienza dei
  servizi è per riga, quindi un'applicazione per singolo sotto-campo non avrebbe nulla su cui appoggiarsi e
  moltiplicherebbe i bottoni.
- **Fonti non disponibili fuori dalle spunte:** su una fonte che non si può leggere non c'è niente da decidere;
  metterla come checkbox disabilitata farebbe sembrare l'anteprima un modulo da compilare. Ogni riga porta il
  link al posto dove si risolve.
- **Costo per fonte + unità sempre vere:** letture, pagine e post si mostrano anche quando il prezzo non è
  configurato, e il totale diventa "stima non disponibile" (lezione di `apollo-lookalike`: l'unità che l'utente
  controlla, non il dollaro).
- **L'esito onesto vive nella pagina**, non solo nel toast (che si chiude) né solo nel log (che va cercato):
  tabella per fonte nella card, stessa frase nel banner, sintesi nella testata della proposta. Un dato
  importante non sta in un solo posto che scompare.
- **Rifiuto in blocco con conferma, non con un clic secco:** una proposta è costata soldi. "Un gesto" (E12) è
  letto come *un'azione sull'intera proposta*, non come *senza conferma* — la stessa asticella dell'eliminazione di
  un servizio (G7). *Rev. 2026-10-03:* l'azione si chiama **Rifiuta le N voci da decidere…** e non più "Scarta la
  proposta…": dice cosa tocca (solo le voci ancora da decidere) e cosa no (quelle già applicate), cosa che "Scarta
  la proposta" non diceva — dopo averne applicate quattro, il toast *"Il profilo non è cambiato"* era falso.
- **Nessuna scorciatoia "genera e applica":** violerebbe E1 e l'invariante del dominio (decide l'utente).
- **Rinviato (YAGNI):** storico delle proposte (una sola salvata, E11: l'ultima, aperta o chiusa); quarta strada
  "genera il profilo" nell'onboarding a CRM vuoto (là si portano dentro le persone, non si configura il venditore);
  memoria dei rifiuti fra una generazione e l'altra (OQ-R1); "Completa solo i campi vuoti" come quarto verbo sui
  servizi in conflitto (OQ-R4: **Modifica…** lo copre); anteprima diff parola per parola dei testi lunghi;
  rilettura automatica del sito a scadenza (Non-Goal: nessun automatismo). *(Rev. 2026-10-03: "Tieni il mio" non è
  più rinviato, è **Tieni il tuo testo**.)*

## Accessibilità

Stessa asticella dei FLOW precedenti (dialog Radix con focus trap e restore, `role="alert"` per blocchi ed
errori, stati mai solo a colore, nessun controllo solo al passaggio del mouse); in più (G9, G10):

> **Revisione 2026-10-03** (i punti della sezione Proposta qui sotto): nomi dei bottoni con la voce, focus dopo
> ogni azione e dopo ogni errore, avanzamento in testo, Modifica in riga (finding 6 del 2026-10-02).

- **Sezione Proposta:** `section aria-labelledby` con il titolo *"Proposta del 4 ott, 09:40"* (`tabIndex=-1`:
  riceve il focus da `#proposta`, da **Rivedi la proposta**, dopo un aggiornamento e alla chiusura); ogni gruppo
  (`Campi del profilo`, `Servizi`) è un `<section>` con intestazione che porta i conteggi nel nome; ogni voce è
  un `<li>`/`<article>` con intestazione = nome del campo o del servizio, e lo stato ("Nuovo", "Modificato",
  "In conflitto con ciò che hai scritto a mano", "applicato", "applicato con le tue modifiche", "rifiutato", "hai
  tenuto il tuo testo") **in testo** dentro il nome accessibile; le icone ✓ ✕ sono `aria-hidden`.
- **Avanzamento:** *"Decise 3 di 6 · ne restano 3, 2 in conflitto"* è testo normale (non live); la barra accanto è
  `aria-hidden`. I cambi li annuncia la live region.
- **Nomi dei bottoni con la voce** (oggi lo screen reader legge sette "Applica" uguali): etichetta visibile breve,
  nome accessibile completo — *"Applica Tono di voce"*, *"Modifica Tono di voce"*, *"Rifiuta Tono di voce"*,
  *"Tieni il tuo testo per Posizionamento"*, *"Sostituisci il tuo testo di Posizionamento"*, *"Annulla la decisione
  su Nome"*, *"Annulla la modifica di Cosa offri"*.
- **Ora / Proposta** come coppia `dt`/`dd` (o blocchi etichettati): lo screen reader legge *"Ora: … Proposta:
  …"* senza dipendere dal bordo colorato. Le fonti di ogni voce sono testo, non solo tooltip (E5). Nelle righe
  decise, *"prima: …"* è testo selezionabile, non un tooltip.
- **Focus dopo ogni azione** (mai `body`, lezione di TD-4):
  - decisione su una riga → titolo della **voce successiva da decidere** in ordine di lettura (non la prima della
    lista: oggi dopo "Di cosa si occupa" il focus torna su "Nome", sopra); se non ce ne sono dopo, la prima rimasta;
    se non ne resta nessuna, il titolo del riepilogo;
  - **Annulla** → titolo della voce riaperta;
  - **Modifica** → dentro la casella; **Annulla** della modifica → il bottone **Modifica**; **Modifica…** di un
    servizio chiuso senza salvare → il bottone **Modifica…**;
  - azione di massa → primo conflitto rimasto, o titolo del riepilogo;
  - errore → resta sul bottone premuto: durante l'attesa i bottoni sono `aria-disabled` + `aria-busy`, mai
    `disabled` (un bottone `disabled` perde il focus);
  - proposta non più corrente → titolo della proposta nuova o della card della generazione.
- **Live region `polite`** (una sola per la sezione): *"Applicato: Tono di voce. Restano 5 voci da decidere, 2 in
  conflitto."* · *"Rifiutato: Nome. Restano 10 voci da decidere."* · *"Hai tenuto il tuo testo: Posizionamento."* ·
  *"Applicato con le tue modifiche: Cosa offri."* · *"Di nuovo da decidere: Cosa offri."* · *"Proposta chiusa: hai
  deciso tutte le voci."*
- **Modifica in riga:** `textarea` con `label` *"Il tuo testo per «Cosa offri»"*, hint in `aria-describedby`,
  errore `role="alert"` legato con `aria-describedby` + `aria-invalid`. Esc non chiude la casella (si perderebbe il
  testo scritto): si esce con **Annulla**.
- **Azioni di massa:** il motivo di un'azione disabilitata e l'hint (*"I 2 conflitti restano fuori…"*) sono in
  `aria-describedby`, così si sentono prima del clic. Hint, motivo ed errore stanno **nella striscia** dell'avanzamento,
  visibili anche quando è fissata in alto, e un titolo che riceve il focus non finisce mai sotto la striscia, a nessuna
  larghezza (UX-REVIEW dopo l'implementazione, findings 3–4). Il dialog di **Rifiuta le N voci…** apre con il focus su
  **Annulla**; confermato, il focus va al titolo del riepilogo.
- **Invariati:** in fondo a ogni gruppo, `button aria-expanded aria-controls` con il conteggio nel nome
  (*"Mostra i 3 invariati dei campi del profilo"*).
- **Anteprima:** `fieldset`/`legend` **"Fonti da leggere"**; la label di ogni spunta contiene il costo
  (*"Profilo LinkedIn, 1 lettura con Apify, circa 0,01 dollari"*); le fonti non disponibili sono una lista con
  il motivo, non checkbox disabilitate; il riassunto e il costo stanno nella sezione
  `aria-label="Anteprima del job"` già esistente, con `aria-busy` durante il ricalcolo e un annuncio `polite`
  dopo ogni esclusione.
- **Servizi:** tabella con `caption` *"I miei servizi, in ordine"*; ↑ ↓ con nome completo (*"Sposta «Fractional
  CTO» su"*) e posizione annunciata dopo lo spostamento; **Elimina** apre una conferma con focus su
  **Annulla**; la provenienza è testo (*"scritto da te il 28 set"*).
- **Card della generazione:** la tabella dell'esito ha `caption` *"Esito dell'ultima generazione per fonte"*;
  "letta"/"non letta"/"ripresa"/"esclusa da te" sono parole, non icone. *Rev. 2026-10-03:* con una proposta aperta
  la tabella sta dietro **Esito per fonte** (`button aria-expanded aria-controls`); la riga di sintesi sopra resta
  testo leggibile.
- **Servizio più affine** nella scheda: parte del testo dell'analisi (nessun badge solo grafico); il caso
  "non è più tra i tuoi servizi" è una frase, non uno stile.
- **Connessioni:** la card Cloudflare segue le altre; con due variabili, la riga di stato nomina quella che
  manca, in testo.

## Testi che cambiano

| Oggi | Diventa |
|---|---|
| Card **"Profilo LinkedIn"** in `/settings/profile` | **"I tuoi indirizzi pubblici"** — profilo LinkedIn (id e ancora `#profilo` invariati) + **Sito web**, con l'hint *"Da qui il CRM legge: non vengono mai proposti."* (E2) |
| Card **"La mia azienda"**, hint *"Usati dall'analisi AI per proporre angoli coerenti con ciò che vendi. Tutti facoltativi."* | Stessa card (`#azienda`) con Posizionamento · Prove e risultati · Tono di voce, ognuno col suo hint sotto il campo, legato con `aria-describedby` — *"Per chi lavori e cosa ti distingue, in una o due frasi."* · *"Numeri, casi e clienti che dimostrano ciò che dici. Quelle di un singolo servizio vanno nel servizio."* · *"Come scrivi ai clienti, in poche parole."* (revisione dell'utente, 2026-09-30) —, hint *"Usati dall'analisi AI e (in futuro) dall'assistente ICP. Tutti facoltativi."* + provenienza sotto ogni campo (B6) |
| — | Card **"Genera profilo e servizi"** (`#genera`) e card **"I miei servizi"** (`#servizi`) |
| Elenco "Da completare" di Oggi | Nuova voce **"genera profilo e servizi"** → `/settings/profile#genera` (solo se mai generato e senza servizi, G6) |
| Connessioni: tre card | Quattro card, la nuova **Cloudflare** — *"Abilita: lettura del tuo sito per la generazione del profilo."* |
| Analisi: badge **"da aggiornare"** + riga *"Il profilo è cambiato dopo l'analisi."*, che compaiono per un cambio del prospect, dell'ICP **o** della tua azienda | Restano, ma solo per un cambio della **persona** (F13): la riga diventa *"Questa persona è cambiata dopo l'analisi."*, senza attribuire il cambio a un gesto. Modificare profilo, servizi o ICP non li fa più comparire (F7) |
| Anteprima dell'analisi in blocco: su una selezione rianalizza in silenzio chi ha l'input cambiato | *"128 persone hanno già un'analisi per questo ICP: restano fuori."* + i due gruppi quando includi (*"Da rifare: 12 · Input identico, saltate comunque: 116."*) (F8) |
| Dialog dell'analisi in blocco: casella **"Rianalizza anche quelle già fatte"** — *"Ricalcola anche le analisi con gli stessi dati: costa di nuovo"* (`force`) | **"Includi chi è già analizzato"** — *"L'anteprima dice quante rifarebbe e quante resterebbero saltate."* (`onlyMissing`). Nessuna promessa nella descrizione: dopo una modifica al profilo **nulla** ha più l'input identico, e i numeri veri stanno nell'anteprima (F8, F11) |
| Analisi: hint *"Rianalizza anche con gli stessi dati (≈ $0,03)."* | *"Rianalizza con il profilo e i servizi di oggi (≈ $0,04)."*, oppure **"stima non disponibile"** (F10, D5) |
| *Rev. 2026-10-03 — proposta:* azioni di riga **Applica** / **Aggiungi questo servizio** / **Aggiorna il servizio**, e sui conflitti **Sostituisci il tuo testo** / **Sostituisci con la proposta** | **Applica** · **Modifica** · **Rifiuta** (campi); **Aggiungi il servizio** / **Aggiorna il servizio** · **Modifica…** · **Rifiuta** (servizi); sui conflitti **Sostituisci il tuo testo** · **Modifica** · **Tieni il tuo testo** e **Sostituisci con la proposta** · **Modifica…** · **Tieni il tuo servizio** |
| **Applica tutto** + hint *"Applica le 6 voci non scritte a mano. Nessun conflitto da decidere."* / *"Applica solo le 5 voci che non hai scritto a mano. I 2 conflitti restano…"* | **Applica tutte le 11 voci** · **Applica le 10 voci rimaste** · **Applica le 4 voci senza conflitto** (+ *"I 2 conflitti restano fuori: decidili uno per uno."*); singolare *"Applica la voce senza conflitto"* |
| **Scarta la proposta…** → *"Scartare la proposta del 4 ott?"* — *"Spariscono le 5 voci non applicate…"* · toast *"Proposta scartata. Il profilo non è cambiato."* | **Rifiuta le 6 voci da decidere…** → *"Rifiutare le 6 voci da decidere?"* — *"Profilo e servizi restano come sono, compresi i 2 testi in conflitto. Le voci che hai già applicato non cambiano. Puoi annullare ogni rifiuto dalla sua riga finché resti su questa pagina; dopo, per riaverle serve una nuova generazione, con la sua spesa."* · **Rifiuta le 6 voci** · toast *"Rifiutate 6 voci: non è stato scritto niente. La proposta è chiusa."* |
| Testata *"Da 3 fonti su 3 · 5 voci da rivedere · 2 conflitti · 2 invariate nascoste · 3 voci scartate."* | *"Da 3 fonti su 3 · 1 voce lasciata fuori perché senza fonte."* + *"Decise 0 di 6 · 2 in conflitto"* → *"Decise 4 di 6 · ne restano 2, 2 in conflitto"* |
| *"Una voce che non applichi resta qui finché non la scarti o non generi di nuovo."* | *"Decidi voce per voce: Applica, Modifica o Rifiuta. Ogni decisione si annulla dalla sua riga; la proposta si chiude quando non resta niente da decidere."* |
| *"3 campi sono già compilati: Applica tutto li sostituisce. Il testo attuale è qui sopra ogni proposta."* | *"Nome, Di cosa si occupa e Cosa offri sono compilati da prima del 2 ott: «Applica le N voci…» li sostituisce. Il testo attuale è nella loro riga."* (finding 5) |
| *"Nome · Applicato ora"* (senza testi) | *"Nome — applicato · prima: «Officina Codice Srl»"* · *"— applicato con le tue modifiche"* · *"— rifiutato: resta «…»"* / *"— rifiutato: il campo resta vuoto"* · *"— hai tenuto il tuo testo"* · *"— aggiunto in fondo a «I miei servizi»"* · *"— hai tenuto il tuo servizio com'è"* + **Annulla** |
| **Mostra le N voci invariate** nella testata | In fondo a ogni gruppo *"Invariati (3): Nome, Di cosa si occupa, Prove e risultati"* + **Mostra**; aperti *"Nome · uguale al tuo: «…»"* |
| *"Fuori da «Applica tutto». Il tuo testo non si recupera."* | *"Fuori dalle azioni di massa."* (il testo di prima resta visibile e **Annulla** lo rimette) |
| Servizio *"4 campi su 4 · scritto da te il 28 set"* | *"Riempie 3 campi vuoti · cambia «A chi serve», scritto da te."* / *"Cambiano descrizione e a chi serve · invariati: nome, problema, prove."* |
| Riepilogo (nuovo) | *"Proposta del 4 ott, 09:40 · chiusa"* — *"Hai deciso tutte le 6 voci: 5 applicate · 1 rifiutata. 4 erano già uguali al tuo profilo."* · **Vedi il profilo aggiornato** |
| Esito *"Proposta pronta: 6 campi del profilo e 3 servizi · …"*, anche dopo che la proposta è stata decisa | Aperta: *"Proposta pronta: 6 voci da decidere, 2 in conflitto · …"*; chiusa: *"Proposta del 4 ott chiusa: 4 applicate · 1 con le tue modifiche · 1 rifiutata."*; senza differenze: *"Nessuna novità: la proposta coincide con il tuo profilo (6 voci uguali)."* |
| *"N voci scartate: N senza fonte"* (esito e testata) | *"N voci lasciate fuori perché senza fonte"* (al singolare *"1 voce lasciata fuori perché senza fonte"*) |
| Avviso dell'anteprima *"C'è una proposta del 18 set non applicata: una nuova generazione la sostituisce. Le voci già applicate restano."* | *"C'è una proposta del 18 set con 3 voci ancora da decidere: una nuova generazione la sostituisce. Le voci già applicate restano; quelle rifiutate possono essere riproposte."* |

## Decisioni chiuse (erano Open questions)

Tutte risolte con l'utente il 2026-09-22, prima del piano. Le prime tre erano le Open Questions della SPEC
viste dal lato interfaccia.

- **OQ-1 — Freschezza del proprio profilo** (SPEC OQ-1, C4). **90 giorni**, la stessa `FRESHNESS_DAYS`
  dell'arricchimento. La rilettura voluta la risolve la spunta **"Rileggilo comunque"** sulla riga della fonte
  (come *"Ritenta anche le non trovate"* in `apollo-lookalike`), non una finestra più corta: l'anteprima dice
  *"già letto il 18 set: entro 90 giorni non si ripaga"*.
- **OQ-2 — Tetto di pagine del sito e percorsi cercati** (SPEC OQ-2, C5). **10 pagine**
  (`CLOUDFLARE_MAX_PAGES`); percorsi cercati: pagina iniziale, chi siamo, servizi, prezzi, casi, team — sono i
  numeri e le parole che l'anteprima scrive. La verifica manuale A8 può rivederli prima che un job usi Cloudflare.
- **OQ-3 — Modello dell'elaborazione** (SPEC OQ-3). Variabile propria **`PROFILE_MODEL`**, con default il valore
  di `ANALYSIS_MODEL`. L'anteprima mostra quel valore nella riga *"Elaborazione AI (Anthropic) · Modello: …"*.
- **OQ-4 — Applicare un servizio "modificato".** Già risolta dalla SPEC: E7 dice che i campi che la proposta non
  nomina restano come sono e che il nome resta quello scritto dall'utente. Il FLOW era allineato: nessun cambio.
- **OQ-5 — "Tieni il mio" su una voce in conflitto.** ~~Rinviato.~~ **Superata il 2026-10-03** dalla richiesta
  dell'utente di poter rifiutare ogni voce: lo stato per riga «chiusa ma non applicata» ora c'è (*"rifiutato"*), e
  sul conflitto si chiama **Tieni il tuo testo** / **Tieni il tuo servizio**. Il "fastidio che finisce alla
  rigenerazione" era in realtà una proposta mai chiudibile senza perdere testo o scartare tutto.
- **OQ-6 — Scarto della proposta: con conferma.** Confermato: una proposta è costata denaro, stessa asticella
  dell'eliminazione di un servizio (G7). *Rev. 2026-10-03:* la conferma resta sull'azione di massa che ne ha preso
  il posto, *"Rifiutare le 6 voci da decidere?"*, con **Annulla** a fuoco; i rifiuti di una riga sola non la
  chiedono (si annullano dalla riga).
- **OQ-7 — Il promemoria di Oggi.** **Due voci, non tre**: finché la generazione è possibile (profilo LinkedIn o
  sito impostati) la voce *"descrizione della tua azienda"* non compare, perché è proprio il campo che la
  generazione riempie. Resta *"profilo LinkedIn · genera profilo e servizi"*. Se la generazione non è possibile
  (nessun indirizzo), torna la voce di oggi. **[→ PLAN: è una condizione in più nell'elenco "Da completare",
  non una voce in più.]**
- **OQ-8 — Card `#profilo` → "I tuoi indirizzi pubblici".** Confermato: il titolo cambia, l'ancora `#profilo` e
  l'`id` del campo restano (G2 vincola indirizzi e ancore, non i titoli).

## Open questions (revisione della proposta, 2026-10-03)

Il modello (tre verbi, **Annulla** per riga, chiusura da sé, rifiuto in blocco con conferma) è deciso nel mandato
dell'utente ed è scritto sopra. Restano da decidere queste quattro; ognuna ha una raccomandazione, e il FLOW è
scritto secondo la raccomandazione.

- **OQ-R1 — Una voce rifiutata torna alla generazione successiva?** (a) Sì: ogni generazione è un giudizio nuovo,
  le decisioni non passano da una proposta all'altra; l'avviso dell'anteprima lo dice (*"quelle rifiutate possono
  essere riproposte"*). (b) Una voce nuova identica, parola per parola, a una rifiutata nasce già *"rifiutata il 3
  ott"*: costa poco, ma con un modello linguistico il testo raramente torna identico, quindi aiuterebbe di rado.
  (c) I rifiuti vanno al modello come "non riproporre": è una funzione nuova della generazione, fuori da questa
  revisione. **Raccomandazione: (a)**, e (c) solo se rifiutare sempre la stessa voce diventa un fastidio vero.
- **OQ-R2 — Fin dove arriva Annulla?** (a) Su ogni decisione, anche dopo un'applicazione: torna il valore di prima
  con la sua provenienza, un servizio aggiunto si toglie, uno aggiornato riprende i campi di prima; se il campo o il
  servizio è cambiato dopo, Annulla è rifiutato col motivo. (b) Su ogni decisione dei campi e sui rifiuti dei
  servizi; un servizio applicato si corregge da «I miei servizi». (c) Solo sui rifiuti; per le applicazioni resta
  *"prima: …"* visibile e copiabile (la decisione 4 del 2026-10-02). **Raccomandazione: (a).** Il dato serve comunque
  per *"prima: …"*. Una regola sola (*"ogni decisione si annulla dalla sua riga"*) si spiega in una frase; tre regole
  diverse no. Ed è la risposta vera a *"Sostituisci il tuo testo"* con un clic solo (finding 3 del 2026-10-02).
- **OQ-R3 — La SPEC va emendata prima di implementare?** Il comportamento nuovo resta compatibile con E8–E12: quel
  che non si applica resta nella proposta come rifiutato (E10), e l'azione sull'intera proposta, con la sua
  conferma, è **Rifiuta le N voci da decidere…** (E12). Però la SPEC non nomina il rifiuto per voce, Modifica,
  Annulla e la chiusura da sé. **Raccomandazione: sì, un emendamento breve** nella sezione E (per esempio E15
  "l'utente rifiuta o modifica una singola voce; un valore modificato è scritto a mano", E16 "ogni decisione si
  annulla finché la proposta è sulla pagina; la proposta non è più in attesa quando non resta niente da decidere"),
  più una riga nel Decision Log, così `adversarial-review` giudica la stessa cosa che si implementa.
- **OQ-R4 — Un quarto verbo sui servizi in conflitto, «Completa solo i campi vuoti»?** Nel caso del seed (*"MVP in
  sei settimane"*) la proposta riempie tre campi vuoti e cambia solo *"A chi serve"*. Oggi, per tenere il proprio
  *"A chi serve"* e prendere il resto, si passa da **Modifica…**. **Raccomandazione: no per ora.** La riga dice già
  *"Riempie 3 campi vuoti · cambia «A chi serve»"*, e **Modifica…** ci arriva in un dialog. Un quarto bottone su ogni
  conflitto costa più di quanto aiuti finché il caso resta raro.
