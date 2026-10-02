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
updated: 2026-10-02
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

## Goal

Avere **in un posto solo chi sono e cosa vendo** — profilo, azienda estesa e servizi — ricavato dalle mie
superfici pubbliche (profilo LinkedIn, sito, miei post) e **applicato solo dove decido io**,
così che l'analisi delle persone sappia dire **quale dei miei servizi c'entra** con quella persona.

**Segnale di successo** (verifica con `agent-browser` sul server e2e con job finti): (1) da profilo vuoto, una
generazione e un **Applica tutto** riempiono profilo e servizi senza scrivere a mano nemmeno un campo;
(2) alla seconda generazione, su un profilo che ho corretto a mano, le voci da decidere stanno in cima e
**Applica tutto non tocca** nessuna parola scritta da me; (3) da `/settings/profile` leggo quali fonti sono
state lette e quali no, con il motivo, e quanti post sono stati letti per intero, **senza aprire il log di un
run**; (4) nessuna spesa parte senza anteprima, ed escludere una fonte cambia conteggi e stima sotto i miei
occhi; (5) la scheda di una persona nomina un servizio, e un servizio eliminato resta leggibile senza errori.

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
    conflitti in cima e fuori da "Applica tutto"; costo per fonte prima dell'avvio; esito per fonte scritto
    nella pagina, non solo nel log.
  > Persona non definita in `brain/domains/prospect-crm/`: caratterizzazione derivata dalla SPEC (Context,
  > "Per chi") e dai FLOW precedenti; è l'assunzione su cui si progetta.

---

## Entry points

Nessuna precondizione di ruolo (single-user, no-auth). Route deep-linkabili; le ancore già esistenti
continuano a funzionare (G2). **Nessun link apre da solo un dialog che spende**: le ancore portano al bottone.

| Entry | Route | Precondizioni / comportamento |
|---|---|---|
| **Profilo e azienda** | `/settings/profile` | Sezione esistente, estesa (G1). Ancore: `#profilo` (focus sul campo del profilo LinkedIn, come oggi) · `#azienda` (focus su "Di cosa si occupa", come oggi) · **`#genera`** (focus sul bottone della generazione) · **`#servizi`** · **`#proposta`** (presente solo con una proposta pendente; senza, l'ancora non trova nulla e la pagina resta in cima con la card della generazione che dice *"Nessuna proposta in attesa."*). |
| `/settings` | → `/settings/profile` | Redirect esistente, conserva l'ancora (A5 di `people-first-crm`). |
| **Genera profilo e servizi** | dialog dalla card `#genera` | Anteprima `JobPreviewDialog`. Il bottone è **sempre attivo** anche con blocker (la card ne anticipa il motivo in una riga, il dialog lo scrive e disabilita **Avvia**: G3, G4, convenzione di `apollo-lookalike`). |
| **Promemoria di Oggi** | `/` → `/settings/profile#genera` | Voce *"genera profilo e servizi"* nell'elenco "Da completare", solo se il profilo non è **mai** stato generato **e** non esiste nessun servizio (G6). |
| **Connessioni** | `/settings/connections` | Quarta card **Cloudflare** accanto ad Apify, Apollo e Anthropic (A3, H2). |
| **Strumento Cloudflare** | `/settings/connections/cloudflare?outcome=failed&page` | `$tool` accetta il nuovo valore; i run della generazione compaiono qui e negli strumenti delle **fonti scelte** (A6). **[→ PLAN: `$tool` valida oggi tre id: `cloudflare` non validato ⇒ "Strumento non trovato".]** |
| **Run della generazione** | `/settings/connections/runs/$runId` | Parametri (fonti scelte, senza segreti: A7), esito per fonte, log riga per riga (D10, D11). |
| **Scheda persona** | `/people/$id` → card "Fit e analisi AI" | Riga **Servizio più affine** quando l'analisi l'ha prodotta (F2–F5, F9). |
| **JobBanner** | sidebar, ogni pagina | Nuovo kind **"Genera profilo e servizi"**; link d'esito **Rivedi la proposta** e **Dettagli del run**; **Riprova…** sui falliti con gli stessi parametri (D12). |

### Architettura della pagina `/settings/profile`

Dall'alto, una colonna sola per ciò che si legge in orizzontale (A3 di questo elenco è l'unica novità
strutturale rispetto a oggi):

