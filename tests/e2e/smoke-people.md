# Smoke di tappa M1 (people-first-crm T16)

Collaudo con `agent-browser` della tappa **M1 — Persone e contatti manuali** contro il server e2e (job fake,
nessuna chiamata ad Apify, Anthropic o Apollo). Contratto: `brain/specs/prospect-crm/people-first-crm/FLOW.md`
(Architettura della sidebar, Happy path A, B senza ⌘K, C, F, H, I, Error paths, Edge cases, Accessibilità, Testi
che cambiano) e `PLAN.md` T10–T16. Fuori perimetro M1 (non riportato come mancante): Oggi e FLOW D, ⌘K, fit
manuale (FLOW E), Connessioni/log/"Dettagli del run" (FLOW G), "Nascondi" del promemoria. Dataset e trigger:
[README](README.md) (scenario people-first-crm, sezione 4 `fail-next`).

- **Data:** 2026-09-18
- **Codice:** branch `people-first-crm`, modifiche non committate sopra `0967f2f`
- **Server:** API e2e su `:8841` (`E2E_FAKE_JOBS=1`, DB scratch, chiavi finte) · Vite su `:5191`
  (`API_URL=http://localhost:8841`) · sessione `agent-browser --session smoke-m1`, viewport 1280×900
- **Evidenze:** `smoke-m1/*.png` nella cartella scratch della sessione
  (`/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/b46a3e40-0044-40a6-9f88-df6cab0e2630/scratchpad/smoke-m1/`)
- **Esito:** tutti i percorsi felici di M1 passano; **0 BLOCKER · 2 MAJOR · 18 MINOR** (sezione "Esiti").
  Console del browser senza errori a fine sessione.

Id del seed usati (stabili dopo ogni `POST /api/e2e/seed`): Giulia Neri a mano **#21**, Giulia Neri dai job
**#20**, Sara Conti senza LinkedIn **#22**, Anna Bianchi **#23** / Ufficio Beta **#24** (stessa email), Marco Riva
**#25** (LinkedIn noto, prossima azione a oggi+10), Nuvola Srl **azienda #8**, Marco Ferri **#3**, Luca Bernardi
**#6**, Carlo Gentile **#19**, liste 1–3.

