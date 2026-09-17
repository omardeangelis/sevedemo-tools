# Smoke end-to-end del CRM (crm-foundation T18)

Scenario ripetibile con `agent-browser` contro il server e2e (job fake, nessuna chiamata ad Apify o a
Claude): il percorso completo a DB vuoto (FLOW A → G) e i percorsi non felici del FLOW. È il collaudo a
livello di prodotto: ogni passo ha un'**azione**, un'**asserzione testuale** e un file di **evidenza**.
Server, dataset e trigger: [README](README.md). Attriti e bug trovati:
`brain/tech-debt/prospect-crm/crm-foundation.md`.

Ultima esecuzione: 2026-09-16 (T18), tutti i passi **passati**; console senza `error`; CSV con l'header atteso.

## Precondizioni e comandi

```bash
npm --prefix web run build                         # la SPA servita dal server e2e è web/dist
UI_PORT=8831 npm run e2e:server                    # terminale a parte; DB scratch azzerato all'avvio
curl -s -X POST localhost:8831/api/e2e/reset       # DB vuoto (NON il seed) per il percorso principale

ab() { agent-browser --session t18 "$@"; }
ab open http://localhost:8831/ && ab set viewport 1280 1000   # viewport alta: niente click sotto la piega
ab console --clear && ab errors --clear
```

Evidenze in una cartella scratch come `t18-*.png` (+ `t18-export.csv`). A fine sessione: `ab console`,
`ab errors` (vuoti), `ab close`, stop del server.

Per le sezioni con blocchi servono riavvii del server (ogni riavvio azzera il DB):
`E2E_NO_APIFY=1 E2E_NO_ANTHROPIC=1 UI_PORT=8831 npm run e2e:server` e
`E2E_FAKE_DELAY_MS=20000 UI_PORT=8831 npm run e2e:server`, seguiti da `POST /api/e2e/seed`.

### Gotcha di automazione (non bug del prodotto)

- Lo scroll è dentro `main`: un elemento scrollato sopra la viewport non si clicca (`ab click` fallisce o
  colpisce altro). Usa `ab eval "window.scrollTo(0,0)"`, `ab open <url>` o un selettore per `href`.
- `ab find role link click --name "…"` e `ab find label "…" fill ""` a volte non trovano/non svuotano:
  preferisci i ref di `ab snapshot -i` o `ab fill '<css>' ""`.
- `visibilityState=hidden`: le animazioni di chiusura dei dialog finiscono solo dopo uno `ab screenshot`.
- Il banner **non scopre** un job avviato fuori dalla pagina (curl, `eval fetch`, altra scheda) finché non
  ricarichi o navighi: il polling parte solo se il job in cache è `running` (vedi tech-debt TD-10). Dopo
  un avvio via `eval fetch` fai `ab reload`.
- `ab console` cattura `console.*` ed errori di pagina, **non** le righe di rete "Failed to load resource"
  (i 4xx/5xx attesi dei percorsi di errore inline).

## A. Percorso completo a DB vuoto