```
Impostazioni › Profilo e azienda
1. Card  «Genera profilo e servizi»            #genera     ← stato, costo anticipato, CTA
2. Sezione «Proposta del 20 set»               #proposta   ← solo se pendente; sopra i campi che cambia
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

### A. Primo giro: profilo vuoto → una generazione → "Applica tutto" (B5, D1–D5, E1, E8, G5, G6)

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
4. Fine job: toast e banner **Completato** — *"Proposta pronta: 6 campi del profilo e 5 servizi · fonti lette
   2 su 3 · 12 post per intero (30 solo estratto, non usati)."* Link: **Rivedi la proposta** ·
   **Dettagli del run**.
5. **Rivedi la proposta** → `/settings/profile#proposta`. Testata della sezione: *"Proposta del 20 set, 10:12
   · da 2 fonti su 3 · 6 campi e 5 servizi · nessuna voce scartata."* Riga in evidenza, che dice la
   verità sul database vero: con campi già compilati ma senza provenienza registrata (E14) è *"3 campi sono già
   compilati: Applica tutto li sostituisce. Il testo attuale è qui sopra ogni proposta."*; solo su un profilo
   davvero vuoto è *"Non hai scritto nulla a mano in questi campi: puoi applicare tutto e correggere dopo."*
   Azioni:
   **Applica tutto** (primario) · **Scarta la proposta…**; sotto il bottone l'hint *"Applica le 11 voci non
   scritte a mano. Nessun conflitto da decidere."*
6. **Applica tutto** → toast *"Applicate 11 voci: 6 campi e 5 servizi."*; la sezione Proposta sparisce (niente
   resta da applicare) e il focus va al titolo della card **La mia azienda**, che ora mostra i valori con il
   marcatore di provenienza *"dalla proposta del 20 set"* sotto ogni campo (B6); i 5 servizi sono nella card
   **I miei servizi** nell'ordine in cui la proposta li ha elencati (B4, riordinabile).
→ **Outcome:** profilo e servizi compilati senza scrivere niente; la card della generazione dice *"Ultima
generazione: 20 set, 10:12 · fonti lette: profilo LinkedIn, i miei post"* (G5); la voce *"genera profilo e
servizi"* sparisce da Oggi (G6); le analisi già fatte restano esattamente come sono — nessun badge, nessun
invito a rifarle (F7, percorso F).

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
6. **Avvisi gialli** (non di fonte): *"C'è una proposta del 18 set non applicata: una nuova generazione la
   sostituisce. Le voci già applicate restano."* (D8, E11).
7. **Blocchi** (rosso, **Avvia** disabilitato): *"ANTHROPIC_API_KEY mancante nel .env: senza l'elaborazione la
   generazione non può partire. Vai a Connessioni."* (D6) · *"Nessuna fonte disponibile: imposta il profilo
   LinkedIn o il sito, oppure sincronizza i tuoi post."* (D7) · *"Hai escluso tutte le fonti: scegline almeno
   una."* · *"C'è già un job in corso: Analisi, 2 min fa."* (D1).
→ **Outcome:** l'avvio è una decisione presa su poche righe leggibili, non su un modulo; il costo è per fonte
e la stima non è mai inventata.

### C. Giri successivi: la proposta su un profilo curato a mano (E3–E10, H5)

Il 4 ott, dopo aver riscritto posizionamento e due servizi a mano, Omar rigenera.

1. La card **Genera profilo e servizi** lo avvisa **prima di spendere**: *"4 campi su 7 e 2 servizi li hai
   scritti a mano: una nuova proposta li mostra come conflitti e non li sovrascrive."* (H5). Stessa frase nel
   sottotitolo del dialog.
