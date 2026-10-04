---
domain: prospect-crm
type: ux-review
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC|SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW|FLOW]]"
  - "[[specs/prospect-crm/own-profile-services/IMPLEMENTATION-NOTES|IMPLEMENTATION-NOTES]]"
created: 2026-10-02
updated: 2026-10-03
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

### Decisioni dell'utente (2026-10-02)

Le cinque domande aperte sono decise: l'utente accetta tutte le raccomandazioni ("Vanno bene tutte"). Le revisioni non
partono ora: si fanno in un nuovo run di `implement-spec`, insieme ai findings da confermare all'avvio di quel run.

1. **Fonte fresca:** si tiene la deviazione di T24, cioè scelta e ripresa senza costo. Si aggiungono la finestra di
   freschezza ("entro 90 giorni"), *"esclusa: non si legge"* per una fonte tolta e *"ripresa"* nell'esito (findings 1, 9
   e 10).
2. **Testi per un freelance:** si applicano i testi proposti per l'hint del profilo, la riga in più nell'hint del sito e
   l'avviso C11 per le pagine dei social. Il segnaposto resta com'è.
3. **Generazione senza novità:** opzione (a). L'esito è neutro, *"Nessuna novità"*, e non resta nessuna proposta pendente;
   una proposta pendente che c'era già viene sostituita lo stesso (E11).
4. **"Sostituisci il tuo testo":** opzione (b). Il testo di prima resta visibile e copiabile nella riga *"Applicato
   ora"* finché si resta sulla pagina.
5. **«La mia azienda»** diventa **«La mia attività»**, con esempi da freelance. L'ancora `#azienda` resta com'è.

## [Round: 2026-10-03] — revisione della proposta

> Chiesto dall'utente dopo la **prima generazione reale**, guardando la proposta: *"trovo molto strano non poter
> rifiutare esplicitamente niente. Migliora questa parte, sia da un punto di vista di ux che di interfaccia […] è
> un flusso chiave che deve essere chiaro, usabile e con un'interfaccia di buon livello."* Questo round, a
> differenza del precedente, ha il **mandato di riscrivere il FLOW**: il nuovo disegno è già in `FLOW.md`
> (`updated: 2026-10-03`). Qui ci sono le prove viste sullo schermo, i findings e le domande che restano aperte. Codice,
> SPEC e PLAN non sono toccati.

### Scope

- **App:** Vite `http://localhost:5273` contro il server e2e `:8873` (job finti, DB temporaneo,
  `PRICE_PROFILE_DETAIL_USD=0.01`, `PRICE_PROFILE_GENERATION_USD=0.05`, `E2E_FAKE_DELAY_MS=400`). Seed
  `{"profile":"empty"}` (percorso A) e `{"profile":"curated"}` (percorso C: 2 conflitti, 3 campi E14). Viewport 1280 × 900
  e 1280 × 1100–1400 per vedere la sezione intera. Sessione `agent-browser` `ux-prop`, chiusa alla fine; server e Vite
  fermati per PID.
