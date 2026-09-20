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

---

# Smoke di tappa M2 (people-first-crm T27)

Collaudo con `agent-browser` della tappa **M2 — Seguire le persone** contro il server e2e (job fake, nessuna chiamata
ad Apify, Anthropic o Apollo). Contratto: `brain/specs/prospect-crm/people-first-crm/FLOW.md` (D.1–D.3 Oggi, E.1–E.5
fit tuo e prossima azione in scheda, B.1–B.3 solo da tastiera con ⌘K, H.2, G.5 "Riprova…" dal banner, Error paths,
Edge cases, Accessibilità, Testi che cambiano) e `SPEC.md` (F1–F10, G1–G6, H1–H8, I1–I5, J12). Fuori perimetro M2 (non
riportato come mancante): Connessioni, run, log, "Dettagli del run", avvisi dei run falliti in Oggi, analisi singola
come run, Impostazioni in tre sezioni.

- **Data:** 2026-09-19
- **Codice:** branch `people-first-crm`, modifiche non committate sopra `9b71233`
- **Server:** API e2e su `:8851` (`E2E_FAKE_JOBS=1`, DB scratch, chiavi finte) · Vite su `:5201` · sessione
  `agent-browser --session smoke-m2`, viewport 1280×900
- **Evidenze:** `smoke-m2/*.png` nella cartella scratch della sessione
  (`/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/007304c3-baeb-4ea8-8f74-6916cd38517b/scratchpad/smoke-m2/`)
- **Esito:** tutti i percorsi felici di M2 passano (D.1–D.3, E.1–E.5, B.1–B.3 da tastiera, H.2, touchpoint G2, H7,
  G.5); **0 BLOCKER · 0 MAJOR · 6 MINOR** (sezione "Esiti M2"). Nessun dato perso o sovrascritto, anche nei conflitti
  "cambiata altrove". Console del browser senza errori (a parte le risposte 500/409 simulate).

Id del seed usati: Paolo Ranieri **#2** (prossima azione scaduta −3 *"Richiamare per la demo"*), Sara Conti **#22**
(oggi, *"Mandare la proposta"*, senza LinkedIn), Anna Bianchi **#23** (+3 *"Follow-up dopo l'evento"*), Federico Mancini
**#18** (scartato, prossima azione a ieri), Marco Riva **#25** (+10), Marco Ferri **#3** (AI medio + fit tuo alto), Luca
Bernardi **#6** (AI medio), Davide Greco **#7**, ICP 1–3 (+ ICP 4 e 5 creati via API per Elimina ICP), lista 1. Il DB è
stato riseminato tra un blocco e l'altro; a fine smoke `seed` fresco.

### Gotcha di automazione nuovi (non bug del prodotto)

- `find role button click --name "Rimanda"` prende il trigger della riga **dietro** il dialog modale: il click cade
  fuori e chiude il dialog senza salvare. Dentro un dialog usare i ref di `snapshot -i -s '[role=dialog]'`.
- `agent-browser type` senza selettore non scrive: usare `keyboard type "…"` sul campo a fuoco.
- I toast durano 8 s (errori 20 s): per "Imposta la prossima" cliccare nello stesso giro di comandi (via `eval`).
- `eval` condivide lo scope globale tra le chiamate (`const` ripetute → SyntaxError): usare IIFE.
- Un job avviato via `curl` compare nel banner solo dopo un `reload` (pagina `hidden`: il polling si ferma).
- Latenza di ⌘K: misurarla **in pagina** (setter nativo + evento `input` e attesa del nuovo `role=status` nello stesso
  `eval`); da CLI ogni tasto aggiunge ~100 ms di overhead.

---

## D. Iniziare la giornata da Oggi (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| D1 | `open /` | Oggi + data lunga, Aggiungi persona; Da fare (scadute prima) con stato in testo · testo · persona · azienda · Fatto · Rimanda ▾; In arrivo · prossimi 7 giorni; Da smistare; Ultime persone aggiunte (10) | h1 "Oggi", "sabato 19 settembre"; **Da fare (2)**: "Scaduta · mer 16 set · Richiamare per la demo · Paolo Ranieri" poi "Oggi · Mandare la proposta · Sara Conti · Pagamenti Srl"; **In arrivo (1)** "mar 22 set · Anna Bianchi · Beta · Follow-up dopo l'evento"; "9 persone da smistare" + Apri Da smistare; 10 righe "Marco Riva · Beta · Commento · oggi"…; bottoni "Fatto: Richiamare per la demo, Paolo Ranieri"; stato in `<time datetime>`; nessun promemoria (configurazione completa) | ✓ | `d1-oggi.png` |
| D2 | **Fatto** (Invio) su Paolo | riga esce, toast "Fatto: '…' (…)" + Imposta la prossima; timeline; stato/liste invariati; focus sul Fatto della riga successiva | toast "Fatto: 'Richiamare per la demo' (Paolo Ranieri)" + **Imposta la prossima**; focus su "Fatto: Mandare la proposta, Sara Conti"; API: attività `next_action_done` body "Richiamare per la demo", `meta.on` 2026-09-16, stato `nuovo` | ✓ | `d2-fatto.png` |
| D3 | Fatto su Sara → **Imposta la prossima** dal toast | dialog "Prossima azione per Sara Conti"; Data obbligatoria + Domani · Tra una settimana; Cosa fare "es. Mandare la proposta" | dialog corretto (focus sulla data); testo senza data → "Scegli la data della prossima azione."; Tra una settimana → toast "Prossima azione impostata: sab 26 set", riga in In arrivo; dopo la chiusura focus su `body` (MINOR-2) | ✓ | `d2-imposta-prossima.png`, `d2-prossima-salvata.png` |
| D4 | **Rimanda ▾** da tastiera (trigger a fuoco, Invio, Invio) sull'ultima riga | Domani · Tra una settimana · Scegli una data…, contati da oggi; toast "Rimandata a …"; riga in In arrivo; focus sul titolo se la sezione si svuota | menu "Domani · dom 20 set", "Tra una settimana · sab 26 set", "Scegli una data…"; toast "Rimandata a dom 20 set"; riga in In arrivo; focus su h2 "Da fare (0)"; vuoto "Niente da fare oggi. Qui compaiono le prossime azioni scadute e di oggi."; Esc sul menu riporta il focus al trigger | ✓ | `d3-rimanda-menu.png`, `d3-rimandata.png` |
| D5 | Rimanda → **Scegli una data…** sulla scaduta (−3) | data scelta; data passata avvisa senza bloccare | dialog "Rimanda a una data" (default domani); 10 set → "Data passata: comparirà come scaduta." subito; 24 set → Rimanda → "gio 24 set · Paolo Ranieri" in In arrivo, focus sul Fatto di Sara | ✓ | `d3-scegli-data.png`, `d3-data-passata.png`, `d3-scegli-data-done.png` |
| D6 | Vista Persone › **Con prossima azione** | elenco completo, ordinato per prossima azione; scartate escluse | Paolo (scaduta), Sara, Anna, Marco Riva; ordinamento "Prossima azione"; Federico Mancini (scartato) assente | ✓ | `b8-con-prossima-azione.png` |
| D7 | Link della pagina | persona con origine Oggi; Apri Da smistare; Vedi tutte in Persone | `/people/22?from=%2F` → "Torna a Oggi" → `/`; `/people?view=da_smistare`; `/people?sort=added` ("Data di aggiunta") | ✓ | — |
| D8 | Sezioni vuote (reset + 1 persona) | testi neutri (H6) | "Niente da fare oggi. …", "Nessuna prossima azione nei prossimi 7 giorni.", "Niente da smistare." | ✓ | `h2-oggi-dopo-prima.png` |
| D9 | Caricamento fallito (`fail-next GET /api/today` ×2) | ErrorBox + Riprova; sidebar e ⌘K usabili | "Errore interno (e2e)." + Riprova; ⌘K si apre; Riprova → Oggi | ✓ | `err-oggi-caricamento.png` |
| D10 | `seed-bulk` (10.000/2.000) | nessun limite di righe | "Da fare (146)", "In arrivo · prossimi 7 giorni (215)", `GET /api/today` 13 ms | ✓ | `d1-oggi-bulk.png` |

