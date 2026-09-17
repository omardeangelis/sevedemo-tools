---
domain: prospect-crm
type: spec
status: draft
links:
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[chore/roadmap-apollo-icp-assistant-profilo|roadmap Apollo · assistente ICP · anagrafica]]"
  - "[[specs/prospect-crm/crm-foundation/PLAN|crm-foundation PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
  - "[[specs/prospect-crm/apollo-lookalike/FLOW|FLOW]]"
created: 2026-09-16
updated: 2026-09-17
---

# Spec: Aziende simili e contatti via Apollo (`apollo-lookalike`)

---

## User input

> Avrei 3 requisiti per migliorare la piattaforma. 1. Una volta creato ICP, aziende di riferimento e una
> lista deve partire l'estrazione da Apollo per trovare aziende simili e successivamente i contatti utili
> per contattarli. […] Per apollo nelle env è gia presente APOLLO_API_KEY

Decisioni prese il 2026-09-16 sulle domande aperte della roadmap (risposte testuali dell'utente):

> D-A (identità aziende): dominio come identità alternativa, magari LinkedIn lo recuperiamo poi quando
> abbiamo lo scraper dei siti o le contattiamo direttamente via mail
> D-B (default pipeline): Triage manuale di default
> D-C (email): Entrambi, Apollo come nuovo provider
> D-E (piano Apollo): Piano a pagamento, master key

---

## Context

Oggi le aziende target di un ICP si inseriscono **a mano** (URL LinkedIn) e da ciascuna si estraggono le
persone con il sourcing Apify. Il contract del dominio documenta il lookalike di aziende come seam futuro
`CompanyLookalikeProvider`: questa spec lo rende una capability posseduta dal dominio.

**Per chi:** Omar, unico utente (founder/consulente), esperto del dominio e ansioso da costo: ogni chiamata
esterna è denaro reale, quindi vuole vedere prima cosa succede e quanto costa, e decidere lui cosa entra
nel CRM.

**Cosa:** dato un ICP con almeno un'azienda di riferimento con dominio, il CRM usa Apollo per (1)
**arricchire** le referenze (settore, parole chiave, dipendenti, paese), (2) proporre **aziende simili**
con filtri derivati dalle referenze arricchite e dall'ICP, (3) far **vagliare** all'utente le proposte, (4)
per le aziende accettate trovare le **persone** che matchano i ruoli dell'ICP e metterle in una lista
dell'ICP scelta al lancio, (5) opzionalmente trovare l'**email di lavoro** di quelle persone. Ogni passo a
pagamento passa dalla preview uniforme del CRM; nessun passo scrive liste o stati senza una scelta
esplicita.

**Perché:** oggi la ricerca di aziende nuove è manuale e lenta; le aziende di riferimento (clienti vinti,
trattative) sono il miglior segnale di "chi altro comprerebbe" e Apollo ha i dati per usarle.

**Terminologia:** "referenza" = azienda di riferimento dell'ICP (`icp_reference_companies`); "candidata"
= azienda proposta dal lookalike per un ICP; "arricchita (Apollo)" = azienda con dati Apollo salvati.

**Dipendenze verso le altre capability della roadmap:** l'assistente ICP e l'anagrafica automatica riusano
la configurazione Apollo e l'arricchimento azienda introdotti qui; nessuna dipendenza inversa.

---

## Non-Goals

- **Avvio automatico** della catena "aziende simili → contatti" alla creazione di ICP/referenze/lista:
  niente trigger, niente cron; la catena parte da click con anteprima (l'opzione "pipeline" comprime
  ricerca e contatti in un solo click, non in zero).
- **Somiglianza via AI**: in v1 filtri e punteggio derivano da regole deterministiche (sezione "Regole di
  somiglianza"); una proposta dei filtri fatta da Claude è un'estensione futura.
- **Email personali** e **telefoni** via Apollo: solo email di lavoro; Apollo non rivela email personali
  per contatti EU e non le chiediamo.
- **Piano Apollo gratuito**: non supportato. La readiness verifica solo la presenza della chiave; una
  chiave senza il permesso di ricerca persone emerge come errore di configurazione al primo job che lo
  richiede (contatti o pipeline), non come blocker in preview; la verifica manuale preliminare (A5) lo
  anticipa. Nessun fallback su Apify per i contatti.
- **Sourcing Apify** per aziende senza pagina LinkedIn: resta bloccato finché l'URL LinkedIn non è noto.
- **Scraper dei siti**, assistente ICP e anagrafica automatica: spec separate. (L'URL LinkedIn che Apollo
  restituisce per un'azienda già nota **viene** invece acquisito: vedi Regole di unione.)
- **Progresso parziale** dei job ("12/80"): non previsto, come nel resto del dominio.
- **Invio email**: il dominio si ferma sempre all'export CSV e al touchpoint registrato.

---

## Acceptance Criteria

### A. Configurazione e readiness

- A1. `APOLLO_API_KEY` è letta dalla configurazione e documentata in `.env.example` e nel README.
- A2. Il README ha una sezione Apollo: piano richiesto (a pagamento; master key, oppure chiave con il
  permesso di ricerca persone via API), crediti per operazione, rate limit, variabili `APOLLO_*`.
- A3. Impostazioni e onboarding espongono la readiness `apollo` (chiave presente sì/no) accanto a quelle
  Apify e Anthropic.
- A4. Senza chiave, ogni preview che usa Apollo mostra il blocker "APOLLO_API_KEY mancante nel .env" e
  nessuna chiamata parte.
- A5. Prima dell'uso reale esiste una verifica manuale documentata nel README che, eseguita dall'utente
  dopo una conferma esplicita, chiama una volta ciascuna operazione Apollo usata e riporta: permessi della
  chiave, crediti consumati (attesi: 3 = 1 arricchimento azienda + 1 pagina di ricerca + 1 match persona;
  la ricerca persone è gratuita) e limiti di rate letti dalle risposte.

### B. Identità azienda a doppia chiave

- B1. Un'azienda può esistere con solo il **dominio**, con solo l'**URL LinkedIn**, o con entrambi; mai con
  nessuno dei due.
- B2. Il dominio è normalizzato: minuscolo; senza schema, porta, percorso e query; senza il prefisso `www.`;
  gli altri sottodomini restano (`shop.acme.it` ≠ `acme.it`); per le aziende Apollo si usa il dominio
  primario che Apollo riporta. Gli host di piattaforme condivise (almeno `linkedin.com`, `facebook.com`,
  `instagram.com`, `google.com`, `sites.google.com`, `wixsite.com`) non sono un dominio: lasciano il campo
  vuoto.
- B3. Dominio e URL LinkedIn sono ciascuno unico tra le aziende; `apollo_org_id` è unico se presente.
- B4. Da API e da UI, creare o aggiornare un'azienda con un dominio o un URL LinkedIn già presente su
  un'altra riga risponde 409 con messaggio in italiano e l'identità dell'azienda che lo possiede; nessuna
  scrittura.
- B5. Dal dettaglio azienda l'utente può **unire esplicitamente** l'azienda con quella indicata dal 409
  ("Unisci in <nome>"): la superstite è sempre l'azienda indicata, campi e relazioni seguono le Regole di
  unione; l'azione è irreversibile e chiede una conferma che elenca cosa si perde (chiave scartata, righe
  assorbite); dopo l'unione l'azienda assorbita non esiste più e l'utente si trova sulla superstite.
- B6. Nei job, un'azienda restituita da Apollo che corrisponde a due righe diverse (una per dominio, una
  per URL LinkedIn) le unisce automaticamente secondo le Regole di unione; l'esito del job conta le unioni.
- B7. Nei job, un'azienda già nota per una sola chiave **acquisisce** dall'esito Apollo l'altra chiave se
  nessun'altra azienda la possiede; se la possiede, si applica B6.
- B8. Le aziende esistenti con un sito riconoscibile come dominio ottengono il dominio al primo avvio dopo
  l'aggiornamento, senza intervento dell'utente; a parità di dominio lo tiene la riga con id minore e le
  altre restano senza dominio con una riga nel log del server; un sito non normalizzabile lascia il
  dominio vuoto senza errore.
- B9. La migrazione dello schema delle aziende avviene solo se lo schema va ricostruito, è idempotente
  (una seconda esecuzione non fa nulla), e conserva ogni riga e ogni relazione (riferimenti ICP, prospect
  collegati, fonti).
- B10. Prima di ricostruire, la migrazione crea una copia di sicurezza **consistente** del DB (stesso
  contenuto che si leggerebbe, incluse le transazioni non ancora consolidate) accanto all'originale, con
  nome che include la data; in caso di errore il server non parte, il messaggio indica la copia e il DB
  originale è intatto ("tutto o niente").
- B11. Dal dettaglio azienda l'utente può inserire, modificare o togliere dominio e URL LinkedIn; mai
  entrambi vuoti (400 con messaggio).
- B12. Elenco e dettaglio aziende mostrano il dominio e l'indicazione "Senza pagina LinkedIn" quando manca
  l'URL; la ricerca aziende filtra anche per dominio.
- B13. La creazione manuale di un'azienda accetta come chiave un URL LinkedIn **oppure** un sito/dominio;
  senza nome, il nome predefinito è lo slug LinkedIn se c'è l'URL, altrimenti il dominio.
- B14. La preview del sourcing Apify su un'azienda senza URL LinkedIn mostra il blocker "Azienda senza
  pagina LinkedIn: recuperala prima" e il job non parte; l'azione torna disponibile appena l'URL è noto.

### C. Arricchimento Apollo delle aziende (referenze)

- C1. La pagina ICP, nella card "Aziende simili (Apollo)", mostra lo stato delle referenze: quante hanno
  un dominio, quante sono arricchite (Apollo) e quante restano da arricchire.
- C2. "Arricchisci referenze" apre una preview con `counts.est_credits` = referenze con dominio non ancora
  arricchite né tentate di recente (1 credito ciascuna), `est_cost_usd` come in C5, l'opzione "ritenta anche
  le non trovate di recente", blocker (chiave mancante; nessuna referenza da arricchire; un altro job in
  corso) e warning (referenze senza dominio, elencate per nome).