- **Superfici:** solo la card **Genera profilo e servizi** (`#genera`: anteprima, esito per fonte, frase d'esito) e la
  sezione **Proposta** (`#proposta`), più il passaggio **Rivedi la proposta** da toast e banner. Codice letto per capire
  cosa è possibile: `ProposalSection.tsx`, `GenerateCard.tsx`, `src/db/profile-proposal.ts`, `src/server/routes/profile.ts`,
  `src/jobs/generate-profile.ts`, `src/db/schema.ts` (`profile_proposals`).
- **Screenshot** (non nel repo, per il lavoro visivo del design-engineer):
  `/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/12a929df-27bf-46ac-87d4-82353f18c70e/scratchpad/ux-proposal/`
  (citati sotto per nome file), più quello dell'utente sulla proposta reale (`images/1.webp` della stessa sessione).
- **Walked:** A da capo (Oggi escluso): anteprima, avvio, toast e banner, **Rivedi la proposta** (focus e scorrimento),
  applica uno per uno quattro campi e il servizio lasciando *Nome: Marta Fiorini*, ricarico, conferma di scarto vista e
  chiusa con Esc. C: avviso H5, anteprima, testata con E14, conflitti, invariati aperti, **Applica tutto** da tastiera
  (focus e live region), **Sostituisci il tuo testo**, scarto confermato con l'ultimo conflitto ancora aperto, card dopo
  lo scarto.
- **Not walked:** errori di rete su applica e scarto, proposta non più corrente, `#proposta` senza proposta (visti nel
  round 2026-10-02 e invariati nel codice: findings 6 e 11 di allora). Viewport stretto. Screen reader vero (solo albero
  di accessibilità). Il nuovo disegno non esiste ancora sullo schermo: i comportamenti nuovi del FLOW sono proposte, non
  cose viste.

### Findings

Ordinati per impatto sull'utente rispetto allo sforzo. Un finding uguale a uno del round 2026-10-02 lo cita invece di
ripeterlo.

| # | Impatto | Sforzo | Passo del FLOW | Cosa vede l'utente | Proposta (scritta nel FLOW) |
|---|---------|--------|----------------|--------------------|-----------------------------|
| 1 | Alta | Media | C.4–C.5 · E10 · E12 | **Non c'è un "no" per voce.** Percorso A, dopo aver applicato tutto il resto, resta *"Nome · Nuovo — Proposta: Marta Fiorini"* (il nome della persona proposto come nome dell'attività) con il solo **Applica**. La testata dice *"1 voce da rivedere"* e **Applica tutto** (*"Applica le 1 voce non scritta a mano"*) la scriverebbe. L'unica uscita è **Scarta la proposta…**, con una conferma che parla di spesa (`10-A-only-nome-left-no-way-to-reject.png`, `12-A-discard-confirm-only-way-to-say-no.png`; nel caso reale dell'utente, *"Nome: Spatalo Tech → Spatalo"*). | Per ogni voce tre verbi, sempre nello stesso ordine: **Applica · Modifica · Rifiuta**. Un rifiuto non scrive niente, si annulla dalla riga e non chiede conferma (C.4–C.7). |
| 2 | Alta | Media | C.4 (conflitto) · E9 · OQ-5 | **Un conflitto si chiude solo perdendo il proprio testo.** Quando resta solo *"MVP in sei settimane · In conflitto"*, le uscite sono **Sostituisci con la proposta** o lo scarto dell'intera proposta. Per *Posizionamento* **Sostituisci il tuo testo** cancella il testo di Omar dalla pagina: la riga diventa *"Posizionamento · Applicato ora"*, senza testi (`20-C-after-sostituisci-own-text-gone.png`, `21-C-last-conflict-discard-dialog.png`). | **Tieni il tuo testo** / **Tieni il tuo servizio** come rifiuto del conflitto. **Annulla** su ogni decisione, con il valore di prima ripristinato. *"prima: …"* resta visibile finché la proposta è aperta (C.4, C.7; decisione 4 del 2026-10-02 resa persistente; OQ-R2). |
| 3 | Alta | Bassa | C.8 (scarto) · E12 | **Lo scarto dice il falso dopo un'applicazione.** Applicate 5 voci, scartata la proposta: il toast dice *"Proposta scartata. Il profilo non è cambiato."* mentre sotto c'è *"Nome: Marta Fiorini · dalla proposta del 3 ott"* (`22-C-card-after-discard-stale-summary.png`). La conferma dice *"Spariscono la voce non applicata"* e non dice che le applicate restano (`21-…`). | L'azione diventa **Rifiuta le N voci da decidere…**: la conferma dice cosa tocca e cosa no, il toast dice *"Rifiutate 6 voci: non è stato scritto niente. La proposta è chiusa."* (C.11; finding 19 del 2026-10-02). |
| 4 | Alta | Media | C.2 · C.6 · Accessibilità | **L'avanzamento non si vede e si perde.** La voce applicata salta in fondo al gruppo (*"Di cosa si occupa"* passa dal 2° al 5° posto, `09-A-after-apply-one-applicato-ora.png`). La testata la conta fra le *"invariate nascoste"* mentre è visibile. *"Mostra le 5 voci invariate"* non cambia niente. Dopo un ricarico le voci applicate finiscono fra le invariate e il conto di quanto deciso sparisce. Il gruppo *"SERVIZI (1 INVARIATO)"* resta un riquadro vuoto (`10-…`, `11-A-after-reload-progress-lost.png`, `19-C-after-apply-all-applicato-ora-mixed.png`: *"0 voci da rivedere · 2 conflitti · 7 invariate nascoste"*). | Le decisioni si salvano con la proposta. La testata dice *"Decise 4 di 6 · ne restano 2, 2 in conflitto"*. Le righe decise restano al loro posto durante la visita. Gli invariati sono una riga che li nomina in fondo a ogni gruppo, e un gruppo vuoto non c'è (C.2, C.3, C.7, C.8; supera il finding 4 del 2026-10-02). |
| 5 | Media-alta | Media | C.6 · E14 · H8 | **Una voce applicata non dice cosa ha scritto né cosa c'era.** *"Nome · Applicato ora"* non ha testi: *"Officina Codice Srl"* sostituito da *"Marta Fiorini"* non lascia traccia nella sezione (`19-…`). Le tre righe E14 (*Nome*, *Di cosa si occupa*, *Cosa offri*) sono "Modificato" come le altre, e solo il riquadro giallo in testata dice che **Applica tutto** le sostituisce (`15-C-proposal-top-conflicts.png`). | La riga decisa dice la conseguenza a parole (*"Nome — applicato · prima: «Officina Codice Srl»"*). La riga E14 lo dice prima del clic (*"compilato da prima del 2 ott: l'azione di massa lo sostituisce"*). La testata nomina quei campi (C.4, C.7; finding 5 del 2026-10-02). |
| 6 | Media | Media | Modifica (nuovo) · E7 · H5 | **Ritoccare un testo quasi giusto costa quattro passi.** *"La product engineer che porta in produzione…"*: si applica, si scorre fino a «La mia azienda», si corregge, **Salva azienda**, e la provenienza diventa comunque "scritto da te". Un conflitto non si può fondere. Sul servizio in conflitto la proposta riempie 3 campi vuoti e ne cambia uno solo, *"A chi serve"*, ma i verbi sono "tutto o niente" (`16-C-proposal-middle.png`, `18-C-unchanged-expanded-duplicate-text.png`). | **Modifica**: in riga per i campi (una casella già compilata, **Applica il tuo testo**), nel dialog dei servizi che già esiste per i servizi (`17-C-cards-below-service-dialog-exists.png`). Il risultato è "scritto da te" (C.6; OQ-R4 per un quarto verbo). |
| 7 | Media | Bassa | C.2 · C.4 (gerarchia) | **Tutto è primario.** Nel percorso A ci sono sette bottoni neri uguali (sei **Applica** e **Applica tutto**). **Scarta la proposta…** sta a metà riga e il toggle degli invariati sembra testo. Prima della prima decisione ci sono quattro righe di testo: conteggi, riquadro giallo, hint su due righe, *"Una voce che non applichi resta qui…"* (`07-A-proposal-top.png`, `15-…`; findings 20–21 del 2026-10-02). | Un solo primario, l'azione di massa. Le azioni di riga sono secondarie e sempre nello stesso ordine. Le azioni di massa stanno su una riga. Una frase sola spiega il modello. Per un campo nuovo c'è solo "Proposta", e un invariato è una riga sola (A.5–A.6, C.4, C.8). |
| 8 | Media | Bassa | C.2 · E8 | **"Applica tutto" non applica tutto.** Con conflitti gli serve un hint di due righe (*"Applica solo le 5 voci che non hai scritto a mano. I 2 conflitti restano da decidere uno per uno."*). Con una voce sola dice *"Applica le 1 voce non scritta a mano"* (`15-…`, `10-…`). | L'etichetta dice quante e quali: *"Applica tutte le 11 voci"* / *"Applica le 10 voci rimaste"* / *"Applica le 4 voci senza conflitto"*. Le azioni di massa ci sono solo con almeno 2 voci da decidere (C.2, C.9; finding 17 del 2026-10-02). |
| 9 | Media | Bassa | E.1 · Entry `#proposta` | **La proposta parte sotto la piega.** A 1280 × 900, dopo la generazione, la sezione comincia a ~700 px: sopra c'è la tabella per fonte con la frase d'esito (`04-A-done-toast-banner.png`). Dopo **Rivedi la proposta** il toast copre la parte destra delle righe e il focus resta sul link del banner (`05-A-after-rivedi-link.png`; finding 6 del 2026-10-02). | Con una proposta aperta la tabella si chiude in una riga con **Esito per fonte**, e la card dice *"Proposta in attesa: 4 voci da decidere"*. `#proposta` e **Rivedi la proposta** mettono il focus sul titolo della sezione (E.1, Entry points). |
| 10 | Media | Bassa | Accessibilità · G9 · G10 | **Tastiera e screen reader.** Tutti i bottoni di riga hanno lo stesso nome accessibile, *"Applica"* (albero di accessibilità). Dopo **Applica** su *"Di cosa si occupa"* il focus torna su *"Nome"*, la prima voce **sopra** quella appena decisa. Dopo il ricarico su `#proposta` il focus è su `body`. | Nomi con la voce (*"Rifiuta Tono di voce"*, *"Annulla la decisione su Nome"*). Il focus va alla voce **successiva** in ordine di lettura. Durante l'attesa i bottoni sono `aria-disabled`, mai `disabled`. La sezione ha una live region con i messaggi scritti (Accessibilità). |
| 11 | Media | Bassa | Testata · E6 | **"Scartare" vuol dire due cose.** La testata dice *"3 voci scartate"* (dal sistema, senza fonte) accanto a **Scarta la proposta…** (tua decisione), e la card dice *"3 voci scartate: 3 senza fonte."* (`04-…`, `05-…`). Con il rifiuto per voce le parole diventano tre. | *"lasciate fuori perché senza fonte"* per il sistema, *"rifiutate"* per te; "scartare" non si usa più (A.5, Edge, Testi). |
| 12 | Bassa-media | Bassa | E.1 · E.2 | Finding 11 del 2026-10-02 confermato. Dopo lo scarto la card dice ancora *"Proposta pronta: 6 campi del profilo e 3 servizi · …"* (`22-…`). Il conto è delle voci prodotte, non delle differenze (finding 2 del 2026-10-02). | Frase d'esito che segue la proposta (aperta / chiusa al passato / *"Nessuna novità"*). **Rivedi la proposta** solo finché la proposta è aperta (E.1, E.2, E.2b). |
| 13 | Bassa | Bassa | C.3 · C.5 | Nelle voci invariate aperte lo stesso paragrafo compare due volte. Il servizio in conflitto mostra *"Descrizione / Ora / vuoto / Proposta / …"* su tre livelli per quattro campi, con *"4 campi su 4"* (`18-…`, `16-…`; finding 20 del 2026-10-02). | *"uguale al tuo: …"* (un testo). La sintesi del servizio separa *"Riempie 3 campi vuoti"* da *"cambia «A chi serve»"*. Un campo vuoto mostra solo *"Si aggiunge: …"* (C.5, C.8). |

