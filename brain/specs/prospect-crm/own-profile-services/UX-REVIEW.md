---
domain: prospect-crm
type: ux-review
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC|SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW|FLOW]]"
  - "[[specs/prospect-crm/own-profile-services/IMPLEMENTATION-NOTES|IMPLEMENTATION-NOTES]]"
created: 2026-10-02
updated: 2026-10-02
---

# UX Review: Profilo e servizi dalle fonti pubbliche (`own-profile-services`)

> Giro sulle schermate vere, fatto dall'`ux-advisor` dopo l'implementazione. Contiene solo **proposte**: FLOW, PLAN e
> codice non sono stati toccati, e le revisioni le decide l'utente. Persona: Omar, freelance, esperto, desktop; per la
> generazione ci sono due momenti, il primo giro su un profilo vuoto (fretta) e i giri dopo su un profilo curato
> (protegge le sue parole, ha ansia da costo), come descritto nel FLOW. Fonti: tre (decisione del 2026-10-02).

## [Round: 2026-10-02] — tappa M4

### Scope

- **App:** Vite `http://localhost:5261` contro il server e2e `:8861` (job finti, DB temporaneo,
  `PRICE_PROFILE_DETAIL_USD=0.01`, `PRICE_PROFILE_GENERATION_USD=0.05`). Seed `{"profile":"empty"}` (percorso A) e
  `{"profile":"curated"}` (percorso C). Trigger: `cloudflare-401`, `cloudflare-limite`, `sito-vuoto`, `profilo-vuoto`,
  `modello-non-valido` scritti in «I tuoi indirizzi pubblici», più un sito che è una pagina LinkedIn (C11). Inoltre
  `fail-next` su `POST /api/profile/proposal/apply` e `DELETE /api/profile/proposal`. Viewport 1280 × 900, più un
  controllo a 760 × 900. Sessione `agent-browser` `ux-m4`, chiusa alla fine; seed riportato a `empty`.
- **Screenshot** (non conservati nel repo):
  `/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/94b3f69c-2bc8-41de-95a5-260268d1c65e/scratchpad/ux/`
  (sotto citati per nome file).
- **Percorsi fatti:** Entry Oggi → `#genera` (G6, comparsa e scomparsa della voce); A completo (anteprima, avvio,
  banner, toast, **Rivedi la proposta**, applica singolo, **Applica tutto**, provenienza, card servizi); B
  (righe per fonte, esclusione con live region, tutte escluse, Non disponibili con link, fonte fresca +
  **Rileggilo comunque**, avviso giallo della proposta pendente, blocco *"job in corso"* preso in corsa); C completo
  (avviso prima della spesa, testata con E14, ordine conflitti → nuovi → modificati, **Applica tutto** che salta i
  conflitti, focus sul primo conflitto, **Applica tutto** spento col motivo, **Sostituisci il tuo testo**, scarto con
  conferma, Esc); E (tabella per fonte, banner e toast, `cloudflare-401` in Connessioni e Oggi, `cloudflare-limite`,
  `sito-vuoto`, D14 neutro, dettaglio del run e log); errori: applica fallito, scarto fallito, generazione fallita +
  **Riprova…** dal banner, proposta non più corrente (seconda scheda simulata avviando una generazione via API), C11;
  edge: testo non salvato mentre applichi, deep link `#proposta` senza proposta, servizio eliminato con proposta
  aperta, campo riscritto a mano con proposta aperta, tastiera e focus dopo ogni azione.
- **Conformi al FLOW, senza rilievi:** voce di Oggi e sua scomparsa; focus sul bottone da `#genera`; etichette
  delle spunte col costo e `fieldset`/`legend`; live region *"Anteprima aggiornata: 1 fonte, costo stimato ≈ $0,05."*;
  blocchi *"Hai escluso tutte le fonti…"* e *"C'è già un job in corso…"* con **Avvia** spento; avviso H5 nella card e
  nel dialog; testata del primo giro (*"Non hai scritto nulla a mano in questi campi…"*); toast del testo non salvato
  (*"Avevi modifiche non salvate in quel campo: sono ancora nel form…"*); focus su «La mia azienda» dopo **Applica
  tutto**; marcatori *"dalla proposta del 2 ott"*; conflitti in cima e fuori da **Applica tutto**, con l'hint giusto;
  **Applica tutto** spento con il motivo in `aria-describedby`; conferma di scarto con **Annulla** a fuoco ed Esc che
  rende il focus al trigger; errore inline `role="alert"` sull'applica e nel dialog di scarto; *"Questa proposta non è
  più quella corrente: la pagina si aggiorna."*; **Riprova…** con le stesse fonti e la lettura del sito ripresa;
  C11, C14, D14 (tono neutro, *"il modello non è stato chiamato"*); attribuzione a Cloudflare in Oggi e nella sua card;
  conferma di eliminazione di un servizio con le frasi su F5/F7.
