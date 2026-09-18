# Smoke end-to-end Apollo (apollo-lookalike T18)

Smoke funzionale con `agent-browser` contro il server e2e (job fake, client Apollo vero su fixture, nessuna
chiamata ad Apollo, Apify o Claude) sui percorsi A–F del [FLOW](../../brain/specs/prospect-crm/apollo-lookalike/FLOW.md),
sulla tabella **Error paths** e sugli **Edge cases**. Non è una UX review né un audit dei criteri di accettazione:
per ogni riga registra **OK / attrito / bug**. Server, seed e trigger: [README](README.md). Drift durevole:
`brain/tech-debt/prospect-crm/apollo-lookalike.md` (AL-TD-1…5 già noti, AL-TD-6…11 aperti da questo smoke).

Ultima esecuzione: **2026-09-17** (T18). Esito: tracer OK; 97 righe = 89 OK · 4 attrito (A12, E6, ERR20,
EDGE3) · 4 bug MINOR (C10, F10, ERR4, ERR22); nessun BLOCKER né MAJOR. Drift registrato: AL-TD-6…8 e AL-TD-11
(bug), AL-TD-9…10 (attriti durevoli). Console del browser senza `error`/`warn` (solo Vite e React DevTools).

## Precondizioni e comandi

```bash
UI_PORT=4431 npm run e2e:server                                        # DB scratch azzerato all'avvio
API_URL=http://localhost:4431 npm --prefix web run dev -- --port 5431 --strictPort
curl -s -X POST localhost:4431/api/e2e/reset && curl -s -X POST localhost:4431/api/e2e/seed

ab() { agent-browser --session t18 "$@"; }
ab open http://localhost:5431/ && ab set viewport 1280 1000
ab eval "localStorage.removeItem('crm.jobs.notified');localStorage.removeItem('crm.jobs.dismissed')"
```

Riavvii (ognuno azzera il DB, poi `POST /api/e2e/seed` e pulizia del `localStorage`):
`E2E_NO_APOLLO=1 UI_PORT=4431 npm run e2e:server` (blocchi chiave) e
`APOLLO_CREDIT_USD=0.1 UI_PORT=4431 npm run e2e:server` (riga "Costo stimato"). Processi fermati per PID
(server: `npm` → `tsx` → `node`; Vite: `npm` → `vite`); sessione chiusa con `ab close`.

Evidenze: `t18-NN-*.png` nella cartella scratch della sessione
(`…/scratchpad/t18/`, 84 screenshot, non versionati). "API" = verifica su `GET /api/jobs/current` o sulle route
di lettura, per le righe avviate con `curl` (il banner le mostra dopo `ab reload`).

### Gotcha di automazione (non bug del prodotto)

- `ab find role button click --name …` a volte risponde `✓ Done` senza cliccare quando il bottone è fuori
  viewport: usa i ref di `ab snapshot -i` + `ab scrollintoview @ref` + `ab click @ref`.
- I toast persistenti in basso a destra coprono la card "Aziende simili" e la paginazione delle candidate: un
  click a coordinate finisce sul toast (vedi attrito T-3). Chiudili prima (`button[aria-label="Chiudi notifica"]`).
- La tabella candidate scorre in orizzontale: dopo `scrollintoview` su un bottone di riga il click può mancare
  il bersaglio; un `element.click()` via `ab eval` è affidabile.
- Il toggle "Ricerche precedenti" va cliccato **una** volta (due click = chiuso).
- Uccidere un job: il `pid` di `jobs.current` è il wrapper `tsx`; il lavoro vero è il figlio (`pgrep -P <pid>`).
  Uccidere solo il wrapper lascia finire il job.

## Tracer (tdd_target): a DB e2e appena seminato → prospect "Apollo · <azienda>" con email di lavoro

Reset + seed (ICP 2 "HR tech Milano": Acme arricchita, Beta da arricchire, Delta senza sito; lista 2), poi solo UI.

| # | Preview | Crediti dichiarati | Esito del job | Crediti usati | Evidenza |
|---|---|---|---|---|---|
| 1 | `/icps/2` → "Arricchisci referenze" → *"Arricchisci le referenze con Apollo"* | *"Crediti stimati: 1 = 1 referenza da arricchire … · 1 già arricchita (non si ripaga)"*, "Costo stimato: stima non disponibile" | *"1 referenza arricchita · 0 non trovate su Apollo · 0 unioni · 1 URL LinkedIn acquisito"*; card → "2 arricchite, 0 da arricchire"; il dialog ricerca ora deriva anche `human resources, payroll` da Beta | 1 | `t18-02`, `t18-04` |
| 2 | "Trova aziende simili" (1 pagina × 25) | *"Crediti stimati: fino a 26 = 1 pagina di ricerca + fino a 25 aziende nuove da arricchire"* | *"25 lette · 21 nuove candidate · 1 già nota · 1 con chiavi in conflitto · 1 senza sito né pagina LinkedIn · 2 senza pagina LinkedIn · 1 referenza completata · 21 aziende arricchite · 1 pagina letta · 22 crediti usati."* (Attenzione, warning conflitto) → "Vedi candidate" | 22 | `t18-05`, `t18-07` |
| 3 | Triage: spunta Gamma Welfare, Turni Facili, Paghe Semplici → BulkBar "Accetta" → toast *"3 candidate accettate"* → **"Trova contatti in queste 3"** → *"Trova contatti in 3 aziende"* (lista 2 preselezionata) | *"3 aziende · 3 con dominio · fino a 30 persone · fino a 6 richieste Apollo … · Crediti stimati: fino a 30"* | *"Contatti Apollo: 13 persone lette in 3 aziende · 11 aggiunte a 'HR tech Milano — decisori' (11 nuove, 0 già in archivio) · 1 già in lista · 1 senza profilo LinkedIn (saltata) · 1 con id Apollo già assegnato · 9 con email · 13 crediti usati."* | 13 | `t18-10`, `t18-11`, `t18-14` |
| 4 | `/prospects/9` (Andrea Colombo, senza email) → "Arricchisci" → Provider **Apollo** | *"1 selezionato · 1 da cercare · Crediti stimati: 1"* | *"Email via Apollo: 1 email di lavoro trovata · 0 non disponibili … · 1 credito usato."*; banner "Arricchimento (Apollo)"; "Profilo non arricchito" invariato; timeline *"Arricchimento via Apollo: email di lavoro trovata"* | 1 | `t18-16`, `t18-17` |