### Proposed FLOW.md changes

Applicate **direttamente** in `FLOW.md` il 2026-10-03, con il mandato dell'utente; ogni sezione toccata ha una riga
*"Revisione 2026-10-03"* in testa. In sintesi:

- **Goal**: segnali 1 e 2 con il rifiuto e le nuove azioni di massa; segnale 6 nuovo (avanzamento, righe decise, ricarico).
- **Entry points**: `#proposta` mette il focus sul titolo; **Rivedi la proposta** solo con la proposta aperta.
  Architettura: la sezione c'è se è aperta, più il riepilogo durante la visita.
- **A.4–A.7**: esito che conta le differenze, testata con l'avanzamento, righe con tre verbi, un rifiuto, l'azione di
  massa e la chiusura da sé con il riepilogo. **B.6**: avviso della proposta aperta con le voci rimaste.
- **C** riscritto (1–11): testata, gruppi, righe da decidere di campi e servizi, **Modifica** (in riga e nel dialog), righe
  decise con **Annulla**, invariati per gruppo, azione di massa, **Tieni il tuo testo**, **Rifiuta le N voci da
  decidere…**. C'è anche un blocco **[→ PLAN]** su cosa serve al server.
- **E.1, E.2, E.2b**: tabella del run (finding 1 del 2026-10-02), tabella chiusa con una proposta aperta, frase al
  passato, **Nessuna novità** (OQ-3 del 2026-10-02 opzione a).