## H7. Promemoria di Oggi con Nascondi

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| P1 | `PUT /api/settings` profilo e descrizione vuoti → `/` | "Da completare: …", ogni voce link + **Nascondi** (tooltip "Torna se cambia cosa manca.", nome "Nascondi il promemoria: …") | "Da completare: profilo LinkedIn ✕ Nascondi · descrizione della tua azienda ✕ Nascondi"; link `/settings#profilo`, `/settings#azienda`; `title` e nome accessibile corretti | ✓ | `h7-promemoria.png` |
| P2 | Nascondi la prima, poi l'ultima; reload | focus alla voce successiva o al titolo della pagina; resta nascosta | focus su "Nascondi il promemoria: descrizione della tua azienda", poi sull'h1 "Oggi"; la riga sparisce e resta nascosta dopo il reload (`localStorage` con la firma dell'insieme) | ✓ | — |
| P3 | Profilo ripristinato (l'insieme cambia) → reload | le voci tornano | "Da completare: descrizione della tua azienda · Nascondi" | ✓ | `h7-torna.png` |
| P4 | Onboarding (reset) | "Sotto, lo stesso promemoria 'Da completare: …' di Oggi" (H.1) | promemoria presente ma **senza Nascondi** (MINOR-6) | ✓ / ✗ | `h1-onboarding.png` |

## H.2 Primo avvio → prima persona → Oggi (reset)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| O1 | `open /` a CRM vuoto | onboarding, voce Oggi attiva | "Porta dentro le prime persone" con le tre card; `aria-current` su "Oggi" (e sul marchio: MINOR-4) | ✓ | `h1-onboarding.png` |
| O2 | Aggiungi persona → "Prima Persona" + email → Invio | la prima persona apre la sua scheda | `/people/1`, toast "Persona aggiunta: Prima Persona"; card "Fit e analisi AI": "Il fit si esprime rispetto a un ICP: crea il primo ICP per impostarlo." + Crea ICP (`/icps/nuovo`) (F9) | ✓ | `h2-prima-persona.png` |
| O3 | Voce **Oggi** in sidebar | `/` = Oggi, nessun redirect (H1) | Oggi con promemoria, sezioni vuote e "Prima Persona · Aggiunta a mano · oggi" | ✓ | `h2-oggi-dopo-prima.png` |
| O4 | CRM con una sola persona, scartata | Oggi anche se l'unica persona è scartata | `/` = Oggi | ✓ | — |

## E. Il mio fit accanto all'AI, prossima azione in scheda, Elimina ICP (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| E1 | Marco Ferri #3 | card "Fit e analisi AI" con ICP in testa; "Tuo: alto · AI: medio" | select ICP "CTO di PMI manifatturiere · analizzato"; "Tuo: alto · AI: medio", "La tua motivazione: Ci ho parlato al DevFest…", Cambia il mio fit · Rimuovi il mio fit, analisi AI sotto | ✓ | `e1-fit-tuo-ai.png` |
| E2 | Luca Bernardi #6 ("AI: medio") → **Imposta il mio fit** da tastiera | radiogroup con legend che nomina l'ICP, Alto · Medio · Basso, Motivazione (facoltativa), Salva fit | `fieldset` + legend "Il tuo fit per 'CTO di PMI manifatturiere'", `role=radiogroup` `aria-labelledby`; focus sul primo radio, Spazio = Alto, Tab → Motivazione | ✓ | — |
| E3 | `fail-next PUT /api/prospects/6/fits/1` → Salva fit | errore accanto al controllo; valori conservati | "Fit non salvato: Errore interno (e2e). I valori scelti sono ancora qui." (`role=alert`) nel form; Alto e motivazione conservati; focus su `body` (MINOR-2) | ✓ | `e-fit-errore.png` |
| E4 | Salva fit di nuovo | toast "Fit impostato: alto (tuo)"; timeline "nessuno → alto" + motivazione | tutto ✓; "Tuo: alto · AI: medio"; focus su "Cambia il mio fit" | ✓ | — |
| E5 | Cambia il mio fit (↓ = Medio) | timeline "alto → medio" | toast "Fit impostato: medio (tuo)"; timeline "Fit (tuo) per 'CTO di PMI manifatturiere': alto → medio" | ✓ | — |
| E6 | Rimuovi il mio fit | senza conferma, "Fit rimosso: vale di nuovo l'analisi AI", timeline "… → nessuno" | ✓; card "AI: medio"; focus su "Imposta il mio fit" | ✓ | — |
| E7 | F4: analisi singola di Davide Greco #7 fallita (JSON non valido, via API) + fit tuo alto | "Tuo: alto · AI: errore" con l'errore dell'AI sempre visibile | "Tuo: alto · AI: errore" + "Risposta del modello non valida (2 tentativi). Riprova tra poco." + Riprova | ✓ | `e1-tuo-ai-errore.png` |
| E8 | F1: Sara Conti #22 (senza LinkedIn né analisi) → Imposta il mio fit (↓↓ = Basso) | vale anche senza arricchimento o LinkedIn | "Fit impostato: basso (tuo)", "Tuo: basso · AI: non analizzata" | ✓ | — |
| E9 | Persone `?icp=1&sort=fit`; filtro Fit; Lista 1; Azienda 2 | colonna Fit "alto · tuo" / "medio · AI" / "non analizzata"; stessi valori nel filtro; ordinamento "Fit (tuo o AI)" | "alto · tuo" e "medio · tuo" in testa, poi "non analizzata"; filtro "Fit alto/medio/basso (tuo o AI) · Non analizzate · Analisi rifiutata · Analisi in errore · Non arricchibili"; colonna Fit anche in Lista 1 ("alto · tuo") e nella tabella Persone di Acme HR Software | ✓ | `e3-colonna-fit.png`, `e3-azienda-persone.png` |
| E10 | **Elimina ICP** (F10): ICP 4 con 3 fit tuoi; ICP 5 senza | conferma con il numero dei fit; senza fit la frase non c'è | "…Si cancellano anche i suoi riferimenti, le candidate, le analisi e i 3 fit che hai impostato per questo ICP; aziende e persone restano. Non si può annullare." → toast "ICP … eliminato", `manual_fits` delle persone senza l'ICP 4; ICP 5: "…le candidate e le analisi per questo ICP; …" (ICP 1 ha una lista: non eliminabile, invariato) | ✓ | `e5-elimina-icp-conferma.png` |
| E11 | Testata **Prossima azione** (Anna #23, Paolo #2) | stato in testo + Fatto · Rimanda ▾ · Modifica | "mar 22 set — Follow-up dopo l'evento"; "Scaduta · mer 16 set — Richiamare per la demo" con `<time datetime="2026-09-16">`; bottoni con nome completo | ✓ | `e4-testata.png` |
| E12 | Rimanda → Tra una settimana (Paolo) | contata da oggi; focus | "Rimandata a sab 26 set", focus su "Fatto: Richiamare per la demo, Paolo Ranieri" | ✓ | — |
| E13 | Fatto in scheda | "Nessuna prossima azione." + Imposta prossima azione; timeline "Prossima azione completata: …"; toast con Imposta la prossima | ✓; focus su "Imposta prossima azione" | ✓ | `e4-fatto-scheda.png` |
| E14 | Imposta prossima azione → 12 set → Salva | "Data passata: comparirà come scaduta." (non blocca); scaduta in scheda, Persone e Oggi (G3) | avviso subito sotto la data; toast "Prossima azione impostata: sab 12 set"; Oggi "Scaduta · sab 12 set" in testa; Persone "Scaduta · sab 12 set"; apertura del form con focus su `body` (MINOR-10 di M1, ancora aperto) | ✓ | `edge-data-passata-scheda.png` |
| E15 | Fatto su una prossima azione senza testo | toast "Fatto: '…' (…)" | toast "Fatto: 'prossima azione' (Paolo Ranieri)" (MINOR-5); timeline "Prossima azione completata" | ✓ / ✗ | — |

## G2. Touchpoint con blocco Prossima azione (Sara Conti #22)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| T1 | Form touchpoint | blocco **Prossima azione** vuoto con "Attuale: … Compila per sostituirla." | `fieldset` "Prossima azione", "Attuale: 19 set · Mandare la proposta. Compila per sostituirla."; senza prossima azione "Facoltativa: compila per impostarla insieme al touchpoint." | ✓ | — |
| T2 | Touchpoint con nota e blocco vuoto | nessun cambio | toast "Touchpoint registrato"; prossima azione invariata (API) | ✓ | — |
| T3 | Cosa fare "Mandare il contratto" senza data | "Scegli la data della prossima azione." | errore sotto la data, focus sulla data, touchpoint non registrato | ✓ | `g2-touchpoint-senza-data.png` |
| T4 | Tra una settimana → Registra touchpoint | touchpoint + prossima azione nello stesso passo; stato invariato | toast "Touchpoint registrato · Prossima azione: 26 set"; testata "sab 26 set — Mandare il contratto"; "Attuale: 26 set · Mandare il contratto…"; stato `nuovo`; focus su `body` (MINOR-2) | ✓ | `g2-touchpoint.png` |
| T5 | Data passata nel blocco (e nel form Aggiungi persona) | "Data passata: comparirà come scaduta." | presente subito in entrambi (in M1 compariva solo al salvataggio) | ✓ | — |

## B. Ritrovare un contatto con ⌘K, solo da tastiera (seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| K1 | Da `/lists/1?status=nuovo` → `Meta+k`, "g" | dialog "Cerca persone e aziende", cursore nel campo; "Scrivi almeno 2 caratteri." | ✓; `role=combobox` con `aria-expanded`, `aria-controls`, `aria-autocomplete=list`; messaggio anche nella live region polite | ✓ | — |
| K2 | "giu" | al più 5 per gruppo con seconda riga; Vedi tutte · Aggiungi ultima; live "N persone, M aziende" | Giulia Marchetti (headline) · Giulia Neri "CFO · Pagamenti Srl" · Giulia Neri "giulia.neri@…" (omonima distinta dall'email); "3 persone, 0 aziende"; nessuna voce attiva finché ↓ | ✓ | `b2-cmdk-giu.png` |
| K3 | ↓↓ Invio | scheda con "← <lista>" e Persone attiva | `aria-activedescendant` + `aria-selected`; `/people/20?from=…` con "Torna a CTO manifattura Nord Italia" → `/lists/1?status=nuovo`; `aria-current` su Persone e sull'ultimo segmento | ✓ | `b3-scheda-da-lista.png` |
| K4 | "devfest" → ↑↑ Invio | trova dal contesto dell'incontro; Vedi tutte → `/people?q=devfest` | Giulia Neri (a mano, contesto DevFest); `/people?q=devfest` "1 persona in Tutte" | ✓ | — |
| K5 | "mancini" (scartato) → Vedi tutte | "Scartata" come testo; hint delle scartate | "Federico Mancini · Scartata · Head of People Operations · Benefit Hub Srl"; `/people?q=mancini` → "Anche 1 persona scartata corrisponde a 'mancini'. Mostrala" | ✓ | `b2-scartata.png`, `b-vedi-tutte-scartata.png` |
| K6 | "acme" → azienda | gruppo Aziende con dominio | Carlo Gentile + "Acme HR Software Srl · acme-hr.example"; Invio → `/companies/2`, voce Aziende attiva | ✓ | — |
| K7 | "zzqq" | "Nessun risultato per 'zzqq'." sopra la sola voce Aggiungi | ✓ | ✓ | — |
| K8 | "Lucia Verdi" ↑ Invio | `/people/new?name=…` col nome | `/people/new?name=Lucia+Verdi`, Nome precompilato e a fuoco | ✓ | — |
| K9 | Esc; `Control+k` due volte; ⌘K con "Aggiungi a lista" aperto | Esc chiude e riporta il focus; seconda pressione chiude; ignorata con un altro dialog | focus tornato su "Imposta il mio fit" (scheda), sul bottone Cerca (aperto con Invio), sull'h1 di Oggi; Ctrl+K apre e chiude; con un altro dialog aperto nessun secondo dialog | ✓ | `b-esc.png`, `b-ctrlk-close.png`, `b-cmdk-ignored.png` |
| K10 | Da Oggi: ⌘K "paolo" Invio (senza ↓) | apre la prima voce; origine Oggi | `/people/2?from=%2F`, "Torna a Oggi" | ✓ | — |
| K11 | **Ricerca fallita** (`fail-next GET /api/search`) → "mar" → Tab → Riprova | "Ricerca non riuscita." + Riprova; testo conservato | `role=alert` "Ricerca non riuscita." + Riprova raggiungibile con Tab; Invio → 7 persone (5 mostrate), campo "mar" conservato e a fuoco | ✓ | `err-ricerca-fallita.png` |
| K12 | `seed-bulk` (10.000/2.000): dall'input ai risultati (in pagina, debounce compreso) | < 300 ms | rossi 121 · giu 117 · bianchi 125 · evento 123 · mar 120 ms | ✓ | — |
| K13 | Bottone in sidebar | "Cerca" con ⌘K, `aria-keyshortcuts` | "Cerca… ⌘K", `aria-keyshortcuts="Meta+K Control+K"` | ✓ | — |

## Righe d'errore ed edge case di M2

| # | Riga (FLOW) | Azione | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| X1 | Fatto/Rimanda su una prossima azione cambiata altrove (scheda) | Anna #23 aperta; `PUT /api/prospects/23/next-action {on:"2026-09-23", text:"Cambiata altrove"}` via curl; **Fatto** | toast "Attenzione: Questa prossima azione è già stata completata o cambiata: aggiorno la lista."; testata ricaricata con "mer 23 set — Cambiata altrove"; nulla sovrascritto (API); focus su `body` (MINOR-2) | ✓ | `err-cambiata-altrove-scheda.png` |
| X2 | Idem da Oggi | Oggi aperta; `POST /api/prospects/2/next-action/done` via curl; **Rimanda → Domani** su Paolo | stesso toast; Paolo esce da Da fare, la prossima azione completata altrove non viene ricreata (API `null`); In arrivo aggiornata; focus su `body` (MINOR-2) | ✓ | `err-cambiata-altrove-oggi.png` |
| X3 | Prossima azione: scrittura fallita | `fail-next POST /api/prospects/22/next-action/done` → Fatto; `fail-next PUT /api/prospects/22/next-action` → Rimanda → Domani | toast di errore "Fatto non riuscito · Errore interno (e2e)." / "Rimanda non riuscito · …"; prossima azione invariata; **non accanto al controllo**, focus su `body` (MINOR-1) | ✓ / ✗ | `err-fatto-fallito.png` |
| X4 | Fit: scrittura fallita | vedi E3 | errore nel form accanto al controllo, valori conservati | ✓ | `e-fit-errore.png` |
| X5 | Ricerca fallita | vedi K11 | ✓ | ✓ | `err-ricerca-fallita.png` |
| X6 | Scartata con prossima azione | Federico Mancini #18 (ieri) | assente da Oggi (Da fare e In arrivo) e dalla vista Con prossima azione (Scartate 1); scheda "Persona scartata: la prossima azione non compare in Oggi." | ✓ | `edge-scartata-scheda.png` |
| X7 | Portare a Scartato chi ha una prossima azione | Anna #23 → Cambia stato → Scartato | pannello "Nuovo → Scartato" con "Ha una prossima azione (23 set): resta, ma non comparirà più tra le cose da fare." (MINOR-3); Annulla | ✓ / ✗ | `edge-scarta-popover.png` |
| X8 | Data passata | Rimanda a una data, Imposta prossima azione, blocco del touchpoint, form Aggiungi persona | "Data passata: comparirà come scaduta." ovunque, non blocca | ✓ | `d3-data-passata.png` |

## G.5 "Riprova…" con preview dal banner

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| R1 | Profilo `omar-fail-once` + `POST /api/sync/interactions` via curl, reload | banner fallito con **Riprova…** (hint "Apre l'anteprima con gli stessi parametri: …") | "Errore: Sync interazioni · durata 0:01" + errore `Actor apimaestro/…` + **Riprova…** (hint in `title` e `sr-only`); toast "Sync interazioni non riuscito … Usa "Riprova…" nel banner a sinistra." | ✓ | `g5-banner-fallito.png` |
| R2 | Riprova… (`scrollintoview` + click) | `JobPreviewDialog` "Riprova: <operazione>" con conteggi, stima, blocchi; nessun job senza Avvia | "Riprova: Sync interazioni" · "Stessi parametri del job fallito: conteggi, stima e blocchi sono ricalcolati adesso." · Ultimi post letti 10 · Già sincronizzati 2 · "Costo stimato: ≈ $0,05" · avviso; focus su Annulla; `GET /api/jobs` = solo il #1 `failed` | ✓ | `g5-riprova-preview.png` |
| R3 | Tab → **Avvia** | nuovo run nel banner; il fallito resta | "In corso: Sync interazioni" → "Completato: Sync interazioni …"; job #2 `succeeded` con gli stessi `params`, #1 resta `failed` | ✓ | `g5-riprova-running.png`, `g5-riprova-ok.png` |
| R4 | `omar-fail` fallito, poi profilo vuoto → Riprova… | blocchi e Avvia disabilitato | "Il job non può partire: Salva prima il tuo profilo LinkedIn nelle Impostazioni.", Avvia `disabled` | ✓ | `g5-riprova-blocco.png` |
| R5 | Dialog aperto, sync avviato via curl, Avvia | toast "C'è già un job in corso: <kind>, <n> min fa." | "Job non avviato · C'è già un job in corso: Sync interazioni, avviato meno di un minuto fa." | ✓ | `g5-riprova-409.png` |

## Sidebar, `aria-current` e testi (A3)

| # | Controllo | Osservato | Esito |
|---|---|---|---|
| S1 | `aria-current="page"` per pagina | `/` Oggi (**+ marchio "SeVedemo CRM personale"**, MINOR-4); `/people`, viste, `?icp=1&sort=fit` → Persone + vista (in Da smistare anche il badge, che punta a quella pagina); `/people/:id`, `/people/new` → Persone + ultimo segmento; `/icps`, `/icps/1`, `/lists`, `/lists/1`, `/companies`, `/settings` corretti; `/companies/2` **anche il link all'azienda stessa** nella tabella Persone (MINOR-4) | ✓ / ✗ |
| S2 | Testo senza "prospect"/"prospects"/"Inbox" | scansione di `innerText` + `aria-label`/`title`/`placeholder` + `document.title` su `/`, `/people` (4 viste + `?icp=1&sort=fit`), `/people/{3,7,18,22}`, `/people/new`, `/icps`, `/icps/1`, `/lists`, `/lists/1`, `/companies`, `/companies/2`, `/settings`, più dialog ⌘K, "Riprova: …", "Rimanda a una data", "Prossima azione per …", conferma Elimina ICP e toast visti: **nessuna occorrenza**; titolo "SeVedemo · CRM personale"; il gruppo "Prospecting" è ammesso | ✓ |
| S3 | Sidebar | "Cerca… ⌘K" sopra "Oggi", gruppi Contatti/Prospecting, badge "9 persone da smistare" | ✓ |

---

## Esiti M2

**0 BLOCKER · 0 MAJOR · 6 MINOR.** Tutti i percorsi felici di M2 si completano, anche solo da tastiera (Fatto,
Rimanda ▾, fit, ⌘K); le righe d'errore obbligatorie esistono e non perdono dati. Nessun conflitto "cambiata altrove"
sovrascrive o ricrea una prossima azione.

### MINOR

1. **Fatto/Rimanda falliti: l'errore è solo in un toast, non accanto al controllo** (FLOW Error paths, riga "Fit,
   prossima azione, collega/scollega: scrittura fallita → Errore accanto al controllo"). Repro (seed): `curl -s -X POST
   localhost:8851/api/e2e/fail-next -H 'content-type: application/json' -d
   '{"method":"POST","path":"/api/prospects/22/next-action/done"}'` → `/people/22` → **Fatto**: toast "Errore: Fatto non
   riuscito · Errore interno (e2e)." (20 s) e nulla nella testata; stesso esito con `{"method":"PUT","path":
   "/api/prospects/22/next-action"}` → Rimanda → Domani ("Rimanda non riuscito"), e dalle righe di Oggi. Atteso:
   l'errore nella testata (o nella riga di Oggi) accanto a Fatto/Rimanda, come fa il fit ("Fit non salvato: …") e come fa
   Modifica. Classificato MINOR perché l'errore è visibile e annunciato, non ci sono valori da conservare e la prossima
   azione resta invariata; è però una deviazione dalla riga del FLOW.
2. **Focus su `body` dopo gli esiti asincroni nuovi di M2** (Accessibilità "dopo Fatto/Rimanda il focus va…", lezione
   TD-4; continua MINOR-10 di M1). Repro (seed): (a) Oggi → Fatto → **Imposta la prossima** dal toast → Tra una settimana →
   Salva prossima azione: dialog chiuso, focus su `body` (il bottone del toast non esiste più); (b) "cambiata altrove" in
   scheda (X1) e in Oggi (X2); (c) "Fit non salvato" (E3: "Salva fit" si disabilita durante l'invio); (d) Fatto/Rimanda
   falliti (X3); (e) **Registra touchpoint** riuscito (T4), anche col blocco Prossima azione; (f) Salva prossima azione in
   scheda (E14). Atteso: focus su un controllo vicino (Fatto della riga successiva / titolo della sezione in Oggi, il
   controllo che ha fallito, "Registra touchpoint" o la testata). I casi felici di Fatto/Rimanda seguono già il FLOW.
3. **Testi dello scarto con prossima azione ancora "tra le cose da fare" invece di "in Oggi"** (FLOW Edge "Scartata con
   prossima azione"; la correzione di MINOR 8 di M1 lo rimandava a M2). Repro: `/people/23` → Cambia stato → Scartato:
   *"Ha una prossima azione (23 set): resta, ma non comparirà più tra le cose da fare."*; atteso *"Ha una prossima azione
   (23 set): non comparirà più in Oggi."*. Stessa formula (letta nel sorgente, non riprodotta nel browser) nel toast di
   Scarta dalla BulkBar (`web/src/routes/people.index.tsx`: "…ma non comparirà più tra le cose da fare.") e nel pannello
   "Aggiungi l'incontro" a uno scartato (`web/src/components/DuplicatePanel.tsx`: "{nome} è tra le persone scartate: la
   prossima azione non comparirà tra le cose da fare finché non cambi lo stato."; FLOW: *"Marco Riva è scartato: la
   prossima azione non comparirà in Oggi finché non cambi lo stato."*).
4. **`aria-current="page"` su link che non sono la voce della sezione** (FLOW Architettura della sidebar: voce attiva =
   sezione; continua MINOR-9 di M1). Repro: `/` → sia "Oggi" sia il marchio "SeVedemo CRM personale" hanno
   `aria-current="page"` (un lettore di schermo annuncia due "pagina corrente" nella sidebar); `/companies/2` → nella
   tabella Persone il link "Acme HR Software Srl" della colonna Azienda / Ruolo (punta alla pagina stessa) ha
   `aria-current="page"`.
5. **Toast di Fatto senza testo:** su una prossima azione senza "Cosa fare" il toast dice *"Fatto: 'prossima azione'
   (Paolo Ranieri)"*, come se il testo fosse "prossima azione". Repro: `/people/2` → Imposta prossima azione → solo data
   → Oggi → Fatto sulla riga. Atteso una formula senza virgolette (es. *"Fatto: prossima azione di Paolo Ranieri"*); la
   timeline dice correttamente "Prossima azione completata".
6. **Promemoria dell'onboarding senza "Nascondi"** (FLOW H.1: *"Sotto, lo stesso promemoria 'Da completare: …' di
   Oggi"*; SPEC H7). Repro: `POST /api/e2e/reset` → `/`: "Da completare: profilo LinkedIn · descrizione della tua azienda ·
   un ICP" senza i bottoni Nascondi che la stessa riga ha in Oggi. Impatto basso (a CRM vuoto il promemoria serve).

**Verificati e conformi (niente da segnalare):** H1 anche con una sola persona scartata; "Rimanda conta da oggi" anche
per le scadute (−3 → Domani = dom 20 set); ⌘K entro 300 ms su 10.000/2.000; "Riprova…" senza spesa prima di Avvia, con
blocchi e con la corsa 409; F10 con e senza fit tuoi; F4 con errore dell'AI visibile; stati G3 in testo con `<time>` in
scheda, Persone e Oggi. Non verificabile con agent-browser: il ricalcolo di "oggi" su `visibilitychange`/`focus`
(`useToday`; pagine sempre `hidden`).

## Correzioni dopo lo smoke M2 (2026-09-19, stesso giorno)

Tutti e 6 i MINOR corretti e ricontrollati nel browser (server e2e :8851 + Vite :5201, sessione `t18`):

1. **Errore di Fatto/Rimanda accanto al controllo**: gli hook di `NextActionActions` fanno il toast solo per "cambiata
   altrove"; gli altri errori (`writeError`) stanno sotto i bottoni in scheda e nella riga di Oggi (`role="alert"`,
   *"Fatto non riuscito: …"* / *"Rimanda non riuscito: …"*), col focus rimasto sul bottone.
2. **Focus mai sul `body`**: i bottoni in salvataggio usano `aria-disabled` (con la scelta ignorata finché la scrittura
   è in corso) invece di `disabled`, che toglieva il focus (Fatto, Rimanda, Salva fit, Rimuovi il mio fit, Registra
   touchpoint, Salva/Rimuovi prossima azione); dopo ogni scrittura della prossima azione (anche "cambiata altrove") il
   focus torna su "Fatto" o, se non c'è più, su "Imposta prossima azione"; il dialog *"Prossima azione per …"* aperto
   dal toast lo riporta lì (o sul titolo della pagina, focalizzabile da `PageHeader`).
3. **Testi di scarto**: *"Ha una prossima azione (16 set): non comparirà più in Oggi."* (popover di stato), bulk *"… non
   comparirà più in Oggi."*, pannello "Aggiungi l'incontro" *"… non comparirà in Oggi finché non cambi lo stato."*.
4. **`aria-current` in più**: il marchio della sidebar è testo (la home è la voce Oggi); nella tabella Persone della
   scheda azienda la colonna Azienda non c'è più (tutte collegate a quell'azienda, D5).
5. **Fatto senza testo**: toast *"Fatto: prossima azione di Paolo Ranieri"*.
6. **Onboarding**: lo stesso promemoria di Oggi con **Nascondi** (voci mancanti da `setup_missing` del server).

---

# Smoke di tappa M3 (people-first-crm T36)

Collaudo con `agent-browser` della tappa **M3 — Connessioni** (T28–T35) contro il server e2e (job fake, nessuna
chiamata ad Apify, Anthropic o Apollo). Contratto: `FLOW.md` (Happy path **G.1–G.6**, le righe di Error paths su run,
log e caricamenti, gli Edge case "Run di più strumenti" e A6 sul percorso) e `SPEC.md` (**J1–J15**, **H5**). Dataset e
trigger: [README](README.md) (scenario del seed, `__fixture` compreso **`LOG_FLOOD`**, `fail-next`, `E2E_NO_APOLLO=1`).
Fuori perimetro M3 (non riportato come mancante): tutto ciò che M1 e M2 hanno già collaudato.

- **Data:** 2026-09-20
- **Codice:** branch `people-first-crm`, modifiche non committate sopra `9b71233`
- **Server:** API e2e su `:8853` (`E2E_FAKE_JOBS=1`, DB scratch, chiavi finte) · Vite su `:5203`
  (`API_URL=http://localhost:8853`) · sessione `agent-browser --session smoke-m3`, viewport 1280×900. Due riavvii
  del server e2e per `E2E_FAKE_DELAY_MS=5000` (log in diretta) e `E2E_NO_APOLLO=1` (chiave mancante), poi ripristino
  della configurazione normale.
- **Evidenze:** `smoke-m3/*.png` nella cartella scratch della sessione
  (`/private/tmp/claude-501/-Users-omardeangelis-Desktop-imparare-cose-sevedemo-tools/007304c3-baeb-4ea8-8f74-6916cd38517b/scratchpad/smoke-m3/`)
- **Esito:** tutti i percorsi di G si completano (Connessioni → strumento → run → log → "Riprova…" con preview);
  **0 BLOCKER · 1 MAJOR · 8 MINOR** (sezione "Esiti M3"). Nessuna chiave né corpo di richiesta nei log e nei
  dettagli. Console del browser pulita a fine sessione (passata finale su tutte le route di M3).

Id del seed usati (stabili dopo ogni `POST /api/e2e/seed`): run **1** Contatti Apollo *fallito* per la chiave Apollo ·
run **2** Analisi *fallita* per Anthropic ma con anche Apify tra i suoi strumenti · run **3** Sync interazioni
*completato con avvisi* · run **4** Arricchimento (Apify) **precedente al rilascio del log** (`logged: false`).
Persone: Marco Ferri **#3**, Luca Bernardi **#6**, Giulia Marchetti **#1**, Paolo Ranieri **#2**.

> **Nota di esecuzione (importante).** Durante lo smoke un'altra sessione ha modificato il codice di prodotto di M3
> (`ConnectionCard.tsx`, `FailedRunAlerts.tsx`, `RunParams.tsx`, `RunLog.tsx`, `runs/parts.tsx`, le route
> `settings.connections.*`, `src/runs/*`, `src/db/runs.ts`: mtime 03:37–03:46). Vite ha ricaricato a caldo sotto la
> sessione. **Tutti i rilievi qui sotto sono stati riverificati dopo le 03:46** su un server e2e riavviato (`:8853`,
> configurazione normale) e su un seed fresco; dove il comportamento è cambiato in corsa lo dico esplicitamente
> (es. il prefisso `config:` negli avvisi, sparito tra le 03:32 e le 03:46). Gli errori `Failed to fetch dynamically
> imported module` nella console alle 03:46 sono artefatti dell'HMR su quelle modifiche, non del prodotto.

### Gotcha di automazione nuovi (non bug del prodotto)

- Il dettaglio del run usa `retry: false` sulla query: per la riga "caricamento fallito" serve
  `fail-next … {"times": 1}` (con `times: 2` il secondo 500 se lo prende il primo **Riprova** e sembra che il
  bottone non funzioni). Per `GET /api/connections` invece servono **2** (query con retry di default).
- `find role button click --name "Riprova"` prende il bottone del **banner** invece di quello della pagina (e su
  viewport bassi il click cade fuori): usare i ref di `snapshot -i` o `eval` con `scrollIntoView()` + `click()`.
- `find role link click --name "Falliti"` ha attivato "Tutti": per i filtri conviene
  `click "a[href*='outcome=failed']"`.
- I job con `E2E_FAKE_DELAY_MS=1000` finiscono in 2–8 s: per vedere il log crescere da solo apri il dettaglio
  **nello stesso comando** che avvia il job (o riavvia il server con `E2E_FAKE_DELAY_MS=5000`).
- `kill -9` sul `pid` del job non lo interrompe (il run arriva comunque in fondo): un errore `process:` — l'unico
  non attribuibile a uno strumento — non è producibile da agent-browser.
- Il seed **non** è documentato nel README per la parte M3 (i 4 run finti): gli id 1–4 qui sopra sono stati ricavati
  da `GET /api/connections/<tool>/runs`.

## G.2 Connessioni (`/settings/connections`, seed)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| C1 | `open /settings/connections` | sottotitolo *"Gli strumenti esterni che il CRM usa, con i loro run e i log. Le chiavi si impostano nel file .env: dopo una modifica riavvia il server."* | testo esatto | ✓ | `g2-connessioni-finale.png` |
| C2 | Una card per strumento (J2) | nome, "Abilita: …", `<VARIABILE> · Configurata`, ultimo run con esito, "N run", **Vedi run** | tre `section[data-tool]` (apify, apollo, anthropic) con i tre testi "Abilita: …" del FLOW, `APIFY_TOKEN/APOLLO_API_KEY/ANTHROPIC_API_KEY · Configurata`, *"Ultimo run: oggi 03:14 · Contatti Apollo"* (data = link al dettaglio), *"1 run"* / *"3 run"*, **Vedi run** → `/settings/connections/<tool>` | ✓ | `g2-connessioni-finale.png` |
| C3 | Salute onesta di Apollo e Anthropic (J5) | riga rossa con l'errore + *"«Configurata» vuol dire solo che la chiave è presente."* | *"Ultimo run fallito: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env. Correggi APOLLO_API_KEY nel .env, riavvia il server e usa «Riprova…»."* + la frase su "Configurata" | ✓ | `g2-connessioni-finale.png` |
| C4 | Apify: run 2 fallito **per Anthropic** (J4, Edge "Run di più strumenti") | niente riga rossa sulla card di Apify | nessuna riga rossa (`health: ok` dall'API) e la riga dice *"Ultimo run: oggi 02:19 · Analisi — fallito per Anthropic, non per Apify."*; **però** l'intestazione della card porta il chip rosso **Fallito** (MINOR-1) | ✓ / ✗ | `g2-connessioni-finale.png` |
| C5 | Nessun run (`POST /api/e2e/reset`) | stato vuoto | *"Nessun run ancora."* + *"0 run"* su tutte e tre le card; pagina dello strumento *"Apify non ha ancora run."* | ✓ | — |
| C6 | `describeJobError` nelle card | messaggio leggibile | alle 03:32 la card mostrava il prefisso grezzo (*"Ultimo run fallito: config: chiave Apollo…"*); dopo le 03:46 il prefisso è ripulito e c'è il rimedio | ✓ (dopo le 03:46) | `g2-connessioni.png` (prima), `g2-connessioni-finale.png` (dopo) |

## J1 / A5 — Impostazioni in tre sezioni

| # | Azione | Atteso (SPEC/FLOW) | Osservato | Esito |
|---|---|---|---|---|
| S1 | `open /settings` | redirect a `/settings/profile` | `/settings/profile` | ✓ |
| S2 | `open /settings#profilo` e `#azienda` | redirect conservando l'ancora | `/settings/profile#profilo` (focus sul campo URL del profilo) e `/settings/profile#azienda` (focus su "Di cosa si occupa") | ✓ |
| S3 | Sotto-navigazione | Profilo e azienda · I miei post · Connessioni, con `aria-current` | `nav "Sezioni delle impostazioni"` con i tre link e `aria-current="page"` sulla sezione aperta | ✓ |
| S4 | "Configurazione" e "Ultimi job" (J1) | non esistono più | nessuna occorrenza nelle tre sezioni; nessun "prospect"/"Inbox" nei testi delle pagine di M3 | ✓ |
| S5 | `aria-current` doppio | uno solo per destinazione | su `/settings/profile` sono "pagina corrente" sia la voce **Impostazioni** della sidebar (`/settings` → redirect alla stessa pagina) sia **Profilo e azienda** (MINOR-4) | ✗ |

## G.3 Pagina di uno strumento (`/settings/connections/$tool`)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| T1 | `/settings/connections/apollo` | percorso, titolo, colonne Operazione · Avvio · Durata · Esito · Riassunto, dal più recente | *"Impostazioni › Connessioni › Apollo"*, *"Run di Apollo (1)"*, `table` con `th scope=col` e le 5 colonne, righe ordinate per avvio discendente | ✓ | `g3-run-strumento.png` |
| T2 | Filtro **Tutti · Falliti** (J6) | nell'URL | link a `?outcome=all&page=1` e `?outcome=failed&page=1`, `aria-current="page"` sul filtro attivo; con `failed` resta la sola riga fallita; reload conserva il filtro | ✓ | — |
| T3 | Etichette delle operazioni in italiano | elenco di G.3 | viste nei run reali: *Sync interazioni · Solo elenco post · Persone di un'azienda · Arricchimento (Apify) · Analisi · Analisi singola · Arricchimento aziende (Apollo) · Aziende simili (Apollo) · Contatti Apollo* | ✓ | `g3-run-strumento.png` |
| T4 | Riga che spiega l'errore di un **altro** strumento (Edge) | *"Fallito · errore di Anthropic"* | nella pagina di Apify la riga dell'Analisi ha esito **Fallito** + chip **Errore di Anthropic** | ✓ | `g3-run-strumento.png` |
| T5 | Ogni riga apre il run | link sull'operazione | `<a href="/settings/connections/runs/<id>">` | ✓ | — |
| T6 | Strumento inesistente (`/settings/connections/brave`) | *"Strumento non trovato"* + **Vai a Connessioni** | testo *"Strumento non trovato · Questo indirizzo non corrisponde a nessuno strumento del CRM."* + link a `/settings/connections` | ✓ | — |
| T7 | Colonna Riassunto dei run falliti | riassunto leggibile | l'errore grezzo con il prefisso (`actor:apimaestro/…`, `config: …`), mentre card e avvisi lo ripuliscono (MINOR-6) | ✗ | `g3-run-strumento.png` |
| T8 | Tabella e lettori di schermo | come le altre tabelle dell'app | manca il `<caption>` sr-only che hanno `ProspectTable`, `CandidatesTable`, export delle liste (MINOR-8) | ✗ | — |

## G.4 Dettaglio del run (`/settings/connections/runs/$runId`)

| # | Azione | Atteso (FLOW/J7) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| R1 | Run 1 (Contatti Apollo fallito) | Parametri leggibili · Tempi · Esito · Errore + *"Conta come fallito per: …"* · Log | *"ICP: HR tech Milano · Lista: HR tech Milano — decisori · Massimo 10 persone per azienda"*; *"Avvio 20/09/26, 03:14 · fine … · durata 4 s"*; *"Nessun esito salvato: il run non è arrivato in fondo."*; *"config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env."* + **Conta come fallito per: Apollo**; log con avvio, chiamata Apollo, errore sull'azienda e riga finale | ✓ | `g4-run-fallito.png` |
| R2 | Run 2 (Analisi fallita, strumenti Anthropic + Apify) | attribuzione al solo Anthropic | **Conta come fallito per: Anthropic**; nel log *"Apify · profilo · Marco Ferri"* | ✓ | — |
| R3 | Run di sync fallito creato nello smoke | attribuzione ad Apify | **Conta come fallito per: Apify** | ✓ | `g4-run-fallito.png` |
| R4 | Esito di un run riuscito | riassunto, conteggi, warning | riassunto in italiano + conteggi in inglese/snake_case: *"posts synced: 2 · prospects seen: 7 · skipped no url: 1"*, *"enriched: 4"* (MINOR-5) | ✗ | — |
| R5 | Parametri di run non-sync | parametri del **quel** run | un'**Analisi** mostra *"Solo i post da sincronizzare"* (con `force: false`) o *"Rilegge anche i post già sincronizzati"* (con `force: true`); un run **Persone di un'azienda** non dice **quale azienda** (`companyId` non è tra le chiavi mostrate) — MAJOR-1 | ✗ | `g6-log-in-corso.png` |
| R6 | Percorso (A6) | *"Impostazioni › Connessioni › Contatti Apollo del 18 set, 10:12"*, segmenti link tranne l'ultimo | *"Impostazioni › Connessioni › Contatti Apollo"*: manca la data e **Impostazioni** è uno `<span aria-current="page">`, non un link (due "pagina corrente" nel percorso) — MINOR-3 | ✗ | — |
| R7 | Run inesistente (`/settings/connections/runs/999999`) | *"Run non trovato"* | *"Run non trovato · Questo run non esiste (o è stato cancellato con i suoi dati)."* + **Vai a Connessioni** | ✓ | — |

## G.6 Log (J8–J11)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| L1 | Run in corso col dettaglio aperto (analisi su 6 persone) | le righe arrivano **senza ricaricare**, *"In corso: il log si aggiorna da solo."* | polling ogni 2 s: 0 → 7 → 11 righe senza `reload`, badge **In corso**, *"Il run è ancora in corso."*; a fine run le due frasi spariscono, badge **Completato con avvisi** e ultima riga *"Fine: completato con avvisi"* | ✓ | `g6-log-in-corso.png` |
| L2 | Stessa prova con `E2E_FAKE_DELAY_MS=5000` | idem | idem (7 → 11 righe in due poll) | ✓ | — |
| L3 | Righe del log (J8) | fasi, chiamate allo strumento, elementi, errori, esito | *"Avvio: Analisi singola"* · *"Apify · profilo · <persona>"* · *"Anthropic · analisi · <persona>"* · *"Analisi rifiutata dal modello · Sara Colombo"* · *"Errore su …"* · *"Fine: fallito — …"*, ognuna con l'orario in `<time>` | ✓ | `g4-run-fallito.png` |
| L4 | `__fixture: 'LOG_FLOOD'` (J11) | avviso di troncamento con le righe omesse, avvio ed esito visibili | *"Log troncato: superava le 5.000 righe. Vedi l'inizio e la fine; omesse 503 righe centrali."*, riga *"… 503 righe omesse …"* nel punto del taglio, prima riga *"Avvio: Sync interazioni"*, ultima *"Fine: completato"*; 5.000 `li` renderizzati, nessun doppione di `seq` | ✓ | `g6-log-troncato.png` |
| L5 | Run 4, precedente al rilascio | *"Log non disponibile per questo run."* | testo esatto (API: `logged: false`) | ✓ | — |
| L6 | Log dopo la fine del run (J9) | resta consultabile | riaperto il dettaglio a run concluso, le righe ci sono tutte | ✓ | — |

La persistenza del log **dopo un riavvio del server** (J9) non è verificabile sul server e2e: all'avvio azzera il DB
scratch. Le righe stanno in `run_logs` con `ON DELETE CASCADE` sul run (letto nel codice, non provato).

## G.5 "Riprova…" con preview (J12)

| # | Azione | Atteso (FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| P1 | Profilo `…/in/omar-fail-once` → **Sincronizza interazioni** dalla UI | banner e toast d'errore con **Dettagli del run** e **Riprova…** | banner *"Errore: Sync interazioni · durata 0:01"* + errore + **Dettagli del run** + **Riprova…** (hint *"Apre l'anteprima con gli stessi parametri: conteggi, stima e blocchi ricalcolati adesso."*); toast con lo stesso link | ✓ | `g5-banner-fallito.png` |
| P2 | **Riprova…** dal dettaglio del run | preview con gli stessi parametri, **nessun job avviato** | dialog *"Riprova: Sync interazioni"* con *"Stessi parametri del job fallito: conteggi, stima e blocchi sono ricalcolati adesso."*, conteggi (10 / 2), *"Costo stimato: ≈ $0,05"*, avviso; `GET /api/jobs` invariato; focus iniziale su **Annulla** | ✓ | `g5-preview.png`, `g5-retry-preview.png` |
| P3 | **Avvia** | nuovo run; il fallito resta nello storico | toast *"Sync interazioni riavviato · Nuovo run #9 con gli stessi parametri."* poi *"Completato: Sync interazioni"*; nella pagina di Apify restano sia il #8 **Fallito** sia il #9 **Completato** | ✓ | — |
| P4 | **Riprova…** con un job in corso | blocco *"C'è già un job in corso…"*, Avvia disabilitato | *"Il job non può partire: C'è già un job in corso: Analisi, avviato meno di un minuto fa."*, **Avvia** `disabled` | ✓ | `g5-blocco-job-in-corso.png` |
| P5 | **Riprova…** dal banner (J12) | stessa preview | dialog *"Riprova: Sync interazioni"* (click via `eval`: il bottone sta in fondo alla sidebar) | ✓ | — |
| P6 | Tastiera | Invio apre, Esc chiude e riporta il focus | focus su **Riprova…** → Invio → dialog con focus su Annulla → Esc → focus di nuovo su **Riprova…** | ✓ | — |
| P7 | Run completato | niente Riprova | il bottone compare solo sui run `failed` | ✓ | — |

## J13 / J15 — Analisi singola

| # | Azione | Atteso (SPEC) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| A1 | Persona *"Nadia e2e-invalid-json"* → **Arricchisci e analizza** dalla scheda | analisi fallita (JSON non valido) | errore inline nella card *"Risposta del modello non valida (2 tentativi). Riprova tra poco."* | ✓ | — |
| A2 | Il run tra quelli di Anthropic (J15) | operazione **Analisi singola** con esito e log | riga *"Analisi singola · oggi 03:54 · 3 s · Fallito"* nelle pagine di Anthropic **e** di Apify (ha arricchito prima, J3) | ✓ | — |
| A3 | Dettaglio del run (J13) | niente **Riprova…**, *"Le analisi singole si rilanciano dalla scheda della persona."* + **Apri la scheda di <nome>** | nessun bottone nella pagina; testo esatto + link a `/people/26`; **Conta come fallito per: Anthropic** | ✓ | `j13-analisi-singola.png` |
| A4 | Banner dei job | non la mostra | durante e dopo l'analisi singola il banner resta sull'ultimo job (`/api/jobs/current` → il job vero) | ✓ | — |
| A5 | "Un job alla volta" (J15) | l'analisi singola non blocca e non è bloccata | con un'**Analisi** bulk in corso, `POST /api/prospects/1/analyze` → **200**; con un'analisi singola in corso, `POST /api/sync/interactions` → **202** | ✓ | — |

## H5 + J14 — Avvisi di Oggi e "Dettagli del run"

| # | Azione | Atteso (SPEC/FLOW) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| O1 | `/` dopo il seed | una riga per strumento il cui ultimo run è fallito **per lui**, con **Vedi dettagli** | `section aria-label="Avvisi sugli strumenti"` con due righe (Apollo, Anthropic) e nessuna per Apify (il run 2 è fallito per Anthropic) | ✓ | `h5-oggi-avvisi.png` |
| O2 | Testo della riga | *"Ultimo run fallito per Apollo: Contatti Apollo, oggi 10:12 — chiave Apollo rifiutata (401)."* | *"Ultimo run fallito per Apollo: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env."*: mancano **operazione** e **orario** (MINOR-2) | ✗ | `h5-oggi-avvisi.png` |
| O3 | Sync fallito → Oggi | compare la riga di Apify | *"Ultimo run fallito per Apify: …"* + **Vedi dettagli** → `/settings/connections/runs/7` | ✓ | — |
| O4 | Un run riuscito dopo | la riga sparisce | dopo il retry riuscito la riga di Apify non c'è più (restano Apollo e Anthropic) | ✓ | — |
| O5 | **Dettagli del run** (J14) | nel banner (in corso, completato, fallito) e nel toast | banner *"In corso: Sync interazioni · in corso · 0:02 · Dettagli del run"*, *"Completato: …· Dettagli del run"*, *"Errore: … · Dettagli del run"*; stesso link nei toast d'esito | ✓ | `g5-banner-fallito.png` |
| O6 | Riga aggiornata da un'analisi singola | l'ultimo run fallito è quello | dopo l'analisi singola fallita la riga di Anthropic punta a quel run | ✓ | — |

## C.1 — Esito del sync

| # | Azione | Atteso (FLOW C.1) | Osservato | Esito |
|---|---|---|---|---|
| Y1 | Sync con "Risincronizza tutto" dalla vista Da smistare | esito con **Apri Da smistare** *e* **Dettagli del run** | banner e toast: *"Sync completato: 2 post sincronizzati · 6 reazioni e 3 commenti letti · 0 nuove persone da smistare · 7 già presenti (fonte aggiunta) · 1 senza profilo pubblico (saltati)."* + **Apri Da smistare** + **Dettagli del run** | ✓ |

## J10 — Chiavi e segreti

| # | Controllo | Osservato | Esito |
|---|---|---|---|
| K1 | `GET /api/runs/<id>` e `/log` di **tutti** i run creati (12 run: seed, sync, analisi, analisi singola, sourcing, Apollo) | nessuna occorrenza di `e2e-fake-apify-token`, `e2e-fake-anthropic-key`, `e2e-fake-apollo-key`, `x-api-key`, `authorization`, `bearer ` | ✓ |
| K2 | `GET /api/connections`, `/api/today`, `/api/jobs/current` | idem, puliti | ✓ |
| K3 | Job Apollo fallito con `apollo-badkey` (ICP rinominato) | log: *"Apollo · arricchimento aziende · 1 dominio"*, *"Errore sul lotto di 1: config: chiave Apollo rifiutata (401)…"* — nessun corpo di richiesta o risposta, solo l'operazione | ✓ |

## Chiave mancante (`E2E_NO_APOLLO=1`)

| # | Azione | Atteso (J2) | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|
| M1 | Riavvio del server con `E2E_NO_APOLLO=1` → Connessioni | *"APOLLO_API_KEY · Mancante: aggiungila al .env e riavvia il server."* | testo esatto, in rosso, sulla sola card Apollo (le altre restano "Configurata") | ✓ | `g2-apollo-mancante.png` |

## Righe d'errore (`fail-next`)

| # | Riga (FLOW Error paths) | Azione | Osservato | Esito |
|---|---|---|---|---|
| E1 | Caricamento pagina fallito — Connessioni | `fail-next GET /api/connections times:2` | ErrorBox *"Errore interno (e2e)."* + **Riprova** che al click ricarica le tre card; sidebar e sotto-navigazione usabili, ⌘K apre la ricerca | ✓ |
| E2 | Caricamento pagina fallito — dettaglio del run | `fail-next GET /api/runs/9 times:1` | stesso ErrorBox + **Riprova** che recupera il dettaglio (con `times: 2` il secondo 500 se lo prende il Riprova: la query ha `retry: false`) | ✓ |
| E3 | Log non aggiornabile durante un run | `fail-next GET /api/runs/<id>/log times:1` a run in corso | *"Log non aggiornato: nuovo tentativo tra pochi secondi."* (`role="status"`) con le 4 righe già viste al loro posto; al poll successivo riprende e arriva fino a *"Fine: completato con avvisi"* | ✓ |
| E4 | Riprova con job in corso / race 409 | vedi P4 | blocco e Avvia disabilitato | ✓ |
| E5 | Run / strumento inesistente | vedi R7 / T6 | ✓ | ✓ |

## Accessibilità e console

| # | Controllo | Osservato | Esito |
|---|---|---|---|
| X1 | Tastiera sui percorsi nuovi | Connessioni → **Vedi run** (Invio) → riga del run (link) → **Riprova…** (Invio) → dialog con focus su Annulla → Esc torna al bottone | ✓ |
| X2 | Log | `ol aria-live="off"`, orari in `<time datetime>`, esiti con prefisso testuale (Completato / Completato con avvisi / Fallito / In corso) | ✓ |
| X3 | Stato del run in `role="status"` (FLOW Accessibilità) | *"Il run è ancora in corso."* è un `<p>` senza `role`: il passaggio da "In corso" a "Completato" non viene annunciato (MINOR-7) | ✗ |
| X4 | `aria-current` | percorso: due elementi "pagina corrente" (MINOR-3); Impostazioni: sidebar + prima voce della sotto-navigazione sulla stessa destinazione (MINOR-4) | ✗ |
| X5 | Testi in italiano | tutto italiano tranne i conteggi dell'Esito (MINOR-5) e i prefissi tecnici nella colonna Riassunto (MINOR-6) | ✗ |
| X6 | Console del browser | passata finale su `/`, `/settings`, `/settings/posts`, `/settings/connections`, `/settings/connections/apify?outcome=failed`, un run, un run inesistente e uno strumento inesistente: **nessun errore né warning** (gli errori delle 03:46 sono HMR delle modifiche concorrenti) | ✓ |

---

## Esiti M3

**0 BLOCKER · 1 MAJOR · 8 MINOR.** Tutti i passi di G si completano: da Oggi o dal banner si arriva al dettaglio del
run in un clic, il log si legge (anche in diretta e troncato) e "Riprova…" apre sempre la preview prima di spendere.
Nessuna chiave nei log e nei dettagli, nessun job avviato senza preview, il run fallito resta nello storico.

### MAJOR

1. **Parametri del run: uno mancante e uno con le parole di un altro kind** (SPEC J7, FLOW G.4 *"parametri in forma
   leggibile"*). Repro (seed, server `:8853`):
   a. `curl -s -X POST localhost:8853/api/companies/2/source -H 'content-type: application/json' -d
      '{"mode":"Short","maxItems":5,"listId":1}'` → apri il run da `/settings/connections/apify`. **Atteso:** i
      parametri dicono di quale azienda sono state estratte le persone (*"Azienda: Acme HR Software Srl"*).
      **Osservato:** *"Lista: CTO manifattura Nord Italia · Ruoli: … · Località: Italia · Massimo 5 persone ·
      Profilo: Short"* — `companyId` non è tra le chiavi di `RunParams` (`web/src/components/runs/RunParams.tsx`,
      mappa `LABELS`), quindi il parametro che identifica il run sparisce. Stesso buco per
      `POST /api/companies/:id/enrich-apollo` (arricchimento Apollo di una singola azienda).
   b. `curl -s -X POST localhost:8853/api/analyze -H 'content-type: application/json' -d
      '{"prospectIds":[1,2,4,5,6,7],"icpId":1,"force":true}'` → il dettaglio dell'**Analisi** mostra *"Rilegge anche
      i post già sincronizzati"* (con `force: false`: *"Solo i post da sincronizzare"*). **Atteso:** il testo del
      kind (*"Rianalizza anche chi è già analizzato"* / *"Solo chi non è ancora analizzato"*). `force` e `postsOnly`
      sono etichettati una volta sola per tutti i kind. Si vede anche sul run **2** del seed e su ogni **Analisi
      singola** (*"… · Solo i post da sincronizzare · Arricchisce prima di analizzare"*).
   Impatto: la pagina che deve spiegare *cosa ha fatto* un run dice il falso su un parametro e ne nasconde un altro;
   è la superficie su cui si decide se rilanciare (J12). Fix piccolo (mappa per kind), nessun dato perso.

### MINOR

1. **Chip rosso "Fallito" sulla card di uno strumento che non ha fallito** (SPEC J4/J5, FLOW Edge *"Run di più
   strumenti"*: *"negli altri la riga dice «Fallito · errore di Anthropic» e non accende … la riga rossa di
   Connessioni"*). Repro: seed → `/settings/connections`: la card **Apify** ha in testa
   `<span class="bg-red-100 text-red-800">Fallito</span>` mentre la riga sotto dice *"Ultimo run: oggi 02:19 ·
   Analisi — fallito per Anthropic, non per Apify."* e la riga rossa (giustamente) non c'è. La lettera del FLOW è
   rispettata (niente box rosso, niente avviso in Oggi), ma il colpo d'occhio dice "Apify è rotto". Atteso: esito
   neutro (o *"Fallito per Anthropic"*) quando `failed_tools` non contiene lo strumento della card
   (`web/src/components/runs/ConnectionCard.tsx`, `<Outcome outcome={last.outcome} />`).
2. **Avviso di Oggi senza operazione né orario** (SPEC H5, FLOW D.1/G.1). Repro: seed → `/`: *"Ultimo run fallito
   per Apollo: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env."*; atteso *"Ultimo run fallito per
   Apollo: **Contatti Apollo, oggi 03:14 —** chiave Apollo rifiutata (401)."* (`FailedRunAlerts.tsx` stampa solo
   `run.error`). Senza operazione e ora, due run falliti dello stesso strumento sono indistinguibili prima di
   aprire il dettaglio.
3. **Percorso dei nuovi dettagli: "Impostazioni" non è un link, è marcato "pagina corrente", e manca la data del
   run** (FLOW A6: *"segmenti link tranne l'ultimo"*, *"Impostazioni › Connessioni › Contatti Apollo del 18 set,
   10:12"*). Repro: `/settings/connections/runs/1` → `nav[aria-label="Percorso"]`: `<span aria-current="page">
   Impostazioni</span> › <a>Connessioni</a> › <span aria-current="page">Contatti Apollo</span>`. Due "pagina
   corrente" nello stesso percorso e un segmento non cliccabile; le route passano `{ label: 'Impostazioni' }` senza
   `to` (`settings.connections.$tool.tsx`, `settings.connections.runs.$runId.tsx`).
4. **Due `aria-current="page"` sulla stessa destinazione in Impostazioni** (continua il MINOR-4 di M2). Repro:
   `/settings/profile` → la voce **Impostazioni** della sidebar (`href="/settings"`, che redirige proprio lì) e
   **Profilo e azienda** della sotto-navigazione sono entrambe "pagina corrente". Il FLOW vuole `aria-current` sulla
   sezione anche nei dettagli, quindi la scelta è difendibile; resta che un lettore di schermo annuncia due volte la
   stessa pagina.
5. **Conteggi dell'Esito in inglese** (J7 *"esito (riassunto, conteggi, warning)"*; AGENTS.md: copy in italiano).
   Repro: un run di sync → `/settings/connections/runs/<id>`: *"posts: 2 · posts synced: 2 · reactions: 6 ·
   comments: 3 · prospects seen: 7 · skipped no url: 1"*; un arricchimento: *"enriched: 4"*. Sono le chiavi di
   `result.counts` con gli underscore sostituiti da spazi.
6. **Errori grezzi nella colonna Riassunto della tabella dei run.** Repro: `/settings/connections/apify` → la riga
   fallita mostra *"actor:apimaestro/linkedin-profile-posts: Impossibile leggere i post di …"*, e quella dell'analisi
   *"actor:claude-opus-5: …"*, mentre la card di Connessioni e l'avviso di Oggi ora ripuliscono il prefisso con
   `describeJobError`. Incoerenza di lettura tra le tre superfici (nel **dettaglio** il prefisso è invece voluto,
   FLOW G.4).
7. **Stato del run non annunciato** (FLOW Accessibilità del log: *"stato del run in `role="status"`"*). Repro: apri
   il dettaglio di un run in corso: *"Il run è ancora in corso."* è un `<p>` senza `role`; quando il run finisce, il
   badge passa a **Completato** e la frase sparisce senza che niente venga annunciato. Il log (`aria-live="off"`) e
   *"Log non aggiornato: …"* (`role="status"`) sono invece a posto.
8. **Tabella dei run senza `<caption>` sr-only.** Repro: `/settings/connections/apollo` → `main table` non ha
   `caption` (ce l'hanno `ProspectTable`, `CandidatesTable` e la tabella degli export delle liste). Per chi usa un
   lettore di schermo la tabella arriva senza nome.

**Verificati e conformi (niente da segnalare):** i tre testi *"Abilita: …"* e il sottotitolo di Connessioni parola per
parola; `Configurata` / `Mancante: aggiungila al .env e riavvia il server.`; *"Nessun run ancora."* e *"Apify non ha
ancora run."*; ordinamento dei run dal più recente e filtro Falliti nell'URL; attribuzione dell'errore sui tre casi
(Apollo, Anthropic con Apify tra gli strumenti, Apify); *"Conta come fallito per: …"*; log in diretta, troncato a
5.000 righe e assente sui run precedenti al rilascio; "Riprova…" da dettaglio, banner e toast, con blocchi, senza
spesa prima di Avvia e con il fallito che resta nello storico; J13 e J15 in tutti e due i versi; J14 sui tre stati
del banner e nei toast; C.1; J10 su 12 run.

**Non verificabile con agent-browser / sul server e2e:** la riga d'avviso di un run **non attribuibile** (*"… per
Apify e Anthropic"*) e la frase *"L'errore non nomina uno strumento: conta per …"* del dettaglio — servirebbe un
errore `process:` e `kill -9` sul pid del job non lo produce (il run arriva in fondo); il codice le implementa
(`FailedRunAlerts.tsx`, `settings.connections.runs.$runId.tsx:98`). La persistenza del log **dopo un riavvio del
server** (J9): il server e2e azzera il DB all'avvio.

## Correzioni dopo lo smoke M3 (2026-09-20, stesso giorno)

Tutti i rilievi sono stati corretti e ricontrollati nel browser (sessione `t28`, e2e `:8852` + Vite `:5202`, seed
fresco). Nessuno ha richiesto modifiche allo schema o alle API.

| # | Rilievo | Correzione | Verifica |
|---|---|---|---|
| MAJOR-1 | Parametri: `companyId` assente, `force` con le parole del sync in ogni kind | `RunParams` riceve il `kind`: `companyId` → *"Azienda: <nome>"* (una query sola, solo se il run ne ha una) e le opzioni che cambiano significato prendono le parole del loro kind (`force` per l'analisi = *"Rianalizza anche chi è già analizzato"*) | run "Persone di un'azienda" → *"Azienda: Ferronova Digitale Srl · Lista: … · Massimo 5 persone · Profilo: Short"*; analisi con `force: true` → *"Rianalizza anche chi è già analizzato"* |
| MINOR-1 | Chip rosso "Fallito" sulla card di uno strumento che non ha fallito | chip neutro *"Fallito per Anthropic"* quando `failed_tools` non contiene lo strumento della card | card Apify: *"Fallito per Anthropic"* in testa, riga di spiegazione sotto, nessun box rosso |
| MINOR-2 | Avviso di Oggi senza operazione né orario | la riga ora è *"Ultimo run fallito per Apollo: Contatti Apollo, oggi 03:30 — chiave Apollo rifiutata (401)…"* | due avvisi in Oggi con operazione, ora ed errore ripulito |
| MINOR-3 | Percorso: "Impostazioni" non cliccabile e marcato "pagina corrente", senza data del run | primo segmento → `/settings/profile`, ultimo segmento con la data (*"Persone di un'azienda · oggi 04:06"*) | `nav[aria-label="Percorso"]` con **un solo** `aria-current` |
| MINOR-4 | Due `aria-current="page"` sulla stessa destinazione in Impostazioni | la voce della sidebar resta evidenziata per tutta la sezione ma senza `aria-current`: la pagina corrente la marca la sotto-navigazione | `/settings/posts`: un solo `aria-current` ("I miei post"), voce "Impostazioni" comunque evidenziata |
| MINOR-5 | Conteggi dell'esito in inglese | `countLabel` traduce le chiavi di `result.counts` dei sette kind (`contacts_*` con il prefisso *"contatti:"*), le sconosciute restano com'erano | *"persone lette: 3 · persone nuove: 2 · aggiunte alla lista: 3"* |
| MINOR-6 | Errori grezzi nella colonna Riassunto | la colonna usa `describeJobError` come card e avvisi (nel dettaglio il prefisso resta, FLOW G.4) | *"ANTHROPIC_API_KEY non valida o senza permessi…"* senza `config:` |
| MINOR-7 | Stato del run non annunciato | l'esito nel dettaglio è in `role="status"` | `role="status"` sull'esito, il log resta `aria-live="off"` |
| MINOR-8 | Tabella dei run senza `caption` | `<caption class="sr-only">Run di Apify, dal più recente</caption>` (col filtro quando è attivo) | caption presente su entrambe le viste |

Corretto anche, dal passaggio `simplify` fatto in parallelo: l'errore delle card di Connessioni e degli avvisi di
Oggi si legge come nel banner (etichetta, messaggio e rimedio invece del prefisso `config:`), le chiavi vengono
oscurate **quando l'esito si salva** (quindi anche nel banner e nei toast, non solo nelle API dei run), gli orari dei
run usano le date condivise (*"oggi"*, *"ieri"*, *"18 set"*) e si riallineano a mezzanotte come il resto del CRM.