- C3. Il job arricchisce ogni referenza nell'ambito e salva sull'azienda i dati Apollo (id, dominio
  primario, URL LinkedIn secondo B7, settore, parole chiave, dipendenti, città, regione, paese, dati grezzi) e la data
  dell'esito; i campi descrittivi già presenti (nome, sito, settore, dimensione, sede) **non** vengono
  sovrascritti: Apollo riempie solo i campi vuoti. Una referenza che Apollo non conosce, o il cui esito
  Apollo ha chiavi in conflitto con l'anagrafica (Regole di unione), è marcata come tentata con la stessa
  data e l'esito ("non trovata" / "chiavi in conflitto" con le chiavi Apollo discordanti), elencata
  nell'esito e nel warning, e non ritentata prima di `FRESHNESS_DAYS` giorni salvo "ritenta"; cambiare
  dominio o URL LinkedIn di un'azienda azzera la data del tentativo.
- C4. La stessa azione "Arricchisci con Apollo" è disponibile dal dettaglio azienda per una singola azienda
  con dominio (stessa preview, 1 credito); un'azienda già arricchita mostra il blocker "Già arricchita il
  <data>" (i dati Apollo non si ricomprano).
- C5. Ogni `est_cost_usd` di questa spec che dipende dai crediti vale crediti × `APOLLO_CREDIT_USD`; senza
  prezzo configurato è `null` e la UI dice "stima non disponibile"; i crediti stanno sempre in
  `counts.est_credits` e in una riga riassuntiva sempre visibile, anche a 0, con la scomposizione.