- **Error paths**: focus dopo errori e aggiornamenti, voce cambiata o già decisa, Annulla rifiutato, Modifica vuota o
  uguale, rifiuto in blocco fallito.
- **Edge cases**: confronto ricalcolato solo per le voci da decidere, ritorno a una proposta decisa a metà, chiusura
  derivata, Annulla dopo la chiusura, voce in Modifica e azioni di massa, rifiuto di una voce E14, due schede, riavvio.
- **Friction notes**, **Accessibilità**, **Testi che cambiano**: aggiornati. **Decisioni chiuse**: OQ-5 superata,
  OQ-6 spostata sul rifiuto in blocco. Nuova sezione **Open questions (OQ-R1…R4)**.

**Decisioni del 2026-10-02 su queste superfici:** integrati i findings 1, 2, 5, 6, 11, 17, 19, 20, 21. Il 3
(opzione b) è **integrato e rafforzato**: *"prima: …"* resta finché la proposta è aperta, anche dopo un ricarico, e
**Annulla** rimette il testo. Il 4 è **superato**: niente più "applicate ora" contate a parte, c'è un modello di
avanzamento. Il 19 è **superato in parte**: il toast dello scarto diventa quello del rifiuto in blocco.

### Open questions

Sono le stesse della sezione *Open questions (revisione della proposta, 2026-10-03)* del FLOW, dove trovi il testo
completo e le raccomandazioni. Il FLOW segue già le raccomandazioni.

1. **OQ-R1 — Una voce rifiutata torna alla generazione successiva?** Raccomandazione: sì, ogni generazione è un
   giudizio nuovo. L'anteprima lo dice.
2. **OQ-R2 — Fin dove arriva Annulla?** Raccomandazione: su ogni decisione, anche dopo un'applicazione (valore e
   provenienza di prima; un servizio aggiunto si toglie), e rifiutato se il valore è cambiato dopo.
3. **OQ-R3 — Emendare la SPEC (sezione E) prima di implementare?** Raccomandazione: sì, con due criteri brevi (rifiuto
   e modifica per voce; Annulla e chiusura da sé) e una riga nel Decision Log.
4. **OQ-R4 — Un quarto verbo «Completa solo i campi vuoti» sui servizi in conflitto?** Raccomandazione: no per ora,
   perché **Modifica…** lo copre.

## [Round: 2026-10-03 · dopo l'implementazione] — revisione della proposta

> Giro sulle schermate del branch `profile-proposal-review` (modifiche non committate), contro le sezioni "Revisione
> 2026-10-03" del FLOW e la forma di [[specs/prospect-crm/own-profile-services/PROPOSAL-DESIGN|PROPOSAL-DESIGN]] (D1–D5
> accettate: striscia sticky, altezza animata, "Applica il tuo testo" pieno, "Genera di nuovo…" outline, icone ✓ ✎ ✕).
> Solo proposte: codice, FLOW e SPEC non sono stati toccati. **Bug** = comportamento diverso dal FLOW (o dal brief
> accettato); **proposta** = il FLOW è rispettato, ma si può fare meglio.