| # | Azione | Asserzione testuale | Evidenza |
|---|---|---|---|
| 1 | `ab open /` | h1 "Il tuo CRM di prospecting"; "PASSO 1 · DA FARE"; "Sincronizza le interazioni ai miei post" e "Aggiungi un'azienda e cerca le persone" `[disabled]` con hint "Salva prima il tuo profilo LinkedIn." / "Crea prima un ICP: le persone finiscono in una lista dell'ICP." | `t18-01-onboarding.png` |
| 2 | "Apri Impostazioni" → URL profilo `https://example.com/omar` → "Salva profilo" | `role=alert` + `aria-invalid`: "Inserisci l'URL pubblico del tuo profilo, es. https://www.linkedin.com/in/tuo-nome/"; `GET /api/settings` → `own_profile_url: null` | `t18-02-profile-invalid.png` |
| 3 | URL `https://www.linkedin.com/in/Omar-Smoke/` → Salva; Nome, "Di cosa si occupa", "Cosa offri" → "Salva azienda" | toast "Profilo salvato" e "Azienda salvata"; "Salvato come https://www.linkedin.com/in/omar-smoke" (slug minuscolo); "Sincronizza interazioni" abilitato | `t18-03-settings-saved.png` |
| 4 | ICP → "Nuovo ICP" (`/icps/nuovo`): nome "CTO PMI manifatturiere", descrizione, ruoli `CTO` ⏎ `Head of Engineering` ⏎, settore, località `Italia`, dimensione, pains → "Crea ICP" | redirect `/icps/1`; "2 ruoli target · 0 liste · 0 aziende di riferimento"; chip "Rimuovi ruolo CTO", "Rimuovi ruolo Head of Engineering"; "Nessuna azienda di riferimento. Aggiungi le aziende…" | `t18-04-icp-created.png` |
| 5 | Nav → `/` | "PASSO 1 · FATTO" con "linkedin.com/in/omar-smoke"; "PASSO 2 · FATTO" con "CTO PMI manifatturiere · 2 ruoli"; passo 3 abilitato | `t18-05-onboarding-step3.png` |
| 6 | "Sincronizza le interazioni ai miei post" | dialog "Sincronizza interazioni": "Profilo: linkedin.com/in/omar-smoke", "Stima: non disponibile al primo sync.", warning "Prima sincronizzazione… 10 post × 300 reazioni = 3000 reazioni (≈ $15)…", bottone "Aggiorna solo l'elenco dei post (≈ $0,05)", "Avvia sync" abilitato | `t18-06-sync-preview.png` |
| 7 | "Aggiorna solo l'elenco dei post" | banner "In corso: Sync interazioni"; toast "Elenco post aggiornato: 2 post letti (2 nuovi). Nessuna interazione letta: riapri…" | `t18-07-postsonly-running.png` |
| 8 | Riapri il dialog Sync | "Post già sincronizzati: 0 (saltati) · Da sincronizzare: 2 (2 nuovi, 0 con sync scaduto)."; "Stima: fino a ~6 reazioni e ~3 commenti (limite 300 reazioni per post)."; "Costo stimato: ≈ $0,10" | `t18-08-sync-preview-estimate.png` |
| 9 | "Avvia sync" | banner `role=status` "In corso: Sync interazioni · in corso · 0:00" | `t18-09-sync-running.png` |
| 10 | Attendi l'esito (~2 s) | toast persistente "Sync completato: 2 post sincronizzati · 6 reazioni e 3 commenti letti · 7 nuovi prospect in Inbox · 1 senza profilo pubblico (saltati)." + link "Apri Inbox"; `/` reindirizza a `/inbox` | `t18-10-sync-outcome-toast.png` |
| 11 | "Apri Inbox" (**tdd_target**) | "7 da triagiare · Ultimo sync: adesso"; 7 righe; ≥1 riga con fonte `aria-label="reazione"`; Giulia Marchetti = **una** riga con "reazione" + "commento" | `t18-11-inbox-after-sync.png` |
| 12 | Spunta "Seleziona Luca Bernardi" e "Seleziona Marco Ferri" | region "Azioni sui selezionati": "2 selezionati", Deseleziona · Aggiungi a lista · Scarta · Analizza… · Arricchisci…; checkbox di header `aria-checked="mixed"` | `t18-12-inbox-bulkbar.png` |
| 13 | "Aggiungi a lista" → "Nessuna lista: creane una" → nome "CTO manifattura Nord (smoke)", ICP preselezionato → "Crea lista" | radio "CTO manifattura Nord (smoke) 0 persone" `checked`; bottone "Aggiungi 2 a 'CTO manifattura Nord (smoke)'" | `t18-13-addtolist-created.png` |
| 14 | Conferma | toast "2 aggiunti a 'CTO manifattura Nord (smoke)' · 0 già presenti · lista creata" + "Apri lista"; Inbox "5 da triagiare" (Luca e Marco spariti) | `t18-14-inbox-after-add.png` |
| 15 | "Apri lista" | `/lists/1`: "ICP: CTO PMI manifatturiere · 2 persone · arricchiti 0/2 · analizzati 0/2 · con email 0/2"; chip "Nuovo 2" | `t18-15-list-2-members.png` |
| 16 | `/icps/1` → "Aggiungi da URL": `https://www.linkedin.com/company/ferronova-digitale-e2e/`, esito Vinta, nota → "Aggiungi riferimento" | "Aziende di riferimento (1)" con "linkedin.com/company/ferronova-digitale-e2e", esito "Vinta" e nota; toast "… aggiunta alle aziende di riferimento · Esito: Vinta · nuova azienda in Aziende"; "Elimina ICP" disabilitato: "Impossibile eliminare l'ICP: ha 1 lista (contano anche le archiviate)." | `t18-16-icp-reference-company.png` |
| 17 | Aziende → azienda → "Estrai persone" → radio lista "CTO manifattura Nord (smoke)" | dialog "Cerca persone in ferronova-digitale-e2e"; prima della scelta blocker "Scegli la lista di destinazione." e Avvia disabilitato; dopo: chip "Rimuovi ruolo CTO", "Rimuovi ruolo Head of Engineering", "Rimuovi località Italia"; "Short — nome, headline, ruolo (≈ $0,22)"; "Costo stimato: ≈ $0,22"; "Avvia ricerca" abilitato | `t18-17-sourcing-preview.png` |
| 18 | "Avvia ricerca" | banner "In corso: Sourcing da azienda"; toast "Sourcing ferronova-digitale-e2e completato: 3 persone lette · 3 aggiunte a 'CTO manifattura Nord (smoke)' (2 nuove, 1 già in archivio)." | `t18-18-sourcing-outcome.png` |
| 19 | "Apri lista" | 5 righe: Elena Rota e Stefano Villa "dipendente"; Giulia Marchetti "reazione, commento, dipendente" (stessa persona, 3 fonti); `GET /api/inbox` → 4 (Giulia uscita dall'Inbox) | `t18-19-list-after-sourcing.png` |
| 20 | "Sulla lista: Analizza…" | "Analisi per ICP: CTO PMI manifatturiere"; "5 nella lista · 5 da arricchire prima · 5 da analizzare"; "Costo stimato: ≈ $0,15 · Modello: claude-opus-5"; warning "Prezzo per profilo non configurato (PRICE_PROFILE_DETAIL_USD)…" | `t18-20-analyze-preview.png` |
| 21 | "Avvia analisi" | banner "In corso: Analisi"; toast "Analisi completata: 5 analizzati · 5 arricchiti prima."; header "arricchiti 5/5 · analizzati 5/5 · con email 2/5"; fit Giulia `alto`, gli altri `medio` | `t18-21-analysis-outcome.png` |
| 22 | Link "Giulia Marchetti" (`/prospects/1?list=1`) | "Fonti (3)"; About ed esperienze; "Fit alto · claude-opus-5"; RIASSUNTO; ANGOLI DI APERTURA 1. "La linea ferma due giorni", 2. "Il quarto stabilimento", 3. "Un team dati piccolo", ognuno con "Copia"; timeline "Analisi AI" + "Arricchimento" | `t18-22-prospect-analysis.png` |
| 23 | TouchpointForm: canale DM LinkedIn (default), "In uscita", testo "Ciao Giulia, …", "Nuovo stato" = Contattato → "Registra touchpoint" | toast "Touchpoint registrato · Stato: Contattato"; header STATO "Contattato"; timeline in cima "Touchpoint · DM LinkedIn · in uscita … Ciao Giulia…" + "Stato: Nuovo → Contattato", entrambe con chip lista | `t18-23-touchpoint-status.png` |
| 24 | `/lists/1` → "Sulla lista: Esporta…" | "Ambito: Tutta la lista (5)"; "Solo con email" `checked`; "Segna come 'contattato'…" non spuntato; "Verranno esportati 2 prospect (3 senza email esclusi)."; bottone "Esporta 2 prospect" | `t18-24-export-dialog.png` |
| 25 | `ab download <ref "Esporta 2 prospect"> t18-export.csv` | toast "2 esportati · CSV scaricato"; "Export precedenti": "Export #1 · Tutta la lista · solo con email · 2 · Scarica di nuovo"; timeline di Giulia "Esportato (lista CTO manifattura Nord (smoke), export #1)" | `t18-25-export-done.png`, `t18-export.csv` |
| 26 | Verifica del CSV (`python3 csv`) | header **esatto** `full_name,first_name,last_name,email,company,title,linkedin_url,location,status,list,icp,fit,summary,angle_1,angle_2,angle_3,last_touchpoint_at,sources`; 2 righe (Giulia `Contattato`, fit `alto`, 3 angoli, `last_touchpoint_at` valorizzato; Marco `Nuovo`, `medio`); identico a `GET /api/exports/1.csv` | `t18-export.csv` |
| 27 | `ab console` · `ab errors` | vuoti | — |

## B. Percorsi non felici

Stesso DB del percorso A, salvo dove indicato.

| # | Percorso (FLOW) | Azione | Asserzione testuale | Evidenza |
|---|---|---|---|---|
| U1 | Sync a 0, esito neutro (B.4) | Impostazioni → "Sincronizza interazioni" → "Avvia sync" | preview "Post già sincronizzati: 2 (saltati) · Da sincronizzare: 0…" + warning "Tutti i post noti sono già sincronizzati…"; toast bianco/neutro "Nessun post da sincronizzare: i 2 post sono già sincronizzati. Usa 'Risincronizza tutto' per rileggerli." senza "Apri Inbox"; nessun `role=alert` in pagina | `t18-26-sync-zero-neutral.png` |
| U2 | Actor fallisce + Riprova (errore) | profilo `https://www.linkedin.com/in/omar-fail/` → Salva → Sync → "Avvia sync" | banner rosso "Errore: Sync interazioni … Actor apimaestro/linkedin-profile-posts: Impossibile leggere i post di https://www.linkedin.com/in/omar-fail (errore simulato…). Nessun dato modificato." + "Riprova"; toast "Errore: Sync interazioni non riuscito … Usa "Riprova" nel banner a sinistra."; "Ultimi job" con "Riprova job #6" | `t18-27-sync-failed-banner.png` |
| U3 | Riprova = nuovo job, stessi params | "Riprova" nel banner | job #7 `failed` con params identici `{force:false, postsOnly:false}` (il profilo fallisce ancora) | `t18-28-sync-retry-failed-again.png` |
| U4 | Riprova che riesce | ripristina `…/in/omar-smoke/`; `ab eval "fetch('/api/sync/interactions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({__fixture:'FAIL_ONCE'})}).then(r=>r.status)"` → `202`; `ab reload`; "Riprova" | banner errore per `omar-smoke`, poi job #9 `succeeded` con `__fixture:'FAIL_ONCE'` e banner "Completato: Sync interazioni" | `t18-29-fail-once-banner.png`, `t18-30-fail-once-retry-ok.png` |
| U5 | Prospect in 2 liste, stato globale (F.1, Edge) | nuovo ICP "Responsabili IT logistica" (ruolo Head of Engineering); `/prospects/1?list=1` → "Aggiungi a lista" → "+ Crea nuova lista" "Logistica Nord (smoke)" sotto il 2° ICP → Aggiungi | toast "Aggiunto a 'Logistica Nord (smoke)'"; header: un solo STATO "Contattato", LISTE con 2 badge; nota "Lo stato è unico per persona: cambiarlo qui vale in tutte le liste (CTO manifattura Nord (smoke), Logistica Nord (smoke))."; `/lists/2`: Giulia "Contattato", fit "— non analizzato" (altro ICP), chip "Contattato 1" | `t18-31-prospect-addtolist-dialog.png`, `t18-32-prospect-two-lists.png`, `t18-33-list2-global-status.png` |
| U6 | Inbox con 2 ICP → `IcpPickerDialog` (H.1) | `/inbox`: filtro "ICP: scegli per il fit" visibile, "Fit: scegli prima l'ICP" disabilitato; seleziona Davide Greco, Chiara Lombardi, Sara Colombo → "Analizza…" | dialog "Analizza con l'AI: scegli l'ICP": 2 radio (nome + descrizione) **nessuno** `checked`, "Continua" `[disabled]`; scelto il 1° → "Analisi per ICP: CTO PMI manifatturiere · 3 selezionati · 3 da arricchire prima · 3 da analizzare · ≈ $0,09" | `t18-34-icp-picker.png`, `t18-35-inbox-analyze-preview.png` |
| U7 | Analisi bulk con refusal / errore / non arricchibile (E.4) | "Avvia analisi" | toast warning "Analisi completata: 0 analizzati · 2 arricchiti prima · 1 rifiutato dal modello · 1 errore · 1 non analizzabile (profilo senza dati)." + 2 avvisi; righe: Davide `errore`, Chiara `non arricchibile`, Sara `rifiutata` (tooltip "Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano.") | `t18-36-inbox-analysis-states.png`, `t18-37-fit-tooltip-refusal.png` |
| U8 | Descrizione azienda vuota → warning in preview (E.3) | Impostazioni: svuota "Di cosa si occupa" (`ab fill 'textarea[id$="company_description"]' ""`) → Salva (server `company_description: null`, nota "Descrizione azienda vuota: gli angoli AI saranno meno mirati."); Inbox → Paolo Ranieri → Analizza… → 2° ICP → Continua | warning "Descrizione della tua azienda vuota: angoli meno mirati."; Avvia → Inbox fit "basso · Responsabili IT logistica" | `t18-38-analyze-preview-empty-description.png`, `t18-39-inbox-fit-basso.png` |
| U9 | Refusal sull'analisi singola (Error paths) | `/prospects/<Sara>` → AnalysisCard "Riprova" | `aria-busy` + "Sto analizzando…"; poi `role=alert` "Il modello ha rifiutato di analizzare questo profilo. Puoi riprovare o scrivere il messaggio a mano."; nessun "ANGOLI DI APERTURA"; timeline "Analisi AI non riuscita"; API `state: 'rifiutata'`, `latest: null` | `t18-40-single-refusal.png` |
| U10 | Scarta → Mostra scartati → Ripristina (C.3) | Inbox: seleziona Chiara → "Scarta"; "Mostra scartati"; seleziona → "Ripristina" | toast "… Li ritrovi con "Mostra scartati"."; URL `?status=scartato` con Chiara "Scartato"; toast "1 ripristinato"; stato API `nuovo` | `t18-44-scarta.png` |
| U11 | Sync parziale (B.4) | `ab eval "fetch('/api/sync/interactions',{…body:JSON.stringify({__fixture:'PARTIAL', force:true})})"` → `ab reload` | toast "… · 1 post in errore (vedi 'I miei post')."; riga del 2° post "Errore · Actor apimaestro/linkedin-post-comments-…: errore simulato… · Il prossimo sync lo riprende." (nessun retry per post) | `t18-45-post-partial-no-retry.png` |
| U12 | Sourcing a zero (D.3) | Aziende → "Aggiungi da URL" `https://www.linkedin.com/company/acme-empty` → "Estrai persone" → lista → "Avvia ricerca" | toast neutro "Nessuna persona trovata in acme-empty con ruoli CTO, Head of Engineering. Amplia i ruoli o togli la località." (solo chiudi); "Ricerche di persone (1)": "Nessun risultato … Riprova con altri filtri" | `t18-46-sourcing-zero-toast.png` |
| U13 | Blocchi di configurazione (Error paths) | riavvio con `E2E_NO_APIFY=1 E2E_NO_ANTHROPIC=1` + seed; Sync, Lista → Analizza…/Arricchisci…; dettaglio Luca → "Arricchisci e analizza" | "Il job non può partire: APIFY_TOKEN mancante nel .env — nessun job avviato." + "Avvia sync" `[disabled]`; analisi: "ANTHROPIC_API_KEY mancante nel .env — nessuna analisi avviata." + "APIFY_TOKEN mancante…: 2 prospect vanno arricchiti prima dell'analisi…" + Avvia `[disabled]`; enrich idem; singola → alert "Analisi non avviata: ANTHROPIC_API_KEY mancante…" | `t18-48-blocker-apify-sync.png`, `t18-49-blocker-anthropic-analyze.png`, `t18-50-single-analyze-no-key.png` |
| U14 | Job già in corso + analisi singola durante un job | riavvio con `E2E_FAKE_DELAY_MS=20000` + seed; `curl -X POST /api/sync/interactions -d '{"force":true}'`; `ab reload`; apri Sync. Poi `curl -X POST /api/lists/1/analyze` e subito "Arricchisci e analizza" su Paolo Ranieri | "C'è già un job in corso: Sync interazioni, avviato meno di un minuto fa." + "Avvia sync" `[disabled]`; analisi singola `aria-busy` "Sto analizzando… Analisi in corso… può richiedere fino a un minuto, fino a tre se serve anche l'arricchimento…" → fit `basso` mentre il job bulk (#2) è `running` (arricchimento 16:04:50 dentro 16:04:24–16:05:05). Nota: il sync fake dura una sola latenza (~20 s): apri il dialog subito | `t18-51-blocker-job-running.png`, `t18-52-single-analysis-during-job.png` (stato d'attesa), `t18-53-single-analysis-overlap-job.png` |

Verifiche degli attriti noti (dettagli e stato nel tech-debt): Avvia con 0 target (`t18-41-enrich-zero-targets.png`,
`t18-42-analyze-zero-targets.png`, `t18-43-analyze-zero-outcome.png`), liste senza "Elimina" (`t18-47-lists-no-delete.png`),
focus su `body` dopo Aggiungi a lista / Scarta / Ripristina (`ab eval "document.activeElement.tagName"` → `"BODY"`).

## Console

`ab console` e `ab errors` vuoti alla fine di ogni sezione (dopo A, dopo U1–U4, dopo U5–U9, dopo U13, dopo U14).
Controllo dello strumento: `ab eval "console.error('probe')"` compare in `ab console` e sopravvive a `ab reload`.