**Risultato: OK.** 4 preview viste (3 job della catena + email Apollo), crediti dichiarati ≤ 58, usati 37; mai
un job senza preview; nessuna candidata cambiata senza clic (3 accettate a mano, 18 restano `proposta`).
`/prospects/20?list=2` **Alberto Ricci**: lista "HR tech Milano — decisori", *"Fonti (1) Apollo · Gamma Welfare
Srl (ricerca del 17 set)"*, email `alberto.ricci@gamma-welfare.example` arrivata col match dei contatti (nessun
credito in più) — `t18-15`. Seconda email via passo D: `andrea.colombo@turni-facili.example`.

## A. Aziende simili con preview

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| A1 | Entry Impostazioni | `/settings` | riga Apollo verde | "Apollo APOLLO_API_KEY … Configurata" | OK | `t18-00` |
| A2 | A.1 / A.1b card | `/icps/2` dopo il seed | "Mai eseguita. Usa le referenze con sito (2 di 3)…"; riga referenze | *"3 referenze · 2 con sito (1 arricchita, 1 da arricchire) · 1 senza sito"* + "Arricchisci referenze" | OK | `t18-01` |
| A3 | A.2 preview | "Trova aziende simili" | referenze usate, chip con origine, fasce con mappatura, località, 25·50·100, pagine, crediti sempre visibili, warning Delta | tutto presente; chip con `aria-label` "(da Acme HR Software Srl · da Beta Payroll Srl)"; fasce 1–10…101–200 spuntate con nota *"Dall'ICP "10-50" → … · da Beta … · da Acme …"*; warning Delta senza sito con link | OK | `t18-05` |
| A4 | A.3 successo + card | avvio ricerca | banner "In corso" → esito → card "Ultima ricerca", sezione Candidate ordinata per punteggio | come atteso; card *"Ultima ricerca: 17 set · 25 lette · 21 nuove candidate · proposte 21 · accettate 0 · scartate 0"*; Epsilon 79 % "località non disponibile", Gamma 75 % "stessa città di Acme" | OK | `t18-06`, `t18-07` |
| A5 | A.1 "Ricerche precedenti" (D14) | apri "Ricerche precedenti" | data · filtri · esito · distribuzione · "Riusa questi filtri" | *"21 proposte · basso 4 (4 proposte) · medio 13 (11 proposte, 2 accettate) · alto 4 (3 proposte, 1 accettata) · 1 senza località"* + "Riusa questi filtri" | OK | `t18-08`, `t18-24` |
| A6 | A.2 "Riusa" + D6 continua | "Riusa questi filtri" | dialog precompilato, *"Stessi filtri … continuo dalla pagina 2"* | riga *"Continuo dalla pagina 2: stessi filtri della ricerca del 17 set (letta fino alla pagina 1)."* + "Ricomincia dalla pagina 1" + warning uguale; preview "Pagina 2" | OK | `t18-18` |
| A7 | D6 pagina 2 / 3 | avvio (pag. 2), poi "Trova aziende simili" (pag. 3) | 25 nuove + 1 unione; poi 8 lette | pag. 2 *"25 lette · 25 nuove candidate · 1 unione · 25 aziende arricchite · 26 crediti usati"*; pag. 3 *"8 lette · 8 nuove candidate · 9 crediti usati"* | OK | `t18-19`, `t18-21` |
| A8 | D6 esaurita | riapri il dialog | *"Ricerca esaurita … (ultima pagina: 8 aziende su 25)"* | riga + warning *"Ricerca esaurita con questi filtri (ultima pagina: 8 aziende su 25): ricomincia dalla pagina 1 o cambia i filtri."*; preview torna a "Pagina 1" | OK | `t18-22` |
| A9 | A.2 dimensione pagina | radio 50, pagine 2 | continuazione solo a parità di dimensione; "fino a 102" | *"Stessi filtri … ma con 25 aziende per pagina: la continuazione richiede la stessa dimensione, riparto dalla pagina 1."*; *"fino a 102 = 2 pagine di ricerca + fino a 100 aziende"* | OK | `t18-23` |
| A10 | A.2 pagine fuori range | pagine = 5 | errore inline che blocca | *"Pagine di ricerca: da 1 a 3 (APOLLO_MAX_COMPANY_PAGES)."*, `aria-invalid="true"` + `aria-describedby`, "Avvia ricerca" `[disabled]` | OK | `t18-20` |
| A11 | D6 "Ricomincia" | con continuazione attiva → "Ricomincia dalla pagina 1" | preview a pagina 1 con avviso che ripaga | *"Ricomincio dalla pagina 1 con i filtri della ricerca del 17 set: ripaga pagine già lette."* + link "Continua dalla pagina 2" | OK | `t18-30` |
| A12 | Costo con prezzo | riavvio `APOLLO_CREDIT_USD=0.1` + seed | *"fino a ≈ $2,60 (26 crediti × $0,10)"* | "Costo stimato: ≈ $0,10" (referenze), "≈ $2,60" (ricerca), "≈ $27,60" (pipeline): manca "fino a" e il dettaglio "26 crediti × $0,10" (deviazione dichiarata in T12a) | attrito (T-7) | `t18-83` |