### Scope

- **App:** Vite `http://localhost:5276` contro il server e2e `:8876` (job finti, DB temporaneo,
  `PRICE_PROFILE_DETAIL_USD=0.01`, `PRICE_PROFILE_GENERATION_USD=0.05`). Seed `{"profile":"empty"}` (percorso A) e
  `{"profile":"curated"}` (percorso C: 2 conflitti, 3 campi E14), generazione dalla UI e con `POST /api/profile/generate`;
  `fail-next` su `apply` e `reject`. Viewport 1280 × 900 (1280 × 1500–2400 per la sezione intera) e 760 × 900. Sessione
  `agent-browser` `uxpa`, chiusa; server e Vite fermati per PID.
- **Superfici:** card «Genera profilo e servizi» (esito, proposta in attesa), sezione Proposta, link **Rivedi la
  proposta** di banner e toast. Nient'altro.
- **Screenshot** (non nel repo):
  `/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/12a929df-27bf-46ac-87d4-82353f18c70e/scratchpad/ux-proposal-after/`
  (citati per nome).
- **Walked:** A da capo (rifiuto di *Nome*, Modifica in riga con `edit_empty`, 500 su Applica, Annulla di una voce
  modificata, azione di massa con una voce in Modifica, chiusura, **Vedi il profilo aggiornato**, Annulla dopo la
  chiusura, ricarico con `#proposta` a proposta chiusa). C: deep-link `#proposta`, `edit_same` su un conflitto, **Tieni il
  tuo testo** da tastiera, **Modifica…** del servizio in conflitto (Esc, salvataggio), nome duplicato e `edit_same` nel
  dialog, chiusura, `undo_blocked` dopo aver cambiato «Cosa offri» a mano (+ **Vai al campo**), toast "Avevi modifiche
  non salvate…", ricarico a metà, **Applica le N voci senza conflitto** con i conflitti rimasti, 500 sull'azione di
  massa, rifiuto in blocco (500 nel dialog, poi conferma), proposta non più corrente (con e senza una nuova aperta,
  *Nessuna novità*), voce già decisa "in un'altra scheda", **Rivedi la proposta** da toast, card e banner (anche con la
  generazione finita mentre ero su `/people`), sparizione del link alla chiusura, albero di accessibilità, 760 px.