- **Non fatti:**
  - Blocco D6 (`ANTHROPIC_API_KEY` mancante), A4 (credenziali Cloudflare mancanti fra le Non disponibili), `APIFY_TOKEN`
    mancante, D5 *"stima non disponibile"*: servono variabili d'ambiente diverse, cioè un riavvio del server e2e che
    il brief esclude.
  - D7 *"Nessuna fonte disponibile"* e la riga della card che lo anticipa (G4): il seed ha sempre un post integrale, e
    dalla UI non si arriva a zero fonti.
  - E.4 *"Proposta povera"*: nessun trigger documentato.
  - *"Applica su un servizio eliminato nel frattempo"* (servizio **modificato**) ed edge B10 *"Corrisponde al tuo
    servizio «…»"*: nei due seed non c'è un servizio modificato da eliminare o da scrivere in un altro modo; T31 dice di
    averli provati.
  - H4 (riavvio del server con proposta pendente): non posso riavviare.
  - Percorsi D (servizi a mano) ed F (servizio più affine nella scheda): sono di M1b/M2 e non c'erano nel brief. Ho
    visto solo la conferma di eliminazione.
  - Lo screen reader vero: ho controllato solo l'albero di accessibilità (nomi, ruoli, `aria-describedby`, live region).
    Niente sotto i 760 px.

### Findings

Ordinati per impatto sull'utente rispetto allo sforzo (prima l'impatto alto e lo sforzo basso).