Nota di esecuzione: durante H.1 l'orchestratore ha lanciato un `seed` sullo stesso server; il passo è stato
ripetuto dopo un nuovo `reset` (nessun esito derivato da quell'interferenza).

### Gotcha di automazione (non bug del prodotto)

- I campi `type="date"` non accettano `fill`: si scrivono premendo le cifre una alla volta sullo spinbutton "Giorno".
- Click su elementi sotto la piega a volte non arrivano: `scrollintoview @ref` prima di `click`; `find role … --name`
  a volte non trova link/bottoni presenti (usare i ref di `snapshot -i`).
- `visibilityState=hidden`: dopo la chiusura di un dialog serve uno `screenshot` prima di asserire.

---

## H. Primo avvio a CRM vuoto (`POST /api/e2e/reset`)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| H1 | `open /` | Onboarding "Porta dentro le prime persone" + sottotitolo; tre card con requisiti scritti; "Da completare: …" | h1 e sottotitolo esatti; card 1 **Aggiungi persona** attivo; card 2 **Sincronizza** `disabled` con "Serve il tuo profilo LinkedIn. Salva il profilo" (`aria-describedby` sul bottone); card 3 **Aggiungi un'azienda** `disabled` con "Serve un ICP: … Crea ICP"; "Da completare: profilo LinkedIn · descrizione della tua azienda · un ICP" (APOLLO assente perché le chiavi e2e sono finte) | ✓ | `h1-onboarding.png` |
| H2 | Link del promemoria e delle card | `/settings#profilo`, `/settings#azienda`, `/icps`, `/icps/nuovo`, `/people/new` (P-24) | tutti i link portano lì; `#profilo` → focus sull'URL del profilo, `#azienda` → focus su "Di cosa si occupa", `/people/new` → focus su Nome | ✓ | — |
| H3 | Sidebar | "CRM personale", gruppi Contatti/Prospecting, niente Oggi/Cerca in M1 (P-22) | `nav "Navigazione principale"`, due `role=group` con `aria-labelledby` ("Contatti", "Prospecting"), badge assente a 0 | ✓ | `h1-onboarding.png` |
| H4 | `open /people` a CRM vuoto (B10) | "Il CRM è vuoto." + stesse tre strade | testo e tre card identiche; viste "Tutte, 0 · Da smistare, 0 · …"; `aria-current` su "Persone" e "Tutte" | ✓ | `h3-people-empty.png` |
| H5 | Aggiungi persona → "Primo Contatto" + email → **Invio** nel Nome | Salva è primario con Invio; si apre la scheda con conferma | `/people/1`, toast "Persona aggiunta: Primo Contatto", Fonti "Aggiunta a mano · incontro del 18 set" | ✓ | `h2-first-person.png` |
| H6 | `open /` con 1 persona | redirect a `/people` (P-16) | `/people`, "1 persona in Tutte" | ✓ | — |

## A. Dopo un evento: più persone di fila (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| A1 | Persone → **Aggiungi persona** | titolo, sottotitolo "Bastano il nome e un recapito. Non avvia job e non costa nulla.", 4 `fieldset`, placeholder del contesto, data incontro = oggi, "Nessuna lista", Nuovo, Salva / Salva e aggiungi un'altra / Annulla, focus su Nome | tutto presente; "Nome (obbligatorio)" scritto; percorso "Persone › Aggiungi persona" | ✓ | `a1-form-empty.png` |
| A2 | "+ Crea nuova lista" nel form → "Eventi autunno" (ICP 1) | lista creata e scelta | radio "Eventi autunno 0 persone" `checked` | ✓ | — |
| A3 | Azienda: scrivo "Nuvola" → Invio | opzione "Nuvola Srl · nuvola.example" → chip "Collegata: Nuvola Srl" (×) | combobox con `aria-activedescendant`/`aria-controls`, prima opzione preselezionata, Invio collega senza inviare il form; **focus finisce su `body`** (MAJOR-2) | ✓ / a11y ✗ | `a2-company-search.png` |
| A4 | Luca Bassi · CTO · email · contesto DevFest · 12 set · lista Eventi autunno · prossima azione 1 ott "Proporre la call" → **Salva e aggiungi un'altra** | toast "Persona aggiunta: Luca Bassi" + Apri scheda; form svuotato tranne contesto/data/lista/stato; riga "Restano per la prossima persona: …" + Svuota tutto; "Aggiunte ora (1): Luca Bassi"; focus su Nome; live region | tutto come da FLOW, live region "Persona aggiunta: Luca Bassi. Il form è pronto per la prossima."; API: `company_id 8`, `met_on 2026-09-12`, nota datata 12 set 12:00Z, lista 4, prossima azione 2026-10-01 | ✓ | `a3-after-save-add-another.png` |
| A5 | 2ª persona: Azienda "Fabbrica Digitale" → "Crea l'azienda 'Fabbrica Digitale'…" → Crea e collega senza chiavi, poi con sito `nuvola.example`, poi `fabbricadigitale.example` | "Serve almeno il sito o la pagina LinkedIn." · "… è già di 'Nuvola Srl'." + Collega quella · toast "Azienda creata: Fabbrica Digitale" | messaggi presenti (testo: "Il dominio nuvola.example è già di 'Nuvola Srl'."), Collega quella; dopo la creazione chip "Collegata: Fabbrica Digitale", toast corretto, **focus su `body`** (MAJOR-2); il messaggio di conflitto resta visibile dopo aver cambiato il sito (MINOR-14) | ✓ | `a2-company-taken.png` |
| A6 | Paola Verdi · LinkedIn nuovo `…/in/Paola-Verdi-Smoke/` · stato iniziale Qualificato → Salva e aggiungi un'altra | persona creata, stato ≠ Nuovo scrive un cambio di stato (C6) | "Aggiunte ora (2)"; API: URL minuscolo senza slash, `qualificato`, timeline `status_change nuovo→qualificato` + nota; riga "… · stato Qualificato." | ✓ | — |
| A7 | **C7**: 3ª persona "Marco Riva" + `https://www.linkedin.com/in/Marco-Riva-e2e/` → esco dal campo | pannello "Questo profilo LinkedIn è già nel CRM: Marco Riva — Head of Engineering · Beta (commento del …) · Apri scheda. Non si crea un doppione." + opzione Aggiungi l'incontro | testo esatto (URL normalizzato), `role=status`, checkbox "Aggiungi l'incontro a Marco Riva" | ✓ | `a4-c7-panel.png` |
| A8 | Spunto l'opzione + prossima azione "Domani" | riepilogo C9 + "Ha già una prossima azione (28 set · Richiamare): verrà sostituita da quella del form." | riepilogo presente ("…Gli altri campi del form non cambiano la sua scheda.") + frase della prossima azione | ✓ | `a4-c7-summary.png` |
| A9 | Salva e aggiungi un'altra | toast "Incontro aggiunto a Marco Riva"; "Marco Riva (incontro)"; esce da Da smistare, badge scende | tutto ✓; badge 9 → 8; API: fonti manual (met_on 12 set) + commento, lista Eventi autunno, prossima azione sostituita, stato **invariato** (Nuovo) | ✓ | `a4-c7-saved.png` |
| A10 | **C8**: "Anna Bianchi" + `INFO@beta-e2e.example` → esco dal campo | "Questa email è già di: Anna Bianchi — Marketing · Beta; Ufficio Beta. Scegli come procedere." + 3 radio senza preselezione | testo presente (con "(commento del 18 set) · Apri scheda"), confronto senza maiuscole, radio non preselezionati | ✓ | `a5-c8-panel.png` |
| A11 | Salva senza scelta | "Scegli se aggiungere l'incontro a una persona esistente o crearne una nuova." sul gruppo, focus sul gruppo | errore presente, focus sul `fieldset` con `aria-describedby` all'errore | ✓ | `a5-c8-nochoice.png` |
| A12 | Scelgo "Aggiungi l'incontro a Anna Bianchi" → Salva e aggiungi un'altra | toast "Incontro aggiunto a Anna Bianchi" | ✓; badge 8 → 7; "Aggiunte ora (4)" | ✓ | — |
| A13 | **C10**: nome "  sara   CONTI " → esco | avviso non bloccante "Esiste già una persona con questo nome: Sara Conti — CFO · Pagamenti Srl (Apri scheda)." + opzione non preselezionata | avviso con "(aggiunta a mano del 29 ago)"; confronto che ignora spazi e maiuscole | ✓ | `a6-c10-panel.png` |
| A14 | Email nuova + opzione scelta | riepilogo + "L'email e il telefono del form non si copiano: aggiungili dalla sua scheda." (+ "Ha già la fonte 'Aggiunta a mano' …") | tutte e tre le frasi presenti | ✓ | `a6-c10-summary.png` |
| A15 | **Salva** | si apre la scheda di Sara Conti, toast "Incontro aggiunto a Sara Conti" | `/people/22`, toast corretto, due note "Come vi siete conosciuti", lista Eventi autunno, fonte manuale invariata (29 ago) | ✓ | `a6-c10-saved-scheda.png` |
| A16 | C10 senza scelta → Salva | scheda della nuova persona, "Persona aggiunta: Sara Conti" | `/people/28`, toast corretto | ✓ | — |
| A17 | C8 → "Crea comunque una nuova persona" → Salva | nuova persona con la stessa email (E1) | `/people/28` "Persona aggiunta: Segreteria Beta" | ✓ | — |
| A18 | Da scheda azienda (Nuvola) → Aggiungi persona (`?company=8`) → Salva e aggiungi un'altra | chip "Collegata: Nuvola Srl"; la riga dice "… · stato Nuovo · azienda Nuvola Srl"; l'azienda resta | ✓ ("Restano per la prossima persona: 18 set · stato Nuovo · azienda Nuvola Srl."); **Svuota tutto** toglie la riga ma lascia il chip dell'azienda (MINOR-12) | ✓ | `a3-from-company-add-another.png` |
| A19 | `?company=9999&name=giu` | campo vuoto + "Azienda non trovata: forse è stata unita a un'altra."; Nome "giu" | ✓ | ✓ | — |

## Righe d'errore del form e "Persona inesistente"

| # | Riga (FLOW Error paths) | Azione | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| E1 | Nome vuoto · Nessun recapito | Salva a form vuoto | "Inserisci il nome." (`aria-invalid` + `aria-describedby`), focus su Nome; sul `fieldset` Recapiti `aria-describedby` → "Serve almeno un recapito: profilo LinkedIn, email o telefono." | ✓ | `e1-empty-save.png` |
| E2 | URL non di persona · Email malformata · Cosa fare senza data | `…/company/acme/`, `nome@azienda`, "Richiamare" senza data → Salva | tre errori con i testi esatti del FLOW, focus sul primo campo errato (LinkedIn) | ✓ | `e2-invalid-fields.png` |
| E3 | Data passata | prossima azione 10/09/2026 | "Data passata: comparirà come scaduta." (compare solo al salvataggio successivo, prima resta "Scegli la data…") | ✓ | — |
| E4 | Salvataggio fallito | `fail-next POST /api/prospects` → Salva | `role=alert` "Salvataggio non riuscito: Errore interno (e2e). I dati inseriti sono ancora qui."; valori conservati; focus su `body` (MINOR-10); Salva di nuovo → `/people/29`, scheda con "Scaduta · gio 10 set — Richiamare" | ✓ | `e3-save-failed.png` |
| E5 | Persona di "Aggiungi l'incontro" sparita | C10 su Sara Conti #22 scelta, poi `POST /api/prospects/28/merge {otherId:22}` → Salva | alert "Sara Conti non è più nel CRM (forse unita a un'altra persona): ricontrollo i doppioni."; pannello ricalcolato (resta la #28) | ✓ | `e4-meeting-person-vanished.png` |
| E6 | Lista archiviata nel frattempo | lista 3 scelta, `PATCH /api/lists/3 {archived:true}` → Salva | alert "La lista 'Software house — CTO' è archiviata: scegline un'altra.", focus sul gruppo Lista | ✓ | `e5-list-archived.png` |
| E7 | Uscita dal form con dati | Annulla; poi voce "Aziende" in sidebar | dialog "Uscire senza salvare? I dati inseriti andranno persi." · **Resta** (focus) · Esci senza salvare; Resta conserva i dati (focus poi su `body`, MINOR-10); Esci → `/companies`. `beforeunload` (chiusura tab) non verificabile con agent-browser | ✓ | `e6-exit-guard.png` |
| E8 | C7 per corsa al salvataggio | URL nuovo, esco (nessun doppione), `POST /api/prospects` con lo stesso URL via curl, poi Salva | nulla creato; pannello C7 su "Corsa Altrove" + "Questo profilo LinkedIn è già nel CRM: aggiungi l'incontro a questa persona o cambia URL."; focus su `body` (MINOR-10); risalvando senza scelta il focus va alla checkbox | ✓ | `e7-c7-race.png` |
| E9 | Crea azienda senza chiavi / chiave già usata | vedi A5 | ✓ | ✓ | `a2-company-taken.png` |
| E10 | Azienda scelta sparita | azienda "Sparisce Srl" scelta, `POST /api/companies/10/merge {into:11}` → Salva | sotto il campo "Azienda non trovata: forse è stata unita a un'altra. Cercala di nuovo." (`aria-describedby`, non `role=alert`), focus su `body` (MINOR-10) | ✓ | `e8-company-vanished.png` |
| E11 | Persona inesistente o unita (E8) | `/people/22` (unita) e `/people/9999` | "Persona non trovata" + "Il link potrebbe essere sbagliato, oppure la persona è stata unita a un'altra." + Vai a Persone; "Vai a Persone" ha `aria-current="page"` (MINOR-9) | ✓ | `e9-person-not-found.png` |
| E12 | Caricamento pagina fallito | `fail-next GET /api/prospects/21 times:2` | ErrorBox "Errore interno (e2e)." + Riprova, sidebar usabile; Riprova → scheda | ✓ | `e10-load-failed.png` |

## B. Ritrovare un contatto (senza ⌘K)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| B1 | Cerca "devfest" (dopo A) | trova chi ha "DevFest" nel contesto dell'incontro (B5) | `/people?q=devfest`: Sara Conti, Anna Bianchi, Marco Riva, Paola Verdi, Luca Bassi, Giulia Neri (seed); viste "Tutte 6 · Da smistare 0 · Con prossima azione 2 · Scartate 0" (conteggi coi filtri) | ✓ | `b4-devfest.png` |
| B2 | Righe (B7) | nome + ruolo, fonti con tooltip, azienda (link se collegata), stato, liste / "Nessuna lista", prossima azione, Aggiunta il | ✓; tooltip "Aggiunta a mano · incontro del 12 set" (badge focusabile); prossima azione "gio 1 ott · Proporre la call" con `<time datetime>` | ✓ | `b4-source-tooltip.png` |
| B3 | Cerca "pagamenti", "+39 333", "marco-riva-e2e" | testo su azienda, email, telefono, URL | ✓ (3, 1, 1 risultati). **Con l'URL completo copiato da LinkedIn (slash finale) nessun risultato** (MAJOR-1) | ✓ / ✗ | — |
| B4 | Fonte "Aggiunta a mano" + Altri filtri › Azienda collegata "Nuvola Srl" | filtri nell'URL, chip | `?q=devfest&source=manual&company=8`, chip "Cerca: devfest · Fonte: Aggiunta a mano · Azienda: Nuvola Srl" rimovibili + Pulisci; 1 riga (Luca Bassi) | ✓ | `b4-filters.png` |
| B5 | Apro Luca Bassi → reload → percorso "Persone" (A7) | torna a vista/filtri | link `/people/26?from=…`; dopo il reload "Persone" punta a `/people?q=devfest&source=manual&company=8`; click → stessa vista | ✓ | `a7-scheda-from-filters.png` |
| B6 | Testo che trova scartate (B6) | "Anche N persone scartate corrispondono a '…'." + Mostrale | `?view=da_smistare&q=giulia` dopo aver scartato #20: "Anche 1 persona scartata corrisponde a 'giulia'. Mostrale" → `?view=scartate&q=giulia` (plurale "Mostrale" con 1: MINOR-3) | ✓ | `b5-scartate-hint.png` |
| B7 | Valori invalidi (`view=bogus&sort=xx&next=zz&page=-3`) | default | `/people` Tutte | ✓ | — |
| B8 | Pagina oltre l'ultima (`?page=5`, o `/inbox?…&page=2`) | — | "25 persone in Tutte" + "Nessuna persona." senza paginatore (MINOR-6) | ✗ | `b-page-out-of-range.png` |
| B9 | Vista Con prossima azione | ordinamento di default "Prossima azione" (B8) | ✓; vuota: "Nessuna prossima azione. Impostala dalla scheda di una persona o quando la aggiungi." | ✓ | — |

## A4/A5/A7 — Redirect e ritorno all'origine

| # | Azione | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| R1 | `/inbox` | `/people?view=da_smistare` (replace) | ✓ (history +1 per navigazione: replace) | ✓ | — |
| R2 | `/inbox?source=post_comment&sort=comments_first&page=2` | stessi parametri + `view=da_smistare` | ✓ | ✓ | `a4-inbox-redirect.png` |
| R3 | `/inbox?status=scartato,nuovo&q=beta` | `view=scartate` senza `status` | `/people?q=beta&view=scartate` | ✓ | — |
| R4 | `/inbox?status=nuovo&q=giu&fit=alto&icp=1` | `view=da_smistare` + stessi valori | ✓ | ✓ | — |
| R5 | `/prospects/21?list=1`, `/prospects/9999` | `/people/$id` con gli stessi parametri | ✓; il secondo mostra "Persona non trovata" | ✓ | — |
| R6 | Da `/companies/8` apro Luca Bassi, reload | "← Nuvola Srl" (nome "Torna a Nuvola Srl") | ✓ anche dopo il reload | ✓ | `a7-from-company.png` |
| R7 | Da `/lists/1?status=nuovo` apro Giulia Neri, reload | "← CTO manifattura Nord Italia" verso `/lists/1?status=nuovo` | ✓ | ✓ | `a7-from-list.png` |
| R8 | `aria-current` nei dettagli | sezione attiva in sidebar + ultimo segmento del percorso | ✓ su `/people/*`, `/companies/1`, `/lists/1`, `/icps/1`, `/settings`; in più "Annulla" su `/people/new` e "Vai a Persone" hanno `aria-current="page"` (MINOR-9) | ✓ | — |

## C. Da smistare, triage, bulk (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| C1 | Reset + profilo via API → onboarding **Sincronizza** → Avvia sync | toast/banner "Sync completato: … N nuove persone da smistare …" + **Apri Da smistare**; badge | banner "In corso: Sync interazioni", poi toast e banner "Sync completato: 2 post sincronizzati · 6 reazioni e 3 commenti letti · 7 nuove persone da smistare · 1 senza profilo pubblico (saltati)." + "Apri Da smistare"; badge 7; `/` passa a `/people` | ✓ | `c1-sync-running.png`, `c1-sync-done.png` |
| C2 | "Apri Da smistare" | `/people?view=da_smistare` | ✓, "Chi arriva dai tuoi strumenti e non è in nessuna lista. Ultimo sync: adesso." | ✓ | `c1-open-da-smistare.png` |
| C3 | Senza profilo | Sincronizza disabilitato, "Salva prima il tuo profilo LinkedIn." | bottone `disabled`; il motivo è solo nell'attributo `title` (MINOR-7) | ✓ / ✗ | `c2-sync-disabled.png` |
| C4 | Seed: vista Da smistare, "Commenti prima" | 9 persone, viste con conteggi, sottotitolo | ✓ `?view=da_smistare&sort=comments_first`; viste come link con nome "Da smistare, 9" | ✓ | `c2-da-smistare.png` |
| C5 | Seleziono Anna + Ufficio Beta → Aggiungi a lista → lista 1 | "12 aggiunte a '…' · 0 già presenti. Le trovi in Tutte e nella lista."; righe escono; badge scende | toast "2 aggiunti a 'CTO manifattura Nord Italia' · 0 già presenti" + Apri lista (manca la seconda frase, maschile: MINOR-2); righe uscite, badge 9 → 7; focus su `body` | ✓ / ✗ | `c3-add-to-list.png` |
| C6 | Scarta Chiara | "1 scartata. Le ritrovi in Scartate." senza conferma | ✓, focus sul riepilogo, badge 6 | ✓ | `c3-scarta.png` |
| C7 | Cambia stato ▾ → Qualificato (2) | cambio diretto | toast "Stato aggiornato: Qualificato (2)" | ✓ | — |
| C8 | Scarta Marco Riva (ha prossima azione) | avviso (deviazione T11: nel toast) | "1 scartata. … 1 aveva una prossima azione: la conserva, ma non comparirà più tra le cose da fare." | ✓ | `c3-scarta-next-action.png` |
| C9 | Vista Scartate → Ripristina | BulkBar: Aggiungi a lista · Ripristina · Cambia stato · Arricchisci… · Analizza… | "1 ripristinata: torna in Tutte."; **manca "Aggiungi a lista"** nella vista Scartate (MINOR-4) | ✓ / ✗ | — |
| C10 | `q=giulia` (3, una senza LinkedIn) → Arricchisci… (Apify e Apollo) · Analizza… (ICP 1) | "N senza LinkedIn: escluse", fuori stima (E11) | "3 selezionati · 2 da arricchire" + "1 senza LinkedIn: escluse." (Apify, Apollo: 2 crediti, Analizza: 2 da analizzare); con 1 il testo resta al plurale (MINOR-3) | ✓ | `c3-enrich-preview.png`, `c3-analyze-preview.png` |
| C11 | Lista 1 con #21 e #22 → Sulla lista: Analizza… · Esporta… | stessa esclusione anche dalla lista; testi A3 | "4 nella lista · 2 da analizzare" + "2 senza LinkedIn: escluse."; export "Verranno esportate 2 persone (2 senza email escluse)." / "Esporta 2 persone" | ✓ | `c-list-analyze-preview.png` |
| C12 | Seleziona tutti (6) → Scarta | "Niente da smistare: …" + "Ultimo sync: … (N post)." + Sincronizza interazioni · Vedi le scartate; badge sparisce | tutto ✓ ("Ultimo sync: 3 min fa (2 post)."), badge assente | ✓ | `c-outcome-empty.png` |
| C13 | Filtro impossibile (Da smistare + Aggiunta a mano) | "Le persone aggiunte a mano non passano da Da smistare." | ✓ + "Togli il filtro Fonte" | ✓ | — |

## F. LinkedIn su una persona manuale → Unisci (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| F1 | `/people/21` | Aggiungi profilo LinkedIn al posto di Apri su LinkedIn; Arricchisci e Analizza disabilitati col motivo | ✓ "Serve il profilo LinkedIn: aggiungilo per arricchire o analizzare questa persona." sotto entrambi | ✓ | `f1-giulia-manual.png` |
| F2 | Aggiungi profilo LinkedIn → incollo `…/in/giulia-neri-e2e/` → Salva | focus sul campo; nulla salvato; "Questo profilo LinkedIn è già di Giulia Neri — CFO · Pagamenti Srl (reazione del …) · Apri scheda. Non salvato." + Unisci … · Annulla la modifica | focus su `person-21-linkedin`; testo esatto; API `linkedin_url` ancora nullo | ✓ | `f2-linkedin-conflict.png` |
| F3 | Unisci Giulia Neri in questa persona… | dialog "Unisci Giulia Neri (#20) in questa scheda", Confluiscono, Profilo LinkedIn, Si aggiungono, tabella con caption, "L'unione non si può annullare.", focus su Annulla | tutto presente, focus su Annulla, Esc/Annulla riportano il focus al bottone; "Confluiscono" senza il dettaglio tra parentesi (MINOR-5) | ✓ | `f3-merge-dialog.png` |
| F4 | Stato #21 → Qualificato, riapro | tabella "Stato · Qualificato · Nuovo" | `caption` "Valori in conflitto", `th scope`, riga Stato Qualificato / Nuovo | ✓ | `f3-merge-conflicts.png` |
| F5 | `fail-next POST /api/prospects/21/merge` → Unisci | ErrorBox nel dialog | `role=alert` "Errore interno (e2e)." nel dialog; focus finisce su `body` fuori dal dialog (MINOR-10) | ✓ | `f-merge-500.png` |
| F6 | Unisci di nuovo | toast "Persone unite: resta Giulia Neri"; Apri su LinkedIn; Arricchisci attivo; Fonti a mano + Reazione; timeline di entrambe; stato invariato senza nuova voce; LinkedIn in sola lettura col motivo; #20 fuori da Da smistare | tutto ✓; badge 9 → 8; campo `readonly` con "Il profilo LinkedIn arriva da una fonte dei tuoi strumenti: non si modifica."; `GET /api/prospects/20` → 404 | ✓ | `f4-merged.png` |
| F7 | Variante E4: Sara Conti #22 (solo telefono) → svuoto il telefono → Salva | "Serve almeno un recapito: senza profilo LinkedIn tieni l'email o il telefono." + Ripristina | alert esatto, Ripristina ripristina, nulla salvato | ✓ | `f5-e4-clear-contacts.png` |
| F8 | Variante URL libero: `…/in/sara-conti-smoke/` → Salva; poi correggo in `…/sara-conti-cfo/` | "Profilo LinkedIn aggiunto"; correggibile finché c'è solo la fonte a mano | ✓ toast; correzione salvata ("Anagrafica salvata") | ✓ | — |
| F9 | Svuotare il LinkedIn | "Il profilo LinkedIn non si può rimuovere." | messaggio inline con `aria-invalid` + `aria-describedby`, nulla salvato | ✓ | `f5-e3-clear-linkedin.png` |
| F10 | Email di altri su chi ha un altro LinkedIn (Sara con `…/sara-conti-cfo`, email `info@beta-e2e.example`) | niente Unisci: "X ha un altro profilo LinkedIn (…): sono due persone distinte e non si possono unire." + Salva comunque | ✓ per Anna Bianchi e Ufficio Beta; Salva comunque → salvata | ✓ | `f5-email-taken-distinct.png` |
| F11 | Email di altri su persona senza LinkedIn (#21, `info@beta-e2e.example`) | "Questa email è anche di: …" + Unisci … · Salva comunque | "Unisci Anna Bianchi in questa persona…" / "Unisci Ufficio Beta …" + Salva comunque; anteprima con "Nome · Giulia Neri · Anna Bianchi" | ✓ | `f5-email-merge-preview.png` |
| F12 | LinkedIn + Località "Torino" insieme → Unisci… (E6) | i valori che sto salvando contano come della persona tenuta | tabella "Località · Torino · Milano" | ✓ | `f5-merge-values-being-saved.png` |
| F13 | A dialog aperto `POST /api/prospects/22/merge {otherId:20}` → Unisci | `role=alert` "Giulia Neri #20 non è più nel CRM (forse unita da un job). Nessuna modifica." | ✓, nulla salvato su #21; dopo Chiudi il pannello offre ancora "Unisci Giulia Neri…" per la #20 sparita (MINOR-15); Salva ricalcola ("già di Sara Conti") | ✓ | `f-merge-vanished.png`, `f-merge-vanished-reopen.png` |

## I. Persona ↔ azienda (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| I1 | Marco Riva #25: riga Azienda | "Beta · non collegata" + Collega a un'azienda | ✓ (vuota su #21: "Nessuna azienda") | ✓ | — |
| I2 | Collega → dialog | "Collega Marco Riva a un'azienda", ricerca "Cerca per nome, sito o pagina LinkedIn" precompilata | ✓ "Beta" → "Beta Payroll Srl · beta-payroll.example"; senza "Crea …" quando ci sono risultati (MINOR-16) | ✓ | `i2-collega-dialog.png` |
| I3 | Scelgo Beta Payroll → Collega | toast "Azienda collegata: Beta Payroll Srl"; link + Cambia azienda · Scollega + "Collegata da te: i job non cambiano questo collegamento." | ✓; focus su `body` | ✓ | `i2-linked.png` |
| I4 | Cambia azienda → "zeta" (nessun risultato) → "nuvola.example" → Collega | "Nessuna azienda trovata per 'zeta'." + "Crea 'zeta' come nuova azienda"; toast | ✓; ricerca per dominio ✓; Beta Payroll "Persone (0)" col testo del vuoto, Nuvola "Persone (1)" | ✓ | `i2-no-results.png`, `i2-changed.png` |
| I5 | Collega su persona con testo "Zeta Srl" → "Crea 'Zeta Srl' come nuova azienda" → pagina LinkedIn → **Crea e collega** | azienda creata e collegata | toast "Azienda creata: Zeta Srl", chip "Collegata: Zeta Srl" nel dialog ma la persona **non** è collegata finché non premo anche "Collega" (MINOR-13) | ✓ / ✗ | `i2-create-in-dialog.png` |
| I6 | `fail-next DELETE /api/prospects/25/company` → Scollega | errore accanto al controllo, valori conservati | "Scollega non riuscito: Errore interno (e2e)." (`role=alert`), collegamento invariato | ✓ | `i3-unlink-failed.png` |
| I7 | Scollega di nuovo | "Azienda scollegata: resta 'Beta' come testo." | ✓ + "Scollegata da te: i job non la ricollegano."; fonti invariate | ✓ | `i3-unlinked.png` |
| I8 | Scheda Nuvola: Persone (N) | solo collegate; Aggiungi persona (`?company=8`) · Collega una persona esistente · Estrai persone | ✓ | ✓ | `i4-company-nuvola.png` |
| I9 | Collega una persona esistente → "Carlo" | "Ora collegata a …: collegandola qui lascia …" | "Ora collegata a Acme HR Software Srl: collegandola qui lascia Acme HR Software Srl."; ricerca per evento ("devfest") trova Giulia Neri ma con "Giulia Neri —" (MINOR-18); Collega → "Persona collegata a Nuvola Srl: Carlo Gentile", Persone (2) | ✓ | `i4-link-person.png`, `i4-linked-person.png` |
| I10 | Prossima azione in scheda (#21): Imposta → `fail-next PUT …/next-action` → Salva; Salva; Modifica → Rimuovi | errore accanto, valori conservati; toast | "Salvataggio non riuscito: Errore interno (e2e)." con data e testo conservati; poi "Prossima azione impostata: ven 25 set" e "Prossima azione rimossa" | ✓ | `g-next-action-failed.png` |

## D7/D8/D9 — Dati impostati a mano e arricchimento finto

| # | Azione | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| D1 | Marco Ferri #3: Ruolo "Direttore Tecnico", Azienda (testo) "PagoLampo Manuale" → Salva | marcatore "a mano" con tooltip "Scritto da te: i job non lo sovrascrivono." | ✓ (`title` + testo sr-only) | ✓ | — |
| D2 | Arricchisci → Avvia arricchimento (job fake) | ruolo e azienda restano, marcatore resta; i campi mai toccati si riempiono | job `succeeded` "1 arricchito (1 con email)"; Ruolo/Azienda invariati con "a mano"; Località "Milano, Lombardia, Italia", About ed esperienze riempiti | ✓ | `d8-after-enrich.png` |
| D3 | D7: Luca Bernardi #6 collegato a mano a Ferronova, poi Arricchisci | il collegamento non cambia | resta "Ferronova Digitale Srl" + "Collegata da te…"; il testo azienda si riempie sotto (Trasporti Adrialog Spa) | ✓ | `d7-after-enrich.png` |
| D4 | D9: Carlo Gentile #19 svuoto l'email → Salva; preview Apollo | "vuota · svuotata a mano"; "N con email svuotata a mano: escluse" | ✓ "Emailvuota · svuotata a mano"; preview Apollo "1 con email svuotata a mano: escluse." + blocco "Nessun profilo da cercare con queste opzioni." (plurale con 1: MINOR-3) | ✓ | `d9-email-cleared.png`, `d9-apollo-preview.png` |
| D5 | Edge: porto a Scartato Marco Riva (ha prossima azione) dal popover della scheda | il popover avvisa prima di confermare | nessun avviso nel popover; dopo la conferma la scheda dice "Persona scartata: la prossima azione resta, ma non compare tra le cose da fare." (MINOR-8) | ✗ | `edge-scarta-with-next-action.png` |

## Testi (A3): "prospect" / "Inbox"

Scansione di `innerText` + `aria-label`/`title`/`placeholder` + `document.title` su: `/people` (4 viste + nessun
risultato), `/people/new`, `/people/21`, `/people/3`, `/people/25`, `/people/9999`, `/companies`, `/companies/1`,
`/companies/8`, `/companies/3`, `/lists`, `/lists/1`, `/lists/2`, `/icps`, `/icps/1`, `/icps/nuovo`, `/settings`,
più dialog (Aggiungi a lista, Arricchisci, Analizza, IcpPicker, Esporta, Sincronizza, Unisci) e toast visti.
Nessuna occorrenza di "prospect"/"Inbox"/"sourcing" nel testo; unica occorrenza il **titolo del documento**
"SeVedemo · CRM prospecting" su tutte le pagine (MINOR-1). Il gruppo "Prospecting" della sidebar è ammesso.

---

## Esiti

**0 BLOCKER · 2 MAJOR · 18 MINOR.** Tutti i percorsi felici di M1 (A, B senza ⌘K, C, F, H, I) e le righe d'errore del
form da "Nome vuoto" a "Persona inesistente" funzionano; nessuna perdita di dati osservata.

### MAJOR

**MAJOR-1 — La ricerca per URL confronta l'URL grezzo: con lo slash finale (o `https://`/`www.` sul sito) non trova
nulla** (FLOW B.4, I.2, A.2; SPEC B5, D2; regola di identità del root `AGENTS.md`: mai confrontare URL grezzi).
- Repro (seed): `/people?q=https://www.linkedin.com/in/marco-riva-e2e/` (URL come si copia da LinkedIn) →
  "Nessuna persona corrisponde ai filtri." (`GET /api/prospects?q=…/` → `total 0`); senza lo slash finale → Marco
  Riva #25.
- `/people/new` → Azienda: `https://www.linkedin.com/company/ferronova-digitale-e2e/` → solo "Crea l'azienda
  'https://www.linkedin.com/company/ferronova-digitale-e2e/'…" (senza slash trova Ferronova, azienda #1);
  `https://acme-hr.example/` o `www.acme-hr.example` → solo "Crea l'azienda '…'" (con `acme-hr.example` trova Acme
  HR Software, azienda #2). Scegliendo "Crea…" l'URL finisce nel campo **Nome** del pannello.
- Atteso: "Cerca per nome, sito o pagina LinkedIn" (D2) e testo su "URL LinkedIn" (B5) normalizzano l'input come il
  controllo doppioni del form (C7 riconosce `…/in/Marco-Riva-e2e/`). Il doppione non nasce grazie al 409 della
  creazione (D3), ma la ricerca fallisce con il formato di input più comune.

**MAJOR-2 — Nel CompanyPicker del form il focus finisce su `body` dopo la scelta dell'azienda** (FLOW A.2 e
Accessibilità "il combobox azienda segue il pattern della ricerca"; baseline "focus trap e restore").
- Repro (seed): `/people/new` → Azienda → scrivo "Nuvola" → Invio: chip "Collegata: Nuvola Srl", poi
  `document.activeElement` = `BODY`; il Tab successivo parte dal marchio in sidebar. Stesso esito dopo **Crea e
  collega** del pannello inline (A5) e dopo × "Togli il collegamento a Nuvola Srl".
- Atteso: focus su un elemento del gruppo (× del chip o campo successivo). È il cuore del flusso "5–10 biglietti di
  fila" da tastiera: ogni azienda scelta costringe a ripartire dalla sidebar (~10 Tab).

### MINOR

1. **Titolo del documento "SeVedemo · CRM prospecting"** su tutte le pagine (A3: il marchio è "CRM personale").
   Repro: qualunque pagina, `document.title`.
2. **Esito di "Aggiungi a lista" dalla BulkBar senza la frase di orientamento** (FLOW C.3). Repro: seed →
   `/people?view=da_smistare` → seleziona Anna Bianchi e Ufficio Beta → Aggiungi a lista → lista 1. Osservato "2
   aggiunti a 'CTO manifattura Nord Italia' · 0 già presenti"; atteso "2 aggiunte a '…' · 0 già presenti. Le trovi in
   Tutte e nella lista." (manca la frase che risponde al "dove finisce" della persona; maschile al posto di "persone").
3. **Accordo singolare/plurale:** "1 senza LinkedIn: escluse." (preview Arricchisci/Analizza con una sola persona
   senza LinkedIn: `/people?q=giulia` → seleziona tutti → Arricchisci…), "1 con email svuotata a mano: escluse."
   (preview Apollo di Carlo Gentile #19 dopo aver svuotato l'email), "Anche 1 persona scartata corrisponde a 'giulia'.
   Mostrale" (scarta #20, poi `?view=da_smistare&q=giulia`). Atteso "esclusa", "Mostrala".
4. **Vista Scartate: la BulkBar non offre "Aggiungi a lista"** (SPEC B9 "In ogni vista…"; FLOW C.3: Ripristina sostituisce
   solo Scarta). Repro: `/people?view=scartate` → seleziona una persona → BulkBar = Deseleziona · Ripristina · Cambia
   stato · Arricchisci… · Analizza…. Deviazione non registrata nel log di T11.
5. **"Confluiscono" senza dettaglio** (FLOW F.3: "1 fonte (Reazione a 'Abbiamo migrato…') · … · 1 analisi (CTO
   startup IT, fit medio)"). Repro: `/people/21` → LinkedIn `…/in/giulia-neri-e2e` → Salva → Unisci… → "1 fonte · 0
   liste · 0 attività · 0 analisi" senza quale fonte.
6. **Pagina oltre l'ultima: conteggio e vuoto contraddittori, senza paginatore.** Repro: `/people?page=5` → "25 persone
   in Tutte" + "Nessuna persona."; `/inbox?source=post_comment&page=2` (redirect A4) → "2 persone in Da smistare" +
   "Nessuna persona corrisponde ai filtri." Atteso: tornare all'ultima pagina valida (o un link).
7. **Motivo di "Sincronizza interazioni" disabilitato solo nel `title`** (FLOW C.2, baseline "nessun controllo solo al
   passaggio del mouse"). Repro: `PUT /api/settings {"own_profile_url":""}` → `/people?view=da_smistare`: il bottone è
   `disabled` e "Salva prima il tuo profilo LinkedIn." non è testo visibile né `aria-describedby` (l'onboarding invece lo
   scrive).
8. **Scarta dalla scheda di chi ha una prossima azione: nessun avviso prima della conferma** (FLOW Edge "il popover di
   stato avvisa…"). Repro: seed → `/people/25` → Cambia stato → Scartato: il popover mostra solo "Nuovo → diventa
   Scartato"; l'informazione arriva dopo, nella card ("Persona scartata: la prossima azione resta, ma non compare tra le
   cose da fare.").
9. **`aria-current="page"` su link che non sono la pagina corrente:** "Annulla" in `/people/new` e "Vai a Persone" in
   `/people/9999` (match fuzzy di TanStack su `/people`); un lettore di schermo li annuncia come "pagina corrente".
10. **Focus su `body` dopo gli esiti asincroni** (baseline di focus; lezione TD-4): salvataggio fallito (E4), corsa C7
    (E8), persona dell'incontro sparita (E5), azienda sparita (E10: il messaggio non è `role=alert`, quindi nessun
    annuncio), "Resta" nel guard d'uscita (E7), 500 di Unisci (F5: focus fuori dal dialog aperto), Collega/Scollega e
    Rimuovi prossima azione in scheda, apertura di "Imposta prossima azione", Aggiungi a lista dalla BulkBar (C5).
11. **Invio nel CompanyPicker senza corrispondenze apre il pannello di creazione.** Repro: `/people/new` → Azienda
    "Zeta Srl" → Invio: "Crea l'azienda 'Zeta Srl'…" è preselezionata, quindi si apre il pannello (Nome = "Zeta Srl") invece
    di restare "solo testo" (FLOW A.2) o salvare con Invio (A.1). Salvando comunque il testo resta (`company_name` "Zeta Srl").
12. **"Svuota tutto" non toglie l'azienda portata da `?company=`.** Repro: `/companies/8` → Aggiungi persona → nome +
    email → Salva e aggiungi un'altra → Svuota tutto: la riga "… · azienda Nuvola Srl" sparisce ma il chip "Collegata:
    Nuvola Srl" resta e la persona successiva verrà collegata.
13. **"Crea e collega" nel dialog Collega non collega.** Repro: persona con azienda testo "Zeta Srl" → Collega a
    un'azienda → "Crea 'Zeta Srl' come nuova azienda" → Pagina LinkedIn → Crea e collega: toast "Azienda creata" e chip
    "Collegata: Zeta Srl" nel dialog, ma la scheda resta "Zeta Srl · non collegata" finché non si preme anche "Collega";
    chiudendo il dialog il collegamento non avviene.
14. **Messaggio di conflitto del pannello "Crea l'azienda" non si aggiorna:** dopo "Il dominio nuvola.example è già di
    'Nuvola Srl'." cambiando il sito il messaggio e "Collega quella" restano finché non si ripreme Crea e collega; il testo
    ha il prefisso "Il dominio …" rispetto al FLOW ("fabbricadigitale.it è già di '…'").
15. **Dopo "l'altra persona sparita" in Unisci il pannello resta vecchio.** Repro: F13 → Chiudi: sotto il campo c'è
    ancora "Questo profilo LinkedIn è già di Giulia Neri … Unisci Giulia Neri in questa persona…" per la #20 che non esiste
    più; riaprendo si ottiene lo stesso errore; serve premere Salva per ricalcolare (poi "già di Sara Conti").
16. **Il picker di Collega/Cambia azienda non offre "Crea …" quando ci sono risultati parziali** (FLOW "un solo picker
    d'azienda"; D3). Repro: Marco Riva #25 (testo "Beta") → Collega: solo "Beta Payroll Srl"; nel form lo stesso testo
    mostra anche "Crea l'azienda 'Beta'…". Per creare "Beta" bisogna cambiare la ricerca.
17. **Omonimi in C10: controlli con lo stesso nome accessibile.** Repro: dopo A16 (due "Sara Conti") → `/people/new` →
    nome "Sara Conti": due pannelli "Esiste già una persona con questo nome" e due checkbox "Aggiungi l'incontro a Sara
    Conti" indistinguibili per chi usa un lettore di schermo (mutuamente esclusive, ma senza ruolo/azienda/id nel nome).
18. **Polish:** nella ricerca "Collega una persona esistente" chi non ha ruolo né azienda appare come "Giulia Neri —"
    (trattino pendente; `/companies/8` → Collega una persona esistente → "devfest"); la nota "Come vi siete conosciuti"
    in timeline mostra un orario inventato ("12/09/26, 14:00", da `T12:00Z`) per un incontro che ha solo la data.

## Correzioni dopo lo smoke (2026-09-18, stesso giorno)

Ricontrollate con agent-browser sul server e2e (seed) e, dove c'è logica server, con test vitest nuovi.

| Esito | Correzione | Verifica |
|---|---|---|
| MAJOR-1 | Ricerca di Persone: un URL di profilo incollato (slash finale, query, maiuscole, id membro) si confronta anche normalizzato (`personTextCondition`); ricerca aziende: sito o pagina LinkedIn incollati confrontati per dominio / pagina normalizzati (`listCompanies`). Il pannello "Crea l'azienda" mette un URL LinkedIn nel campo Pagina LinkedIn e un sito nel campo Sito web, non nel Nome | `api-people-list`, `api-companies`; `?q=https://www.linkedin.com/in/marco-riva-e2e/` → Marco Riva #25; `…/company/ferronova-digitale-e2e/` → Ferronova; `www.nuvola.example` → Nuvola |
| MAJOR-2 | Scelta dell'azienda nel form: focus sulla × del chip; × → focus sul campo; "Crea e collega" idem | `document.activeElement` = "Togli il collegamento a Nuvola Srl", poi il combobox |
| MINOR 1 | Titolo "SeVedemo · CRM personale" | `document.title` |
| MINOR 2 | Toast "2 aggiunte a '…' · 0 già presenti" + "Le trovi in Tutte e nella lista." | codice (stesso dialog di T11) |
| MINOR 3 | "1 senza LinkedIn: esclusa", "1 con email svuotata a mano: esclusa", "Mostrala" | `no-linkedin`, `manual-data-jobs` |
| MINOR 4 | BulkBar di Scartate con **Aggiungi a lista** + **Ripristina** | `/people?view=scartate` |
| MINOR 5 | "Confluiscono" con le fonti e le analisi in parole (`moving_labels` dell'anteprima) | `api-people-identity`; "1 fonte (Reazione a 'Migrare al cloud senza fermare…') · …" |
| MINOR 6 | Pagina oltre l'ultima → ultima pagina con righe (URL sostituito) | `/people?page=5` → `/people` |
| MINOR 7 | "Serve il tuo profilo LinkedIn. Salva il profilo" visibile sotto "Sincronizza interazioni" (`aria-describedby`) | codice |
| MINOR 8 | Pannello di stato → Scartato su chi ha una prossima azione: *"Ha una prossima azione (28 set): resta, ma non comparirà più tra le cose da fare."* (in M2 diventerà "in Oggi") | `/people/25` |
| MINOR 9 | `aria-current` tolto da "Annulla" (`/people/new`) e "Vai a Persone" (`/people/9999`) | unico `aria-current` = voce Persone della sidebar |
| MINOR 10 (in parte) | Unisci: dopo il 500 focus su **Unisci**, con l'altra persona sparita su **Chiudi**; "Azienda non trovata" del form con `role="alert"` | `document.activeElement` |
| MINOR 11 | Invio nel picker senza risultati non apre "Crea …" (nel form invia); ↓ + Invio sì | "Zeta Srl" + Invio → validazione del form |
| MINOR 12 | "Svuota tutto" toglie anche l'azienda portata da `?company=` | codice |
| MINOR 13 | "Crea e collega" nel dialog Collega collega subito | #25 → azienda nuova collegata senza secondo click |
| MINOR 14 (in parte) | Il messaggio di conflitto del pannello sparisce modificando un campo; il prefisso "Il dominio …" resta (testo del server di apollo-lookalike) | codice |
| MINOR 15 | Chiudendo Unisci dopo "l'altra persona non è più nel CRM" il pannello vecchio sparisce e il focus torna sul campo | pannello assente, focus sul LinkedIn |
| MINOR 16 | Il picker di Collega offre "Crea '…' come nuova azienda" anche con risultati parziali | #25 "Beta" → "Beta Payroll Srl" + "Crea 'Beta' come nuova azienda" |
| MINOR 17 | Nome accessibile distinto per gli omonimi: "Aggiungi l'incontro a Sara Conti (CFO · Pagamenti Srl)" / "(#id)" | codice |
| MINOR 18 | Niente trattino pendente in "Collega una persona esistente"; la nota dell'incontro mostra solo la data ("12 set 2026") | `/people/21` timeline |

**Restano aperti (MINOR):** il focus dopo gli altri esiti asincroni di MINOR 10 (salvataggio fallito, corsa C7, persona
dell'incontro sparita, "Resta" del guard d'uscita, Collega/Scollega, Rimuovi prossima azione, bulk "Aggiungi a lista");
il prefisso "Il dominio …" di MINOR 14; l'avviso bulk *"3 persone selezionate hanno una prossima azione…"* (Scarta bulk è
senza conferma). Non verificabile con agent-browser: il guard d'uscita alla chiusura della scheda (`beforeunload`).