2. Esito → **Rivedi la proposta**. Testata: *"Proposta del 4 ott, 09:40 · da 3 fonti su 3 · 3 voci da rivedere ·
   2 conflitti · 6 invariate nascoste · 1 voce scartata perché senza fonte."* (E5, E6). Azioni: **Applica
   tutto** con l'hint *"Applica solo le 3 voci che non hai scritto a mano. I 2 conflitti restano da decidere
   uno per uno."* (E8) · **Scarta la proposta…** (E12) · toggle **"Mostra le 6 voci invariate"**
   (`aria-expanded`, chiuso).
3. **Due gruppi**, mai una lista sola: **Campi del profilo (2 da rivedere · 4 invariati)** e **Servizi (1 nuovo
   · 1 in conflitto · 2 invariati)**. Dentro ogni gruppo l'ordine è **In conflitto → Nuovo → Modificato →
   Invariato**: prima ciò che chiede un giudizio.
4. **Riga di un campo** (E3, E4): titolo = nome del campo, poi lo stato in **testo** e le fonti.
   - Nuovo: *"**Tono di voce** · Nuovo · da: sito, i miei post"* → **Ora**: *"vuoto"* / **Proposta**: *"Diretto,
     concreto, con numeri…"* → **Applica**.
   - Modificato: *"**Cosa offri** · Modificato · da: sito"* → **Ora** e **Proposta** uno sopra l'altro (i testi
     sono paragrafi: affiancarli li spezza), il blocco della proposta con un bordo a sinistra.
   - Conflitto: *"**Posizionamento** · In conflitto con ciò che hai scritto a mano · scritto da te il 28 set ·
     da: sito, profilo LinkedIn"*; l'azione non si chiama "Applica" ma **Sostituisci il tuo testo**, e sotto:
     *"Fuori da «Applica tutto». Il tuo testo non si recupera."* (E9).