## B. Triage delle candidate

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| B1 | B.1 tabella | sezione Candidate | colonne, % con testo, ragioni, badge, link sito `noopener` | tutte le colonne; link *"Apri il sito di Epsilon Paghe Cloud Srl (nuova scheda)"* con `rel="noopener noreferrer"`; badge "Senza pagina LinkedIn" (Turni Facili, Paghe Semplici) | OK · colonna "Perché simile" tagliata a 1280 px (T-4) | `t18-10`, `t18-31` |
| B2 | B.3 bulk Accetta + toast | 3 spunte → Accetta | toast "N candidate accettate" + "Trova contatti in queste N"; filtro invariato; focus non su `body` | come atteso; focus su "Seleziona Epsilon Paghe Cloud Srl" | OK | `t18-09`, `t18-10` |
| B3 | B.2 riga Scarta / Riproponi / Accetta | "Scarta Formula Welfare Srl" (pag. 2) → chip "Scartate 1" → "Riproponi" | cambio immediato, riga esce, nessuna conferma | toast di riga *"Formula Welfare Srl scartata."* / *"… riproposta."*; azioni in `scartata` = Accetta · Riproponi; focus su riga/contatore | OK | `t18-26`, `t18-27` |
| B4 | B.4 empty state | "Scartate" vuoto dopo Riproponi | *"Nessuna candidata scartata."* + conteggi degli altri stati | *"Nessuna candidata scartata. Proposte 51 · Accettate 3"* | OK | `t18-27` |
| B5 | Filtro/pagina in URL (P-17) | chip stato, "Successiva" (51 proposte) | `?candidates=scartata`, `?cpage=2`, "Pagina 2 di 2" | come atteso; dopo lo Scarta dell'unica riga di pag. 2 la vista torna a pag. 1 ma l'URL resta `cpage=2` | OK (attrito minimo, T-5) | `t18-25`, `t18-26` |
| B6 | B.3 errore per item | 2 spunte, poi (curl) Ferie Smart promossa a referenza, poi Accetta | *"N riuscite · M errori"* con nomi + "Riprova le fallite" | toast *"Attenzione: 1 riuscita · 1 errore · Ferie Smart Srl: Candidata non trovata per questo ICP."* + "Riprova le fallite" + "Trova contatti in questa" | OK | `t18-28` |
| B7 | Error "Cambio stato fallisce" | riga stantia (People Metrics promossa via curl) → "Accetta" | toast "Stato non aggiornato: <errore>" | *"Stato non aggiornato: Candidata non trovata per questo ICP."*; la riga sparisce al refetch (non è più candidata: dato corretto) | OK | `t18-62` |
| B8 | Deep-link non valido | `/icps/2?candidates=pippo&cpage=abc` | default `proposta`, pagina 1 | URL normalizzato a `/icps/2`, "Candidate proposte…", "Pagina 1 di 2" | OK | API/testo |

## C. Trova contatti in lista

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| C1 | C.1 da toast | tracer passo 3 | stesso dialog, ambito già impostato | "Trova contatti in 3 aziende", ambito con nomi, lista unica preselezionata | OK | `t18-11` |
| C2 | C.1 da header | "Trova contatti in tutte le accettate (4)" | ambito "4 aziende accettate … (+1) mostra tutte" | come atteso; "mostra tutte" elenca nome + dominio | OK | `t18-32` |
| C3 | C.1 da BulkBar | 1 accettata → "Trova contatti…" | stesso dialog, 1 azienda; 2 liste → blocker finché non scegli | *"Trova contatti in Clima Aziendale Srl"*; nessuna lista preselezionata → *"Il job non può partire: Scegli una lista di destinazione."* | OK | `t18-34` |
| C4 | C.2 warning rilancio | header con lista 2 | *"N di M aziende già cercate per '<lista>' il <data>: … il match si ripaga."* | *"3 di 4 aziende già cercate per 'HR tech Milano — decisori' il 17 set: le persone già in lista non si duplicano, ma il match si ripaga."* | OK · scegliendo un'altra lista il warning sparisce anche se il match si ripaga (T-6) | `t18-32` |
| C5 | C.2 lista inline | "+ Crea nuova lista" → "HR tech — smoke inline" → "Crea lista" | lista creata e selezionata | radio nuova `checked`, preview aggiornata | OK | `t18-33` |
| C6 | C.2 tetto fuori range | massimo = 0 | errore inline che blocca | *"Il massimo di persone per azienda va da 1 a 100."*, "Avvia ricerca" `[disabled]` | OK | testo |
| C7 | C.3 esito + "Apri lista" | avvio sulla lista nuova | esito con conteggi | *"17 persone lette in 4 aziende · 16 aggiunte a 'HR tech — smoke inline' (4 nuove, 12 già in archivio) · 1 senza profilo LinkedIn (saltata) · 1 con id Apollo già assegnato · 12 con email · 17 crediti usati."* + "Apri lista" | OK | `t18-33` |
| C8 | C.4 badge "già cercata il" | candidate accettate dopo i contatti | badge su ogni azienda cercata | "già cercata il 17 set" su Gamma, Turni Facili, Paghe Semplici e (dopo C7) Clima Aziendale | OK | `t18-31`, `t18-33` |
| C9 | C.4 fonte in lista / filtro / dettaglio | `/lists/2`, filtro Fonte "Apollo", `/prospects/20` | icona `aria-label` "Apollo"; filtro; "Apollo · <azienda> (ricerca del <data>)" | icona "Apollo" in tabella, `?source=apollo_people` "1–12 di 12", Fonti del dettaglio come atteso | OK | `t18-14`, `t18-40`, `t18-15` |
| C10 | C.3 zero neutro | lista 2 rinominata `… apollo-empty` → header → avvio | toast neutro + "Riprova con altri filtri" | toast bianco *"Nessuna persona trovata in 4 aziende con ruoli CTO, Head of People · località Milano. Amplia i ruoli o togli la località."* **senza azione**; "Riprova con altri filtri" solo nella fascia sopra la tabella candidate | bug MINOR (AL-TD-6) | `t18-73` |