- C6. Esito: "N referenze arricchite, K non trovate su Apollo, U unioni, L URL LinkedIn acquisiti, C con
  chiavi in conflitto".
- C7. Un errore del provider su un lotto non ferma gli altri (isolamento per lotto); un arresto dopo almeno
  una referenza salvata chiude il job come riuscito con esito parziale e warning; prima della prima
  scrittura è un job fallito; errori attribuiti come D13.

### D. Trova aziende simili (preview + job)

- D1. La card "Aziende simili (Apollo)" mostra la CTA "Trova aziende simili", il conteggio delle candidate
  per stato e la data dell'ultima ricerca riuscita (derivata dai job).
- D2. La preview mostra i **filtri derivati** secondo le Regole di somiglianza dalle referenze **arricchite**
  e dall'ICP, con l'origine di ogni valore, e lascia modificarli prima dell'avvio; la ricerca non arricchisce
  nulla.
- D3. La preview propone 1 pagina di ricerca, modificabile da 1 fino al tetto `APOLLO_MAX_COMPANY_PAGES`
  (default 3); 1 pagina = fino a 100 aziende; `counts.est_credits` = pagine da leggere.
- D4. Blocker ("Avvia" disabilitato con motivo): chiave Apollo mancante; tutti i filtri vuoti; un altro
  job in corso (in preview come blocker; all'avvio 409 `job_running`). La card anticipa in una riga di
  stato il blocker noto prima di aprire il dialog.
- D5. Warning (non bloccano): referenze con dominio non ancora arricchite ("arricchiscile per usare i loro
  settori e dimensioni nei filtri"); nessuna referenza arricchita ("i filtri derivano solo dall'ICP");
  nessuna parola chiave nei filtri ("la ricerca userà solo fasce e località"); nessuna lista attiva per
  l'ICP; referenze senza dominio; ICP senza settori né dimensione né località.
- D6. Se i filtri confermati sono **uguali** a quelli dell'ultima ricerca riuscita dello stesso ICP (stessi
  insiemi normalizzati di parole chiave, fasce e località), la preview propone di continuare dalla pagina
  successiva all'ultima letta (default) con l'alternativa esplicita "Ricomincia dalla pagina 1", e avvisa
  che ricominciare ripaga pagine già lette; se l'ultima pagina letta non era piena (meno di 100 aziende) la
  ricerca è esaurita: la preview lo dice e propone solo "Ricomincia" o filtri diversi.
- D7. Il job esegue la ricerca pagina per pagina con i filtri confermati ed esclude dai risultati le
  referenze dell'ICP e le aziende già candidate dello stesso ICP in qualunque stato (contate come "già
  note").
- D8. Una referenza dell'ICP ritrovata tra i risultati con l'altra chiave si unisce/completa secondo B6/B7
  e non diventa candidata (contata come "referenza completata").
- D9. Ogni altra azienda trovata diventa una riga di `companies` (creata, o riconosciuta per dominio/URL
  LinkedIn con le Regole di unione) con i dati Apollo salvati come in C3; un'azienda senza dominio né URL
  LinkedIn, o con chiavi in conflitto, è saltata e contata.
- D10. Per ogni azienda di D9 nasce una **candidata** dell'ICP in stato `proposta` con punteggio (0–1, due
  decimali) e ragioni secondo le Regole di somiglianza; rilanciare non duplica candidate né aziende.
- D11. Esito: "N aziende lette, M nuove candidate, K già note, J senza pagina LinkedIn, U unioni, R referenze
  completate, C con chiavi in conflitto, S senza chiavi, pagine lette P"; 0 aziende lette è un esito neutro con i filtri usati e il suggerimento di
  allargarli; oltre la metà senza pagina LinkedIn produce un warning.
