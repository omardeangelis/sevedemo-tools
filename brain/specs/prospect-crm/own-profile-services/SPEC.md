---
domain: prospect-crm
type: spec
status: draft
links:
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[chore/roadmap-apollo-icp-assistant-profilo|roadmap Apollo · assistente ICP · anagrafica]]"
  - "[[specs/prospect-crm/apollo-lookalike/SPEC|apollo-lookalike SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW|FLOW]]"
  - "[[specs/prospect-crm/people-first-crm/SPEC|people-first-crm SPEC]]"
created: 2026-09-20
updated: 2026-09-22
---

# Spec: Profilo e servizi dell'utente da fonti pubbliche (`own-profile-services`)

---

## User input

> Credo ne avessimo già parlato di questa parte in cui andare a lavorare su una migliore creazione del
> proprio profilo personale, così da riuscire ad avere uno spettro completo del profilo e una migliore e
> semplice allineamento del profiloe dei servizi.
>
> Le idea searebbero queste:
>
> La creazione del tuo profilo, servizi e account potrebbe nascere da un service che:
>
> * Accetta il tuo profilo linkedin da cui estrae informazioni
>
> * Accetta il tuo sito che screpa ed estrae da qui entrambi le informazioni -
>
> * Le elabora con un LLM e crea una tua anagrafica e suggerisce descrizioni utili dei tuoi prodotti e
> servizi che possono essere usati per estrarre le aziende con apollo

> Non è che voglio che venga generata la ricerca aziendale, l'obiettivo è che queste informazioni poi
> possano essere usate nella definizione del ICP, di affinitià con quest'ultimo. Tutta la piattaforma deve
> collaborare.
>
> Sono d'accordo con aggiungere i miei post e anche la pagina aziendale può aiutare nella composizione di un
> profilo dell'utilizzatore migliore.
>
> In generale l'idea è che tutte le parti si parlino: che l'utente possa avere un profilo con i servizi
> dettagliato e coerente con i touchpoints che porta ai clienti finali, con cui può rifinire ICP.
>
> Per lo scraper perché farlo in house invece che usare ad esempio ?
> https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/

Risposte alle domande di chiarimento (2026-09-20):

> (lettura web) Cloudflare Browser Run
> (servizi) Tabella dei servizi
> (ponte ICP) ICP poi verrà creato usando un chatbot che avrà accesso a queste informazioni. Ora lo scopo è
> e rimane quello di creare un profilo dell'utilizzatore ben definito
> (affinità) Sì, con il servizio più affine
> (touchpoint) sito, pagina linkedin, profilo linkedin, post. tutto quello che è pubblico
> (post) Testo integrale dai prossimi sync
> (sito) Il sito è facoltativo
> (rigenerazione) Sempre proposta, mai sovrascrittura
> (collocazione) Estendi «Profilo e azienda» nelle Impostazioni
> (quarta fonte) Il record Apollo per dominio
> (applica tutto) Li salta e li segnala

Decisione successiva, in revisione della spec (2026-09-22):

> La cosa che mi interessa è che analisi passate non vanno invalidate dopo che modifico dei punti nel mio ICP,
> servizi o profilo. Se voglio rifarla la rifaccio se no mi va bene quella.

Precisazione concordata lo stesso giorno, dopo che il gate ha mostrato che l'impronta dell'input copre anche i
dati della persona analizzata e non solo quelli dell'utente:

> (terzo caso: la persona cambia) Sì, impronta spezzata in due
> (casella dell'analisi in blocco) Riusa quella esistente, semantica `onlyMissing`

Decisioni di piano dello stesso giorno, che chiudono le Open Questions 1–3: finestra di freschezza del proprio
profilo = 90 giorni (`FRESHNESS_DAYS`, la stessa dell'arricchimento); tetto del sito = 10 pagine
(`CLOUDFLARE_MAX_PAGES`); modello dell'elaborazione = variabile propria `PROFILE_MODEL` con default il valore
di `ANALYSIS_MODEL`.

---

## Context

Ciò che il CRM sa dell'utente sono quattro valori scritti a mano in `settings`: URL del proprio profilo
LinkedIn, nome dell'azienda, di cosa si occupa, cosa offre. Di ciò che l'utente **vende**, l'analisi AI
riceve solo gli ultimi tre (l'URL del profilo non entra nel prompt), e i servizi non esistono da nessuna
parte. Il
risultato è che il CRM non sa cosa l'utente vende davvero: ogni parte che dovrebbe usarlo — l'analisi oggi,
l'assistente ICP domani — parte da una descrizione generica scritta una volta e mai più aggiornata.

**Per chi:** Omar, unico utente (founder/consulente). Compila a mano il meno possibile, non vuole spese non
annunciate e vuole decidere lui cosa entra nel CRM.

**Cosa:** il CRM legge le superfici **pubbliche** con cui l'utente si presenta — profilo LinkedIn, sito,
propri post, record d'impresa della propria azienda — le fa elaborare a un LLM e ne ricava una **proposta**
di profilo (chi sono, azienda, posizionamento, prove, tono) e di **servizi**, uno per riga, con a chi
servono, quale problema risolvono e quali prove li sostengono. L'utente rivede la proposta campo per campo e
applica ciò che vuole. Il profilo diventa il posto unico dove il CRM tiene "chi sono e cosa vendo", e
l'analisi delle persone lo usa per dire anche **quale dei miei servizi c'entra con questa persona**.

**Perché:** un profilo ricco e coerente con ciò che l'utente pubblica è il pezzo che fa collaborare le parti.
Serve prima all'analisi (angoli e affinità ancorati a un servizio reale) e subito dopo all'assistente ICP,
che comporrà gli ICP leggendo questo profilo invece di chiedere tutto da zero.

**Terminologia:** "profilo" = le informazioni sull'utente e sulla sua azienda tenute in `settings`; "servizio"
= una riga della nuova tabella `services`; "proposta" = il risultato di una generazione, non ancora applicato;
"fonte" = una delle quattro origini pubbliche. Nel CRM "touchpoint" resta l'attività di contatto con una
persona: le fonti pubbliche di questa spec non sono touchpoint.

---

## Non-Goals

- **Generare ricerche Apollo dal profilo**: nessun filtro, nessuna candidata, nessun credito speso a partire
  dai servizi. Il profilo è una sorgente, non un motore di ricerca.
- **Comporre o rifinire gli ICP**: nessuna proposta di ruoli/settori/pain nella pagina ICP, nessun
  collegamento stabile ICP ↔ servizio. Sarà l'assistente ICP (spec separata) a leggere questo profilo.
- **Chatbot**: nessuna interfaccia conversazionale qui.
- **Contenuti non pubblici**: nessun login, nessun cookie, nessuna area riservata, nessun `LINKEDIN_LI_AT`.
- **Leggere la pagina LinkedIn aziendale come pagina**: nessun actor nuovo per il company detail; dell'azienda
  si legge il record d'impresa che Apollo restituisce per il dominio (C10).
- **Siti di terzi**: leggere i siti di clienti tipo, referenze o candidate resta fuori (arriverà con
  l'assistente ICP); qui si legge solo il sito dell'utente.
- **Aggiornamento automatico**: nessun cron, nessuna rigenerazione periodica o innescata da altri job.
- **Ri-sincronizzazione retroattiva dei post** per recuperare il testo integrale di quelli già salvati.
- **Scritture automatiche**: nessun valore del profilo, nessun servizio e nessuna analisi cambiano senza un
  gesto dell'utente.
- **Profili di altre persone**: le persone del CRM hanno la loro scheda; qui si descrive solo l'utente.
- **Profilo multilingua**: la proposta è in italiano.

---

## Acceptance Criteria

### A. Cloudflare come quarto strumento

- A1. La configurazione legge le due credenziali Cloudflare (identificativo dell'account e token), documentate
  in `.env.example`.
- A2. Il README documenta per Cloudflare: permesso richiesto dal token, piano sufficiente per questo uso,
  limiti di browser del piano gratuito e cosa succede quando si superano.
- A3. Cloudflare compare in Impostazioni → Connessioni come quarto strumento, con etichetta, variabili
  d'ambiente, cosa abilita e stato configurata / non configurata.
- A4. Lo strumento risulta non configurato quando manca almeno una delle due credenziali.
- A5. "Configurata" non significa valida: una credenziale rifiutata dal servizio non viene mostrata come sana,
  come già accade per gli altri tre strumenti.
- A6. Un errore di Cloudflare è attribuito a Cloudflare nella sua card, nella pagina dei run e negli avvisi
  della home; non ad Anthropic, Apify o Apollo.
- A7. Il valore del token non appare mai nel log di un run, in un messaggio d'errore, né nei parametri mostrati
  nel dettaglio di un run.
- A8. Prima che un job del CRM chiami Cloudflare, una verifica manuale documentata nel README — lanciata
  dall'utente con conferma esplicita — legge un sito una volta e riporta pagine lette, forma del contenuto,
  consumo dichiarato dalla risposta e l'errore leggibile in caso di permessi insufficienti.
- A9. Senza credenziali Cloudflare nessuna chiamata parte e nessun'altra funzione del CRM si blocca.

### B. Profilo e servizi

- B1. Il profilo tiene in un unico posto chi è l'utente e cosa vende: i valori di oggi più sito,
  posizionamento, prove e tono di voce (elenco in "Data model").
- B2. Un servizio esiste con il solo nome; gli altri campi sono facoltativi.
- B3. I servizi si creano, modificano ed eliminano a mano in qualsiasi momento, senza passare da una
  generazione.
- B4. L'ordine dei servizi lo dichiara l'utente, e ogni lettura li restituisce in quell'ordine.
- B5. Nessun campo del profilo e nessun servizio è obbligatorio: un profilo vuoto o parziale non blocca niente
  di ciò che il CRM fa oggi.
- B6. Ogni campo del profilo e ogni servizio dice se è stato scritto a mano o applicato da una proposta, e in
  quale data.
- B7. Una sola lettura restituisce profilo, servizi, provenienza di ciascun valore e data dell'ultima
  generazione.
- B8. I consumatori attuali di `company_description` e `company_offering` (il contesto dell'analisi e gli
  avvisi di configurazione) continuano a comportarsi come oggi.
- B9. L'azienda dell'utente non è un'azienda del CRM: non compare in Aziende, non è candidabile per un ICP, non
  è arricchibile come target e non entra in nessuna unione.
- B10. Due servizi non possono avere lo stesso nome a meno di maiuscole e spazi: il confronto della proposta
  (E4) e il riferimento conservato nelle analisi (F5) si appoggiano al nome.

### C. Le fonti pubbliche

- C1. Le fonti sono quattro: il profilo LinkedIn dell'utente, il sito, i propri post già sincronizzati, il
  record d'impresa che Apollo restituisce per il dominio del sito.
- C2. Nessuna fonte richiede login, cookie o sessioni: si legge solo ciò che è pubblico.
- C3. Il profilo LinkedIn si legge con l'actor no-cookie già usato dal CRM.
- C4. Una lettura recente del proprio profilo non si ripaga entro una finestra di freschezza dichiarata
  nell'anteprima.
- C5. Del sito si legge la pagina iniziale più le pagine interne che parlano di azienda, servizi, prezzi, casi
  e team, entro un tetto di pagine dichiarato nell'anteprima.
- C6. Per ogni post il CRM registra se il testo conservato è completo o troncato; per i post già salvati prima
  del rilascio vale troncato quando il testo è stato tagliato al limite dei 300 caratteri, completo altrimenti.
- C7. Dal rilascio in poi il sync dei propri post conserva il testo integrale del post.
- C8. La generazione usa i post con testo completo, e l'esito dice quanti post ha letto per intero e quanti
  erano solo estratti.
- C9. Nessuna ri-sincronizzazione dei post parte da sé per recuperare i testi già troncati.
- C10. Il record d'impresa si chiede ad Apollo per il **dominio** del sito e si conserva col profilo, non come
  azienda del CRM (B9). Costa un credito per azienda trovata: un dominio che Apollo non conosce non consuma
  crediti.
- C11. Senza un dominio (sito assente o non riconducibile a un dominio) la fonte Apollo non è disponibile e
  l'anteprima lo dice.
- C12. Le fonti sono isolate: quella che fallisce non ferma la generazione.
- C13. L'esito elenca le fonti lette e quelle no, ciascuna con il proprio motivo.
- C14. Un sito che non restituisce contenuto utile (pagina vuota, consenso obbligatorio, blocco) produce un
  avviso che lo dice, e nessun valore viene dedotto in assenza di contenuto.
- C15. Nessuna vista mostra il testo intero di un post dove oggi mostra un estratto: I miei post (corpo della
  card **e** testo che appare al passaggio del mouse), anteprima di unione ed etichetta della fonte nell'elenco
  delle persone restano brevi anche per i post con testo integrale.

### D. Generazione: anteprima e spesa

- D1. La generazione è un job del CRM: vale "un solo job alla volta" e un secondo avvio è rifiutato.
- D2. La generazione non parte senza anteprima, e l'anteprima ha la forma uniforme del CRM (conteggi, stima di
  costo, avvisi, blocker).
- D3. L'anteprima elenca una per una le fonti che leggerà.
- D4. L'anteprima dichiara il costo di ogni fonte a pagamento: profilo LinkedIn (prezzo dell'actor), record
  Apollo (crediti), elaborazione LLM (stima); sito e post non costano denaro.
- D5. Una stima non calcolabile è dichiarata mancante, mai sostituita da un numero inventato.
- D6. Blocker: chiave Anthropic mancante.
- D7. Blocker: nessuna fonte disponibile, o tutte le fonti disponibili escluse dall'utente.
- D8. Avvisi che non bloccano, ciascuno con la fonte che salta: token Apify o URL del profilo mancanti (profilo
  LinkedIn), credenziali Cloudflare o sito non impostato (sito), nessun post con testo completo (post), chiave
  Apollo o dominio mancanti (record d'impresa), più la proposta pendente non ancora applicata.
- D9. L'utente può escludere singole fonti prima di avviare e chiedere la rilettura di una fonte che verrebbe
  saltata perché letta di recente (C4); conteggi e stima si aggiornano di conseguenza.
- D10. Il run scrive una riga di log per ogni chiamata a uno strumento esterno, dicendo quale fonte e quale
  strumento.
- D11. Il log non contiene il contenuto letto né il testo inviato al modello.
- D12. Una generazione fallita si riprova dalla stessa anteprima, con gli stessi parametri e gli stessi blocker.
- D13. L'esito distingue "nessuna fonte ha prodotto contenuto" (neutro) dagli avvisi e dall'errore attribuito
  allo strumento che ha fallito.
- D14. Se nessuna fonte ha prodotto contenuto, il modello non viene chiamato: nessuna spesa di elaborazione,
  nessuna proposta creata e la proposta pendente, se c'era, resta intatta.

### E. La proposta

- E1. Il risultato di una generazione è una proposta: nessun valore del profilo e nessun servizio cambia finché
  l'utente non applica.
- E2. La proposta può contenere solo i campi generabili elencati in "Data model" e i servizi; mai gli indirizzi
  che sono input della generazione.
- E3. Per ogni campo la proposta mostra il valore attuale accanto a quello proposto.
- E4. Per ogni servizio la proposta dice se è nuovo, modificato o invariato rispetto agli esistenti,
  confrontando i nomi normalizzati.
- E5. Ogni voce proposta cita le fonti da cui deriva.
- E6. Una voce senza nessuna fonte non entra nella proposta: viene scartata e contata nell'esito. Lo stesso vale
  per un secondo servizio proposto con un nome che collide con un altro della stessa proposta (B10).
- E7. L'utente applica un singolo campo o un singolo servizio. Applicando un servizio modificato, i campi che la
  proposta non nomina restano come sono e il nome resta quello scritto dall'utente.
- E8. "Applica tutto" applica solo le voci che non sono state scritte a mano.
- E9. Le voci scritte a mano che la proposta cambierebbe sono mostrate come conflitti e si risolvono una per una.
- E10. Ciò che non viene applicato resta nella proposta.
- E11. Esiste una sola proposta pendente: una nuova generazione la sostituisce e non tocca mai i valori
  applicati.
- E12. La proposta si scarta con una sola azione sull'intera proposta, previa conferma (è costata denaro), e
  scartarla non tocca nessun valore del profilo.
- E13. La proposta è in italiano.
- E14. I valori del profilo **già presenti prima del rilascio** non hanno una provenienza registrata: la
  provenienza nasce con questa spec (B6), quindi di quei valori il CRM non sa se li ha scritti l'utente. Non
  contano come conflitti e "Applica tutto" può sostituirli, ma la proposta **dichiara quanti campi già
  compilati sostituirebbe** prima del clic, e ogni riga mostra comunque il valore attuale accanto a quello
  proposto (E3). Dal rilascio in poi ogni scrittura a mano è marcata e torna a valere E8.

### F. L'analisi delle persone usa il profilo

- F1. Il contesto dell'analisi include posizionamento, prove, tono di voce e l'elenco dei servizi con a chi
  servono e quale problema risolvono.
- F2. Quando esiste almeno un servizio, l'analisi restituisce quale servizio è il più affine a quella persona e
  una frase sul perché. Senza servizi al modello non si chiede nulla in più di oggi, né nei dati né nel formato
  della risposta.
- F3. Se non esistono servizi, o la risposta non è riconducibile a un servizio esistente, il campo resta vuoto e
  l'analisi è valida e utilizzabile.
- F4. L'analisi conserva il nome del servizio come testo al momento in cui è stata fatta.
- F5. Eliminare o rinominare un servizio non riscrive le analisi salvate: l'interfaccia mostra il nome di
  allora e dice che quel servizio non esiste più, senza errori.
- F6. Al rilascio, sul database reale (nome, descrizione e offerta dell'azienda già valorizzati, campi nuovi
  vuoti, nessun servizio), nessuna analisi salvata perde valore e nessuna rianalisi viene proposta: i campi
  nuovi vuoti non aggiungono niente al contesto e senza servizi non cambia neppure ciò che si chiede al modello
  (F2). Un effetto una tantum va dichiarato e non nascosto: l'impronta della persona (F11) nasce dai dati di
  oggi, quindi le analisi che al momento del rilascio risultano "da aggiornare" perdono il segnale una volta
  sola e lo riprendono al primo cambio successivo della persona (F13).
- F7. **Una modifica dell'utente non scade un'analisi.** Modificare profilo, servizi o ICP non segna niente:
  nessuna analisi salvata risulta "da aggiornare" per quel motivo, nessun indicatore compare sulla scheda della
  persona e nessun avviso invita a rifarle. È un cambio del comportamento di oggi, dove un ICP o un profilo
  modificato marca tutte le analisi fatte con il testo precedente.
- F8. Nessun cambio — né dell'utente né della persona — fa entrare qualcuno tra i bersagli di una rianalisi: in
  un'analisi in blocco chi ha già un'analisi per quell'ICP si salta sempre, sia partendo da una lista sia da una
  selezione. Per includerlo l'utente spunta la casella che l'anteprima già offre, spenta di default, e
  l'anteprima conta e stima quella scelta prima della spesa distinguendo chi verrebbe rifatto da chi ha l'input
  identico e resterebbe saltato comunque. Nessuna rianalisi parte da sé e nessuna spesa nasce da una modifica.
  È l'altro cambio del comportamento di oggi, dove una selezione rianalizza chi ha l'input cambiato.
- F9. Le analisi salvate prima del rilascio restano leggibili e non mostrano un servizio affine che non hanno
  prodotto.
- F10. Rifare un'analisi resta un'azione con anteprima e stima dichiarata.
- F11. Ogni analisi conserva **due** impronte del suo input: quella dell'input intero, che serve solo a non
  ripagare un'analisi identica, e quella della **sola persona analizzata**, che è l'unica a decidere
  l'indicatore di F13. Nessuna interfaccia e nessuna anteprima usa l'impronta dell'input intero per dire che
  qualcosa è scaduto. "Rianalizza" sulla scheda della persona resta un "rifalla comunque", valido anche a dati
  identici, con il costo dichiarato.
- F12. La scheda dice quando l'ultima analisi è stata fatta e con quale modello.
- F13. Quando cambia **ciò che l'analisi sapeva di quella persona** — un arricchimento Apify o Apollo, un campo
  corretto a mano sulla sua scheda, o le sue interazioni con i post dell'utente — la scheda lo dice, con parole
  che nominano la persona e non il profilo dell'utente. Il testo non attribuisce il cambio a un gesto
  preciso, perché il CRM non lo sa: dice che è cambiato, non chi l'ha cambiato. È il solo motivo per cui
  un'analisi risulta da aggiornare, ed è un'informazione, non una richiesta: non mette nessuno tra i bersagli
  di una rianalisi (F8) e non chiede di spendere.

### G. Interfaccia

- G1. Impostazioni → "Profilo e azienda" ospita profilo, azienda estesa, servizi, generazione e proposta.
- G2. Gli indirizzi e le ancore esistenti di quella sezione continuano a funzionare.
- G3. La generazione si avvia da quella sezione e apre l'anteprima.
- G4. Con un blocker l'avvio è disabilitato, il motivo è scritto accanto e porta al punto dove si risolve.
- G5. La sezione dice quando il profilo è stato generato l'ultima volta e da quali fonti; se non lo è mai stato,
  lo dice.
- G6. L'elenco di configurazione della home guadagna una voce che porta alla generazione quando il profilo non è
  mai stato generato e non esiste nessun servizio; la voce sparisce appena una delle due condizioni cade, e non
  duplica le voci già esistenti su profilo e azienda.
- G7. I servizi si aggiungono, modificano, riordinano ed eliminano dalla sezione, con conferma sull'eliminazione.
- G8. Testi, avvisi ed errori sono in italiano.
- G9. Il confronto della proposta e la gestione dei servizi si usano interamente da tastiera.
- G10. Etichette, stati e messaggi d'errore della proposta e dei servizi sono comprensibili con uno screen
  reader.

### H. Coerenza con il dominio

- H1. **Emendamento dichiarato**: l'invariante "l'AI serve solo all'analisi" diventa "l'AI non assegna liste né
  stati: propone, l'utente conferma" (decisione D-D della roadmap). Questa spec è il primo uso dell'AI fuori
  dall'analisi: l'emendamento va riflesso nel contract del dominio all'ingest e nella guida di progetto alla
  radice del repo (`AGENTS.md` e `CLAUDE.md`), che oggi dicono che l'AI serve solo all'analisi dei prospect.
- H2. **Emendamento dichiarato**: gli strumenti esterni diventano quattro. Dove `people-first-crm` J2 elenca
  Apify, Apollo e Anthropic si aggiunge Cloudflare, con la sua card in Connessioni, i suoi run e i suoi avvisi.
- H3. Nessun automatismo: nessuna lista, nessuno stato, nessun valore del profilo cambia senza un gesto
  dell'utente.
- H4. SQLite resta l'unica verità e i derivati restano derivati: la proposta è un dato salvato che sopravvive al
  riavvio, e dell'analisi entra nel database solo la seconda impronta di F11 — un input, non uno stato. "Da
  aggiornare" resta calcolato a ogni lettura e non diventa una colonna.
- H5. La regola "i dati impostati a mano vincono" vale anche per profilo e servizi (E8, E9).
- H6. Anteprima, un job alla volta, retry con gli stessi parametri ed esito attribuito valgono anche per questa
  generazione.
- H7. **Emendamento dichiarato**: cambia il significato del derivato `stale`. Non dipende più dall'input intero
  ma dai soli dati della persona: una modifica dell'utente non scade più niente (F7), un cambio della persona
  sì (F13), e in blocco chi è già analizzato si salta sempre (F8). All'ingest va aggiornato ciò che descrive il
  comportamento precedente: il contract del dominio (`stale` = "`input_hash` diverso dall'input corrente"), il
  PLAN di `crm-foundation`, il `README.md` (elenca tre motivi di invalidazione: solo quello del prospect
  sopravvive), il `README.md` del server e2e (un seed documentato come "stesso hash d'input"), e il PLAN di
  `people-first-crm` dove descrive il badge. **Restano invece veri e non vanno cambiati**: `README.md` dove dice
  che le scritture Apollo possono rendere un'analisi da aggiornare, il Constraints di `apollo-lookalike` che
  accetta quell'effetto perché il segnale è visibile (con F13 lo resta), e F8 di `people-first-crm`
  ("l'indicazione «da aggiornare» riguarda solo l'analisi AI").
- H8. **Emendamento dichiarato**: "i dati impostati a mano vincono" (H5) non è applicabile ai valori che
  esistevano prima del rilascio, perché di loro non esiste una provenienza da rispettare (E14). È una
  deroga circoscritta e una volta sola — riguarda i tre campi dell'azienda che il CRM ha oggi — e va
  dichiarata all'utente nella testata della proposta invece di essere scoperta dopo un clic. L'alternativa
  (marcarli tutti come scritti a mano) renderebbe il primo giro tre decisioni invece di un gesto, e l'utente
  ha scelto la prima.

---

## Data model (delta, livello di dominio)

- **Profilo** (`settings`): campi di input `own_profile_url` (esistente) e `website_url`; campi **generabili**
  già esistenti `company_name`, `company_description`, `company_offering` e **nuovi** `positioning`,
  `proof_points`, `tone_of_voice` (F6 distingue i due gruppi). Più, non modificabili a mano: il record d'impresa
  Apollo così come arriva (contiene anche l'URL LinkedIn dell'azienda), i contenuti letti dalle fonti con le
  rispettive date, la proposta pendente e la data dell'ultima generazione.
- **Solo i campi generabili possono comparire in una proposta**; gli input non sono mai proposti (E2).
- **Servizi** (`services`): `name` obbligatorio e unico a meno di maiuscole e spazi (B10), più `description`,
  `audience` (a chi serve), `problem` (problema che risolve), `proof` (prove e risultati), `notes`, `position`
  (ordine dichiarato dall'utente) e la provenienza di B6.
- **Post** (`posts`): per ogni post l'informazione se il testo conservato è completo o troncato (C6).
- **Analisi** (`analyses`): nome del servizio più affine e motivo, entrambi facoltativi (F2, F4).
- **Job**: un nuovo kind per la generazione del profilo, con la sua anteprima e il suo retry.
- **Strumenti**: `cloudflare` entra nel catalogo degli strumenti esterni (A3).

---

## Constraints

- **Limiti Cloudflare** (documentazione del servizio, letta il 2026-09-20): piano gratuito 10 minuti di browser
  al giorno e 3 sessioni contemporanee; piano Workers a pagamento 10 ore al mese incluse e $0,09 per ora oltre.
  Un sito di poche pagine letto di rado sta nel piano gratuito. Il superamento arriva come rifiuto del servizio
  e l'esito del job deve dirlo con parole comprensibili, non con un codice.
- **Scopo dichiarato al servizio**: la lettura del sito dichiara di servire come input per un'elaborazione AI e
  rispetta i limiti che il sito espone.
- **Un solo job alla volta e anteprima obbligatoria**, retry compreso.
- **Output del modello strutturato e validato**: una risposta che non rispetta la forma attesa produce un errore
  leggibile, non un profilo a metà.
- **Dati reali già presenti**: il database dell'utente contiene persone, aziende, post, analisi e run veri. Le
  nuove colonne e il nuovo job kind passano dalla migrazione idempotente con backup, e la migrazione va provata
  su una copia del database reale prima di toccare quello vero. L'impronta della persona (F11) è una colonna
  additiva di `analyses` che nessuna analisi esistente possiede: si riempie una volta dai dati odierni della
  persona, che è ciò che rende vero F6 e che va dichiarato all'utente invece di lasciarlo scoprire.
- **Locale e single-user**: nessuna autenticazione, nessuna esposizione remota.
- **Dati personali**: il profilo riguarda l'utente; il record Apollo è un dato d'impresa. Nessun dato di terzi
  entra nel profilo.

---

## Technical Notes

- L'hash dell'input (sha256 di system + user) ha oggi due usi: dire che un'analisi è "da aggiornare" (calcolato
  in un punto solo, `GET /api/prospects/:id/analyses`, e mostrato dalla scheda come badge e come riga "Il
  profilo è cambiato dopo l'analisi") e far saltare chi ha l'input identico. Il secondo resta com'è; il primo
  cambia base. La separazione esiste già nel prompt: il **system** porta il contesto dell'utente (azienda, ICP,
  aziende di riferimento, istruzioni) e lo **user** porta la persona (blocchi `<profilo>` e `<segnali>`).
  L'impronta della persona si calcola dai soli blocchi dello user prompt: la frase finale che nomina l'ICP resta
  fuori, altrimenti rinominare un ICP segnerebbe le analisi e F7 cadrebbe.
- Il salto per input identico **non** vive nel job in blocco: sta in `analyzeProspect`, condivisa con il
  `POST /api/prospects/:id/analyze` senza `force`. Toccare il job in blocco non lo sposta, e F11 vale per
  entrambe le strade.
- Tre consumatori di `stale` vanno seguiti, non solo il badge: la riga "Il profilo è cambiato dopo l'analisi",
  la prominenza del bottone "Rianalizza" (oggi primario quando l'analisi è scaduta) e il
  `POST /api/prospects/:id/analyze`, che oggi restituisce un `stale: false` fisso.
- Cosa **non** è lavoro nuovo, per non sovrastimare: F12 (modello e data dell'ultima analisi) è già sulla
  scheda; "Rianalizza" manda già `force: true` quando un'analisi esiste; e la casella "Rianalizza anche quelle
  già fatte" esiste già nel dialog dell'analisi in blocco, legata a `force`. F8 la riusa cambiando parole e
  semantica (da `force` a "includi chi è già analizzato"), non ne aggiunge una seconda: due etichette simili
  vicine con effetti diversi sono il modo più rapido di far spendere per sbaglio.
- Testi e test che asseriscono il comportamento di oggi: il toast del salvataggio di About sulla scheda persona
  ("Le analisi fatte prima di questa modifica risultano da aggiornare") **resta vero** con F13, perché About è
  un dato della persona; restano veri anche i casi vitest che attendono `stale: true` dopo un `UPDATE
  prospects.about`. Va invece rivisto il seed di prova che scrive una riga `analyses` a mano senza impronta
  della persona, e i commenti che dichiarano l'invariante in `db/analyses.ts`, `db/prospects.ts`,
  `db/schema.ts`, `analysis/prompt.ts` e `jobs/fake-deps.ts`.
- I post sono salvati troncati (`EXCERPT_MAX` = 300 caratteri) mentre l'actor restituisce il testo integrale e
  il mapper lo passa già: C7 cambia ciò che si conserva, non come si legge. C6 serve perché per un post più
  corto di 300 caratteri il valore salvato è identico nei due regimi: senza un marcatore il conteggio di C8 non
  sarebbe decidibile.
- Il marcatore di C6 **non** si deduce dal confronto con `EXCERPT_MAX`: `truncate` aggiunge i puntini di
  sospensione, quindi un estratto troncato è lungo 301 caratteri, non 300. Il marcatore va derivato dalla
  forma vera prodotta da `truncate` (lunghezza *e* suffisso), non dalla costante, altrimenti nessun post
  preesistente risulta troncato e C8 conta al rovescio.
- L'unicità di B10 non si può appoggiare a `lower()` di SQLite, che piega solo l'ASCII: `QUALITÀ` e `Qualità`
  non collidono, e i nomi di servizio in italiano hanno accenti. Serve una chiave normalizzata scritta
  dall'applicazione con un solo normalizzatore, su cui poggia l'indice unico — così API e database non
  possono divergere.
- A6 e C12 vanno letti insieme: le fonti sono isolate, quindi una fonte che fallisce **non** fa fallire il
  run, e l'attribuzione di oggi guarda solo i run falliti. Perché l'errore di Cloudflare compaia nella sua
  card e negli avvisi (A6), un run riuscito con una fonte fallita deve poter contare come fallito **per
  quello strumento**: è un'aggiunta all'attribuzione, non un cambio di C12.
- Il catalogo degli strumenti associa oggi **una** variabile d'ambiente a ogni strumento, e la redazione dei
  segreti itera gli strumenti del catalogo: il token Cloudflare va nel catalogo per essere redatto (A7), mentre
  l'identificativo dell'account non è un segreto.
- Attribuzione degli errori: oggi un errore `actor:<id>:` il cui id non contiene uno slash e non è `apollo`
  viene attribuito ad Anthropic quando il run usa Anthropic. La generazione usa Anthropic, quindi A6 richiede di
  cambiare quella logica o di scegliere una forma d'errore che non ricada in quel caso.
- Apollo arricchisce **per dominio** (`organizations/bulk_enrich`, deps `enrichOrganizations(domains)`) e
  restituisce nome, dominio, URL LinkedIn, settore, parole chiave, dipendenti, località e descrizione breve. Il
  job di arricchimento esistente opera su righe di `companies` e salta le aziende senza dominio: C10 riusa la
  richiesta Apollo, non quel job, perché B9 tiene la propria azienda fuori da `companies`.
- L'endpoint di crawl di Cloudflare è asincrono (avvio, stato, annullamento) e combacia con il modello a job del
  CRM, che già attende run esterne.
- La stima dell'analisi è oggi un prezzo fisso per persona: allargando il contesto (F1) va rivista, e resta
  comunque dichiarata in anteprima (F10).
- Le prove del profilo (`proof_points`) non sostituiscono gli esiti delle aziende di riferimento di un ICP, che
  restano dell'ICP e continuano ad arrivare all'analisi come oggi.
- Le istruzioni su cosa il modello deve produrre stanno **dentro** il system prompt. Con l'impronta spezzata
  (F11) il system prompt non decide più se un'analisi è da aggiornare, quindi cambiarle non invalida niente, ma F2 resta condizionato all'esistenza di almeno un servizio per non chiedere
  al modello un campo che non potrebbe compilare, e perché senza servizi l'input dell'analisi resti identico a
  quello di oggi.
- Il testo conservato di un post è esposto con lo stesso nome in API e interfaccia (tooltip di "I miei post",
  anteprima di unione, etichetta della fonte nell'elenco delle persone): conservare il testo integrale cambia
  cosa contiene quel valore, da cui C15. Il prompt dell'analisi tronca già l'estratto a 160 caratteri, quindi
  l'hash dell'analisi non cambia per questo.
- Il branch `people-first-crm` non è ancora unito e ha appena rifatto la sezione Impostazioni: G1 estende quel
  lavoro.
- I nomi di prodotto e i percorsi della documentazione Cloudflare citati qui vanno riconfermati dalla verifica
  manuale A8 prima di diventare vincoli operativi.
- Il `FLOW.md` di questa spec elenca cinque vincoli di interfaccia trovati nel codice esistente (il catalogo
  degli strumenti valido per tre soli id, la card che mostra una sola variabile d'ambiente, la griglia a tre
  colonne delle card, il testo al passaggio del mouse in "I miei post", il prezzo fisso scritto nell'hint di
  "Rianalizza"): non si ripetono qui, li raccoglie il piano.
- Riferimenti esterni: endpoint di crawl
  (`https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/`), prezzi
  (`https://developers.cloudflare.com/browser-run/pricing/`), limiti
  (`https://developers.cloudflare.com/browser-run/limits/`).

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | Quale finestra di freschezza per la lettura del proprio profilo LinkedIn? | C4, D4 | Omar | **Chiusa 2026-09-22**: 90 giorni, la stessa `FRESHNESS_DAYS` dell'arricchimento. La rilettura voluta la risolve la spunta "Rileggilo comunque" (D9), non una finestra più corta |
| 2 | Tetto di pagine del sito e insieme dei percorsi da cercare | C5, D4 | Omar | **Chiusa 2026-09-22**: 10 pagine in `CLOUDFLARE_MAX_PAGES`; percorsi cercati pagina iniziale, chi siamo, servizi, prezzi, casi, team. La verifica manuale A8 può rivederli prima che un job usi Cloudflare |
| 3 | Il modello dell'elaborazione: riusare quello dell'analisi o dichiararne uno proprio? | D4, Constraints | Omar | **Chiusa 2026-09-22**: variabile propria `PROFILE_MODEL`, con default il valore di `ANALYSIS_MODEL`. Una chiamata sola su un input grande è un lavoro diverso da centinaia di analisi piccole: cambiare l'una non deve cambiare l'altra di nascosto |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| La lettura del web usa Cloudflare Browser Run invece di un estrattore in-house | L'in-house reggeva su "gratis" e "testabile offline": il secondo è falso (con dipendenze iniettate e fixture i test sono offline comunque), il primo si paga con zero rendering JavaScript — cioè con i siti moderni quasi vuoti — e con il codice di pulizia HTML. Cloudflare rende JS, restituisce testo pulito, segue i link e al nostro volume non costa; il prezzo vero è diventare il quarto strumento da configurare e sorvegliare |
| Verifica manuale di Cloudflare prima che i job lo usino (A8) | Stesso precedente di Apollo, dove uno smoke reale ha confermato permessi, consumo e limiti prima di scrivere il client: i limiti di un servizio nuovo non si assumono |
| Il sito si legge **senza browser**, e con il browser solo se le pagine arrivano quasi vuote | Deciso dall'utente il 2026-10-02 dopo le tre verifiche reali di A8: sul piano gratuito la lettura con il browser legge solo la pagina iniziale (una volta bloccata 5 minuti, una volta conclusa con le altre pagine in coda), quella senza browser ha letto 7 pagine su 7 in 34 s, senza consumare tempo di browser (gratuita durante la beta di Cloudflare, poi al prezzo dei Workers). Il rendering JavaScript, motivo della scelta di Cloudflare, resta come seconda lettura per i siti che senza non mostrano testo: costa un'altra delle 5 letture del giorno |
| La quarta fonte è il record d'impresa Apollo per dominio, non la pagina LinkedIn aziendale | Nel CRM Apollo arricchisce solo per dominio e restituisce dati d'impresa (settore, parole chiave, dimensione, descrizione, URL LinkedIn). Leggere davvero la pagina LinkedIn richiederebbe un actor nuovo da scegliere e validare: rinviato |
| L'azienda dell'utente non è una riga di `companies` | Le aziende del CRM sono target: candidabili, arricchibili, unibili, sorgente di persone. La propria azienda lì dentro sarebbe un errore in attesa di succedere; il suo record Apollo vive col profilo |
| I servizi sono righe di una tabella, non un testo dentro il profilo | Devono essere citabili singolarmente: l'analisi nomina il servizio più affine e l'assistente ICP ragionerà su un servizio per volta |
| Nessun ponte verso l'ICP in questa spec | L'utente ha deciso che l'ICP lo comporrà un assistente conversazionale con accesso a queste informazioni; qui lo scopo è un profilo ben definito |
| L'analisi guadagna il servizio più affine | È l'affinità che l'utente chiede ("tutte le parti si parlino"), e senza costi nascosti: modificare il profilo o un servizio non segna niente (F7) |
| Modificare profilo, servizi o ICP non segna un'analisi né la rimette tra i bersagli (F7, F8) | Deciso dall'utente il 2026-09-22. Con i servizi nel contesto, ogni ritocco a un servizio riaccenderebbe l'intero archivio delle analisi: un invito permanente a una spesa che nessuno ha chiesto. Un'analisi è una fotografia datata, non un valore che scade; se l'utente la vuole aggiornata la rifà |
| L'impronta si spezza in due invece di sparire: resta il segnale per i cambi della **persona** (F11, F13) | La prima stesura dell'emendamento toglieva `stale` del tutto, ma l'impronta copriva anche i dati della persona: avrebbe cancellato in silenzio anche l'avviso "questa persona è stata arricchita dopo che l'avevi analizzata", che l'utente non ha mai chiesto di togliere, che il README gli documenta e su cui `apollo-lookalike` fonda un rischio accettato ("lo stato `stale` è già derivato e **visibile**"). Deciso dall'utente il 2026-09-22 su segnalazione del gate: sparisce il segnale per le proprie modifiche, resta quello per la persona |
| La casella dell'analisi in blocco è quella che esiste già, con semantica nuova (F8) | Il dialog ha già "Rianalizza anche quelle già fatte" legata a `force`. Aggiungerne una seconda quasi identica nelle parole e diversa nei fatti è un errore di spesa in attesa di succedere; riusarla con "includi chi è già analizzato" invece di `force` è anche l'unica cosa che tiene in vita il primo uso dell'impronta (F11), che altrimenti non servirebbe più a niente |
| Il servizio affine si chiede solo se esistono servizi (F2) | Non si chiede al modello un campo che non potrebbe compilare, e senza servizi l'input dell'analisi resta identico a quello di oggi: il rilascio non cambia nulla per chi ha già analizzato (F6) |
| L'analisi conserva il nome del servizio come testo (F4, F5) | Le analisi sono storia: eliminare o rinominare un servizio non deve riscrivere il passato né rompere la scheda |
| Le fonti sono le quattro superfici pubbliche | Definizione data dall'utente di "touchpoint": tutto quello che è pubblico. Coerente con l'invariante "no cookie" |
| Il testo integrale dei post si conserva dai prossimi sync, con un marcatore per post | Nessuna spesa retroattiva; il marcatore rende decidibile il conteggio "letti per intero / solo estratto" |
| Il sito è una fonte facoltativa | Senza credenziali Cloudflare il profilo si genera dalle altre fonti, con avviso: lo strumento nuovo non diventa un prerequisito del CRM |
| I tre campi dell'azienda già nel database non contano come scritti a mano (E14, H8) | Deciso dall'utente il 2026-09-22. La provenienza nasce con questa spec: di quei valori il CRM non sa chi li ha scritti. Marcarli tutti come propri renderebbe il primo giro tre conflitti da decidere invece del gesto che la spec promette; non marcarli tiene la promessa, e il prezzo — un clic può sostituire una descrizione scritta a mano mesi fa — si paga dichiarandolo nella testata della proposta, non lasciandolo scoprire |
| Il risultato è sempre una proposta, mai una sovrascrittura | Invariante del dominio: decide sempre l'utente. Vale anche per i campi mai toccati a mano |
| "Applica tutto" salta le voci scritte a mano e le mostra come conflitti | È la regola "i dati impostati a mano vincono" già in uso per le persone, senza rinunciare a un gesto solo quando il profilo è vuoto |
| Una sola proposta pendente | Uno storico delle proposte non serve a nessuna decisione dell'utente e moltiplicherebbe gli stati da spiegare |
| L'ordine dei servizi lo dichiara l'utente | È un ordine commerciale (cosa vendi per primo), non un dato tecnico: l'ordine di creazione non lo rappresenta |
| Tutto vive in Impostazioni → "Profilo e azienda" | È dove l'utente già cerca queste informazioni e non cambia la navigazione appena rifatta da `people-first-crm` |
| Il token Apify mancante è un avviso, non un blocco | Il profilo LinkedIn è una fonte come le altre tre: se manca la sua chiave si salta quella fonte. Blocca solo l'assenza di **ogni** fonte (D7), così la generazione non diventa ostaggio di un singolo strumento |
| Senza contenuto da nessuna fonte il modello non viene chiamato (D14) | Una chiamata a pagamento su input vuoto produrrebbe una proposta inventata: esattamente ciò che E6 vieta |
| I nomi dei servizi sono unici a meno di maiuscole e spazi (B10) | Il nome è la chiave con cui la proposta riconosce un servizio esistente (E4) e con cui un'analisi salvata lo cita (F5): due omonimi renderebbero entrambi i criteri ambigui |
| `company_linkedin_url` non è un campo del profilo | Non ha consumatori: la pagina LinkedIn aziendale non si legge (Non-Goals) e l'analisi non la usa. L'URL resta dentro il record Apollo, dove arriva già |
| Gli emendamenti al dominio sono dichiarati nella spec (H1, H2) | Il contract vuole che una violazione degli invarianti sia discussa, non fatta di soppiatto: qui l'AI esce dall'analisi e gli strumenti passano da tre a quattro |