## D. Email di lavoro via Apollo

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| D1 | D.1 radio Provider | dialog da Prospect, Lista, Inbox | Apify default; testi di costo relativo | `radiogroup` con i due testi della FLOW; Apify `checked` | OK | `t18-16`, `t18-35`, `t18-38` |
| D2 | D.2 preview lista | `/lists/2` → "Arricchisci…" → Apollo | selezionati · da cercare · già con email · tentati di recente · crediti | *"23 nella lista · 9 da cercare · 11 con email già presente (saltati) · 3 tentati di recente senza risultato (saltati) · Crediti stimati: 9"* | OK | `t18-35` |
| D3 | D.3 esito + "email non disponibile" | avvio | esito, ✉ aggiornato, "email non disponibile" con tooltip | *"Email via Apollo: 6 email di lavoro trovate · 3 non disponibili (contatti EU o dato assente) · 11 già presenti (saltate) · 3 tentati di recente (saltati) · 8 crediti usati."*; header "con email 17/23"; righe *"Email non disponibile: cercata su Apollo il 17 set 2026"* | OK | `t18-36` |
| D4 | D.3 badge "arricchito" invariato | header lista, dettaglio prospect | "arricchiti" non cambia | "arricchiti 0/23" prima e dopo; "Profilo non arricchito" | OK | `t18-36`, `t18-17` |
| D5 | D.3 timeline | `/prospects/12` (senza email) | *"Arricchimento via Apollo: nessuna email disponibile"* | come atteso | OK | testo |
| D6 | D.2 blocker 0 target + "Riprova…" | rilancio sulla lista 2 | *"Nessun profilo da cercare con queste opzioni"*; con la spunta i tentati rientrano | blocker + Avvia `[disabled]`; con "Riprova anche quelli senza risultato" *"6 da cercare"*. A 0 crediti la riga dice "Costo stimato: ≈ $0,00" senza `APOLLO_CREDIT_USD` (coerente: 0 × prezzo) | OK | `t18-37` |
| D7 | D da Inbox | Giulia, Davide, Paolo → BulkBar "Arricchisci…" → Apollo | esito per selezione | *"3 selezionati · 3 da cercare · Crediti stimati: 3"* → *"1 email di lavoro trovata · 2 non disponibili … · 2 crediti usati."* | OK | `t18-38`, `t18-39` |

## E. Pipeline opt-in

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| E1 | E.1 senza lista | ICP nuovo "Pipeline smoke" (curl) → dialog | spunta disabilitata con motivo + "Crea lista" | checkbox `[disabled]`, `aria-describedby` → *"Crea una lista per questo ICP per usare questa opzione."* + "Crea lista"; warning "Nessuna lista attiva…" e "Nessuna referenza arricchita…"; card *"Nessuna referenza con sito: i filtri derivano solo dall'ICP."* | OK | `t18-41` |
| E2 | E.1 lista inline | "Crea lista" nel dialog → "Pipeline smoke — lista" | spunta attivata, campi di C.2 | spunta `checked`, lista preselezionata, ruoli/seniority/località/tetto | OK | `t18-42` |
| E3 | E.2 anteprima | — | crediti ricerca + persone, richieste, warning aziende scartate | *"Crediti stimati: fino a 26 (ricerca) + fino a 250 (persone trovate) · … · Totale fino a 276 crediti · … fino a 54 richieste Apollo in tutto"* + warning persone da aziende poi scartate + *"Fino a 54 richieste Apollo: più del limite di 20 al minuto…"* | OK | `t18-42` |
| E4 | E.3 esito su due righe | "Avvia ricerca e contatti" | un job, due righe, "Apri lista" + "Vedi candidate" | riga 1 *"Aziende simili per 'Pipeline smoke': 25 lette · 23 nuove candidate …"*, riga 2 *"Contatti Apollo: 91 persone lette in 23 aziende · 90 aggiunte a 'Pipeline smoke — lista' (73 nuove, 17 già in archivio) · … · 91 crediti usati."*; entrambi i link nel toast e nel banner | OK | `t18-43` |
| E5 | E.4 candidate restano proposte | card/API | tutte `proposta`, badge "già cercata" | *"proposte 23 · accettate 0 · scartate 0"*; badge presente (es. dettaglio Busta Chiara) | OK | `t18-43`, `t18-60` |
| E6 | Punteggio senza referenze | candidate dell'ICP senza referenze arricchite | componenti sulla sola parola chiave; ragioni coerenti | Recluta Facile (Milan) *"località non disponibile da Apollo"*; run *"23 senza località"* anche se tutte hanno città (manca la località delle referenze, non di Apollo) | attrito (AL-TD-10) | API |

## F. Azienda solo-dominio, URL LinkedIn, contatti dal dettaglio