| # | Impatto | Sforzo | Passo del FLOW | Cosa vede l'utente | Proposta |
|---|---------|--------|----------------|--------------------|----------|
| 1 | Alta | Bassa | E.1 · G5 · C13 · D9 (esito per fonte) | Run 8 avviato con `sources: ['linkedin']` (post esclusi, profilo `profilo-vuoto`, sito non valido). La card dice *"Ultima generazione: 2 ott, 20:47 · fonti lette: i miei post"* e mostra la riga *"I miei post · letta · 1 per intero, 1 solo estratto (non usati)"*: è l'esito del run delle 20:45, non di questo. Nel run delle 20:43 il profilo LinkedIn è stato ripreso, ma la riga dice *"letta · 2 ott, 20:39"* e non dice che non è stato riletto né pagato. Dopo il run senza contenuto la card mostra ancora *"Elaborazione: claude-opus-5"*, anche se il modello non è stato chiamato (`26-no-content.png`, `21-cloudflare-401-card.png`). È proprio la promessa "esito onesto nella pagina" (segnale di successo 3) che qui non si regge. | La tabella deve descrivere **il run**, non l'ultima lettura di ogni tipo. Fonte esclusa → *"esclusa da te"*. Fonte ripresa → *"ripresa la lettura del 2 ott, 20:39 · senza costo"*. In *"fonti lette"* solo quelle lette o riprese in quel run. Con D14 → *"Elaborazione: non chiamata"*. I conteggi del run ci sono già (`sources_excluded`, `sources_reused`). |
| 2 | Alta | Media | C.2 · E.2 · E10/E11 | Seconda generazione su un profilo già allineato (20:43). Toast e banner dicono *"Proposta pronta: 5 campi del profilo e 1 servizio…"* con **Rivedi la proposta**. La sezione invece dice *"0 voci da rivedere · 6 invariate nascoste"*, e **Applica tutto** è spento con *"Niente da applicare: la proposta coincide con il profilo."*. Eppure la proposta resta "in attesa": l'anteprima dopo avvisa *"C'è una proposta del 2 ott non applicata…"*, e per toglierla serve **Scarta la proposta…**, con una conferma che parla di spesa (`21-cloudflare-401-card.png`). Per chi rigenera su un profilo curato vuol dire una spesa annunciata come "pronta" che non porta niente, più un compito in più. | Contare le **differenze**, non le voci prodotte: *"Nessuna novità: la proposta coincide con il tuo profilo (6 voci invariate)."*, in tono neutro e senza **Rivedi la proposta**. Una proposta senza niente da decidere non diventa pendente (Open question 3). |
| 3 | Media-alta | Media | C.4 (conflitto) · E9 · H5 | **Sostituisci il tuo testo** scrive al primo clic, senza conferma e senza modo di annullare. La riga diventa *"Posizionamento · Applicato ora"* e il testo di Omar (*"Il CTO a tempo che le startup non possono ancora assumere…"*) sparisce dalla pagina, quindi non si può nemmeno copiarlo prima di perderlo. Per la persona che "protegge le proprie parole" è il punto più rischioso del flusso, e l'unico avviso è un hint in piccolo (*"Il tuo testo non si recupera."*). | Senza nuovi stati nel DB: nella riga *"Applicato ora"* tenere *"Il tuo testo di prima: …"* (selezionabile) finché si resta sulla pagina. In alternativa un toast con **Ripristina il mio testo**, che riscrive a mano il valore di prima (Open question 4). |
| 4 | Media | Bassa | C.2 · C.6 · Accessibilità (toggle) | Dopo un'applicazione le voci applicate restano in lista come *"Nome · Applicato ora"*, ma la testata le conta fra le nascoste: *"0 voci da rivedere · 2 conflitti · 7 invariate nascoste"*, e il gruppo dice *"CAMPI DEL PROFILO (1 IN CONFLITTO · 5 INVARIATI)"*. **Mostra le 2 voci invariate** non cambia niente sullo schermo, perché quelle due righe sono già visibili: è un controllo che non fa nulla (`09-after-apply-positioning.png`, `10-apply-tone-unsaved.png`, `17-curated-after-apply-all.png`). | Contarle a parte: *"… · 5 applicate ora · 2 invariate nascoste"*, e nei gruppi *"4 applicati ora · 1 invariato"*. Il toggle conta e mostra solo le voci davvero nascoste. |
| 5 | Media | Bassa | A.5 · E14 · H8 | Testata del profilo curato: *"3 campi sono già compilati: Applica tutto li sostituisce. Il testo attuale è qui sopra ogni proposta."* Non dice **quali** campi, e le tre righe (*Nome*, *Di cosa si occupa*, *Cosa offri*) sono "Modificato" come le altre. È la deroga H8 al "a mano vince" e va decisa campo per campo (`16b-curated-proposal-head.png`). | Nominarli: *"Nome, Di cosa si occupa e Cosa offri sono compilati da prima del 2 ott: Applica tutto li sostituisce. Il testo attuale è sopra ogni proposta."* Sulla riga: *"compilato prima del 2 ott: Applica tutto lo sostituisce"*. |
| 6 | Media | Bassa | Accessibilità (focus) · G9 | Il focus finisce su `body` in tre casi: dopo un **Sostituisci con la proposta** fallito, anche attivato da tastiera (`18b-apply-failed.png`); dopo l'aggiornamento per *"Questa proposta non è più quella corrente"* (`27-stale-proposal.png`); dopo uno scarto fallito, con il dialog ancora aperto (`31-discard-failed.png`). **Rivedi la proposta** dal banner porta la pagina sulla sezione ma lascia il focus sul link del banner (`07-proposta-anchor.png`): da tastiera servono circa 6 Tab per arrivare ad **Applica tutto**. Il FLOW dice "mai `body`". | Dopo un errore il focus torna al bottone premuto (durante l'attesa `aria-disabled` invece di `disabled`). Dopo l'aggiornamento va sul titolo della proposta. L'ancora `#proposta` mette il focus sul titolo della sezione, come `#genera` fa con il bottone. |
| 7 | Media | Bassa | E.6 · A7 · G8 | Dettaglio del run della generazione. **Parametri** dice *"Nessun parametro: il job legge le impostazioni."*, ma il run ha `sources: ['linkedin','posts']`: non si vede quali fonti sono state scelte né se ne è stata riletta una. Sotto l'esito c'è una riga in inglese: *"sources read: 2 · sources unavailable: 1 · proposal id: 1 · fields proposed: 5 · services proposed: 1 · discarded: 3"* (`13-run-detail.png`). | Parametri come nel FLOW: *"Fonti: profilo LinkedIn · i miei post (1 con testo integrale) · Rilette: nessuna"*. I conteggi in italiano, oppure niente (l'esito li dice già a parole). |
| 8 | Media | Bassa | Edge "Confronto ricalcolato a ogni lettura" | Ho eliminato *"Affiancamento del primo CTO"* da **I miei servizi** e la proposta sotto è rimasta *"SERVIZI (1 INVARIATO)"*: il server lo dava già *"Nuovo"*, ma la pagina lo ha mostrato solo dopo un ricarico. Salvare **La mia azienda** invece aggiorna subito: il conflitto su *Tono di voce* è comparso al momento. | Le scritture sui servizi (aggiungi, modifica, elimina) devono aggiornare anche la proposta, come già fa il salvataggio dell'azienda. |
| 9 | Media | Bassa | B.5 · D9 | Se tolgo la spunta a *Profilo LinkedIn*, la riga diventa *"1 lettura con Apify (nessun costo)"*, come se la lettura fosse gratis. Una fonte fresca esclusa dice ancora *"si riprende quella lettura, senza ripagarla"*. Con tutte le fonti escluse la stima resta *"≈ $0,05"* (`04-preview-all-excluded.png`, `20-preview-fresh.png`). Per chi ha ansia da costo, la riga dice il contrario di ciò che succede. | Riga esclusa: *"esclusa: non si legge"*, e il prezzo può restare come informazione (*"≈ $0,01 se la includi"*). Con *"Hai escluso tutte le fonti"* la stima mostra *"—"*. |
| 10 | Media | Bassa | B.2 · C4 · OQ-1 (deviazione di T24) | Fonte fresca: *"già letto il 2 ott: si riprende quella lettura, senza ripagarla"*, con la spunta annidata **Rileggilo comunque** (*"Una lettura nuova con Apify: il suo costo torna nella stima."*). Si capisce subito, e al clic la stima passa da $0,05 a $0,06 (`20-preview-fresh.png`). Manca però la finestra di freschezza, che C4 chiede di dichiarare nell'anteprima. | Tenere la deviazione (Open question 1) e aggiungere la finestra: *"già letto il 2 ott: entro 90 giorni si riprende quella lettura, senza ripagarla"*. |
| 11 | Bassa-media | Bassa | Entry `#proposta` · E.1 · banner | Con la proposta applicata o scartata, la card dice insieme *"Nessuna proposta in attesa."* e *"Proposta pronta: 5 campi del profilo e 1 servizio…"* (`12b-deeplink-proposta-none-fresh.png`). Banner e toast tengono **Rivedi la proposta**, che porta a una pagina senza proposta. I toast persistenti dei run precedenti restano impilati: un *"non riuscito"* sta sopra il neutro del run successivo (`26-no-content.png`). | Sotto la tabella, la frase al passato: *"Generazione del 2 ott, 20:32: proposti 5 campi e 1 servizio…"*. **Rivedi la proposta** solo finché quella proposta è pendente. Il toast d'esito di un run sostituisce quello del run precedente dello stesso tipo. |
| 12 | Bassa-media | Bassa | B.3 (Non disponibili) | *"Sito — Nessun sito impostato. Aggiungilo in «I tuoi indirizzi pubblici». Vai a «I tuoi indirizzi pubblici»"*: la destinazione è scritta due volte. Il link chiude il dialog, ma il focus torna su **Genera profilo e servizi…** e la pagina resta in cima: il campo **Sito web** non riceve il focus (`03-preview-empty.png`, `05-after-link-profilo.png`). | *"Sito — nessun sito impostato."* con un link **Aggiungi il sito** verso un'ancora del campo (es. `#sito`) che, dopo la chiusura del dialog, mette il focus su **Sito web**. |
| 13 | Bassa-media | Bassa | Error paths "Risposta del modello non conforme" | Banner e toast: *"Actor claude-opus-5: Il modello ha risposto in una forma inattesa: nessuna proposta creata. Riprova. Usa "Riprova…" nel banner a sinistra."* "Actor" e l'id del modello sono codici, e "Riprova" compare due volte. La card invece dice bene *"Generazione fallita: Il modello ha risposto…"* (`23-failed-generation.png`). | Il testo del FLOW, senza prefisso (al massimo *"Anthropic: il modello ha risposto…"*), e una sola chiamata all'azione. |
| 14 | Bassa-media | Bassa | E.5 · A6 | In Connessioni, dopo `cloudflare-401`, anche la card **Anthropic** prende il badge *"Completato con avvisi"* e la riga *"Genera profilo e servizi — fallito per Cloudflare, non per Anthropic."*: la parola "fallito" per un run riuscito, e Anthropic sembra avere un problema. La card Cloudflare (riquadro rosso con il motivo) e Oggi (*"Ultimo run fallito per Cloudflare…"*) sono giuste (`22-connessioni.png`). | Il badge riflette la salute dello strumento in quel run: per Anthropic *"Completato"*, con la riga *"— il sito non è stato letto (Cloudflare); l'elaborazione è riuscita."* |
| 15 | Bassa-media | Bassa | Testi che cambiano (`#profilo`) · C11 | L'hint del profilo dice ancora *"Serve a leggere chi reagisce e commenta i tuoi post."*, ma ora il profilo è anche una fonte della generazione. L'hint del sito funziona per un freelance. Però se salvo come sito una pagina aziendale LinkedIn compare *"Questo non sembra l'indirizzo di un sito: la generazione non potrà leggerlo."*: è un indirizzo web, quindi il motivo non si capisce (`25-preview-site-not-a-site.png`). | Testi proposti nell'Open question 2. |
| 16 | Bassa | Bassa | E.7 · B.2 | L'anteprima dice *"è una delle 5 letture al giorno del piano gratuito"*, l'esito di `cloudflare-limite` dice *"superato il limite di browser del piano gratuito (10 minuti al giorno)"*: sono due limiti diversi, e la lettura di default è senza browser. | Allineare: *"Sito non letto: Cloudflare ha rifiutato la lettura per i limiti del piano gratuito (5 letture al giorno). Riprova domani o passa a Workers Paid."* |
| 17 | Bassa | Bassa | C.2 · C.7 · C.8 · E.1 (testi) | Accordi sbagliati con 1: *"Mostra le 1 voce invariata"*, *"Applica le 1 voce non scritta a mano"*, *"Applica solo le 1 voci … I 1 conflitto resta da decidere uno per uno"*, *"Spariscono la voce non applicata"* (`19-discard-confirm.png`). E poi *"3 voci scartate: 3 senza fonte"*. | Usare il plurale corretto ovunque: *"Mostra la voce invariata"*, *"Applica la voce non scritta a mano"*, *"Il conflitto resta da decidere"*, *"Sparisce la voce non applicata"*, *"3 voci scartate perché senza fonte"*. |
| 18 | Bassa | Bassa | B.4 · B.2 | La scomposizione *"= profilo LinkedIn ≈ $0,01 + elaborazione ≈ $0,05"* sta sopra *"Costo stimato: ≈ $0,06"*, quindi l'uguale arriva prima del totale (`03-preview-empty.png`). Nella riga del sito *"fino a 10 pagine"* è scritto due volte (`15-curated-preview.png`). | *"Costo stimato: ≈ $0,06 (profilo LinkedIn ≈ $0,01 + elaborazione ≈ $0,05)"*, come nel FLOW. Un solo "fino a 10 pagine". |
| 19 | Bassa | Bassa | A.6 · C.8 | **Applica tutto** al primo giro dà il toast *"Applicate 4 voci."* (il FLOW dice *"…: 6 campi e 5 servizi."*). Se scarto dopo aver applicato 6 voci, il toast dice *"Proposta scartata. Il profilo non è cambiato."* (`11-after-apply-all.png`). | *"Applicate 4 voci: 3 campi e 1 servizio."* e *"Proposta scartata: le voci già applicate restano."* |
| 20 | Bassa | Bassa | C.3 · C.5 | Nelle voci invariate aperte *"Ora"* e *"Proposta"* mostrano lo stesso paragrafo due volte (`30-unchanged-expanded.png`). Il servizio in conflitto dice *"4 campi su 4"*, che non spiega su quanti campi (un servizio ne ha sei). Al primo giro ogni campo ripete *"Ora: vuoto"*. | Per un invariato, una riga sola: *"Uguale al tuo: …"*. Per il servizio: *"4 campi cambiano · Invariati: nome"*. Per un nuovo con "Ora" vuoto, solo *"Proposta"*. |
| 21 | Bassa | Bassa | C.2 (disposizione) | **Scarta la proposta…** sta a metà riga, perché la colonna di **Applica tutto** è larga quanto il suo hint. **Mostra le N voci invariate** è testo semplice e non sembra un bottone (`16b-curated-proposal-head.png`, `17-curated-after-apply-all.png`). | Le azioni su una riga: **Applica tutto** e **Scarta la proposta…** affiancati, l'hint sotto. Il toggle come bottone-link con chevron, sopra i gruppi. |
| 22 | Bassa | Media | Viewport stretto (superficie di M1b) | A 760 px la tabella **I miei servizi** esce dalla pagina, che scorre in orizzontale (858 px). Card della generazione e proposta reggono (`28-narrow-card.png`, `29-narrow-proposal.png`). | Scorrimento orizzontale dentro la card, oppure le colonne secondarie in **Dettagli** sotto una certa larghezza. |

### Proposed FLOW.md changes

- **Entry points, riga `#proposta`** — oggi: *"presente solo con una proposta pendente; senza, … «Nessuna proposta in
  attesa.»"* → proposta: aggiungere *"con la proposta, l'ancora mette il focus sul titolo della sezione"*. Perché:
  finding 6, coerente con `#genera` e `#profilo`.
- **B.2, Profilo LinkedIn letto di recente** — oggi: *"la spunta è spenta con accanto «Rileggilo comunque»"* →
  proposta: *"la spunta resta accesa e la riga dice «già letto il 18 set: entro 90 giorni si riprende quella lettura,
  senza ripagarla»; sotto, la spunta annidata «Rileggilo comunque» (spenta) — «Una lettura nuova con Apify: il suo costo
  torna nella stima.» Stessa regola per il sito («…un'altra delle 5 letture al giorno del piano gratuito»)."* Stesso
  cambio nell'edge case *"Freschezza del proprio profilo"* e in OQ-1. Perché: la deviazione di T24 regge sullo schermo
  (finding 10), se l'utente la conferma (Open question 1).
- **B.2, Sito** — un solo *"fino a 10 pagine"* nella riga (finding 18).
- **B.3, Non disponibili** — oggi: *"Sito — nessun sito impostato. Aggiungilo in «I tuoi indirizzi pubblici»."* →
  *"Sito — nessun sito impostato."* con il link **Aggiungi il sito**, che chiude il dialog e mette il focus su **Sito
  web** (finding 12).
- **B.5, Escludere una fonte** — aggiungere: *"la riga esclusa dice «esclusa: non si legge», mai «nessun costo»; con
  tutte le fonti escluse il costo stimato è «—»"* (finding 9).
- **A.5 e C.2, testata** — riga di E14: nominare i campi (*"Nome, Di cosa si occupa e Cosa offri sono compilati da
  prima del …"*). Conteggi: aggiungere *"N applicate ora"*, separato da *"invariate nascoste"* (findings 4 e 5).
- **C.4, conflitto** — se l'utente sceglie (b) nell'Open question 4: *"dopo «Sostituisci il tuo testo» la riga
  «Applicato ora» tiene «Il tuo testo di prima: …» finché resti sulla pagina"* (finding 3).
- **C.6, dopo Applica tutto** — oggi: *"le righe applicate restano nella sezione marcate «Applicato ora»"* → aggiungere
  *"e la testata le conta a parte («5 applicate ora»); il toggle degli invariati conta solo ciò che nasconde"*
  (finding 4).
- **C.8, scarto** — conferma al singolare quando la voce è una (*"Sparisce la voce non applicata."*). Toast: oggi
  *"Proposta scartata. Il profilo non è cambiato."* → *"Proposta scartata: le voci già applicate restano."*. Perché: dopo
  un'applicazione la prima frase non è vera (finding 19).
- **E.1, tabella per fonte** — aggiungere che la tabella descrive **l'ultimo run**: *"esclusa da te"*, *"ripresa la
  lettura del 18 set · senza costo"*, *"Elaborazione: non chiamata"* (D14). *"fonti lette"* nella riga di stato conta solo
  le fonti lette o riprese in quel run. Quando la proposta è applicata o scartata, la frase d'esito passa al passato
  (*"Generazione del 20 set: proposti 6 campi e 5 servizi…"*) (findings 1 e 11).
- **E.2 (nuovo punto E.2b) "Nessuna novità"** — se l'utente sceglie (a) nell'Open question 3: *"una generazione che non
  cambierebbe niente chiude con l'esito neutro «Nessuna novità: la proposta coincide con il tuo profilo (6 voci
  invariate).», senza «Rivedi la proposta», e non lascia una proposta pendente"* (finding 2).
- **E.5, Connessioni** — aggiungere: *"in un run riuscito con una fonte fallita, le card degli altri strumenti restano
  «Completato» e dicono cosa è andato bene"* (finding 14).
- **E.7 e tabella Error paths, "Limite del piano Cloudflare superato"** — testo allineato ai limiti veri e alla lettura
  senza browser (*"…per i limiti del piano gratuito (5 letture al giorno)…"*) (finding 16).
- **Error paths, "Applica fallito"** — aggiungere *"il focus torna sul bottone della riga"*. **"Applica su una
  proposta non più corrente"** — aggiungere *"il focus va sul titolo della proposta aggiornata"* (finding 6).
- **Edge case "Confronto ricalcolato a ogni lettura"** — aggiungere *"anche quando servizi o campi cambiano nella
  stessa pagina: la sezione si aggiorna senza ricaricare"* (finding 8).
- **Accessibilità, "Dopo un'applicazione"** — estendere la regola del focus agli errori e agli aggiornamenti, come nei
  due punti sopra.
- **Testi che cambiano, card `#profilo`** — hint del profilo LinkedIn, hint del sito e avviso di C11 secondo l'Open
  question 2 (finding 15).

### Open questions

1. **Fonte fresca (deviazione di T24): resta scelta e si riprende gratis, oppure spunta spenta come nel FLOW?** Sullo
   schermo la deviazione è più chiara e non fa perdere nulla: una seconda generazione (per esempio dopo aver
   aggiunto il sito) tiene il profilo LinkedIn senza ripagarlo, e **Rileggilo comunque** rimette il costo nella stima
   al clic. **Raccomandazione: tenerla**, con la finestra scritta (*"entro 90 giorni"*, finding 10), con il testo
   *"esclusa"* quando la togli (finding 9) e con *"ripresa"* nell'esito (finding 1). Da sapere: si conserva solo
   l'ultima lettura per fonte, quindi se cambi l'indirizzo e poi torni a quello di prima la lettura si ripaga.
2. **Testi per un freelance nella card «I tuoi indirizzi pubblici».** Proposte:
   - Profilo LinkedIn, hint: *"Serve a leggere chi reagisce ai tuoi post e, nella generazione, chi sei. Nessun login:
     solo l'URL pubblico."*
   - Sito web, hint (oggi *"Il tuo sito, anche su Wix o Google Sites: la generazione lo legge dalla pagina iniziale
     seguendo i link."*): va bene così. In più, se vuoi, *"Non una pagina LinkedIn o Instagram: quelle non si leggono."*
   - Avviso di C11 per una pagina di un social: *"Le pagine di LinkedIn, Facebook e Instagram non si leggono come sito:
     qui va il tuo sito. Il tuo profilo LinkedIn lo legge già il campo sopra."*
   - Il segnaposto *"https://www.tuosito.it"* va bene.
3. **Una generazione che non cambierebbe niente deve lasciare una proposta pendente?** (a) No: esito *"Nessuna novità"*,
   niente sezione e niente **Scarta** da fare; se c'era una proposta pendente, la nuova la sostituisce comunque (E11).
   (b) Sì, come oggi. **Raccomandazione: (a)**: chiude il caso più frequente dei giri successivi senza lasciare un
   compito in più.
4. **"Sostituisci il tuo testo": basta un clic per perdere il proprio testo?** (a) Come oggi: un clic e l'hint.
   (b) Il testo di prima resta visibile e copiabile nella riga *"Applicato ora"* finché resti sulla pagina (nessuno
   stato nuovo). (c) Toast con **Ripristina il mio testo** per qualche secondo (una scrittura a mano del valore di prima).
   **Raccomandazione: (b)**, costa poco e non aggiunge stati da spiegare.
5. **«La mia azienda» per un freelance.** La proposta propone *"Nome: Marta Fiorini"* (persona, non azienda), mentre la
   card si chiama «La mia azienda» e ha i segnaposto *"es. Officina Codice Srl"* e *"es. Sviluppiamo software gestionale
   su misura per PMI manifatturiere."*. Rinominare in «La mia attività» e usare esempi da freelance? (Il titolo e
   l'ancora `#azienda` si possono tenere separati, come per `#profilo` in OQ-8.)
