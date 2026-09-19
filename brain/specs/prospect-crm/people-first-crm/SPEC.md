---
domain: prospect-crm
type: spec
status: draft
links:
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
  - "[[specs/prospect-crm/apollo-lookalike/SPEC|apollo-lookalike SPEC]]"
  - "[[tech-debt/prospect-crm/crm-foundation|tech-debt crm-foundation]]"
created: 2026-09-18
updated: 2026-09-18
---

# Spec: CRM centrato su Persone e Aziende (`people-first-crm`)

---

## User input

> Prima di portare avanti flussi di integrazione custom e connessione multipla, ho notato che non è
> possibile aggiungere nessuna persona a mano ne collegarla all'azienda.
>
> Vorrei che aggiungessi questa funzionalità e anche che il CRM fosse più incentrato nella sua navigazione
> su Persone, Aziende e più facilmente navigabile. Al momento sono molto confuso da come si deve navigare,
> da dove trovare i contatti.
>
> Anche il Fit non si può modificare. Va immaginato che questo tool deve servire anche gestire flussi
> manuali di una persona, che sta sia cercando cliente a freddo con dei tools ma anche attivamente creando
> network ad eventi.
>
> Ad esempio avere in impostazioni una sezione Connection che faccia vedere i singoli tools connessi e per
> ognuno ispezionare i logs, i run invece di avere tutto buttato.
>
> Ripensa in generale la navigazione

Risposte dell'utente alle domande di chiarimento (2026-09-18):

> Persona aggiunta a mano: **Nome + un recapito** — nome obbligatorio e almeno uno tra LinkedIn, email o
> telefono.
> Eventi di networking: **Fonte manuale + nota** — la persona risulta "aggiunta a mano" e il contesto va in
> una nota della timeline.
> Fit modificabile: **Tuo giudizio per ICP** — alto/medio/basso (+ nota) per un ICP, anche senza analisi
> AI; il tuo valore vince, una nuova analisi non lo sovrascrive, il fit dell'AI resta visibile accanto.
> Da includere oltre a navigazione, persona manuale, fit e Connessioni: **Ricerca globale**, **Home
> "Oggi"**, **Prossima azione / promemoria**. (Non scelto: pulsante "+ Nuovo" globale.)

---

## Context