| Rif. | FLOW | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| F1 | F.1 creazione da dominio | `/companies` → "Aggiungi azienda" → `https://www.smoke-dominio.example/chi-siamo` | azienda solo-dominio, nome = dominio, toast | toast *"smoke-dominio.example aggiunta · senza pagina LinkedIn — Puoi estrarre persone solo dopo averla collegata (Anagrafica → URL LinkedIn)."* + "Apri …" | OK | `t18-44` |
| F2 | F.2 badge + ricerca per dominio | `?q=smoke-dominio` | riga con dominio e badge testuale | 1 riga, "Senza pagina LinkedIn", colonna Dominio | OK | `t18-45` |
| F3 | F.3 dettaglio + blocker sourcing | `/companies/61` → "Estrai persone" | riga blocker accanto al bottone; preview con blocker | *"Azienda senza pagina LinkedIn: recuperala prima (Anagrafica → URL LinkedIn)."* accanto al bottone e nel dialog; "Avvia ricerca" `[disabled]`; "Dominio: … è la chiave…" | OK | `t18-46`, `t18-47` |
| F4 | F.4 409 + "Unisci in" | URL LinkedIn di Acme → Salva | 409 inline con link + "Unisci in" → conferma che elenca cosa si perde → redirect + toast | *"Questo URL LinkedIn è già di 'Acme HR Software Srl' (apri …). Nessuna modifica salvata."* + "Unisci in Acme HR Software Srl"; dialog "Cosa si perde" (il dominio) / "Cosa assorbe" (0 · 0 · 0 · 0) / "Operazione irreversibile"; redirect `/companies/2` + toast *"Aziende unite in 'Acme HR Software Srl'"*; `/api/companies/61` → 404 | OK | `t18-48`, `t18-49`, `t18-50` |
| F5 | F.4–F.5 sblocco | altra azienda solo-dominio → URL `company/smoke-sblocco-e2e` → Salva → "Estrai persone" | badge sparisce, preview senza blocker | toast "Anagrafica salvata"; nessun badge; preview solo "Scegli la lista", poi Avvia abilitato | OK | `t18-51`, `t18-52` |
| F6 | C.1 / SPEC F12 dal dettaglio | "Trova contatti" | liste attive raggruppate per ICP; default dall'ICP della lista; esito; "contatti cercati il <data>" | gruppi "ICP: CTO DI PMI MANIFATTURIERE / HR TECH MILANO / PIPELINE SMOKE / SOFTWARE HOUSE TORINO"; lista ICP 1 → ruoli CTO, Head of Engineering, VP Engineering, IT Manager + Italia; lista ICP 2 → CTO, Head of People + Milano; esito *"4 persone lette in 1 azienda · 4 aggiunte a 'HR tech Milano — decisori' (4 nuove…) · 3 con email · 4 crediti usati."*; poi "contatti cercati il 17 set" | OK | `t18-53`, `t18-54` |
| F7 | F12 senza dominio | azienda solo-LinkedIn | "Trova contatti" disabilitato con motivo | `[disabled]` + *"Serve il sito web: Apollo cerca le persone per dominio."*; "Arricchisci con Apollo" attivo con motivo (preview con blocker, 0 crediti) | OK | `t18-55` |
| F8 | A.1b singola (C4) | "Arricchisci con Apollo" su dominio ignoto | preview 1 credito → "non trovata" | *"Crediti stimati: 1 = 1 azienda da arricchire"* → *"0 aziende arricchite · 1 non trovata su Apollo (smoke-sblocco.example)…"* + warning "non verrà ritentata prima di 90 giorni"; dettaglio *"Tentata su Apollo il 17 set senza esito (non trovata o chiavi in conflitto)."* (lacuna nota di T15) | OK | `t18-56`, `t18-57` |
| F9 | Referenza da sito (SPEC B13) | `/icps/3` → "Aggiungi da URL" `www.gamma-welfare.example` | riconosce l'azienda per dominio | toast *"Gamma Welfare Srl aggiunta alle aziende di riferimento · Esito: Vinta · azienda già presente in Aziende"* | OK | `t18-58` |
| F10 | Riga referenza solo-dominio | referenze di ICP 2 (Beta) e ICP 3 (Non Trovata) | dominio e badge "Senza pagina LinkedIn" ovunque compaia un'azienda | la riga mostra solo il nome: né dominio né badge (le referenze con URL mostrano `linkedin.com/company/…`) | bug MINOR (AL-TD-8) | `t18-01`, `t18-58` |
| F11 | F.1 409 in creazione | "Aggiungi azienda" `http://acme-hr.example` | 409 inline con link, nulla creato | *"Azienda già presente con lo stesso dominio: apri Acme HR Software Srl"* (testo deviato in T15) | OK | `t18-63` |

## Error paths (tabella del FLOW)