5. **Riga di un servizio** (E4, E7): il nome è la chiave del confronto (B10).
   - *"**Assessment architetturale in 2 settimane** · Nuovo · da: sito, i miei post"* con i campi proposti
     (A chi serve · Problema · Prove) → **Aggiungi questo servizio** (*"si aggiunge in fondo: l'ordine lo
     decidi tu"*, B4).
   - *"**Sviluppo a progetto** · Modificato · 2 campi su 5 · da: sito"*: solo i campi che cambiano, ognuno
     *"Ora: … → Proposta: …"*; in coda *"Invariati: nome, prove. I campi che la proposta non nomina restano
     come sono."* → **Aggiorna il servizio**.
   - *"**Fractional CTO** · In conflitto · scritto da te il 28 set"* → **Sostituisci con la proposta**, fuori da
     "Applica tutto" (E8, E9).
   - Un servizio uguale: compare solo aprendo gli invariati, *"**Formazione** · Invariato"*, senza azioni.
6. **Applica tutto** → toast *"Applicate 3 voci · 2 conflitti non toccati."*; le righe applicate restano nella
   sezione marcate *"Applicato ora"* (senza azione), il focus va al **primo conflitto** e una live region dice
   *"Restano 2 voci in conflitto."* Le voci non applicate restano nella proposta (E10): sotto la testata,
   *"Una voce che non applichi resta qui finché non la scarti o non generi di nuovo."*
7. Se **tutte** le voci sono conflitti: **Applica tutto** è disabilitato con il motivo scritto accanto (e in
   `aria-describedby`): *"Ogni voce della proposta cambierebbe un testo scritto da te: decidili uno per uno."*
8. **Scarta la proposta…** → conferma *"Scartare la proposta del 4 ott?"* — *"Spariscono le 5 voci non
   applicate. Profilo e servizi non cambiano. Per riaverla serve una nuova generazione, con la sua spesa."*
   **Annulla** (focus) · **Scarta la proposta**. Toast *"Proposta scartata. Il profilo non è cambiato."*
→ **Outcome:** una rigenerazione su un profilo curato si legge in tre righe e non porta via una parola scritta
da Omar; ciò che è già giusto è contato, non ripetuto.

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

1. **Nella pagina, non nel log** (G5): la card della generazione tiene l'esito dell'ultima corsa in una tabella
   **una riga per fonte** — *"Esito dell'ultima generazione per fonte"*: **Fonte · Esito · Dettaglio**
   - *"Profilo LinkedIn · letta · 20 set, 10:12"*
   - *"Sito · non letta · nessun sito impostato"* (C13, ogni "non letta" con il suo motivo; letto:
     *"Sito · letta · 7 pagine su 10"*)
   - *"I miei post · letta · 12 per intero, 30 solo estratto (non usati)"* (C8)
   e sotto: *"1 voce scartata perché senza fonte."* (E6) · *"Elaborazione: <modello>"* · **Vedi il run** (per il
   log riga per riga) · **Genera di nuovo…**
2. **Toast e banner** dicono le stesse cose in una riga (nessuna informazione vive solo nel log): *"Proposta
   pronta: 2 campi e 1 servizio · fonti lette 3 su 3 · 12 post per intero (30 solo estratto)."* + gli avvisi
   per fonte. Link **Rivedi la proposta**.
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
| Nessun contenuto da nessuna fonte (D14) | Esito **neutro**, modello non chiamato, nessuna proposta creata, la pendente resta intatta | Sistema una fonte, rigenera |
| Risposta del modello non conforme (Constraints) | Job **fallito**: *"Il modello ha risposto in una forma inattesa: nessuna proposta creata. Riprova."* — mai un profilo a metà | **Riprova…** (stessa anteprima) |
| Generazione fallita (D12) | Banner rosso + **Riprova…**: stessa anteprima, **stesse fonti scelte**, conteggi e blocchi ricalcolati adesso | Riprova o correggi |
| Applica su una proposta non più corrente (E11) | *"Questa proposta non è più quella corrente: la pagina si aggiorna."* + refetch; niente scritto | Rileggi la nuova |
| Applica su un servizio eliminato nel frattempo | *"Il servizio «X» non è più nel CRM: la voce torna «Nuovo»."*; confronto ricalcolato | Riapplica se vuoi |
| Applica fallito (rete, 500) | Errore accanto alla riga (`role="alert"`), la riga resta da applicare, le altre invariate | **Applica** di nuovo |
| Nome del servizio duplicato (B10) | Inline sotto il campo: *"Hai già un servizio con questo nome: «Assessment Architetturale». I nomi si distinguono a meno di maiuscole e spazi."* Nulla salvato | Cambia nome o modifica l'esistente |
| Nome del servizio vuoto (B2) | *"Inserisci il nome del servizio."*, focus sul campo | Compila |
| Salvataggio del profilo fallito | Come oggi: errore sotto il campo, i testi restano nel form | Salva di nuovo |
| Sito che non è un indirizzo web (C11) | Sotto il campo: *"Questo non sembra l'indirizzo di un sito: la generazione non potrà leggerlo."* (non blocca il salvataggio); nell'anteprima il sito è fra le Non disponibili | Correggi o ignora |
| Scarto della proposta fallito | *"Proposta non scartata: <messaggio>."* La proposta resta | Riprova |
| Riordino dei servizi fallito | *"Ordine non salvato: <messaggio>."* + ordine ripristinato | Riprova |
| Strumento o run inesistente | *"Strumento non trovato"* / *"Run non trovato"* + **Vai a Connessioni** | Naviga |
| Caricamento della pagina fallito | `ErrorBox` + **Riprova**; sidebar e ⌘K restano usabili | Riprova |

## Edge cases

- **Proposta pendente e nuova generazione** (E11): l'anteprima avvisa; la nuova proposta **sostituisce** la
  vecchia e non tocca nulla di ciò che era già stato applicato. Unica eccezione: se nessuna fonte produce
  contenuto la pendente resta intatta (D14).
- **Confronto ricalcolato a ogni lettura:** "nuovo / modificato / invariato / in conflitto" si decide **quando
  apri la proposta**, non quando è stata creata. Così un servizio eliminato, rinominato o corretto a mano dopo
  la generazione compare nello stato giusto senza errori.
- **Provenienza che cambia natura** (B6, H5): un valore *applicato da una proposta* non è un conflitto; appena
  lo modifichi a mano diventa *scritto da te* e la proposta successiva lo mostrerà come conflitto. Il marcatore
  sotto ogni campo lo rende leggibile prima della domanda *"perché questa voce è in conflitto?"*.
- **Campo in modifica mentre applichi** (attrito da pagina unica): applicare *Posizionamento* mentre il
  textarea della card ha testo non salvato non lo butta via — toast *"Applicato: Posizionamento. Avevi
  modifiche non salvate in quel campo: sono ancora nel form. Salva o ricarica la pagina."*
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
  *"1 voce scartata: nome già proposto."*
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
  corrente"* e si aggiorna; il riordino dei servizi converge all'ultimo clic (nessun lock, azioni reversibili).
- **Job avviato e pagina cambiata/ricaricata:** il banner si ricostruisce da `/api/jobs/current`; l'esito arriva
  comunque e la sezione Proposta compare al rientro sulla pagina.
- **Deep-link `#proposta` senza proposta:** nessuna sezione, la card della generazione dice *"Nessuna proposta in
  attesa."*; `#genera` con un blocco porta al bottone, non apre il dialog.
- **Riavvio del server con una proposta pendente** (H4): la proposta è un dato salvato, non uno stato della
  pagina: dopo un riavvio (o un `.env` sistemato e il server rilanciato) la sezione Proposta è ancora lì, con le
  stesse voci e le voci già applicate ancora applicate. Nessuna lista, nessuno stato e nessun valore del profilo
  cambia nel frattempo (H3).
- **Migrazione sul database reale** (Constraints): all'apertura della pagina dopo l'aggiornamento i campi nuovi
  sono vuoti, i post esistenti sono marcati integrale/troncato secondo C6, nessun servizio affine compare e
  nessuna rianalisi è proposta (F6). L'unica differenza visibile è il badge "da aggiornare" che si azzera una
  volta sola dove c'era (percorso F.6). Nulla da fare per l'utente.

## Friction notes & decisioni UX

- **Tolto: il modulo a sette caselle come unica strada.** Il primo giro è un bottone e un "Applica tutto"; la
  compilazione a mano resta, ma non è più il percorso obbligato (B3, B5).
- **Tolto: le voci invariate dalla lista.** Restano contate e riapribili (toggle con il numero): senza questo, la
  seconda generazione su un profilo buono sarebbe un muro di righe identiche. Nascoste **con il conteggio**, mai
  in silenzio (E3 resta soddisfatto per chi apre il gruppo).
- **Ordine per decisione, non per struttura dei dati:** conflitti, poi nuovi, poi modificati, poi invariati.
  L'utente legge dall'alto finché ha qualcosa da decidere.
- **"Ora" e "Proposta" incolonnati in verticale**, non affiancati: posizionamento, prove e problema sono
  paragrafi; due colonne strette li spezzano e obbligano a leggere a zig-zag.
- **Il conflitto ha un verbo suo** ("Sostituisci il tuo testo"), non "Applica": la parola dice cosa si perde.
  E resta **fuori** da "Applica tutto", con l'hint che lo dichiara prima del clic (E8, E9).
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
- **Scarto con conferma, non con un clic secco:** una proposta è costata soldi. "Un gesto" (E12) è letto come
  *un'azione sull'intera proposta*, non come *senza conferma* — la stessa asticella dell'eliminazione di un
  servizio (G7). Da confermare con l'utente (OQ-6).
- **Nessuna scorciatoia "genera e applica":** violerebbe E1 e l'invariante del dominio (decide l'utente).
- **Rinviato (YAGNI):** storico delle proposte (una sola pendente, E11); quarta strada "genera il profilo"
  nell'onboarding a CRM vuoto (là si portano dentro le persone, non si configura il venditore); "Tieni il mio"
  per chiudere una riga in conflitto (OQ-5); anteprima diff parola per parola dei
  testi lunghi; rilettura automatica del sito a scadenza (Non-Goal: nessun automatismo).