**Per chi:** Omar, unico utente del CRM (locale, single-user). Fa prospecting in due modi che oggi il CRM
tratta in modo molto diverso: **a freddo con i tool** (sync delle interazioni ai propri post, persone di
un'azienda via Apify, aziende simili e contatti via Apollo) e **di persona**, costruendo network agli
eventi e nei contatti diretti.

**Il problema:**

- **Non si trovano i contatti.** Non esiste una pagina con *tutte* le persone: l'Inbox mostra solo chi non è
  in nessuna lista e, appena una persona entra in una lista, sparisce dall'Inbox; per ritrovarla bisogna
  sapere in quale lista sta. Completato l'onboarding, la home reindirizza all'Inbox. La navigazione segue i
  passaggi del prospecting a freddo (Inbox, Liste, ICP), non le cose che l'utente cerca (persone, aziende).
- **Il CRM non sa gestire un contatto nato di persona.** Una persona entra solo tramite un job e solo con un
  URL LinkedIn; non si può aggiungere chi si è conosciuto a un evento né collegare a mano una persona a
  un'azienda, e quello che l'utente corregge a mano un arricchimento lo riscrive. Non c'è modo di
  ricordarsi *quando* ricontattare qualcuno.
- **Il fit è solo dell'AI.** L'utente non può esprimere il proprio giudizio, nemmeno su chi conosce
  personalmente o su chi l'AI non ha dati.
- **Le Impostazioni mescolano tutto.** Chiavi dei servizi e storico dei job sono due elenchi indistinti; i
  job non hanno log (l'output dei processi finisce nella console del server e si perde), quindi un run
  fallito non si può ispezionare, né si vede per strumento.

**Cosa:** ripensare la navigazione attorno a **Persone** e **Aziende**, con una home **Oggi** che dice cosa
fare, una **ricerca globale**, l'aggiunta **manuale** di persone con collegamento all'azienda, il **fit
manuale per ICP**, una **prossima azione** per persona, e in Impostazioni una sezione **Connessioni** con
run e log di ogni strumento esterno.

**Perché ora:** è il prerequisito dichiarato dall'utente prima delle integrazioni custom e delle connessioni
multiple: Connessioni diventa il posto dove quelle arriveranno.

**Terminologia:** "persona" = ciò che nel codice e nel contract è un *prospect*; "strumento" = servizio
esterno usato dal CRM (Apify, Apollo, Anthropic); "run" = un'esecuzione che usa uno strumento (un job, o
un'analisi singola dalla scheda persona); "fit effettivo" = il fit manuale se c'è, altrimenti l'ultimo fit
dell'AI; "prossima azione" = promemoria datato su una persona; "oggi", "scaduta", "prossimi 7 giorni" =
date di calendario nel fuso orario del computer dell'utente (i prossimi 7 giorni vanno da domani a oggi + 7
inclusi); "dato impostato a mano" = un campo dell'anagrafica o il collegamento all'azienda che l'utente ha
scritto, scelto o rimosso dalla UI; "data di aggiunta" = il momento in cui la persona è entrata nel CRM (primo
job che l'ha portata o inserimento a mano), che non cambia con le fonti successive.

---

## Non-Goals

- **Evento come oggetto** (pagina evento con data, luogo, partecipanti) e **tag liberi**: per scelta
  dell'utente il contesto dell'incontro è una fonte "aggiunta a mano" + una nota.
- **Gestione delle chiavi dalla UI, connessioni multiple per strumento, integrazioni custom, nuovi
  strumenti**: sono la spec successiva annunciata dall'utente. Le chiavi restano nel `.env`.
- **Verifica attiva delle chiavi** (chiamata di prova al provider), **crediti residui** e **costo effettivo**
  dei run.
- **Notifiche fuori dal CRM** (email, push, calendario), prossime azioni ricorrenti o più prossime azioni per
  persona.
- **Uso da smartphone o da un altro dispositivo** (es. inserire un contatto dal telefono durante l'evento):
  il CRM resta locale; esporlo in rete aprirebbe i problemi di sicurezza già aperti (TD-23, TD-28).
- **Import** di persone da CSV, vCard o foto di biglietti da visita.
- **Unione automatica** di persone per email, telefono o nome; **fit manuale in blocco** su una selezione.
- **Arricchimento o analisi AI di persone senza LinkedIn**.
- **Ricerca full-text** in note, timeline, About ed esperienze (unica eccezione: il testo di "Come vi siete
  conosciuti", B5).
- **"Unisci con…" libero** dalla scheda persona: l'unione nasce solo da un conflitto su LinkedIn o email (E5).
- **Filtro per azienda di provenienza** (persone trovate da un'azienda ma non collegate a essa): restano
  visibili nelle Fonti della loro scheda.
- **Cambi al modello di ICP, Liste, candidate Apollo ed export**: restano come sono; cambiano solo come ci si
  arriva e il fit che mostrano ed esportano (F2).

---

## Acceptance Criteria

### A. Navigazione

- **A1.** La navigazione principale, visibile in ogni pagina, contiene nell'ordine: **Oggi**; un gruppo
  **Contatti** con **Persone** e **Aziende**; un gruppo **Prospecting** con **Liste** e **ICP**; in fondo
  **Impostazioni**.
- **A2.** Quando esistono persone da smistare (B3), accanto a Persone compare il loro numero; attivarlo apre
  Persone nella vista Da smistare. Con zero persone da smistare il numero non compare.
- **A3.** Nel testo visibile dell'interfaccia (titoli, voci, bottoni, messaggi, empty state, esiti dei job) le
  persone si chiamano "persona/persone" e non compaiono le parole "prospect"/"prospects" (il nome del gruppo
  "Prospecting" di A1 è ammesso) e "Inbox"; una persona in
  nessuna lista mostra "Nessuna lista". Fanno eccezione i riassunti dei run conclusi prima del rilascio, che
  si mostrano come sono stati scritti.
- **A4.** L'indirizzo dell'Inbox continua a funzionare: apre Persone nella vista Da smistare conservando
  testo, fonte, post, ICP, fit, stato, ordinamento e pagina; con `status=scartato` apre invece la vista
  Scartate con gli stessi filtri.
- **A5.** L'indirizzo della scheda di una persona e i link salvati a Liste, ICP, Aziende e Impostazioni restano
  validi.
- **A6.** Ogni pagina di dettaglio (persona, azienda, lista, ICP, strumento, run) mostra la sezione a cui
  appartiene (es. "Persone › Mario Rossi") e la voce di quella sezione risulta attiva nella navigazione.
- **A7.** Il link "indietro" della scheda persona riporta alla vista di provenienza con i suoi filtri e la sua
  pagina (Persone, una lista, un'azienda, Oggi); aperta da un link diretto, riporta a Persone.

### B. Persone

- **B1.** Persone elenca tutte le persone del CRM, a prescindere da liste e fonti; le persone scartate sono
  escluse salvo nella vista Scartate.
- **B2.** La pagina offre le viste **Tutte**, **Da smistare**, **Con prossima azione** e **Scartate**,
  ciascuna con il proprio conteggio; la vista scelta vive nell'URL.
- **B3.** **Da smistare** = persone non scartate, in nessuna lista e **senza** la fonte "aggiunta a mano". È
  un derivato: non si salva da nessuna parte e cambia da solo quando cambiano liste, stato o fonti.
- **B4.** Filtri combinabili con ogni vista, tutti nell'URL (reload e back li conservano): testo, stato (più
  valori), lista (inclusa "nessuna lista"), fonte (reazione, commento, dipendenti di un'azienda, Apollo,
  aggiunta a mano), post di provenienza, azienda collegata, ICP + fit (F3), prossima azione (scaduta, oggi,
  prossimi 7 giorni, nessuna), recapiti (con email, con LinkedIn, senza LinkedIn).
- **B5.** Il filtro testo cerca in nome, headline, ruolo, nome dell'azienda, email, telefono, URL LinkedIn e
  testo di "Come vi siete conosciuti" (così "DevFest" ritrova le persone di quell'evento): gli stessi campi
  della ricerca globale (I2).
- **B6.** Con un filtro testo attivo in una vista diversa da Scartate, se ci sono persone scartate che
  corrispondono la pagina ne indica il numero con il link alla vista Scartate con lo stesso testo.
- **B7.** Ogni riga mostra almeno: nome (con headline o ruolo), azienda (link alla scheda se collegata),
  stato, liste, prossima azione (data e testo), data di aggiunta; il fit compare quando è scelto un ICP.
- **B8.** Ordinamenti: fonti più recenti (default: l'ultima fonte ricevuta, o la data di aggiunta se è
  l'unica, come l'attuale "Catturati di recente"), data di aggiunta, nome, prossima azione (le più vicine prima, senza
  prossima azione in fondo), fit effettivo (con un ICP scelto), commenti prima, più interazioni. Nella vista
  Con prossima azione l'ordinamento di default è "prossima azione".
- **B9.** In ogni vista sono disponibili sulla selezione (visibili o "tutte le filtrate", con il cap
  esistente): Aggiungi a lista, Cambia stato (incluso Scarta e Ripristina), Arricchisci…, Analizza…; le
  azioni a pagamento passano dalla preview come oggi.
- **B10.** La pagina ha l'azione **Aggiungi persona**. A CRM vuoto l'empty state offre tre strade: aggiungi una
  persona a mano, sincronizza le interazioni ai tuoi post, cerca le persone di un'azienda.

### C. Aggiungere una persona a mano

- **C1.** "Aggiungi persona" è raggiungibile da Persone, da Oggi, dalla scheda di un'azienda (azienda già
  compilata) e dalla ricerca globale (nome già compilato col testo cercato, I4).
- **C2.** Campi: **nome** (obbligatorio), ruolo, azienda (collegata a un'azienda del CRM, creata sul posto con
  le regole di D3, oppure solo testo),
  URL del profilo LinkedIn, email, telefono, località, **"Come vi siete conosciuti"** (testo libero), **data
  dell'incontro** (default oggi), lista, stato iniziale (default Nuovo), prossima azione.
- **C3.** Il salvataggio richiede il nome e **almeno uno** tra LinkedIn, email e telefono. Un URL LinkedIn che
  non è il profilo di una persona, o un'email malformata, sono rifiutati con un messaggio in italiano accanto
  al campo; dopo un errore i valori inseriti restano nel form.
- **C4.** Salvando si apre la scheda della nuova persona con una conferma. L'alternativa **"Salva e aggiungi
  un'altra"** svuota il form conservando "Come vi siete conosciuti", data dell'incontro, lista e stato
  iniziale (e l'azienda, se il form è stato aperto dalla scheda di un'azienda), per inserire di fila le
  persone di uno stesso evento.
- **C5.** La persona creata ha nella sezione Fonti la fonte **"Aggiunta a mano"** con la data dell'incontro.
  Se "Come vi siete conosciuti" è compilato, la timeline contiene una **nota** con quel testo, datata alla
  data dell'incontro.
- **C6.** Uno stato iniziale diverso da Nuovo produce nella timeline un cambio di stato come ogni altro cambio
  manuale. Una lista scelta rende la persona membro di quella lista.
- **C7.** Se l'URL LinkedIn (normalizzato come oggi) appartiene già a una persona del CRM, la persona non si
  crea: il form indica quale persona, con il link alla sua scheda, e conserva i valori inseriti.
- **C8.** Se l'email (senza distinzione tra maiuscole e minuscole) appartiene già a una o più persone, il form
  le elenca con il link alla scheda e il salvataggio richiede una scelta esplicita: usare una di quelle
  persone (C9) oppure **Crea comunque**.
- **C9.** Nei casi C7 e C8 il form offre **Aggiungi l'incontro a <persona>**: quella persona riceve la fonte
  "Aggiunta a mano", la nota "Come vi siete conosciuti" datata alla data dell'incontro e, se scelte nel form,
  la lista e la prossima azione; gli altri campi del form non la modificano. Se la persona ha già una
  prossima azione, quella del form la sostituisce e il form lo dice prima di salvare; se ha già la fonte
  "Aggiunta a mano", la fonte resta con la sua data e il nuovo incontro si registra solo con la nota.
- **C10.** Se il nome coincide (ignorando maiuscole e spazi) con quello di una persona esistente senza
  LinkedIn o email in comune, il form mostra un avviso non bloccante con il link a quella persona e l'opzione
  **Aggiungi l'incontro a <persona>** di C9.
- **C11.** Aggiungere una persona a mano non richiede il profilo LinkedIn salvato, un ICP, una lista né alcuna
  chiave di servizio esterno, e non avvia job né spese.

### D. Persona ↔ azienda

- **D1.** La scheda persona mostra l'azienda collegata come link alla scheda dell'azienda e offre **Collega a
  un'azienda** (se non collegata), **Cambia azienda** e **Scollega** (se collegata).
- **D2.** "Collega" cerca tra le aziende del CRM per nome, dominio o pagina LinkedIn, con la ricerca già
  compilata col nome dell'azienda scritto sulla persona; scelta un'azienda, la persona risulta collegata e
  compare tra le persone di quell'azienda.
- **D3.** Nello stesso passo si può **creare una nuova azienda** con nome e almeno uno tra sito web e pagina
  LinkedIn (le regole di identità delle aziende di oggi); se il sito o la pagina appartengono già a
  un'azienda del CRM, viene proposta quella invece di crearne una doppia.
- **D4.** Una persona senza azienda collegata conserva il nome dell'azienda come testo; la scheda lo mostra
  come "non collegata" con l'azione per collegarla.
- **D5.** La sezione **Persone** della scheda azienda elenca le persone **collegate** a quell'azienda. Dopo
  "Scollega" o "Cambia azienda" la persona non vi compare più; le sue fonti (es. "dipendenti di <azienda>")
  restano invariate nella sua scheda.
- **D6.** La sezione Persone della scheda azienda offre **Aggiungi persona** (azienda già compilata) e
  **Collega una persona esistente** (ricerca tra le persone del CRM).
- **D7.** Dopo che l'utente ha collegato, cambiato o scollegato l'azienda di una persona, nessun job
  (arricchimento, persone di un'azienda, contatti Apollo, unione automatica) cambia più quel collegamento.
- **D8.** Un campo dell'anagrafica impostato a mano (nome, headline, ruolo, azienda testuale, località, About,
  email, telefono) non viene sovrascritto né svuotato da un job, e un campo svuotato a mano non viene
  riempito; i job continuano a riempire i campi vuoti mai toccati e ad aggiornare quelli mai toccati a mano.
- **D9.** Un arricchimento che serve solo a trovare l'email (Apollo) esclude dalla preview e dalla stima le
  persone la cui email è stata svuotata a mano, contandole a parte.

### E. Identità delle persone

- **E1.** Regola di identità: una persona è riconosciuta dal suo **URL LinkedIn** (unico quando presente) e
  dall'**id membro LinkedIn**, come oggi. L'**email** non è una chiave: più persone possono averla uguale e
  serve solo al controllo doppioni sugli inserimenti e sulle modifiche manuali (C8, E5). Il **telefono** non è
  mai una chiave. Una persona senza LinkedIn si unisce ad altre solo con "Unisci" (E6).
- **E2.** Una persona può esistere **senza URL LinkedIn** se ha un'email o un telefono. Le persone portate dai
  job continuano ad avere sempre un URL LinkedIn.
- **E3.** Il profilo LinkedIn si può **aggiungere** a una persona che non ce l'ha e **correggere** su una
  persona che ha solo la fonte "Aggiunta a mano"; non si può rimuovere, né cambiare su una persona che ha
  almeno una fonte portata da un job.
- **E4.** Una persona senza LinkedIn non può restare senza email e senza telefono: la modifica che li svuota
  entrambi è rifiutata con un messaggio.
- **E5.** Solo quando il valore cambia: se il nuovo URL LinkedIn appartiene a un'altra persona il salvataggio
  non avviene e la scheda propone **Unisci**; se la nuova email appartiene ad altre persone la scheda le
  indica e propone **Unisci** o **Salva comunque**.
- **E6.** **Unisci** tiene la persona di cui si sta guardando la scheda e mostra prima un'anteprima: fonti,
  liste, attività e analisi che confluiscono, e per ogni valore in conflitto quale resta e quale si perde.
  Resta il valore della persona tenuta per: ogni campo dell'anagrafica non vuoto, lo stato, la prossima
  azione e il fit manuale di ciascun ICP; i valori dell'altra persona riempiono solo ciò che manca. Quando
  l'unione nasce da una modifica (E5), i valori che si stavano salvando contano come valori della persona
  tenuta.
- **E7.** Profilo LinkedIn nell'unione: nel caso LinkedIn di E5 la persona che resta prende l'URL che si stava
  salvando e l'id membro dell'altra persona. Negli altri casi resta il profilo LinkedIn di chi lo ha; se le due
  persone hanno URL LinkedIn o id membro diversi, "Unisci" non è disponibile e la scheda spiega che sono due
  profili LinkedIn distinti.
- **E8.** Confermata l'unione resta **una sola** persona con le fonti, le liste, le attività e le analisi di
  entrambe; lo stato della persona tenuta non cambia e non genera un cambio di stato (la timeline conserva i
  cambi di stato passati di entrambe); la scheda dell'altra persona risponde "persona non trovata" come oggi
  dopo un'unione.
- **E9.** Le unioni automatiche che i job fanno già oggi (stesso profilo scoperto da un arricchimento o da una
  fonte) conservano ciò che l'utente ha impostato a mano su **una qualsiasi** delle due persone: campi e
  collegamento all'azienda (D7, D8, che restano "impostati a mano"), fit manuale di ciascun ICP e prossima
  azione. Se entrambe hanno lo stesso elemento impostato a mano, resta quello impostato più di recente. Per
  lo stato vale la regola di oggi (il cambio più recente).
- **E10.** Un job che trova una persona con lo stesso URL LinkedIn di una persona aggiunta a mano aggiorna quella
  persona (rispettando D7 e D8) e ne aggiunge la fonte, senza crearne un'altra.
- **E11.** Arricchimento e analisi escludono le persone senza LinkedIn in ogni punto di partenza: nella preview
  di una selezione o di una lista sono contate a parte ("N senza LinkedIn: escluse") e non entrano nella
  stima né nella spesa; nella loro scheda "Arricchisci" e "Analizza" sono disabilitati con il motivo scritto.
- **E12.** La scheda di una persona senza LinkedIn non offre "Apri su LinkedIn" ma **Aggiungi profilo
  LinkedIn**; l'export CSV la include con la colonna LinkedIn vuota.

### F. Fit manuale per ICP

- **F1.** Nella scheda persona, per l'ICP scelto, **Imposta il mio fit** permette di scegliere alto, medio o basso con
  una motivazione facoltativa, anche se la persona non è mai stata arricchita né analizzata.
- **F2.** Il **fit effettivo** per un ICP è il fit manuale se esiste, altrimenti l'ultimo fit dell'AI.
  Ordinamento per fit ed export CSV usano il fit effettivo e ne indicano l'origine (tuo / AI).
- **F3.** Per un ICP, colonna fit delle tabelle (Persone, Lista, Azienda) e filtro fit mostrano lo stesso
  valore, con l'origine (tuo / AI): il fit manuale se esiste; altrimenti lo
  stato dell'analisi AI di oggi (alto, medio, basso, rifiutata, errore, non arricchibile, non analizzata). Il
  filtro accetta tutti questi valori.
- **F4.** Quando fit manuale e fit dell'AI esistono entrambi, la scheda li mostra tutti e due (es. "Tuo: alto ·
  AI: medio"); un'analisi AI fallita resta visibile nella scheda anche quando c'è un fit manuale.
- **F5.** Una nuova analisi AI non modifica il fit manuale; il nuovo fit dell'AI compare accanto.
- **F6.** **Rimuovi il mio fit** riporta il valore di F3 allo stato dell'analisi AI.
- **F7.** Impostare, cambiare o rimuovere il fit manuale aggiunge una voce alla timeline con l'ICP, il valore
  precedente e il nuovo.
- **F8.** L'indicazione "da aggiornare" riguarda solo l'analisi AI: non compare sul fit manuale.
- **F9.** Senza nessun ICP la scheda spiega che il fit si esprime rispetto a un ICP e porta a crearne uno.
- **F10.** Eliminando un ICP si eliminano anche i fit manuali espressi per quell'ICP, e la conferma di "Elimina
  ICP" lo dice con il loro numero.

### G. Prossima azione

- **G1.** Ogni persona ha **al più una** prossima azione: data obbligatoria e testo breve facoltativo. Si
  imposta, modifica e rimuove dalla scheda persona e dal form di aggiunta.
- **G2.** Registrando un touchpoint si può impostare o aggiornare nello stesso passo la prossima azione.
- **G3.** La prossima azione è presentata come **scaduta**, **oggi** o **futura**, con la stessa distinzione in
  scheda, in Persone e in Oggi, e non solo con il colore.
- **G4.** **Fatto** rimuove la prossima azione e aggiunge alla timeline "Prossima azione completata" con il suo
  testo.
- **G5.** **Rimanda** sposta la prossima azione a domani, tra una settimana (entrambi contati da oggi, non
  dalla data della prossima azione) o a una data scelta.
- **G6.** Impostare, completare o rimandare una prossima azione non cambia lo stato della persona né le sue
  liste.

### H. Oggi (home)

- **H1.** Con almeno una persona nel CRM, la home è **Oggi** e non reindirizza altrove.
- **H2.** Oggi mostra **Da fare**: le persone non scartate con prossima azione scaduta o di oggi, le scadute
  prima, con nome, azienda, testo e data, e le azioni Fatto, Rimanda e apri scheda.
- **H3.** Oggi mostra **In arrivo**: le persone non scartate con prossima azione nei prossimi 7 giorni.
- **H4.** Oggi mostra il numero di persone **da smistare** con il link alla vista, e le **ultime 10 persone
  aggiunte** per data di aggiunta (qualunque fonte) con fonte e data; "Aggiungi l'incontro" (C9) su una
  persona già presente non la porta in questo elenco.
- **H5.** Per ogni strumento il cui run più recente è **fallito** (J4), Oggi lo segnala con il link al
  dettaglio del run.
- **H6.** Oggi offre **Aggiungi persona**. Ogni sezione vuota ha un testo neutro che dice cosa ci comparirà.
- **H7.** Una configurazione incompleta (profilo LinkedIn, descrizione azienda, ICP, chiavi) compare in Oggi
  come promemoria compatto che non impedisce di usare il resto. Ogni voce si può nascondere e resta nascosta
  finché l'insieme delle voci mancanti non cambia.
- **H8.** A CRM vuoto (nessuna persona) la home è l'onboarding, con **tre** strade per le prime persone:
  aggiungila a mano (sempre disponibile), sincronizza le interazioni (richiede il profilo), cerca le persone
  di un'azienda (richiede un ICP).

### I. Ricerca globale

- **I1.** Da ogni pagina la ricerca è raggiungibile dalla navigazione e con **⌘K** (macOS) / **Ctrl+K**, che la
  aprono con il cursore nel campo.
- **I2.** Cerca le persone negli stessi campi del filtro testo di Persone (B5) e le aziende per nome, dominio e
  pagina LinkedIn; i risultati sono raggruppati in Persone e Aziende, ciascuno con una seconda riga (ruolo e
  azienda; dominio). Le persone scartate compaiono, indicate come tali.
- **I3.** I risultati si aggiornano mentre si scrive, da 2 caratteri, con al più 5 risultati per gruppo e il
  link "Vedi tutte le persone per '<testo>'" che apre Persone (vista Tutte) con quel filtro testo.
- **I4.** L'ultima voce della ricerca è sempre **Aggiungi '<testo>' come persona** (C1), anche quando ci sono
  risultati (un omonimo trovato non è necessariamente la persona appena conosciuta).
- **I5.** La ricerca si usa tutta da tastiera: frecce per muoversi, Invio apre il risultato, Esc chiude e
  riporta il focus dove era.

### J. Impostazioni e Connessioni

- **J1.** Impostazioni ha tre sezioni, ciascuna con un proprio indirizzo: **Profilo e azienda**, **I miei
  post**, **Connessioni**. Le attuali "Configurazione" e "Ultimi job" non esistono più come sezioni a sé: il
  loro contenuto è in Connessioni.
- **J2.** Connessioni elenca **uno per uno** gli strumenti Apify, Apollo e Anthropic. Per ognuno: nome, cosa
  abilita nel CRM, stato della chiave (configurata / mancante, con il nome della variabile del `.env`), data
  ed esito dell'ultimo run, numero di run.
- **J3.** Un run appartiene a ogni strumento che usa: sync interazioni e persone di un'azienda → Apify;
  arricchimento → Apify o Apollo secondo lo strumento scelto; analisi → Anthropic, e anche Apify quando
  arricchisce prima; arricchimento aziende, aziende simili e contatti Apollo → Apollo.
- **J4.** Esito di un run: **completato**, **completato con avvisi** (errori su singoli elementi o warning),
  **fallito** (il run non è arrivato in fondo). Un run fallito conta come fallito per lo strumento la cui
  chiave o chiamata ha prodotto l'errore; un errore che non si può ricondurre a uno strumento conta per tutti
  gli strumenti del run. Un'analisi
  rifiutata dal modello è "completato con avvisi".
- **J5.** "Configurata" significa solo che la chiave è presente. Se il run più recente dello strumento è
  fallito, la connessione lo mostra con l'errore, così una chiave presente ma non valida non passa per sana.
- **J6.** Ogni strumento ha una pagina con i **suoi run**, dal più recente: operazione (in italiano), avvio,
  durata, esito, riassunto; con filtro Tutti / Falliti.
- **J7.** Ogni run ha un **dettaglio** con indirizzo proprio: parametri in forma leggibile (lista, numero di
  persone, ICP, strumento scelto…), inizio, fine e durata, esito (riassunto, conteggi, warning), errore con la
  sua attribuzione, e il **log**.
- **J8.** Il **log** di un run è un elenco di righe con orario che racconta cosa il run ha fatto: fasi,
  chiamate allo strumento (quale operazione, non i dati inviati o ricevuti), elementi elaborati, errori per
  singolo elemento, warning, esito finale.
- **J9.** Il log resta consultabile dopo la fine del run e dopo un riavvio del server. Con un run in corso e il
  dettaglio aperto, le nuove righe compaiono senza ricaricare la pagina.
- **J10.** Log e dettagli non contengono mai chiavi API, token o i corpi delle richieste e risposte degli
  strumenti.
- **J11.** I log di tutti i run si conservano finché esiste il run. Un log oltre **5.000 righe** viene troncato
  conservando inizio e fine (avvio, esito ed errore finale restano visibili) con un avviso esplicito nel
  dettaglio; un run precedente a questa funzione mostra "Log non disponibile per questo run".
- **J12.** Da un job fallito, **Riprova** (dal dettaglio del run, dal banner o dagli avvisi) apre prima la
  preview con gli stessi parametri: conteggi, stima e blocchi aggiornati; il job riparte solo da "Avvia",
  sempre con un solo job alla volta.
- **J13.** Il dettaglio di un'analisi singola fallita non ha "Riprova": porta alla scheda della persona, dove
  l'analisi si rilancia come oggi.
- **J14.** L'esito di un run nel banner dei job e nei suoi avvisi porta al dettaglio di quel run.
- **J15.** Le **analisi singole** avviate dalla scheda persona compaiono tra i run (J3) con esito e log, senza
  cambiare il fatto che non bloccano né sono bloccate dagli altri job.

### K. Coerenza con il dominio

- **K1.** Ogni cambio di stato resta manuale e registrato nella timeline, compreso lo stato iniziale scelto in
  C6.
- **K2.** Aggiungere, collegare e unire persone, impostare fit e prossime azioni non chiamano strumenti
  esterni e non costano nulla; ogni azione a pagamento, compreso "Riprova", passa dalla preview.
- **K3.** Né l'AI né i job impostano il fit manuale o la prossima azione, né cambiano liste, stati, il
  collegamento all'azienda o i dati impostati a mano al posto dell'utente.
- **K4.** Da smistare, fit effettivo e scadenza della prossima azione restano derivati.
- **K5.** Testo dell'interfaccia e messaggi d'errore in italiano; navigazione, ricerca, form e dialog sono
  usabili da tastiera, con etichette e con errori annunciati.

---

## Constraints

- **Dati reali già presenti**: `data/crm.db` contiene persone, aziende e job reali. Ogni cambio allo schema deve
  preservarli (nessuna persona, fonte, lista, attività, analisi o job perso) e seguire la regola di migrazione
  del repo (backup prima di ricostruire una tabella, idempotente, no-op su DB già migrati). I campi già
  presenti al momento della migrazione non risultano "impostati a mano".
- **Contratti che questa spec cambia** (da aggiornare con `docs-maintenance` dopo l'implementazione, e nel
  frattempo validi in questa versione):
  - contract, **Invariants → Identità**: diventa E1 (URL LinkedIn facoltativo, email non chiave, unione
    manuale con anteprima);
  - contract, **Owns → Organizzazione**: l'Inbox diventa la vista Da smistare (B3);
  - contract, **Owns → Gestione del contatto** e **Automatismi**: fit manuale, prossima azione, dati impostati
    a mano che i job non sovrascrivono (D7, D8, K3);
  - contract, **Owns → Web UI locale**: le pagine diventano Oggi · Persone · Aziende · Liste · ICP ·
    Impostazioni (Profilo e azienda, I miei post, Connessioni);
  - root `AGENTS.md`, **Prospect identity**: `linkedin_url` nullable, email non chiave;
  - crm-foundation `FLOW.md`: Entry points (Home, Impostazioni, Inbox, Prospect), A (onboarding), C (triage
    dell'Inbox, che si fa nella vista Da smistare) sono sostituiti dal `FLOW.md` di questa spec;
  - ovunque i `FLOW.md` di crm-foundation e apollo-lookalike nominano Inbox, prospect, "Configurazione" o
    "Ultimi job" (testi, badge, link d'esito), valgono A3, J1 e il `FLOW.md` di questa spec.
- **Dati personali nei log**: i log possono contenere nomi e aziende; restano locali accanto al DB, mai nel
  repository, con una dimensione massima per run.
- **Tempo di risposta locale**: su un archivio di 10.000 persone e 2.000 aziende, i risultati della ricerca
  globale compaiono entro 300 ms dall'ultimo tasto e Persone si apre entro 1 s.
- **Test**: server in vitest attraverso le interfacce pubbliche; frontend con `agent-browser` sul server e2e
  finto; mai chiamate reali ad Apify, Anthropic o Apollo.
- **Solo desktop**, locale, single-user, senza auth (invariato).

---

## Data model (delta, livello di dominio)

- **Persona**: URL LinkedIn facoltativo; almeno uno tra URL LinkedIn, email e telefono; data di aggiunta;
  **prossima azione** (data + testo + quando è stata impostata); traccia di quali campi e del collegamento
  all'azienda l'utente ha impostato a mano, e quando (serve alla regola di E9).
- **Fit manuale**: al più uno per coppia persona–ICP, con valore, motivazione e data; distinto dalle analisi
  AI, che restano uno storico solo in aggiunta; sparisce con l'ICP (F10).
- **Timeline**: nuove voci per fit manuale (impostato / cambiato / rimosso) e prossima azione completata; la
  nota "Come vi siete conosciuti" (anche quella aggiunta da C9) è una nota datata alla data dell'incontro e
  riconoscibile come **contesto dell'incontro**: è l'unica nota cercabile (B5); modificarla o eliminarla ne
  cambia o toglie il testo dalla ricerca.
- **Fonti**: la fonte "aggiunta a mano" (già prevista, mai scritta finora) diventa reale, con la data
  dell'incontro.
- **Run**: ogni run conserva il proprio log; le analisi singole diventano run consultabili; gli strumenti di
  un run si ricavano dal tipo e dai parametri (J3).

---

## Technical Notes

- `prospects.linkedin_url` è oggi `NOT NULL UNIQUE` (`src/db/schema.ts:195`). Non esiste un endpoint di
  creazione di una persona; `PATCH /prospects/:id` non modifica né `linkedin_url` né `company_id`
  (`src/db/prospects.ts:231-240`).
- `company_id` lo scrivono: l'arricchimento (per URL o nome esatto dell'azienda, solo se vuoto:
  `src/jobs/enrich.ts:256-263,300`), `source_company` (con `refresh` lo sovrascrive:
  `src/jobs/source-company.ts:199-220`), `apollo_people`, l'unione di persone (`src/db/identity.ts:130`) e
  quella di aziende. L'arricchimento sovrascrive nome, headline, About, località, azienda testuale e ruolo
  con i valori nuovi non vuoti; email e telefono solo se vuoti (`src/jobs/enrich.ts:295-300`). D7/D8 cambiano
  questo comportamento.
- Enrichment e contatti Apollo scrivono l'email senza controlli di unicità (`src/jobs/enrich.ts:298`,
  `src/jobs/apollo-people.ts:445`): per questo l'email non può essere una chiave (E1).
- La scheda azienda oggi elenca le persone con `company_id` **oppure** una fonte su quell'azienda
  (`src/db/prospects.ts:720-723`): D5 restringe alle collegate.
- Colonna e filtro fit usano un'unica espressione di stato dell'analisi (`analysisStateSql`,
  `src/db/prospects.ts:477-501`, filtro a 753-760, ordinamento a 779-784); F3 vi antepone il fit manuale.
- `mergeProspects` (`src/db/identity.ts:148`) sposta fonti, liste, attività e analisi, sceglie lo stato col
  cambio più recente e cancella la persona assorbita.
- I job non hanno log: stdout/stderr del processo figlio vanno nella console del server
  (`src/server/jobs.ts:120-124`) e solo l'ultima riga di stderr finisce in `jobs.error` se il processo muore.
- L'analisi singola (`POST /prospects/:id/analyze`, `src/server/routes/analyze.ts:78-83`) è sincrona e **non**
  crea una riga `jobs`: registrarla come run non deve farla contare come "job in corso".
- "Riprova" oggi riparte senza preview (TD-25, parzialmente chiuso): J12 chiude la parte residua.
- Chiude la decisione aperta TD-38 (redirect della home all'Inbox): la home diventa Oggi.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | Quanto si conservano i log e qual è il limite per run? | J9, J11 | Omar | Resolved (default, da confermare): tutti finché esiste il run, 5.000 righe per run con inizio e fine |
| 2 | Indirizzi delle nuove pagine (Persone, Oggi, Connessioni, strumento, run) e nome della scheda persona nell'URL | A4, A5, A6 | FLOW | Resolved: route in FLOW → Entry points (`/people`, `/people/$id`, `/settings/connections/…`, redirect da `/inbox`, `/prospects/$id`, `/settings`) |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Una sola spec per navigazione, persona manuale, fit, prossima azione, Oggi, ricerca e Connessioni | L'utente ha chiesto un ripensamento unico della navigazione; le parti si toccano (Oggi usa prossime azioni e run, Persone usa fit e prossima azione, Impostazioni cambia struttura). |
| Navigazione: Oggi · Contatti (Persone, Aziende) · Prospecting (Liste, ICP) · Impostazioni; l'Inbox diventa la vista Da smistare di Persone | L'utente non sa dove trovare i contatti: persone e aziende sono ciò che cerca; l'Inbox nascondeva chi entrava in una lista. |
| "Persone" nell'interfaccia al posto di "prospect" e "Inbox" | Chi si conosce a un evento non è necessariamente un prospect; l'utente parla di "Persone". |
| Persona manuale = nome + almeno un recapito; LinkedIn facoltativo | Scelta dell'utente: a un evento spesso si ha solo il biglietto da visita. |
| Identità: LinkedIn + id membro come oggi; email solo controllo doppioni manuale; telefono mai chiave; unione solo su richiesta con anteprima | Gli arricchimenti scrivono email senza unicità e gli indirizzi condivisi (info@) fonderebbero persone diverse; l'utente decide, come per stati e liste. |
| Nell'unione manuale resta la persona della scheda aperta, con i suoi valori | È la persona su cui l'utente sta lavorando; l'anteprima mostra cosa si perde. Le unioni automatiche mantengono la regola di oggi sullo stato. |
| Evento = fonte "aggiunta a mano" + nota datata; "Aggiungi l'incontro" su una persona già presente | Scelta dell'utente; "Salva e aggiungi un'altra" copre più persone dello stesso evento. |
| Da smistare esclude le persone aggiunte a mano | Chi l'utente inserisce di persona è già stato valutato: non deve finire nella coda di triage dei tool. |
| Unisci rifiutato tra due profili LinkedIn distinti; nelle unioni automatiche vince ciò che è impostato a mano | Un'unione non deve perdere una chiave d'identità (un job ricreerebbe la persona persa) né il lavoro manuale dell'utente. |
| I dati impostati a mano (campi e collegamento all'azienda) non vengono riscritti dai job | Senza questa regola il primo arricchimento annullerebbe "Collega", "Scollega" e le correzioni dell'utente. |
| Fit manuale per ICP che prevale sull'AI e non viene sovrascritto; in colonna e filtro gli stati di errore dell'AI compaiono solo senza fit manuale (in scheda restano visibili, F4) | Scelta dell'utente; un'unica definizione per colonna e filtro come oggi. |
| Una sola prossima azione per persona, senza notifiche esterne | Sufficiente per i follow-up; notifiche e ricorrenze richiederebbero processi sempre attivi, esclusi dal contract (nessuno scheduling). |
| Home = Oggi (niente più redirect all'Inbox) | Richiesta dell'utente; chiude TD-38. |
| Niente pulsante "+ Nuovo" globale | Non scelto dall'utente; l'aggiunta resta raggiungibile da Persone, Oggi, Azienda e dalla ricerca. |
| "Aggiungi '<testo>' come persona" sempre ultima voce della ricerca | Non è il "+ Nuovo" globale: nasce dal testo cercato, dopo aver visto se la persona c'è già (il controllo doppioni di C7–C10 resta nel form). |
| Connessioni per strumento con run e log; chiavi ancora nel `.env` | Richiesta dell'utente; gestione delle chiavi e connessioni multiple sono la spec successiva. |
| "Riprova" passa dalla preview | Preview prima di ogni spesa (contract); chiude il residuo di TD-25. |
| Persone di un'azienda = persone collegate | Separa "dove lavora" dalla provenienza; le fonti restano nella scheda persona. |
| Accolte le proposte P1–P11 del FLOW (route, azienda conservata e creabile nel form, "Aggiungi l'incontro" anche sul nome, valori salvati che vincono nell'unione, ordinamento della vista prossime azioni, "Rimanda" da oggi, riassunti storici, fit eliminati con l'ICP, promemoria nascondibili, troncamento inizio+fine) | Chiudono buchi del ciclo "evento → più persone di fila" e casi limite emersi scrivendo il flusso. |
| Il testo di "Come vi siete conosciuti" è cercabile (unica eccezione alla ricerca nelle note) | "Chi ho conosciuto a <evento>?" è la domanda tipica del networking e senza un oggetto evento non avrebbe risposta. |
| Rinviati "Unisci con…" libero e il filtro per azienda di provenienza | Casi rari oggi; l'unione da conflitto e le Fonti coprono il bisogno. |