| Rif. | Trigger (FLOW) | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| ERR1 | `APOLLO_API_KEY` mancante | riavvio `E2E_NO_APOLLO=1` + seed; Impostazioni; preview A.1b, A, C (F12), D | blocker *"APOLLO_API_KEY mancante nel .env — nessun job avviato"*, Avvia disabilitato; riga readiness | Impostazioni *"APOLLO_API_KEY mancante nel .env: aziende simili, contatti ed email via Apollo resteranno bloccati." · Mancante*; card *"Ricerca bloccata: APOLLO_API_KEY mancante…"*; blocker in tutte e 4 le preview, Avvia `[disabled]`. `/` reindirizza a `/inbox` (onboarding completo): la riga non si vede in home, il resto del CRM invariato | OK | `t18-78`…`t18-82` |
| ERR2 | Nessuna referenza con dominio/arricchita | ICP senza referenze | card + warning, la ricerca parte | card *"Nessuna referenza con sito: i filtri derivano solo dall'ICP."*; warning *"Nessuna referenza arricchita: i filtri derivano solo dall'ICP."*; job riuscito | OK | `t18-41`, `t18-43` |
| ERR3 | Referenza con chiavi in conflitto | `/icps/3` → "Arricchisci referenze" | esito con chiavi discordanti; riga nella card | *"0 referenze arricchite · 1 non trovata su Apollo (Non Trovata Srl) · 0 unioni · 0 URL LinkedIn acquisiti · 1 con chiavi in conflitto (Conflitto Chiavi Srl)"* + warning con i due URL; card *"Conflitto Chiavi Srl: chiavi in conflitto il 17 set" / "Non Trovata Srl: non trovata il 17 set"* | OK | `t18-59` |
| ERR4 | Rate limit A.1b | ICP con 12 referenze solo-dominio, nome `… apollo-hourly` (curl) | *"Limite Apollo raggiunto: arricchite 10 referenze su 12; le altre restano da arricchire."* | `succeeded`, summary *"0 referenze arricchite · 10 non trovate …"* ma warning *"Limite Apollo raggiunto: arricchite 10 referenze su 12"*: conta le non trovate come arricchite | bug MINOR (AL-TD-7) | API |
| ERR5 | 5xx A.1b prima di scrivere | stesso ICP rinominato `apollo-fail` | `failed` … Nessun dato modificato | `failed` *"actor:apollo:organizations/bulk_enrich: HTTP 500 (…) Nessun dato modificato."* | OK | API |
| ERR6 | Referenze solo-LinkedIn (A) | seed, dialog A | warning per nome, non blocca | *"Delta People Srl è senza sito: ignorata per la ricerca. Aggiungi il sito in Aziende → Delta People Srl per usarla."* | OK | `t18-05` |
| ERR7 | Referenze con sito non arricchite (A.2) | seed / dopo Delta completata | warning | *"Beta Payroll Srl non è ancora arricchita: i suoi settori e dimensioni non entrano nei filtri. Arricchisci le referenze prima."* | OK | `t18-80`, `t18-18` |
| ERR8 | Referenza non trovata (A.1b) | ICP 3; dettaglio azienda | esito con nome + riga card; non ripagata | vedi ERR3 e F8 | OK | `t18-59`, `t18-57` |
| ERR9 | Passo contatti fallisce in pipeline | lista 3 `… apollo-noscope` → pipeline su ICP 3 dalla UI | `succeeded` + warning config, candidate salvate | 2ª riga *"Contatti Apollo: passo interrotto da un errore, vedi l'avviso."* + warning *"config: la chiave Apollo non ha i permessi per mixed_people/api_search: … · Contatti non trovati. Le candidate sono salvate: usa 'Trova contatti' dopo aver sistemato la chiave."*; 22 candidate proposte | OK | `t18-71` |
| ERR10 | Lista mancante (C, E) | ICP senza lista; 2 liste senza scelta | "Crea nuova lista" inline; blocker "Scegli una lista" | vedi E1, E2, C3, C5 | OK | `t18-41`, `t18-34` |
| ERR11 | Lista archiviata (C, D, E) | `PATCH /api/lists/2 {archived:true}`; preview C e D; `POST` contatti e pipeline; "Riprova job #22" da Impostazioni | blocker con nome; `POST` 400 `blocked`; Riprova 400 `blocked` | C: *"La lista 'HR tech Milano — decisori' è archiviata: riattivala per aggiungere persone."*; `POST` contatti 400 *"Contatti non avviati: …"*, pipeline 400 *"Ricerca non avviata: …"*; Riprova → toast *"Job non avviato — Riprova bloccata: La lista … è archiviata…"*, nessun job nuovo. D usa il testo ereditato *"Lista archiviata: arricchimento disabilitato (lettura ed export restano possibili)."* (T-8). Il ramo "job avviato comunque → `failed` in ≤ 1 s" è una race non riproducibile dalla UI | OK | `t18-76`, API |
| ERR12 | Job già in corso (409) | dialog contatti aperto; pipeline via curl; subito "Avvia ricerca" | toast identico al blocker, dialog aperto | toast *"Attenzione: Job non avviato — C'è già un job in corso: Aziende simili (Apollo), avviato meno di un minuto fa."*; dialog resta aperto con il blocker rosso | OK | `t18-75` |
| ERR13 | 403 contatti | ICP 2 `… apollo-noscope` → contatti (curl) | `failed` config, banner rosso con rimedio | *"Configurazione: la chiave Apollo non ha i permessi per mixed_people/api_search … Nessun dato modificato."* + *"Cosa fare: Sostituisci APOLLO_API_KEY … e usa "Riprova"."* | OK | `t18-70` |
| ERR14 | 401 | ICP 2 `… apollo-badkey` → ricerca (curl) | `failed` *"config: chiave Apollo rifiutata (401)…"* | *"Configurazione: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env. Nessun dato modificato."* + "Cosa fare" + Riprova | OK | `t18-69` |
| ERR15 | Rate limit A | chip `apollo-partial`, pagine 2 (UI) | `succeeded` giallo, "letta 1 pagina su 2", continua dalla 2 | *"Aziende simili per 'HR tech Milano' (esito parziale): 25 lette …"* + warning *"Limite Apollo raggiunto: letta 1 pagina su 2 (25 aziende). Le candidate della pagina 1 sono salvate; rilancia più tardi: continuo dalla pagina 2."*; banner "Attenzione" | OK | `t18-65` |
| ERR16 | Rate limit C | lista 2 `… apollo-partial`, contatti su 4 aziende (curl) | parziale con "rilancia sulle stesse aziende" | *"Contatti Apollo (esito parziale): 5 persone lette in 1 azienda su 4 · …"* + *"Limite Apollo raggiunto: completata 1 azienda su 4 · … Rilancia sulle stesse aziende: chi è già in lista non si duplica."* | OK | `t18-72` |
| ERR17 | Rate limit D | lista 5 (90 persone) `… apollo-partial` → Apollo + "Riprova…" (22 target, UI) | "N email cercate su M · K trovate. I restanti restano 'da cercare'" | *"Limite Apollo raggiunto: 10 email cercate su 22 · 0 trovate. I 12 restanti restano "da cercare" (actor:apollo:people/bulk_match: limite di richieste raggiunto …)."* | OK | `t18-74` |
| ERR18 | 5xx A prima di scrivere + "Riprova" | ICP 2 `… apollo-fail-once` → ricerca (UI) → "Riprova" nel banner | `failed` "Nessun dato modificato", Riprova riesce | *"Errore: … Apollo mixed_companies/search: HTTP 500 (…) Nessun dato modificato."* + Riprova → job #20 `succeeded` | OK | `t18-67`, `t18-68` |
| ERR19 | 5xx C dopo la 1ª azienda | contatti su Clima + azienda `apollo-fail.example` (curl) | parziale, dati salvati restano validi | *"Contatti Apollo (esito parziale): 4 persone lette in 1 azienda su 2 …"* + *"actor:apollo:mixed_people/api_search: HTTP 500 … I dati salvati fino all'errore restano validi…"* | OK | API |
| ERR20 | 5xx D prima di scrivere | lista 4 `… apollo-fail`, Apollo + retry (curl) | `failed` attribuito | `failed` *"actor:apollo:people/bulk_match: HTTP 500 (errore simulato …)"*, senza "Nessun dato modificato." (gli altri kind lo dicono) | attrito (T-9) | API |
| ERR21 | Schema inatteso | chip `apollo-unrecognized` (curl) | warning, nessuna candidata, rilancio ripaga | *"… 0 lette · 0 nuove candidate · 0 pagine lette · 1 credito usato."* + *"Apollo ha risposto ma nessuna azienda è stata riconosciuta (5 dichiarate): verifica il provider. La pagina 1 non è stata salvata: rilanciando si ripaga."* | OK | `t18-66` |
| ERR22 | 0 risultati A | chip `apollo-empty` (UI) | neutro con filtri + "Riprova con altri filtri" (toast e card) | toast e banner neutri *"Nessuna azienda trovata con: … Allarga le fasce o togli la località."*; card con "Riprova con altri filtri" che riapre il dialog con `apollo-empty` (chip "aggiunto a mano"); **il toast non ha l'azione** | bug MINOR (AL-TD-6) | `t18-64` |
| ERR23 | 0 risultati C / D | C: vedi C10 · D: lista 4 `… apollo-empty` + retry | neutro | D *"Email via Apollo: 0 email di lavoro trovate · 4 non disponibili … · 0 crediti usati."*, banner "Completato" | OK (C: AL-TD-6) | `t18-77`, `t18-73` |
| ERR24 | Cambio stato candidata fallisce | vedi B7 | toast | vedi B7 | OK | `t18-62` |
| ERR25 | 409 dominio/URL | vedi F4, F11 | inline + "Unisci in" | vedi F4, F11 | OK | `t18-48`, `t18-63` |
| ERR26 | Processo figlio muore | ricerca a 1 pagina via curl, `kill -9` del figlio di `jobs.current.pid` | `failed` "Job interrotto senza esito…" | `failed` *"process: Job interrotto senza esito (segnale SIGKILL). I dati scritti fino all'interruzione restano validi."* (ripartenza da pagina 1: AL-TD-2, non ripetuto) | OK | API |
| ERR27 | Deep-link `?candidates=` non valido | vedi B8 | default `proposta` | vedi B8 | OK | — |
| ERR28 | Deep-link ICP/azienda inesistente | `/icps/999`, `/companies/9999` | messaggio + link padre | *"ICP non trovato — L'ICP non esiste o è stato eliminato. — Torna agli ICP"*; *"Azienda non trovata — L'azienda non esiste (o è stata unita a un'altra). — Torna alle aziende"* | OK | testo |