## Accessibilità

Stessa asticella dei FLOW precedenti (dialog Radix con focus trap e restore, `role="alert"` per blocchi ed
errori, stati mai solo a colore, nessun controllo solo al passaggio del mouse); in più (G9, G10):

- **Sezione Proposta:** `section aria-labelledby` con il titolo *"Proposta del 4 ott, 09:40"*; ogni gruppo
  (`Campi del profilo`, `Servizi`) è un `<section>` con intestazione che porta i conteggi nel nome; ogni voce è
  un `<li>`/`<article>` con intestazione = nome del campo o del servizio, e lo stato ("Nuovo", "Modificato",
  "Invariato", "In conflitto con ciò che hai scritto a mano") **in testo** dentro il nome accessibile.
- **Ora / Proposta** come coppia `dt`/`dd` (o blocchi etichettati): lo screen reader legge *"Ora: … Proposta:
  …"* senza dipendere dal bordo colorato. Le fonti di ogni voce sono testo, non solo tooltip (E5).
- **Dopo un'applicazione** il focus va alla voce successiva da decidere, o al titolo del gruppo se la lista si
  svuota (mai `body`, lezione di TD-4); live region `polite`: *"Applicato: Posizionamento. Restano 2 voci in
  conflitto."*
- **Applica tutto** disabilitato porta il motivo in `aria-describedby`; l'hint sotto il bottone è parte della
  sua descrizione, così "solo le voci non scritte a mano" si sente prima del clic.