- **Not walked:** il movimento (pagine `hidden`: WAAPI non parte, vedi PROPOSAL-DESIGN §4.5); screen reader vero (solo
  albero di accessibilità); 500 su **Annulla**, su **Rifiuta** di una riga e sul salvataggio di **Modifica…** (provato
  solo su Applica, azione di massa e rifiuto in blocco); `item_changed` (voce cambiata dopo che l'hai vista) e "servizio
  eliminato nel frattempo"; una proposta con una voce sola fin dall'inizio; la proposta non più corrente sull'azione di
  massa.

### Conformi al FLOW

- **Rifiuto per voce** (A.6): la riga si chiude al suo posto (*"Nome — rifiutato: il campo resta vuoto"* / *"resta
  «Officina Codice Srl»"*), focus sul titolo della voce dopo, live region *"Rifiutato: Nome. Restano 5 voci da
  decidere."*, avanzamento *"Decise 1 di 6 · ne restano 5"*, bottone *"Applica le 5 voci rimaste"* (`05-…`).
- **Modifica in riga:** focus nella casella con il cursore in fondo, etichetta *"Il tuo testo per «Posizionamento»"*,
  hint in `aria-describedby`, Esc non chiude, **Annulla** → focus su **Modifica**; `edit_empty` e `edit_same` con
  `role="alert"`, `aria-invalid` e focus nella casella (`08-…`, `18-…`); applicato → *"applicato con le tue
  modifiche"* e *"scritto da te il 3 ott"* sotto il campo della card.
- **Annulla:** voce riaperta al suo posto, focus sul suo titolo, *"Di nuovo da decidere: …"*, valore e provenienza di
  prima sul server; dopo la chiusura riapre la proposta (testata, striscia, richiamo della card *"1 voce da decidere"*);
  `undo_blocked` con il testo del FLOW, **Vai al campo** porta il focus sul campo, il focus resta su **Annulla** (`25-…`).
- **Tieni il tuo testo:** *"Posizionamento — hai tenuto il tuo testo"*, hint al singolare *"Il conflitto resta fuori:
  decidilo da solo."* (`19-…`).
- **Azione di massa:** una voce in Modifica resta fuori con la bozza intatta e *"1 voce in modifica resta fuori."*
  (`10-…`); con i conflitti rimasti focus sul primo conflitto, toast *"Applicate 2 voci: 1 campo e 1 servizio. Restano 2
  conflitti."*, live region con il conto (`27-…`); toast "Avevi modifiche non salvate in quel campo…" sull'unico caso
  previsto (`24-…`).
- **Rifiuto in blocco:** testi del FLOW con plurale e conflitti, focus su **Annulla**, 500 nel dialog con focus sul
  bottone di conferma, toast *"Rifiutate 2 voci: non è stato scritto niente. La proposta è chiusa."*, focus sul titolo
  del riepilogo (`28-…`, `30-…`).
- **Modifica… di un servizio:** titolo e bottone del FLOW, campi vuoti già compilati, proposta sopra; Esc → focus su
  **Modifica…**; salvato senza toccare → *"aggiornato con le tue modifiche: descrizione, problema, prove"*; nome
  duplicato inline (`20-…`, `21-…`, `45-…`).
- **Chiusura e ricarico:** riepilogo *"Hai deciso tutte le 7 voci: 5 applicate · 1 con le tue modifiche · 1 rifiutata.
  2 erano già uguali al tuo profilo."*, bordo che torna slate, **Vedi il profilo aggiornato** → titolo di «La mia
  azienda»; a metà, dopo un ricarico, conto, *"prima: …"* e ordine (da decidere, poi decise) restano (`26-…`); a
  proposta chiusa niente sezione, *"Nessuna proposta in attesa."*, frase al passato, **Genera di nuovo…** di nuovo pieno
  (`15-…`).
- **Proposta non più corrente:** toast d'avviso, niente scritto, focus sul titolo della nuova (`32-…`), o sul titolo
  della card se l'ultima generazione è *Nessuna novità* (`34-…`); voce già decisa altrove: messaggio sotto la riga e
  decisione registrata (`33-…`).
- **Card e link:** richiamo *"Proposta in attesa: 7 voci da decidere, 2 in conflitto."* + **Rivedi la proposta**,
  tabella chiusa in *"Fonti: …"*, **Genera di nuovo…** outline; `#proposta`, toast e card portano il focus sul titolo
  della sezione; il link sparisce da banner e toast quando la proposta si chiude (`44-…`).
- **Accessibilità:** nomi dei bottoni con la voce (*"Tieni il tuo testo per Posizionamento"*, *"Annulla la decisione su
  Nome"*), stato nel nome di `article`/`h4`, `dl` Ora/Proposta, una live region `status`, **Mostra** con
  `aria-expanded` e nome completo; 500 su Applica: errore sotto la riga, focus sul bottone (`aria-disabled`, mai
  `disabled`) (`09-…`).

### Findings

Ordinati per impatto sull'utente rispetto allo sforzo. Le righe e i file sono quelli del branch di oggi.

| # | Tipo | Impatto | Sforzo | Passo del FLOW | Cosa vede l'utente | Proposta |
|---|------|---------|--------|----------------|--------------------|----------|
| 1 | **Bug** | Alta | Bassa | A.4 · E.2 · Entry points (JobBanner) | Avvio la generazione da `/settings/profile` e vado su **Persone**. A job finito, banner e toast dicono *"Proposta pronta: 7 voci da decidere, 2 in conflitto · …"* ma hanno solo **Dettagli del run**: **Rivedi la proposta** non c'è (`35-banner-other-page.png`). Compare solo dopo essere tornato su `/settings/profile`. È il percorso principale per arrivare alla proposta da un'altra pagina. | `useOpenProposalId` legge il profilo in cache con `enabled: false` (`web/src/components/JobBanner.tsx:208-209`): `invalidateAfterJob` non rilegge una query senza osservatori attivi, quindi resta `pending_proposal: null` di prima del job e `stillOpen` è falso (`web/src/lib/jobs.ts:455`). Trattare come "non so" (`undefined`) una cache più vecchia della fine del job (`dataUpdatedAt < finished_at`), oppure rileggere il profilo quando finisce un `generate_profile`. |
| 2 | **Bug** | Media-alta | Bassa | Error paths (righe) · C.9 · C.11 | Errori che restano dopo che la cosa è stata decisa. *"Di cosa si occupa — applicato"* con sotto, in rosso, *"Non applicato: Errore interno (e2e)."* (un 500 di prima, poi applicata dall'azione di massa) anche nel riepilogo e dopo la riapertura (`11-…`, `13-…`). *"Voci non applicate: … Nessuna voce è cambiata."* resta sotto il riepilogo dopo un rifiuto in blocco riuscito (`43-…`). Due frasi che si contraddicono. | `ProposalSection.tsx`: il successo dell'azione di massa (`330-347`) non svuota `errors`; `onDone` del rifiuto in blocco (`738-747`) non svuota né `errors` né `bulkError`; una decisione singola non svuota `bulkError`. Svuotare gli errori delle voci che la risposta dà per decise e `bulkError` a ogni scrittura riuscita. |
| 3 | **Bug** | Media | Bassa | Accessibilità (focus) · PROPOSAL-DESIGN §2.1 "Trappola" | A 760 px la striscia va su tre righe (≈ 122 px). Dopo **Rifiuta** sull'ultima voce il focus salta su *"Posizionamento · In conflitto"*, ma il titolo finisce a 80–120 px, **sotto** la striscia (0–122 px): il focus c'è e non si vede (`39-760-far-focus.png`; WCAG 2.4.11). A 1280 px la striscia è alta ≈ 52 px e il problema non c'è. | `scroll-mt-20` (80 px) su `h4` (`ProposalRows.tsx:123`, `:594`) è più basso della striscia quando va a capo. Margine pari all'altezza vera della striscia (variabile CSS misurata), oppure i due bottoni su una riga sola sotto `md`, oppure striscia non sticky sotto `md`. |
| 4 | **Bug** | Media | Bassa | C.9 · Error paths (azione di massa) · "mai silenzio" | Con la striscia fissata in alto, quello che l'azione di massa ha da dire sta fuori schermo. Dopo un 500 su **Applica le 3 voci senza conflitto** si vede solo l'anello di focus sul bottone (`41-bulk-500.png`; lo screen reader sente il `role="alert"`). Con i soli conflitti rimasti il bottone è grigio e il motivo non si vede (`27-…`). | Hint, motivo del disabilitato ed errore sono fuori dalla striscia (`ProposalSection.tsx:675-684`). Metterli **dentro** la striscia, su una seconda riga (`basis-full`), così restano sotto il bottone che li causa. È una conseguenza della D1 (striscia sticky), non un ripensamento. |
| 5 | **Bug** | Media | Bassa | C.9 · Testi | Restano solo i 2 conflitti: il bottone primario dice **"Applica le 0 voci senza conflitto"**, disabilitato (`27-…`). | Etichetta in `ProposalSection.tsx:517-530`: con `massApply === 0` niente numero (*"Applica le voci senza conflitto"*, disabilitato, con il motivo accanto, come vuole C.9). |
| 6 | **Bug** | Media | Bassa | Error paths (Modifica uguale) · C.4 · C.6 | `edit_same` su un **conflitto** dice *"È uguale al testo di oggi: niente da applicare. Se va bene così, scegli «Rifiuta»."*. Sulla riga di un conflitto «Rifiuta» non c'è (c'è **Tieni il tuo testo**), e mentre la casella è aperta i verbi sono nascosti (`18-C-edit-same-conflict.png`). Lo stesso succede nel dialog di un servizio in conflitto, dove il bottone giusto è **Tieni il tuo servizio** (`46-…`). | `src/db/profile-proposal.ts:439` e `:476`: un testo per stato. Conflitto: *"…Se va bene così, annulla la modifica e scegli «Tieni il tuo testo»."* (servizio: *«Tieni il tuo servizio»*). Altrimenti: *"…annulla la modifica e scegli «Rifiuta»."* Il FLOW ha la stessa lacuna (sotto). |
| 7 | **Bug** | Bassa-media | Bassa | C.7 ("si apre per intero") · PROPOSAL-DESIGN §2.6 | *"Posizionamento — applicato con le tue modifiche"* mostra il testo applicato su una riga, tagliato con "…" (*"…in sei settimane, senza…"*), e **Mostra tutto** non c'è: nella riga c'è solo **Annulla** (`07-…`, `11-…`; nel DOM il paragrafo è alto 40 px e ne mostra 20). | `ProposalRows.tsx:580-584` misura solo la frase, non il paragrafo `applied` (`:601`). Misurare anche quello. |
| 8 | **Bug** | Bassa | Bassa | E.1 (tabella chiusa con una proposta aperta) | Chiusa la proposta, la tabella per fonte si apre (giusto). Con **Annulla** la proposta si riapre, ma la tabella resta aperta e la sezione riparte a ~790 px, sotto la piega (`14-…`). | `GenerateCard.tsx:256-259` riapre la tabella quando la proposta si chiude, ma non la richiude quando si riapre. Richiuderla quando `open` torna vero. |
| 9 | **Bug** | Bassa | Bassa | C.11 · Testi | Visto nel DOM, non su uno screenshot (l'animazione di chiusura finisce prima della cattura). Confermato il rifiuto in blocco, durante i 100 ms di chiusura il dialog si ridisegna con il conto a zero: **"Rifiuta le 0 voci"**, e probabilmente il titolo *"Rifiutare le 0 voci da decidere?"*. | `count` del dialog = `massReject` di adesso (`ProposalSection.tsx:894`, `:912`). Fissarlo all'apertura. |
| 10 | Proposta | Bassa | Bassa | C.10 · E.1 · riepilogo | *"Hai deciso tutte le 7 voci: 7 rifiutate."* quando due di quelle erano **Tieni il tuo testo / Tieni il tuo servizio**. La card dice *"Proposta del 3 ott chiusa: 7 rifiutate."* (`43-…`). È conforme al FLOW (C.10 conta "Tieni" fra le rifiutate), ma l'utente non ha rifiutato niente di suo: ha tenuto le sue parole. | Contarle a parte: *"5 applicate · 1 rifiutata · 1 tenuta com'era"* (riepilogo e frase al passato). Vedi le Open questions. |
| 11 | Proposta | Bassa | Bassa | Error paths (Modifica vuota) | `edit_empty`: *"Scrivi un testo, oppure rifiuta la proposta."*, ma con la casella aperta **Rifiuta** non c'è (`08-…`). | Stessa forma del finding 6: *"…oppure annulla la modifica e scegli «Rifiuta»"* (conflitto: *«Tieni il tuo testo»*). |
| 12 | Proposta | Bassa | Bassa | C.9 (hint) | Con un conflitto aperto in Modifica, l'hint dice *"I 2 conflitti restano fuori: decidili uno per uno. 1 voce in modifica resta fuori."*. La voce in modifica è uno dei due conflitti: sembrano tre voci fuori (`18-…`). | Non aggiungere *"in modifica resta fuori"* quando la voce in modifica è un conflitto, che è già fuori dall'azione di massa. |
| 13 | Proposta | Bassa | Bassa | A.7 (**Vedi il profilo aggiornato**) | Il titolo di «La mia azienda» arriva a filo del bordo alto, con il bordo della card tagliato (`12-…`). | Un `scroll-mt` sul titolo che riceve il focus (o `revealAndFocus` con margine). |

### Proposed FLOW.md changes

- **Error paths, riga "Modifica: testo vuoto o uguale"**: *"…scegli «Rifiuta»."* →
  testo che dipende dallo stato: *"…annulla la modifica e scegli «Rifiuta»."* /
  conflitto: *"…annulla la modifica e scegli «Tieni il tuo testo»."* (servizio: *«Tieni il tuo servizio»*). Stesso
  cambio per *"Scrivi un testo, oppure rifiuta la proposta."*. Il verbo nominato deve esistere sulla riga, e
  mentre la casella è aperta non si vede (findings 6, 11).
- **C.9, azione disabilitata**: aggiungere che con le sole voci in conflitto l'etichetta perde il numero (*"Applica le voci
  senza conflitto"*) (finding 5).
- **Accessibilità, "Azioni di massa"** (+ PROPOSAL-DESIGN §2.1): hint, motivo del disabilitato ed errore dell'azione di
  massa stanno **nella striscia**, visibili anche quando è fissata; il titolo che riceve il focus non finisce mai sotto
  la striscia, a nessuna larghezza (findings 3, 4).
- **C.10 / E.1 / Testi, riepilogo e frase al passato**: se si accetta il finding 10, *"N tenute com'erano"* separate da
  *"N rifiutate"*.

### Open questions

1. **"Tieni il tuo testo" nel riepilogo è un rifiuto?** Oggi il riepilogo e la card dicono *"7 rifiutate"* anche quando
   due voci erano testi tuoi tenuti. Raccomandazione: contarle a parte (*"1 tenuta com'era"*). Costa una parola, e il
   riepilogo dice quello che hai fatto davvero.
2. **Fuori dallo scope di questo giro:** a proposta chiusa, banner e toast perdono **Rivedi la proposta** (giusto), ma il
   testo resta *"Proposta pronta: 6 voci da decidere · …"* accanto alla card che dice *"Proposta del 3 ott chiusa: 6
   applicate."* (`44-…`). Allineare anche il testo (E.2: *"toast e banner dicono le stesse cose"*) o chiudere il toast
   quando la proposta si chiude? Da decidere se entra nel prossimo giro.

### Esito (2026-10-03, stessa sessione dell'implementazione)

- **Corretti:** i bug 1–9 e le proposte 11, 12, 13. Il link **Rivedi la proposta** resta se il profilo in cache è più
  vecchio del job (`KnownProposals` in `web/src/lib/jobs.ts`). Gli errori di riga e di massa si svuotano dopo un'azione
  di massa riuscita. La striscia misura la propria altezza (`--proposal-strip`) e i titoli la usano come margine di
  scorrimento. Hint, motivo ed errore stanno nella striscia. Niente più "0 voci", né nel bottone né nel dialog, che
  tiene i numeri dell'apertura. I testi di `edit_empty`/`edit_same` nominano il "no" della riga (server, test e FLOW).
  Il testo applicato tagliato ha **Mostra tutto**. La tabella per fonte torna in una riga quando la proposta si riapre.
  L'hint non conta due volte il conflitto in Modifica. Il titolo di «La mia azienda» arriva con 4rem di margine.
  FLOW aggiornato (Error paths, C.9, Accessibilità).
- **Verificati di nuovo nel pannello browser:** bug 1 (su /people, banner e toast con **Rivedi la proposta**), bug 3 e 5
  a 760 px (titolo del primo conflitto sotto la striscia di 146 px; *"Applica le voci senza conflitto"* disabilitato
  con il motivo nella striscia).
- **Restano all'utente:** finding 10 / Open question 1 ("Tieni il tuo testo" contato a parte nel riepilogo) e Open
  question 2 (testo di banner e toast a proposta chiusa).