## Edge cases

| Rif. | Edge (FLOW) | Passi | Atteso | Osservato | Esito | Evidenza |
|---|---|---|---|---|---|---|
| EDGE1 | Referenza tra i risultati con l'altra chiave | 1ª ricerca ICP 2 (Delta solo-LinkedIn) | unione/completamento, non candidata | *"1 referenza completata"*; card → "3 con sito"; Delta non tra le candidate | OK | `t18-07` |
| EDGE2 | Referenza di un altro ICP | Ferronova (referenza ICP 1) nella pagina 1 dell'ICP 2; Acme (referenza ICP 2) nella pipeline ICP 4 | candidata normale | Ferronova candidata ICP 2 (33 %, acquisisce `ferronova.example`); Acme candidata di "Pipeline smoke" (0 %) | OK | API, `t18-50` |
| EDGE3 | Unione automatica nel job | metà LinkedIn + metà dominio di Omega Paghe (curl), poi pagina 2 | *"1 unione"*, candidata sull'id superstite | *"… 1 unione …"*; resta l'id con l'URL (27) con dominio e dati Apollo; id 28 → 404. La candidata si chiama ancora **"omega-paghe-e2e"** (nome predefinito dallo slug, mai sostituito dal nome Apollo "Omega Paghe Srl") | attrito (AL-TD-9; unione OK) | `t18-19`, API |
| EDGE4 | Candidata di due ICP | `/companies/16` dopo la pipeline | due candidature indipendenti | "Candidata per ICP (2)": HR tech Milano 67 % · Pipeline smoke 0 % | OK | `t18-60` |
| EDGE5 | Rilancio idempotente A | pagina 1 rilanciata (filtri cambiati da nuove referenze), dopo uno Scarta | già note non riproposte, niente arricchimento, scartate restano | *"25 lette · 0 nuove candidate · 23 già note (non riproposte) … · 1 credito usato."*; Epsilon resta `scartata` | OK | `t18-29` |
| EDGE6 | Rilancio idempotente C | contatti ripetuti su lista 2 | "già in lista", nessun doppione | *"4 già in lista"* (ERR16); membri della lista invariati | OK | `t18-72` |
| EDGE7 | Candidata promossa a riferimento | `/companies/16` → "Riferimento per l'ICP" HR tech Milano → "Segna come riferimento" | esce dalle candidate, toast, prospect restano | toast *"Busta Chiara Srl è riferimento di HR tech Milano — Esito: Vinta · uscita dalle candidate di HR tech Milano"*; proposte 48 → 47; "Prospect collegati (4)" invariati | OK | `t18-60` |
| EDGE8 | Eliminazione ICP con candidate | ICP 5 senza liste + 23 candidate → "Elimina ICP" | copy estesa; aziende e prospect restano | *"Eliminare "Da eliminare smoke"? Si cancellano anche i suoi riferimenti, le candidate e le analisi fatte per questo ICP; le aziende e i prospect restano. Non si può annullare."* → redirect `/icps`; `/api/icps/5` 404; Gamma resta, `candidate-of` senza ICP 5 | OK | `t18-61` |
| EDGE9 | Retry bloccato | vedi ERR11 | 400 `blocked` senza nuova riga | vedi ERR11 | OK | `t18-76` |
| EDGE10 | ICP senza liste | vedi E1 | A con warning, pipeline disabilitata | vedi E1 | OK | `t18-41` |
| EDGE11 | ICP senza ruoli target | `GET …/contacts/preview?…&roles=` | warning, non blocca | *"Nessun ruolo indicato: verranno prese le prime 10 persone qualunque per azienda."*, nessun blocker | OK | API |
| EDGE12 | Aziende senza dominio per i contatti | preview con Clima + azienda solo-LinkedIn; solo quest'ultima | warning nominativo; tutte → blocker | *"smoke-solo-linkedin è senza sito: esclusa (Apollo cerca per dominio)."*; solo lei → blocker *"Nessuna delle aziende selezionate ha un sito: Apollo cerca per dominio."* | OK | API |
| EDGE13 | Persone senza URL LinkedIn | Gamma Welfare (`senza-url`) | saltate e contate | *"1 senza profilo LinkedIn (saltata)"* in ogni esito su Gamma | OK | `t18-33` |
| EDGE14 | Persona già nota da sync | pipeline ICP 4 su Ferronova | un prospect, N fonti, esce dall'Inbox | Giulia Marchetti: fonti `apollo_people` (Ferronova) + commento + reazione, membro di "Pipeline smoke — lista", Inbox 5 → 4 | OK | API |
| EDGE15 | Pagina ricaricata durante/dopo un job | job avviati via curl + `ab reload` | banner ricostruito, esito visibile | banner e toast ricostruiti da `jobs/current` dopo il reload (vedi ERR13, ERR14, ERR21) | OK | `t18-66` |
| — | Non eseguiti | referenza rimossa, > 100 aziende, slug diverso, collisioni di migrazione (AL-TD-3), due tab, `APOLLO_CREDIT_USD` impostato dopo una ricerca, Riprova su ICP/lista cancellati (AL-TD-4) | — | — | non eseguito | — |