- **Toggle degli invariati:** `button aria-expanded` con il conteggio nel nome (*"Mostra le 6 voci
  invariate"*).
- **Anteprima:** `fieldset`/`legend` **"Fonti da leggere"**; la label di ogni spunta contiene il costo
  (*"Profilo LinkedIn, 1 lettura con Apify, circa 0,01 dollari"*); le fonti non disponibili sono una lista con
  il motivo, non checkbox disabilitate; il riassunto e il costo stanno nella sezione
  `aria-label="Anteprima del job"` già esistente, con `aria-busy` durante il ricalcolo e un annuncio `polite`
  dopo ogni esclusione.
- **Servizi:** tabella con `caption` *"I miei servizi, in ordine"*; ↑ ↓ con nome completo (*"Sposta «Fractional
  CTO» su"*) e posizione annunciata dopo lo spostamento; **Elimina** apre una conferma con focus su
  **Annulla**; la provenienza è testo (*"scritto da te il 28 set"*).
- **Card della generazione:** la tabella dell'esito ha `caption` *"Esito dell'ultima generazione per fonte"*;
  "letta"/"non letta" sono parole, non icone.
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
- **OQ-5 — "Tieni il mio" su una voce in conflitto.** **Rinviato.** Una voce non applicata resta nella proposta
  (E10) e la proposta si scarta intera (E12): uno stato per riga da salvare e da spiegare («chiusa ma non
  applicata») non si paga per un fastidio che finisce alla rigenerazione successiva.
- **OQ-6 — Scarto della proposta: con conferma.** Confermato: *"Scartare la proposta del 4 ott?"* con **Annulla**
  a fuoco. Una proposta è costata denaro, stessa asticella dell'eliminazione di un servizio (G7).
- **OQ-7 — Il promemoria di Oggi.** **Due voci, non tre**: finché la generazione è possibile (profilo LinkedIn o
  sito impostati) la voce *"descrizione della tua azienda"* non compare, perché è proprio il campo che la
  generazione riempie. Resta *"profilo LinkedIn · genera profilo e servizi"*. Se la generazione non è possibile
  (nessun indirizzo), torna la voce di oggi. **[→ PLAN: è una condizione in più nell'elenco "Da completare",
  non una voce in più.]**
- **OQ-8 — Card `#profilo` → "I tuoi indirizzi pubblici".** Confermato: il titolo cambia, l'ancora `#profilo` e
  l'`id` del campo restano (G2 vincola indirizzi e ancore, non i titoli).