- D12. Qualunque arresto (limite di rate, errore del provider, interruzione) **dopo almeno una pagina
  salvata** chiude il job come riuscito con esito parziale esplicito e warning ("limite Apollo raggiunto:
  lette 2 pagine su 3") e le pagine lette restano derivabili per D6; un arresto prima della prima pagina
  salvata è un job fallito.
- D13. Gli errori del provider sono attribuiti `actor:apollo:<operazione>:`; una chiave rifiutata o senza i
  permessi richiesti produce un errore `config:` con il rimedio ("usa una master key o una chiave con il
  permesso di ricerca persone"); gli errori di configurazione locali `config:`.
- D14. Ogni ricerca resta **analizzabile**: l'elenco "Ricerche precedenti" dell'ICP mostra per ricerca data,
  filtri, pagine lette, aziende lette, candidate proposte e la loro distribuzione per **fascia di punteggio**
  (basso < 0,34, medio 0,34–0,66, alto ≥ 0,67) incrociata con lo **stato attuale** (proposta / accettata /
  scartata), più il numero di candidate "senza località"; la distribuzione è derivata dalle candidate che
  quella ricerca ha proposto (le candidate già note a una ricerca successiva restano attribuite alla prima).
  Ogni candidata conserva le **componenti** del punteggio e la **versione** della regola con cui è stato
  calcolato, così pesi diversi si possono simulare sui dati storici senza nuove chiamate; cambiare le
  costanti non ricalcola i punteggi esistenti.

### E. Candidate e triage

- E1. La pagina ICP mostra la sezione "Candidate" con filtro per stato (`proposta` di default, `accettata`,
  `scartata`) e colonne nome, dominio, settore, dipendenti, sede, punteggio e "perché simile", con link al
  dettaglio azienda e al sito.
- E2. Azioni Accetta / Scarta / Riproponi (torna a `proposta`) per riga e in bulk sulla selezione, senza
  conferme; ogni cambio aggiorna la data di decisione; dopo un Accetta in bulk il toast offre "Trova
  contatti in queste N".
- E3. Il cambio di stato è reversibile: una candidata può passare a qualunque altro stato in qualunque
  momento; un bulk riporta l'esito per riga (riuscite / fallite) e non è tutto-o-niente.
- E4. Promuovere una candidata a referenza (azione esistente sull'azienda) la toglie dalle candidate
  dell'ICP; punteggio e ragioni non si conservano. Rimuovere una referenza non la rende candidata.
- E5. Il dettaglio azienda mostra per quali ICP è candidata e in che stato; la riga candidata mostra "già
  cercata il <data>" con la data della fonte `apollo_people` più recente registrata per quell'azienda
  (derivata dalle fonti, quindi corretta anche dopo un job parziale).
- E6. Le candidate sono leggibili via API per ICP e stato; il cambio di stato è disponibile per singola
  candidata e in bulk; gli errori seguono la convenzione `{error, code?}` del dominio.

### F. Trova contatti (preview + job)

- F1. Dalle candidate accettate (selezione, o tutte le accettate) la CTA "Trova contatti" apre la preview
  con: lista di destinazione tra le liste attive dell'ICP (obbligatoria); ruoli (default `target_roles`
  dell'ICP); seniority Apollo (opzionale, scelta multipla); località (default `target_locations`); tetto
  di persone per azienda (default `APOLLO_PEOPLE_PER_COMPANY`, 10; da 1 a 100).
- F2. La ricerca persone fa **una richiesta per azienda** con al massimo il tetto di persone; la preview
  dichiara `counts.requests` = aziende con dominio, `counts.est_credits: 0`, `est_cost_usd: 0`, e avvisa se
  le richieste superano `APOLLO_RATE_LIMIT_PER_MINUTE` ("il job rispetterà il limite e durerà più a lungo").
- F3. Blocker: chiave mancante; nessuna azienda selezionata; nessuna delle aziende selezionate ha un
  dominio; lista mancante o archiviata; un altro job in corso. Warning: nessun ruolo (dell'ICP o indicato:
  "verranno prese le prime N persone qualunque per azienda", come nel sourcing); alcune aziende selezionate
  senza dominio (escluse ed elencate); aziende già cercate per la stessa lista (con la data: esiste una
  fonte `apollo_people` per l'azienda su un prospect membro della lista).
- F4. Il job verifica lista e configurazione prima di qualunque chiamata; per ogni persona **con URL
  LinkedIn** crea o riconosce il prospect con l'identità del dominio (URL normalizzato + eventuale id
  membro).
- F5. Sul prospect il job salva titolo e nome azienda se mancanti e collega l'azienda solo se il prospect
  non ne ha già una.
- F6. L'id Apollo della persona è salvato come chiave secondaria solo se nessun altro prospect lo possiede;
  altrimenti il prospect resta senza id Apollo e il caso è contato nell'esito ("id Apollo già assegnato");
  l'id Apollo non unisce mai due prospect da solo.
- F7. Il job registra la fonte `apollo_people` con l'azienda e aggiunge il prospect alla lista scelta; un
  prospect nuovo nasce in stato `nuovo`.
- F8. Le persone senza URL LinkedIn vengono saltate e contate; nessun prospect nasce senza URL LinkedIn.
- F9. Rilanciare il job sulle stesse aziende non duplica prospect, fonti o membership.
- F10. Esito: "P persone lette in A aziende, N aggiunte a '<lista>' (X nuove, Y già in archivio), S già in
  lista, Z senza profilo LinkedIn, T con id Apollo già assegnato"; 0 persone è neutro con i filtri usati; oltre la metà senza profilo
  LinkedIn produce un warning; arresto dopo almeno un'azienda completata = esito parziale riuscito con
  warning (come D12); errori attribuiti come D13.
- F11. Il prospect, la lista, il filtro per fonte e l'export CSV mostrano la provenienza "Apollo · <azienda>"
  ovunque oggi si mostrano le fonti.
- F12. Il dettaglio di un'azienda **con dominio** offre "Trova contatti" per quella sola azienda, anche se non
  è candidata né referenza di alcun ICP: stesso dialog e stesso job di F1–F10, con la lista di destinazione
  scelta tra **tutte** le liste attive (raggruppate per ICP) e ruoli/località di default presi dall'ICP della
  lista scelta; senza dominio l'azione è disabilitata con motivo ("serve il sito web"); senza liste attive è
  un blocker; accanto all'azione compare "contatti cercati il <data>" derivato come E5.

### G. Email di lavoro via Apollo (arricchimento con scelta del provider)

- G1. Il dialog di arricchimento (singolo prospect, selezione, lista) offre la scelta del provider:
  **Apify** (comportamento attuale) o **Apollo** (email di lavoro).
- G2. Con Apollo, l'ambito è: prospect **senza email**, escludendo quelli con un esito Apollo negli ultimi
  `FRESHNESS_DAYS` giorni salvo "ritenta"; la preview conta selezionati, da cercare, esclusi per email
  presente, esclusi per esito recente.
- G3. La preview Apollo dichiara `counts.est_credits` = prospect da cercare (1 credito ciascuno) ed
  `est_cost_usd` come in C5; blocker: chiave mancante, nessun prospect da cercare, lista archiviata, un altro
  job in corso.
- G4. L'arricchimento Apollo usa l'URL LinkedIn del prospect (o l'id Apollo se noto) e salva email di
  lavoro se mancante, titolo e nome azienda se mancanti, l'id Apollo secondo F6; non richiede né salva
  telefoni o email personali.
- G5. L'arricchimento Apollo **non** modifica `enriched_at` né `enrichment_attempted_at`: lo stato derivato
  "arricchito" resta "profilo LinkedIn letto" (prerequisito dell'analisi AI, ambito di Apify).
- G6. La data `apollo_matched_at` sul prospect è scritta quando Apollo risponde (email trovata o non
  disponibile), non su errore del provider: i prospect non elaborati restano "da cercare".
- G7. Esito: "E email trovate, K non disponibili (contatti EU o dato assente), F già presenti"; arresto a
  metà = esito parziale riuscito con warning; la timeline del prospect registra un'attività `enrichment` con
  provider Apollo ed esito.

### H. Opzione "pipeline" (aziende → contatti in un click)

- H1. La preview di "Trova aziende simili" espone l'opzione "Trova subito i contatti nelle aziende trovate",
  **spenta di default**; attivandola compaiono gli stessi campi di F1 e la stima somma crediti della
  ricerca (pagine) + 0 per le persone, e `counts.requests` = pagine + "fino a pagine × 100" per i contatti.
- H2. Con l'opzione attiva, un solo job esegue entrambi i passi sulle **candidate create da quel job**, che
  restano in stato `proposta` (la pipeline non decide al posto dell'utente), e l'esito riporta entrambi i
  conteggi.
- H3. Se il passo contatti fallisce (permessi, provider, limite) dopo il passo aziende, il job chiude con
  esito parziale riuscito: il passo aziende completo, le candidate salvate, e l'errore attribuito del passo
  contatti nel warning.
- H4. Senza lista attiva per l'ICP l'opzione è disabilitata con motivo.

### I. Coerenza con il dominio

- I1. I job Apollo rispettano "un solo job alla volta" (409 `job_running`), la preview uniforme
  `{counts, est_cost_usd, warnings, blockers}` e il retry con gli stessi parametri.
- I2. "Riprova" su un job fallito ripassa dai blocker di configurazione della preview (non avvia a chiave
  mancante o lista archiviata) e risponde 400 `blocked` in quel caso; vale per tutti i job kind e chiude
  il debito TD-25 di `crm-foundation` (scope dichiarato oltre la capability).
- I3. Le stime non inventano mai un prezzo (C5).

---

## Regole di somiglianza (v1, deterministiche)

Input: le referenze dell'ICP **arricchite** (tag = `keywords` ∪ {`industry`}, numero dipendenti, città e
regione come le restituisce Apollo) e
l'ICP (`target_industries`, `company_size`, `target_locations`). Tutti i confronti testuali sono su valori
normalizzati (minuscolo, spazi ridotti, uguaglianza esatta).

- **Parole chiave**: per ogni referenza il suo insieme di tag (senza doppioni); frequenza di un tag = numero
  di referenze che lo contengono; ordinamento per frequenza decrescente, poi alfabetico; si tengono le
  prime 10; i `target_industries` dell'ICP si aggiungono **oltre** le 10 (se non già presenti).
- **Fasce di dipendenti** (fasce fisse Apollo: `1-10`, `11-20`, `21-50`, `51-100`, `101-200`, `201-500`,
  `501-1000`, `1001-2000`, `2001-5000`, `5001-10000`, `10001+`): la fascia che contiene il numero
  dipendenti di ogni referenza più la fascia immediatamente inferiore e superiore; più le fasce che
  **intersecano** l'intervallo di `company_size` dell'ICP quando è riconoscibile come `A-B` o `N+`
  (`"10-50"` → `1-10`, `11-20`, `21-50`; `"50+"` → da `21-50` in su); altrimenti ignorata con nota.
- **Località**: unione dei paesi delle referenze e dei `target_locations` dell'ICP (testo libero).
- **Punteggio** (0–1, arrotondato a 2 decimali) = 0,5 × parole chiave + 0,3 × dimensione + 0,2 × località:
  - parole chiave = |tag della candidata ∩ parole chiave del filtro| / |parole chiave del filtro|; 0 se il
    filtro non ha parole chiave o la candidata non ha tag;
  - dimensione = 1 se la fascia della candidata contiene il numero dipendenti di almeno una referenza; 0,5
    se è adiacente a una di quelle; 0 altrimenti (anche senza dato);
  - località = 1 se la **città** della candidata è uguale a quella di almeno una referenza; 0,5 se la sua
    **regione** (`state` di Apollo) è uguale a quella di almeno una referenza; 0 altrimenti. La nazione non
    conta: le ricerche sono nazionali e non distinguerebbe nulla. **Dato mancante**: se la candidata non ha
    né città né regione (o nessuna referenza le ha), la componente è "non disponibile" e si **esclude**: il
    punteggio è la somma pesata delle componenti disponibili divisa per la somma dei loro pesi (0,8), così
    un'azienda senza sede su Apollo non è penalizzata né premiata; il caso è dichiarato tra le ragioni e
    contato per ricerca (D14). Le altre componenti mancanti valgono 0 come sopra.
  - Le tre componenti (0–1 ciascuna, `null` se esclusa) e la versione della regola (`v1`) si conservano sulla
    candidata (D14); fasce di lettura: basso < 0,34, medio 0,34–0,66, alto ≥ 0,67.
- **Ragioni**: una stringa per componente non nulla: "N parole chiave in comune: a, b" · "stessa fascia di
  dipendenti di <ref> (<fascia>)" / "fascia vicina a <ref>" · "stessa città di <ref[, ref]> (<città>)" /
  "stessa regione di <ref> (<regione>)" / "località non disponibile da Apollo".
- Le candidate si propongono tutte, ordinate per punteggio decrescente e, a pari punteggio, per nome
  (nessuna soglia: Open Question 2).

**Esempio di riferimento (fixture):** referenze Acme (tag `software`, `saas`, `hr`; 80 dipendenti; Milan,
Lombardy, Italy) e Beta (tag `hr`, `payroll`, `human resources`; 30; Turin, Piedmont, Italy); ICP: settori
`hr tech`, dimensione `10-50`, località `Milano`. Filtro: parole chiave `hr, human resources, payroll, saas,
software` + `hr tech`; fasce `1-10, 11-20, 21-50, 51-100, 101-200`; località `Italy, Milano`. Candidata
Gamma (tag `hr`, `saas`, `fintech`; 60; Milan, Lombardy): parole chiave 2/6 = 0,333 → 0,167; dimensione
`51-100` contiene Acme → 0,3; località: stessa città di Acme → 0,2; **punteggio 0,67**; ragioni: "2 parole
chiave in comune: hr, saas", "stessa fascia di dipendenti di Acme (51-100)", "stessa città di Acme (Milan)".
Candidata Delta (stessi tag e dipendenti; Bergamo, Lombardy): località = stessa regione di Acme → 0,1;
**0,57**. Candidata Epsilon (stessi tag e dipendenti; sede assente): località esclusa → (0,167 + 0,3) / 0,8
= **0,58**, ragione "località non disponibile da Apollo". Fasce: Gamma alto, Delta ed Epsilon medio.

---

## Regole di unione (aziende)

Valgono per B5 (esplicita) e B6/B7/D8/D9 (nei job).

- **Superstite** (nei job): tra le due righe resta quella con l'URL LinkedIn se solo una lo ha; altrimenti
  quella con id minore. L'altra è assorbita e cancellata. Nell'unione esplicita (B5) la superstite è quella
  indicata dall'utente.
- **Campi**: il superstite tiene i propri valori non vuoti e prende dall'assorbita quelli che gli mancano;
  le note si concatenano; i dati Apollo più recenti vincono.
- **Relazioni**: riferimenti ICP, candidature, prospect collegati e fonti dei prospect passano al
  superstite; due fonti dello stesso prospect e tipo (una per azienda) si fondono tenendo la più recente; se entrambe erano referenza dello stesso ICP resta quella del superstite; se una era referenza
  e l'altra candidata dello stesso ICP, la referenza vince e la candidatura cade; tra due candidature dello
  stesso ICP vince lo stato deciso (`accettata` o `scartata`) sulla `proposta`, e a parità quella del
  superstite.
- **Chiavi in conflitto** (nei job): se una chiave dell'esito Apollo (dominio, URL LinkedIn o
  `apollo_org_id`) corrisponde a una riga in cui **una qualunque delle altre chiavi** è già piena e
  diversa da quella dell'esito, oppure le chiavi dell'esito corrispondono a più di due righe, non si unisce
  né si sovrascrive nulla: l'azienda Apollo viene saltata, contata nell'esito ("chiavi in conflitto") ed
  elencata nel warning con le chiavi discordanti; una chiave assente nell'esito non è mai in conflitto.
  L'unione automatica (B6) avviene solo quando ogni chiave dell'esito trova una riga che manca delle altre
  chiavi o le ha uguali.
- **Acquisizione** (B7): una riga con una sola chiave riceve l'altra dall'esito Apollo quando nessun'altra
  azienda la possiede.

---

## Constraints

- **Invarianti del contract** che restano validi: preview prima di ogni spesa; un solo job alla volta;
  l'utente decide sempre (nessuna assegnazione automatica di liste o stati oltre alla lista scelta al
  lancio); SQLite unica verità; provenienza multipla e idempotente; esito onesto attribuito; nessun cron;
  nessun cookie LinkedIn; dati personali tracciati in `sources`; "non pagare due volte lo stesso dato"
  (arricchimento azienda conservato con freshness, ripartenza dalla pagina successiva, freshness Apollo sui
  prospect).
- **Invarianti che cambiano**: (1) identità delle aziende (D-A): da `linkedin_url` obbligatorio a doppia
  chiave `linkedin_url` | `domain` con almeno una presente; l'identità dei **prospect** non cambia (URL
  LinkedIn obbligatorio; l'id Apollo è solo chiave secondaria). (2) "La configurazione emerge prima come
  blocker in preview" ha un'eccezione dichiarata: il permesso di ricerca persone della chiave Apollo si
  scopre al primo job che lo richiede (D13), mitigato dalla verifica manuale A5. Il contract va aggiornato
  in `docs-maintenance` insieme ai nuovi job kind, source kind e alla tabella delle candidate (seam
  `CompanyLookalikeProvider` → capability posseduta).
- **Stato "arricchito"** invariato: `enriched_at` significa profilo LinkedIn letto (Apify) ed è il
  prerequisito dell'analisi AI; Apollo non lo tocca (G5). Le scritture Apollo su prospect (titolo, azienda)
  e su aziende (solo campi vuoti) possono rendere `stale` analisi già fatte: effetto accettato, lo stato
  `stale` è già derivato e visibile.
- **Apollo** (fonte: roadmap §4; da riconfermare con la verifica manuale A5): arricchimento organizzazione
  per dominio = 1 credito per azienda (bulk da 10); ricerca aziende = 1 credito per pagina, 100 aziende per
  pagina; ricerca persone via API = 0 crediti, senza email/telefono, richiede master key o chiave con il
  permesso specifico; match persona = 1 credito (+8 con telefono, non richiesto), bulk da 10, nessuna
  email personale per contatti EU; piani a pagamento nell'ordine di 200 richieste/minuto con tetti orari e
  giornalieri dal piano. Il prezzo del credito dipende dal piano: mai codificato.
- **Rate limit**: i job rispettano `retry-after` con un'attesa massima per tentativo e un numero massimo
  di ritentativi documentati nel README; oltre, esito parziale (D12); il limite per minuto usato dalle
  preview è `APOLLO_RATE_LIMIT_PER_MINUTE` (default 200, documentato).
- **GDPR**: i prospect trovati via Apollo sono dati personali; la fonte resta sempre tracciata; solo email
  di lavoro; l'export CSV già mostra la provenienza.
- **Test e validazione** (regole del repo): nessuna chiamata Apollo da test o validazione; job con
  dipendenze iniettate, mapper puri con fixture JSON, fake nel server e2e anche per i job Apollo; tutte le
  richieste Apollo costruite in un solo punto del codice; lettura tollerante delle risposte.
- **Stack e gate del repo**: TS/Node ESM, Hono, SQLite, React; gate `typecheck`, `vitest`, build web; UI,
  commenti ed errori in italiano; nessuna nuova dipendenza senza motivo.

---

## Data model (delta, livello di dominio)

- `companies`: `linkedin_url` diventa opzionale (unico se presente); nuovo `domain` (unico se presente);
  vincolo "almeno uno dei due"; `apollo_org_id` (unico se presente), `apollo_json`, `apollo_enriched_at`
  (data dell'ultimo esito Apollo, anche negativo: `apollo_org_id` nullo = non trovata o chiavi in conflitto,
  con l'esito e le chiavi discordanti conservati in `apollo_json`). Migrazione con le
  salvaguardie di B9/B10.
- Nuova relazione `icp_company_candidates`: `icp_id`, `company_id`, `status` (`proposta` | `accettata` |
  `scartata`), `score`, `score_parts` (JSON: `keywords`, `size`, `location`, ciascuna 0–1 o `null` se
  esclusa), `scoring_version` (`v1`), `reasons` (JSON di stringhe), `job_id` (la ricerca che l'ha proposta),
  `created_at`, `decided_at`; chiave `(icp_id, company_id)`; cancellata con l'ICP. Una referenza dell'ICP non
  può essere anche candidata dello stesso ICP. Le statistiche per ricerca (D14) sono derivate da queste righe
  raggruppate per `job_id`: nessuna tabella di statistiche.
- `sources.kind`: nuovo valore `apollo_people` (richiede `company_id`), con la stessa unicità di
  `company_employees`.
- `prospects`: `apollo_person_id` (chiave secondaria, unica se presente, non identità) e
  `apollo_matched_at` (G6).
- `jobs.kind`: nuovi `enrich_companies`, `lookalike_companies`, `apollo_people`; `enrich` acquisisce il
  parametro `provider` (`apify` | `apollo`, default `apify`). "Ultima ricerca", "ultima pagina letta" (D6) sono derivate
  dai job riusciti; "già cercata il <data>" (E5) dalle fonti `apollo_people`; nessuna colonna.
- Readiness: nuovo flag `apollo`. Variabili: `APOLLO_API_KEY`, `APOLLO_MAX_COMPANY_PAGES` (tetto, default
  3; il dialog propone 1), `APOLLO_PEOPLE_PER_COMPANY` (default 10), `APOLLO_RATE_LIMIT_PER_MINUTE`
  (default 200), `APOLLO_CREDIT_USD` (vuoto = stima non disponibile).

---

## Technical Notes

- Apollo non ha un endpoint "aziende simili a": la somiglianza è interamente la derivazione dei filtri e
  il punteggio della sezione dedicata; deve restare spiegabile nel dialog e nelle ragioni.
- Le persone della ricerca Apollo hanno l'URL LinkedIn nella maggior parte dei casi ma non sempre: F8 lo
  gestisce contando gli scarti.
- Una chiave senza il permesso di ricerca persone via API risponde 403: va riportato come `config:` con
  il rimedio (D13).
- Rendere `linkedin_url` opzionale su SQLite richiede la ricostruzione della tabella `companies` (e dei
  `CHECK` su `sources.kind` e `jobs.kind`): da qui B9/B10.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | Seniority Apollo da offrire nel dialog contatti (tutte le 9: `owner`, `founder`, `c_suite`, `vp`, `head`, `director`, `manager`, `senior`, `entry`, o un sottoinsieme) | F1, FLOW | Omar | Resolved 2026-09-17: tutte e 9, nessuna preselezionata |
| 2 | Soglia minima di punteggio sotto cui una candidata non viene proposta | D10, E1 | Omar | Resolved 2026-09-17: nessuna soglia; la componente "paese" (sempre Italia) diventa "località" città/regione delle referenze, con esclusione e rinormalizzazione se la sede manca (Regole di somiglianza) |
| 3 | "Trova contatti" anche dal dettaglio azienda per una singola azienda con dominio, fuori dalle candidate | F1 | Omar | Resolved 2026-09-17: incluso (F12); la lista scelta determina l'ICP dei default |
| 4 | Pesi del punteggio (0,5 / 0,3 / 0,2) e numero di parole chiave (10): da tarare dopo il primo uso reale | Regole di somiglianza | Omar | Resolved 2026-09-17: costanti nel codice; ogni ricerca resta analizzabile (D14: componenti e versione sulla candidata, distribuzione per fascia × stato per ricerca) |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Identità azienda a doppia chiave (`linkedin_url` \| `domain`), D-A | Apollo lavora per dominio; molte aziende trovate non hanno pagina LinkedIn nota subito. Perderle contraddirebbe lo scopo; l'URL LinkedIn arriva da Apollo, da uno scraper futuro o a mano. Stesso modello dei prospect (`linkedin_url` + `member_urn`) con unione. |
| Arricchimento delle referenze come job separato con la sua preview | I filtri "simili alle referenze" richiedono referenze arricchite; arricchire dentro il job di ricerca userebbe filtri derivati prima dell'arricchimento (v2 della spec, bocciata dal gate). Due click la prima volta, uno le successive; l'azione serve anche all'assistente ICP. |
| Unione automatica solo nei job; per l'utente 409 + "Unisci in" esplicito | Un job ha entrambe le chiavi dalla stessa fonte (Apollo) e l'unione è certa; un utente che digita una chiave già usata potrebbe sbagliare: il 409 lo dice e l'unione resta una sua scelta. |
| Triage manuale di default, pipeline opt-in, D-B | "L'utente decide sempre" è un invariante; la pipeline soddisfa "deve partire l'estrazione" con un click e una sola anteprima, non con automatismi. |
| Apollo come secondo provider di arricchimento (email di lavoro), D-C, senza toccare `enriched_at` | Apify `Full+email` resta valido; Apollo aggiunge email di lavoro a 1 credito senza scraping. Lo stato "arricchito" resta il prerequisito dell'analisi: Apollo non porta bio ed esperienze. |
| Piano a pagamento con master key, D-E | La ricerca persone via API richiede master key (o permesso specifico); senza, la capability perderebbe il passo più utile. Il piano gratuito non è supportato. |
| Readiness = chiave presente; permessi verificati al primo job che li richiede e nella verifica manuale | Verificare i permessi in preview costerebbe una chiamata a ogni apertura del dialog; l'errore `config:` è onesto e la verifica manuale lo anticipa. Deviazione dichiarata tra i vincoli. |
| Somiglianza deterministica con regole, tie-break ed esempio numerico | Spiegabilità, testabilità con fixture condivise e zero costi Claude; una versione AI-assistita è un'estensione. |
| Una richiesta per azienda nella ricerca persone | Rende osservabili il tetto per azienda e il numero di richieste; i lotti multi-dominio non garantiscono il tetto. |
| Arresto dopo almeno una pagina/azienda salvata = esito parziale riuscito | Un job fallito perde l'esito: la ripartenza (D6) e "non pagare due volte" richiedono che le pagine lette restino derivabili. |
| Ripartenza dalla pagina successiva con gli stessi filtri | Rispetta "non pagare due volte lo stesso dato" senza una tabella in più: lo stato deriva dai job. |
| Nessuna email personale né telefono | GDPR e ToS: solo email di lavoro; Apollo non rivela email personali EU comunque. |
| Prezzo del credito e rate limit solo da configurazione, con default documentato per il rate | Dipendono dal piano dell'utente; una stima di costo inventata violerebbe "esito onesto"; il rate serve solo a un warning. |
| Persone senza URL LinkedIn saltate; id Apollo mai identità | L'identità del prospect resta l'URL LinkedIn: un prospect "solo Apollo" non sarebbe collegabile a interazioni, sourcing e analisi. |
| Backup consistente del DB prima della migrazione delle aziende | `data/crm.db` è l'unica fonte di verità e la ricostruzione di una tabella è l'unica migrazione distruttiva del repo. |
| Località del punteggio = città (1) / regione (0,5) delle referenze arricchite, non la nazione; sede assente → componente esclusa e punteggio rinormalizzato (2026-09-17) | Le ricerche sono nazionali: la nazione darebbe 0,2 a tutte. Le referenze arricchite usano il vocabolario di Apollo (inglese) come le candidate, quindi il confronto è affidabile; le `target_locations` dell'ICP restano solo filtro perché scritte a mano in italiano. Escludere la componente mancante non penalizza chi non ha la sede su Apollo; il caso è dichiarato e contato. |
| Nessuna soglia di punteggio; seniority tutte e 9 senza preselezione (2026-09-17) | Ogni pagina è già pagata e l'utente decide sempre; una preselezione di seniority in aziende piccole darebbe 0 persone senza che si capisca perché. |
| "Trova contatti" anche dal dettaglio azienda, F12 (2026-09-17) | Serve per segnalazioni inserite a mano, referenze e aziende arrivate dal sourcing; le liste appartengono a un ICP, quindi la lista scelta fornisce ruoli e località di default e il job non cambia. |
| Pesi come costanti, ma ogni ricerca analizzabile: componenti e versione sulla candidata, distribuzione fascia × stato per ricerca, D14 (2026-09-17) | La taratura richiede dati reali; conservare le componenti permette di simulare pesi diversi sulle ricerche passate senza spendere crediti; la distribuzione per ricerca mostra se i filtri producono candidate accettabili. |