## Bug (tutti MINOR, nessun BLOCKER/MAJOR)

| AL-TD | Riga | Sintesi |
|---|---|---|
| AL-TD-6 | ERR22, C10 | Toast degli esiti a zero (aziende simili, contatti) senza "Riprova con altri filtri": l'azione c'è solo nella card / fascia candidate, mentre FLOW A.3/C.3 e Decisioni UX la vogliono "nel toast e nella card". |
| AL-TD-7 | ERR4 | Esito parziale di "Arricchisci referenze": il warning dice "arricchite N referenze su M" contando anche non trovate e conflitti (summary: "0 referenze arricchite"). |
| AL-TD-8 | F10 | Righe "Aziende di riferimento" della pagina ICP: per le referenze solo-dominio non si vedono né il dominio né il badge "Senza pagina LinkedIn". |
| AL-TD-11 | B6 (risposta della PUT) | `PUT /api/icps/:id/reference-companies/:companyId` e `GET /api/icps/:id` restituiscono `company.apollo_json` (grezzo Apollo), contro §12-bis "risposte senza `apollo_json`". |

## Attriti

| Id | Riga | Attrito | Tracciato |
|---|---|---|---|
| T-1 | EDGE3 | Nomi predefiniti (slug/dominio, SPEC B13) mai sostituiti dal nome Apollo dopo arricchimento o unione: la candidata appare come "omega-paghe-e2e". | AL-TD-9 |
| T-2 | E6 | "località non disponibile da Apollo" e contatore "senza località" anche quando mancano le località delle **referenze** (ICP senza referenze arricchite): copy fuorviante, statistica D14 gonfiata. | AL-TD-10 |
| T-3 | A5, B5 | Toast persistenti (esiti con warning, post-bulk) impilati in basso a destra coprono la card "Aziende simili" e la paginazione a 1280×1000. | solo smoke (T13 li ha resi persistenti di proposito) |
| T-4 | B1 | Tabella candidate a 1280 px: colonna "Perché simile" tagliata ("4 parole chiav…") e scroll orizzontale per arrivare alle azioni. | solo smoke |
| T-5 | B5 | Dopo aver svuotato l'ultima pagina la vista torna a pagina 1 ma l'URL resta `cpage=2`. | solo smoke |
| T-6 | C4 | Il warning "già cercate per '<lista>'" dipende dalla lista scelta: cambiando lista sparisce, ma il match delle stesse aziende si ripaga comunque. | solo smoke |
| T-7 | A12 | "Costo stimato: ≈ $2,60" senza "fino a" né "(26 crediti × $0,10)" (deviazione T12a). | solo smoke |
| T-8 | ERR11 | Preview D con lista archiviata usa il testo ereditato "Lista archiviata: arricchimento disabilitato…" invece di quello della FLOW ("…riattivala per aggiungere persone"). | solo smoke |
| T-9 | ERR20 | `failed` dell'email via Apollo senza "Nessun dato modificato." (gli altri kind Apollo lo aggiungono). | solo smoke |
| T-10 | A5 | "Ricerche precedenti": tre righe identiche "17 set · stessi filtri · 1 pagina letta da 25" non dicono quale pagina hanno letto (1, 2, 3). | solo smoke |
| T-11 | ERR11 | "Ultimi job" in Impostazioni etichetta l'email via Apollo come "Arricchimento" (il provider c'è solo nel banner, P-16). | solo smoke |
| T-12 | A2, F10 | La riga referenza di Beta (solo dominio) resta vuota sotto il nome finché Apollo non acquisisce l'URL: vedi AL-TD-8. | AL-TD-8 |

Tech debt già noto osservato: AL-TD-2 (morte del processo → `failed`, ERR26); AL-TD-3, AL-TD-4 non ripetuti;
AL-TD-1 non innescato (nessun arresto dell'arricchimento dentro la ricerca in questo giro).
