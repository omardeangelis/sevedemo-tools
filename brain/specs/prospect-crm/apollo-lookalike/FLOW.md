---
domain: prospect-crm
type: flow
links:
  - "[[specs/prospect-crm/apollo-lookalike/SPEC|SPEC]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
  - "[[chore/roadmap-apollo-icp-assistant-profilo|roadmap Apollo · assistente ICP · anagrafica]]"
created: 2026-09-16
updated: 2026-09-17
---

# Flow: Aziende simili e contatti via Apollo (`apollo-lookalike`)

> Contratto di flusso per [[specs/prospect-crm/apollo-lookalike/SPEC|SPEC]] (criteri A–I). Descrive
> **comportamento osservabile, stati e testi**, non implementazione. Estende
> [[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]: entry point, `JobPreviewDialog`,
> `JobBanner`, esito a tre toni, `ListPicker` con creazione inline, BulkBar e note di accessibilità valgono
> anche qui e non vengono ripetuti se non dove cambiano. Superfici in scope: ICP (`/icps/$id`) · Aziende
> (`/companies`, `/companies/$id`) · dialog di arricchimento (Lista, Inbox, Prospect) · Impostazioni /
> Onboarding (readiness) · banner ed esiti dei job. Dove serve un vincolo al piano lo segnalo con
> **[→ PLAN]**.

## Goal

Partendo dalle aziende di riferimento di un ICP, far proporre da Apollo **aziende simili**, decidere io
quali valgono, e da quelle **portare in lista le persone con i ruoli dell'ICP** (e, se voglio, la loro
email di lavoro) **spendendo solo crediti che ho visto in anteprima**.
**Segnale di successo:** con un ICP che ha 1+ referenza con sito e 1 lista, in una sessione arrivo a
prospect in lista con fonte "Apollo · <azienda>" passando da **3 job** (arricchisci referenze → aziende
simili → contatti) o da 2 con la pipeline; **ogni** preview dichiara i crediti anche quando il prezzo non è configurato; nessuna
candidata cambia stato senza un mio clic; un rilancio non ripropone né ripaga nulla di già noto; 0
risultati non è mai rosso. Verifica con `agent-browser` contro il server e2e con job fake.

## Personas

- **Omar (unico utente; founder/consulente + sviluppatore del tool).** Stessa persona di
  [[specs/prospect-crm/crm-foundation/FLOW|crm-foundation]]: *esperto* del dominio (sa cos'è un ICP, cosa
  vale un credito Apollo, quanto rumore c'è in una ricerca per keyword), lavora da solo, in locale, da
  desktop. Tollera tabelle dense; vuole **controllo**, non tutorial.
  - **Stato emotivo in questo flow:** (1) *ansia da costo* — Apollo si paga a crediti su un piano
    mensile: teme di bruciare crediti su referenze già arricchite, su pagine di ricerca inutili o su
    email di gente che non contatterà; (2) *diffidenza verso la "somiglianza"* — sa che Apollo non ha un
    "simili a": vuole vedere i filtri **prima** e il perché **dopo**; (3) *sovraccarico* — 100 candidate
    per ricerca da vagliare: serve il bulk e un ordine sensato.
  - **JTBD:** "Quando ho chiuso bene con 2–3 aziende, voglio che il CRM mi proponga altre 50 come loro,
    scartarne 30 in cinque minuti e ritrovarmi in lista le persone giuste delle 20 rimaste, senza pagare
    due volte lo stesso dato e senza che il tool decida al posto mio."
  - **Conseguenze di design:** crediti sempre visibili anche senza prezzo; filtri derivati mostrati e
    modificabili; candidate in `proposta` finché non decido io; Accetta/Scarta senza conferma e
    reversibili; esiti con conteggi (letti / nuove / già note / senza LinkedIn / unioni); pipeline spenta
    di default.
  > Persona non definita in `brain/domains/prospect-crm/` (dominio in costruzione): caratterizzazione
  > derivata dalla SPEC (Context) e dal FLOW crm-foundation; è l'assunzione su cui si progetta.

---

## Entry points

Nessuna precondizione di ruolo (single-user, no-auth). Route deep-linkabili; i filtri vivono nell'URL.

| Entry | Route | Precondizioni / comportamento |
|---|---|---|
| Card **"Aziende simili (Apollo)"** | `/icps/$id` | Sempre visibile sotto "Aziende di riferimento". CTA **"Trova aziende simili"** apre la preview anche quando ci sono blocker (li mostra lei); la card anticipa il motivo in una riga così non serve aprire il dialog per saperlo. |
| Sezione **"Candidate"** | `/icps/$id?candidates=proposta\|accettata\|scartata&cpage=` | Compare solo se l'ICP ha almeno una candidata (in qualunque stato). Default `proposta`. Deep-link a uno stato vuoto → empty state con i conteggi degli altri stati. |
| CTA **"Trova contatti…"** | `/icps/$id` (BulkBar delle candidate `accettata`; header della sezione per "tutte le accettate") · toast dopo un "Accetta" in bulk | Richiede ≥1 candidata accettata nell'ambito. Stesso dialog da ogni ingresso. |
| Dialog **"Arricchisci profili"** con scelta provider | `/lists/$id` (BulkBar e "Azioni sulla lista") · `/inbox` (BulkBar) · `/prospects/$id` | Componente unico esistente esteso con il radio **Provider**; default Apify. |
| Aziende | `/companies?q=&listId=` | "Aggiungi azienda" accetta **URL LinkedIn o sito/dominio**; la ricerca `q` filtra anche per dominio; le righe mostrano il dominio e il badge **"Senza pagina LinkedIn"**. |
| Dettaglio azienda | `/companies/$id?listId=` | Anagrafica con URL LinkedIn e Sito web (→ dominio) editabili; card "Candidata per ICP"; "Estrai persone" con blocker se manca l'URL LinkedIn; **"Trova contatti"** (SPEC F12) attivo solo con dominio, stesso dialog di C con la lista scelta tra tutte le attive. |
| Impostazioni / Onboarding | `/settings` · `/` | Readiness `apollo` accanto ad Apify e Anthropic (riga in "Configurazione"); l'assenza della chiave non blocca nient'altro del CRM. |
| JobBanner (sidebar) | ogni pagina | Nuovi kind: **"Arricchimento aziende (Apollo)"**, **"Aziende simili (Apollo)"**, **"Contatti Apollo"**; l'arricchimento con provider Apollo si presenta come **"Arricchimento (Apollo)"**. Link d'esito: "Vedi candidate" / "Apri lista". |

---

## Happy path

### A. Trova aziende simili con preview (crediti visibili, filtri derivati modificabili)

1. `/icps/$id` — card **"Aziende simili (Apollo)"**. Prima ricerca, riga di stato: *"Mai eseguita. Usa le
   referenze con sito (2 di 3) per cercare aziende simili su Apollo."* Dopo una ricerca: *"Ultima ricerca:
   16 set · 100 lette · 84 nuove candidate"* + conteggi cliccabili *"proposte 61 · accettate 18 · scartate
   5"* (portano alla sezione Candidate con il filtro). Sotto, **"Ricerche precedenti"** (chiuso di default):
   data · filtri usati in una riga · esito breve · **distribuzione** delle candidate proposte da quella
   ricerca per fascia e stato attuale (SPEC D14): *"40 proposte · basso 30 (30 scartate) · medio 7 (7
   scartate) · alto 3 (2 accettate, 1 proposta) · 2 senza località"* · **"Riusa questi filtri"** (riapre il
   dialog precompilato, così non rilancio a caso la stessa ricerca). La distribuzione è per rileggere le
   ricerche a distanza di settimane e capire se i filtri portano candidate che poi accetto.
1b. Nella card, riga **Referenze**: *"3 referenze · 2 con sito (1 arricchita, 1 da arricchire) · 1 senza
   sito"* + bottone **"Arricchisci referenze"** → `JobPreviewDialog` **"Arricchisci le referenze con Apollo"**
   (SPEC C2): elenco *"Beta (beta.io) · da arricchire"* / *"Acme (acme.it) · arricchita il 10 set"* /
   *"Delta · senza sito (ignorata)"* (warning); riga crediti sempre visibile *"Crediti stimati: 1 = 1
   referenza da arricchire"* + costo o "stima non disponibile"; spunta **"Ritenta anche le non trovate (o
   in conflitto) di recente"** (spenta; SPEC C2); blocker: chiave mancante · *"Nessuna referenza da
   arricchire"* · job in corso. **"Avvia arricchimento"** → esito *"1 referenza arricchita ·
   0 non trovate su Apollo · 0 unioni · 1 URL LinkedIn acquisito"* (SPEC C6); la card aggiorna la riga e
   il dialog del passo 2 ora deriva anche dai settori di Beta. La stessa azione esiste nel dettaglio
   azienda (**"Arricchisci con Apollo"**, 1 credito; SPEC C4). Le referenze arricchite non si ripagano
   più; una non trovata su Apollo si ritenta solo dopo `FRESHNESS_DAYS`.
2. **"Trova aziende simili"** → `JobPreviewDialog` **"Trova aziende simili a CTO startup IT"** (sottotitolo:
   *"Apollo cerca aziende con filtri derivati dalle tue referenze e dall'ICP. Controlla i filtri e i
   crediti prima di avviare."*). Contenuto, dall'alto:
   - **Referenze usate** (sola lettura): *"Acme (acme.it, arricchita il 10 set) · Beta (beta.io, non
     arricchita: i suoi settori non entrano nei filtri)"*; se ce ne sono senza dominio: warning giallo
     *"Delta è senza sito: ignorata per la ricerca. Aggiungi il sito in Aziende → Delta per usarla."* (link).
     La ricerca non arricchisce le **referenze**; arricchisce invece le **candidate nuove** che trova (S-7,
     steering 2026-09-17: la ricerca di Apollo non restituisce settore, parole chiave, dipendenti né sede).
   - **Filtri derivati, modificabili** (cambiarli non cambia i crediti, solo i risultati):
     - **Parole chiave / settori** — chip precompilati dai settori Apollo delle referenze e dai settori
       dell'ICP, con l'origine nel tooltip (*"da Acme"*, *"dall'ICP"*); Invio aggiunge, non salva.
     - **Fasce di dipendenti** — checkbox sulle fasce fisse di Apollo (1–10 · 11–20 · 21–50 · 51–100 ·
       101–200 · 201–500 · 501–1000 · 1001–2000 · 2001–5000 · 5001–10000 · 10001+), preselezionate dalla mappatura mostrata sotto:
       *"Dall'ICP '50–200' → 21–50, 51–100, 101–200 · da Acme (80 dipendenti): 51–100 + vicine 21–50,
       101–200"* (Beta non è arricchita: non contribuisce).
     - **Località** — chip da `target_locations` dell'ICP e dai paesi delle referenze; vuoto = ovunque.
   - **Aziende per pagina** — scelta 25 · 50 · 100, default 25 (*"ogni azienda nuova si arricchisce subito:
     1 credito ciascuna, così vedi punteggio, settore, dipendenti e sede"*).
   - **Pagine di ricerca** — numero, default 1 (*"1 pagina = fino a 25 aziende · 1 credito a pagina + 1 a
     azienda nuova; massimo 3 (APOLLO_MAX_COMPANY_PAGES)"*). Valore fuori range → errore inline che blocca
     l'avvio come un blocker.
   - **Spunta "Trova subito i contatti nelle aziende trovate"** — spenta (vedi E).
   - **Anteprima** (riga riassuntiva, mai nascosta anche a 0): *"Crediti stimati: fino a 26 = 1 pagina di
     ricerca + fino a 25 aziende nuove da arricchire (le già arricchite non si ripagano)"* (2 pagine da 50 →
     *"fino a 102 = 2 pagine + fino a 100 aziende"*). Sotto, la riga standard **Costo stimato**: *"fino a
     ≈ $2,60 (26 crediti × $0,10)"* se `APOLLO_CREDIT_USD` è impostato, altrimenti *"stima non disponibile —
     imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano fino a 26"*.
   - **Warning** (gialli, non bloccano): *"Nessuna lista attiva per questo ICP: potrai trovare i contatti
     solo dopo aver creato una lista."* · *"Beta non è ancora arricchita: i suoi settori e
     dimensioni non entrano nei filtri. Arricchisci le referenze prima."* · *"Nessuna parola chiave: la ricerca userà solo fasce e località, i risultati saranno poco
     simili."* · *"Stessi filtri della ricerca del 16 set (letta fino alla pagina 1): continuo dalla pagina 2."*
     con il link **"Ricomincia dalla pagina 1"** (hint: *"ricominciare ripaga pagine già lette"*; SPEC D6);
     se l'ultima pagina letta non era piena: *"Ricerca esaurita con questi filtri (ultima pagina: 17 aziende
     su 25): ricomincia dalla pagina 1 o cambia i filtri."* (la continuazione richiede anche la stessa
     dimensione di pagina) · *"Nessuna referenza arricchita: i filtri
     derivano solo dall'ICP."* (link "Arricchisci referenze") · *"L'ICP non ha settori, dimensione né
     località."* (SPEC D5)
   - **Blocker** (rossi, `role="alert"`, "Avvia ricerca" disabilitato): *"APOLLO_API_KEY mancante nel .env —
     nessun job avviato"* · *"Tutti i filtri sono vuoti: aggiungi almeno una parola chiave, una fascia o una
     località."* · *"C'è già un job in corso: <kind>, <n> min fa."* (SPEC D4: nessuna referenza con sito
     **non** è un blocker)
   - **"Avvia ricerca"**.
3. `202` → JobBanner *"In corso: Aziende simili (Apollo) · 0:12"*. Fine (toast + banner, tono per esito):
   - Successo: *"Aziende simili per 'CTO startup IT': 25 lette · 20 nuove candidate · 3 già note (non
     riproposte) · 1 con chiavi in conflitto (saltata) · 2 senza pagina LinkedIn · 1 unione · 1 referenza
     completata · 21 aziende arricchite · 1 pagina letta · 22 crediti usati."* → **"Vedi candidate"**
     (`/icps/$id?candidates=proposta`).
   - Zero (neutro): *"Nessuna azienda trovata con: robotica, automazione · 51–100, 101–200 dipendenti ·
     Italia. Allarga le fasce o togli la località."* → **"Riprova con altri filtri"** (riapre il dialog con
     gli stessi valori; l'azione sta nel toast **e** in "Ricerche precedenti", non solo nello storico).
   - Parziale (warning): vedi Error paths "rate limit".
4. La card aggiorna "Ultima ricerca" e i conteggi; la sezione **Candidate** compare (o si aggiorna) con le
   nuove proposte in cima, ordinate per punteggio.
→ **Outcome:** N aziende in `companies` (nuove o riconosciute) e N candidate dell'ICP in `proposta`, con
punteggio e ragioni calcolati sui dati dell'arricchimento; nessuna lista o stato toccati; crediti spesi
solo per le pagine lette e le aziende nuove non già arricchite.

### B. Triage delle candidate (per riga e in bulk, reversibile, senza conferme)

1. Sezione **"Candidate"** (`?candidates=proposta` di default). Header: chip di stato cliccabili con
   conteggi *"Proposte 61 · Accettate 18 · Scartate 5"*; **"Trova contatti in tutte le accettate (18)"**
   visibile solo con ≥1 accettata. Tabella (50 per pagina, `cpage`), ordinata per punteggio desc:
   checkbox · **Nome** (link a `/companies/$id`) · **Dominio** (link esterno al sito, `rel="noopener"`) ·
   Settore · Dipendenti · Sede · **Somiglianza** (*"82 %"* + barra; testo sempre presente) · **Perché
   simile** (ragioni in chip corti: *"settore in comune"*, *"51–100 dipendenti come Acme"*, *"stessa città
   di Acme"* / *"stessa regione di Beta"* / *"sede non disponibile"*; tooltip con l'elenco completo) · badge **"Senza pagina LinkedIn"** quando manca l'URL
   · badge **"già cercata il 16 set"** se esiste una fonte `apollo_people` per l'azienda (SPEC E5; link al dettaglio azienda) ·
   azioni di riga.
2. **Azioni di riga** (mai hover-only): in `proposta` → **Accetta** · **Scarta**; in `accettata` →
   **Scarta** · *Riproponi*; in `scartata` → **Accetta** · *Riproponi*. Clic = cambio immediato, riga che
   esce dalla vista corrente, `decided_at` registrata, nessun "sei sicuro?" (tutto reversibile).
3. **Bulk** (`BulkBar` "Azioni sulle candidate selezionate", contatore in live region, "Seleziona i
   visibili" nell'header, "tutti i filtrati" con il cap 500 ereditato): **Accetta** · **Scarta** ·
   **Riproponi** (solo fuori da `proposta`) · **Trova contatti…** (solo in `accettata`).
   Dopo un **Accetta** in bulk da `proposta`: toast *"12 candidate accettate"* con azione **"Trova contatti
   in queste 12"** (apre il dialog C già scoped a quelle 12: evita cambio filtro + riselezione). Il filtro
   corrente **non** cambia da solo: continuo a vagliare le proposte.
   Fallimento parziale (rete/500): *"10 riuscite · 2 errori"* con nomi; la selezione conserva solo le
   fallite; **"Riprova le fallite"**.
4. **Empty state** per stato: `proposta` vuoto con altre presenti → *"Nessuna candidata da vagliare.
   Accettate 18 · Scartate 5"* (link ai filtri) + **"Trova altre aziende simili"**; nessuna candidata in
   nessuno stato → la sezione non c'è, resta solo la card A.
→ **Outcome:** le candidate `accettata` sono l'ambito naturale di C; le `scartata` non vengono mai
riproposte da un rilancio di A; nulla è entrato nelle liste.

### C. Trova contatti in lista (crediti dichiarati come tetto, richieste dichiarate, persone senza LinkedIn contate)

1. Ingressi equivalenti allo **stesso dialog**: BulkBar delle accettate → **"Trova contatti…"**; header →
   **"Trova contatti in tutte le accettate (18)"**; toast di B.3; dettaglio azienda → **"Trova contatti"**
   per quella sola azienda (SPEC F12: la lista si sceglie tra **tutte** le attive raggruppate per ICP, i
   ruoli e le località di default arrivano dall'ICP della lista; senza dominio il bottone è disabilitato con
   il motivo *"Serve il sito web"*; accanto, *"contatti cercati il 16 set"* se già fatto).
2. Dialog **"Trova contatti in 12 aziende"** (sottotitolo: *"Apollo cerca le persone con i ruoli dell'ICP
   nelle aziende scelte, ne rivela profilo LinkedIn ed email di lavoro (1 credito a persona trovata) e le
   aggiunge alla lista in stato 'nuovo'."*; steering 2026-09-17: la ricerca gratuita di Apollo non dà l'URL
   LinkedIn, serve il match per id). Campi:
   - **Ambito** (sola lettura): *"12 aziende accettate: Acme, Beta, Gamma… (+9)"* con "mostra tutte".
   - **Lista di destinazione** (`ListPicker` sulle liste **attive** dell'ICP; se una sola → preselezionata;
     **"Crea nuova lista"** inline; obbligatoria). Sotto: *"ICP: CTO startup IT"*.
   - **Ruoli** (chip da `target_roles`, editabili). Vuoti → warning *"L'ICP non ha ruoli target: verranno
     prese le prime N persone qualunque per azienda."*
   - **Seniority** (gruppo di checkbox: Owner · Founder · C-suite · VP · Head · Director · Manager · Senior ·
     Entry; nessuna selezionata = tutte; hint *"Filtro Apollo sul livello; lascia vuoto per non filtrare."*).
   - **Località** (chip da `target_locations`; vuoto = ovunque).
   - **Massimo persone per azienda** (default 10, `APOLLO_PEOPLE_PER_COMPANY`; fuori range → errore inline
     che blocca).
   - **Anteprima:** *"12 aziende · 11 con dominio · 1 senza dominio esclusa (Delta) · fino a 110 persone ·
     fino a 22 richieste Apollo (una ricerca per azienda + i match a lotti da 10; limite del piano ≈ 200/min) ·
     Crediti stimati: fino a 110 (1 per persona trovata)"*; **Costo stimato** (*"fino a ≈ $11,00"* o *"stima
     non disponibile — imposta APOLLO_CREDIT_USD"*) con la nota *"La ricerca è gratuita; paghi solo le persone
     trovate, che arrivano con profilo LinkedIn ed email di lavoro. Riduci il massimo per azienda per spendere
     meno."*
   - **Warning:** *"Delta è senza sito: esclusa (Apollo cerca per dominio)."* · *"8 di 12 aziende già
     cercate per 'CTO startup IT' il 16 set: le persone già in lista non si duplicano, ma il match si
     ripaga."* · *"Più di 200
     aziende: più richieste del limite al minuto; il job rallenta e si ferma con esito parziale se Apollo limita."*
   - **Blocker:** *"APOLLO_API_KEY mancante nel .env"* · *"Nessuna azienda selezionata"* · *"Nessuna delle
     aziende selezionate ha un sito: Apollo cerca per dominio."* · *"Scegli una lista di destinazione"* ·
     *"La lista 'X' è archiviata: riattivala per aggiungere persone."* · *"C'è già un job in corso: …"*.
   - **"Avvia ricerca"**.
3. `202` → JobBanner *"In corso: Contatti Apollo"*. Fine:
   - Successo: *"Contatti Apollo: 96 persone lette in 11 aziende · 88 aggiunte a 'CTO startup IT' (80
     nuove, 8 già in archivio) · 5 già in lista · 3 senza profilo LinkedIn (saltate) · 61 con email · 96
     crediti usati · 1 azienda senza sito esclusa."* → **"Apri lista"**.
   - Zero (neutro): *"Nessuna persona trovata in 11 aziende con ruoli CTO, Head of Engineering. Amplia i
     ruoli o togli seniority e località."* → **"Riprova con altri filtri"** (dialog precompilato).
4. In `/lists/$id` le nuove righe hanno fonte **"Apollo · Acme"** (icona con `aria-label` "Apollo",
   tooltip con l'azienda); filtro sorgente **"Apollo"** in Inbox/Lista; il dettaglio prospect elenca
   *"Apollo · Acme (ricerca del 16 set)"* tra le Fonti; l'export CSV riporta la stessa provenienza. Nel
   dettaglio azienda i prospect compaiono in "Prospect collegati" e la riga candidata mostra il badge
   *"già cercata il 16 set"* (SPEC E5).
→ **Outcome:** membri in lista in stato `nuovo`, `company_id` e titolo collegati, id Apollo conservato
come chiave secondaria; nessun prospect senza URL LinkedIn; rilanciare non duplica.

### D. Email di lavoro via Apollo dall'arricchimento (provider a scelta, costo relativo visibile)

1. Da Lista/Inbox (selezione o "Azioni sulla lista") o dal Prospect → **"Arricchisci…"** → dialog
   **"Arricchisci profili"** con, in cima, il radio **Provider**:
   - **Apify — profilo completo**: *"about, esperienze, formazione ed email dal profilo LinkedIn · ≈ $0,0X a
     persona"* (default; comportamento attuale, i conteggi restano quelli di crm-foundation E.2).
   - **Apollo — solo email di lavoro**: *"email di lavoro, titolo e azienda · 1 credito a persona · niente
     about né esperienze: l'analisi AI richiederà comunque Apify"*.
2. Con **Apollo** la preview dice: *"24 selezionati · 15 da cercare · 6 con email già presente (saltati) · 3
   tentati di recente senza risultato (saltati) · Crediti stimati: 15"* + **Costo stimato** (*"≈ $1,50"* o
   *"stima non disponibile — imposta APOLLO_CREDIT_USD"*). Spunta: **"Riprova anche quelli senza
   risultato"** (esistente; finestra `FRESHNESS_DAYS`, qui sul tentativo Apollo `apollo_matched_at`). Chi
   ha già un'email non si ripaga mai (SPEC G2). Blocker: *"APOLLO_API_KEY mancante nel .env"* · *"Nessun profilo da cercare con queste opzioni"*
   (quando il target è 0: non deve partire un job vuoto, cfr. TD-3) · job in corso · lista archiviata.
   **"Avvia arricchimento"**.
3. Fine → *"Email via Apollo: 11 email di lavoro trovate · 4 non disponibili (contatti EU o dato assente) ·
   6 già presenti (saltate) · 3 tentati di recente (saltati)."* → "Apri lista". In tabella ✉ aggiornato e
   contatore *"con email 20/24"*; i "non disponibili" mostrano *"email non disponibile"* (tooltip: data e
   provider) e restano selezionabili con la spunta "Riprova…". Timeline del prospect: *"Arricchimento via
   Apollo: email di lavoro trovata"* / *"…: nessuna email disponibile"*. Il badge "arricchito" e il
   contatore "arricchiti" **non** cambiano con Apollo (vedi Decisioni UX).
→ **Outcome:** email di lavoro sui prospect che ne avevano una su Apollo, mai telefoni né email personali;
chi aveva già un'email non è stato ripagato.

### E. Pipeline opt-in: aziende simili → contatti in un solo job

1. Nel dialog A, spunta **"Trova subito i contatti nelle aziende trovate"** (spenta). Hint: *"Un solo job:
   dopo la ricerca, cerca le persone in **tutte** le aziende trovate e le mette in lista. Le aziende
   restano 'proposte': le vagli dopo."* Senza lista attiva la spunta è disabilitata con motivo *"Crea una
   lista per questo ICP per usare questa opzione"* (link "Crea lista", inline se possibile).
2. Attivata, sotto compaiono **gli stessi campi di C.2** (lista obbligatoria, ruoli, seniority, località,
   massimo per azienda) e l'anteprima diventa: *"Crediti stimati: 1 (1 pagina) + fino a 1 000 (persone
   trovate) · fino a 100 aziende · fino a 1 000 persone · fino a 200 richieste per i contatti (una ricerca per
   azienda + i match)"*. Warning aggiuntivo: *"Le
   persone entreranno in lista anche da aziende che poi scarterai: puoi rimuoverle dalla lista, ma non
   torna indietro da solo."* Blocker in più: quelli di C (lista mancante/archiviata).
3. **"Avvia ricerca e contatti"** → JobBanner *"In corso: Aziende simili (Apollo)"*. Fine, un solo esito su
   due righe: *"Aziende simili per 'CTO startup IT': 100 lette · 84 nuove candidate · 9 già note · 6 con
   chiavi in conflitto · 1 referenza completata · 5 senza pagina LinkedIn · 2 unioni."* / *"Contatti Apollo: 610 persone lette in 79 aziende · 540 aggiunte a
   'CTO startup IT' (…) · 12 senza profilo LinkedIn · 5 aziende senza sito escluse."* → **"Apri lista"** e
   **"Vedi candidate"**. Se il primo passo trova 0 aziende il secondo non parte e l'esito è il neutro di A.
4. Nella sezione Candidate le righe restano **`proposta`** con il badge *"già cercata il <data>"*; scartare
   una candidata **non** tocca i suoi prospect (badge e link al dettaglio azienda permettono di rimuoverli
   dalla lista a mano, in bulk, dalla card "Prospect collegati").
→ **Outcome:** un click, una preview, una spesa dichiarata; le decisioni sulle aziende restano mie.

### F. Azienda solo-dominio → URL LinkedIn a mano → sourcing Apify sbloccato

1. `/companies` → **"Aggiungi azienda"** → campo unico **"URL LinkedIn o sito web"** (placeholder
   *"https://www.linkedin.com/company/acme/ oppure acme.it"*). Un URL `linkedin.com/company/…` segue il
   percorso attuale; qualunque altro URL/dominio crea l'azienda con **solo il dominio** (nome = dominio
   finché non lo modifico; toast *"acme.it aggiunta · senza pagina LinkedIn: puoi estrarre persone solo dopo
   averla collegata"*). Dominio già presente → `409` inline *"Azienda già presente: apri Acme"* (link);
   nessuna riga creata. Con `?listId=` il bottone dice **"Aggiungi e cerca persone"** solo per URL LinkedIn;
   per un dominio dice **"Aggiungi"** e la nota spiega perché.
2. In tabella la riga mostra **Dominio** e il badge **"Senza pagina LinkedIn"** (testo, non solo icona);
   `q` cerca anche `acme.it`. Le candidate arrivate da Apollo senza LinkedIn appaiono così.
3. `/companies/$id` — **Anagrafica**: campi **URL LinkedIn** (vuoto, placeholder) e **Sito web**; sotto il
   sito, la riga derivata *"Dominio: acme.it"* (è la chiave: cambiare il sito la aggiorna). Svuotare
   entrambi → errore inline *"Serve almeno l'URL LinkedIn o il sito web"*, niente salvataggio. Header:
   sottotitolo con dominio e badge "Senza pagina LinkedIn"; card **"Candidata per ICP"**: *"CTO startup IT ·
   accettata il 16 set · somiglianza 82 %"* con le stesse azioni Accetta/Scarta/Riproponi.
   **"Estrai persone"** resta abilitato ma la preview mostra il blocker *"Azienda senza pagina LinkedIn:
   recuperala prima (Anagrafica → URL LinkedIn)."* e "Avvia ricerca" è disabilitato; accanto al bottone
   una riga con lo stesso testo evita di aprire il dialog per scoprirlo.
4. Incollo l'URL LinkedIn nell'anagrafica → **Salva** → *"Anagrafica salvata"*; il badge sparisce; se l'URL
   appartiene già a un'altra azienda → `409` inline *"Questo URL LinkedIn è già di 'Acme Robotica' (apri)"*,
   nessuna modifica; nel messaggio l'azione **"Unisci in Acme Robotica"** (SPEC B5): unione esplicita che
   conserva riferimenti, candidature, prospect e fonti, previa conferma che elenca cosa si perde (*"Il
   dominio acme-old.it e 2 note verranno assorbiti in 'Acme Robotica'. Operazione irreversibile."*), poi
   redirect all'azienda superstite con toast *"Aziende unite in 'Acme Robotica'"*.
5. **"Estrai persone"** → preview senza blocker → percorso D di crm-foundation invariato (ruoli dell'ICP,
   modalità, lista). Le persone estratte si aggiungono ai prospect già arrivati via Apollo sulla stessa
   azienda: stessa identità (URL LinkedIn), fonti cumulate ("Apollo · Acme" + "Dipendente di Acme").
→ **Outcome:** nessuna azienda Apollo persa per mancanza di LinkedIn; il collegamento manuale sblocca il
sourcing senza ricreare nulla.

---

## Error paths

Per ogni scrittura esiste un esito visibile: successo (toast dove non è ovvio dalla UI) o errore
inline/toast; mai silenzio. I testi dei job seguono il formato attribuito del dominio.

| Trigger / fallimento | Comportamento visibile | Recupero |
|---|---|---|
| `APOLLO_API_KEY` mancante | Preview (A, C, D-Apollo): blocker *"APOLLO_API_KEY mancante nel .env — nessun job avviato"*; "Avvia" disabilitato. Home/Impostazioni: riga *"APOLLO_API_KEY mancante nel .env: aziende simili, contatti ed email via Apollo resteranno bloccati."* Il resto del CRM non cambia | Configura `.env`, riavvia il server, riapri il dialog |
| Nessuna referenza con dominio o nessuna arricchita (A) | Card: *"Nessuna referenza con sito: i filtri derivano solo dall'ICP."*; preview: **warning** con link alla referenza; la ricerca parte con i filtri dell'ICP (SPEC D4/D5) | Dettaglio azienda → Sito web → "Arricchisci referenze" → torna all'ICP |
| Referenza con chiavi in conflitto (A.1b) | Esito *"1 con chiavi in conflitto (Acme: Apollo indica linkedin.com/company/acme-robotics, in anagrafica /company/acme)"*; nella card *"Acme: chiavi in conflitto il 16 set"*; non ripagata prima di `FRESHNESS_DAYS` (SPEC C3) | Correggi l'URL o il sito in Anagrafica (eventuale `409` → "Unisci in"); il cambio azzera il tentativo → "Arricchisci referenze" |
| Rate limit / `5xx` — Arricchimento referenze (A.1b) | Un lotto in errore non ferma gli altri; dopo ≥ 1 referenza salvata → `succeeded` con warning *"Limite Apollo raggiunto: arricchite 8 referenze su 12; le altre restano da arricchire."* (se le salvate non sono tutte arricchimenti: *"elaborate 10 referenze su 12 (0 arricchite)"*); prima → `failed` (SPEC C7) | Rilancio: solo le mancanti |
| Referenze solo-LinkedIn (A) | Warning per nome, non blocca; l'esito non le conta come lette | Aggiungere il sito quando lo si conosce |
| Referenze con sito non arricchite (A.2) | Warning *"Beta non è ancora arricchita: i suoi settori e dimensioni non entrano nei filtri."*; la ricerca parte comunque con i filtri dell'ICP e delle referenze arricchite | "Arricchisci referenze" (A.1b), poi riapri il dialog |
| Referenza non trovata su Apollo (A.1b) | Esito con *"1 non trovata su Apollo (Delta)"*; nella card *"Delta: non trovata il 16 set"*; non si ripaga prima di `FRESHNESS_DAYS` | Correggere il sito della referenza |
| Passo contatti fallisce in pipeline (E) | Job riuscito con warning: *"Aziende simili: 84 nuove candidate. Contatti non trovati: config: la chiave Apollo non ha i permessi… Le candidate sono salvate: usa 'Trova contatti' dopo aver sistemato la chiave."* (SPEC H3) | Sistemare la chiave, poi C |
| Lista mancante (C, E) | Nessuna lista attiva → `ListPicker` vuoto con **"Crea nuova lista"** inline; blocker *"Scegli una lista di destinazione"* finché non c'è | Crea inline |
| Lista archiviata (C, D, E) | Non compare nel `ListPicker`; su deep-link/race → blocker *"La lista 'X' è archiviata: riattivala per aggiungere persone."*; job avviato comunque → `failed` in ≤1 s con `config:` stesso testo | Riattiva la lista |
| Job già in corso (`409 job_running`) | Blocker *"C'è già un job in corso: Contatti Apollo, 2 min fa."*; su race al `POST` → toast identico, dialog resta aperto | Attendere; il banner mostra la fine |
| Chiave senza scope master (`403` Apollo) | Job `failed` (prima di completare la 1ª azienda; dopo → esito parziale riuscito, SPEC F10): *"config: la chiave Apollo non ha i permessi per la ricerca di persone via API: usa una master key o una chiave con quel permesso (Apollo → Settings → API keys). Nessun dato modificato."* Banner rosso persistente | Sostituisci la chiave; **"Riprova"** passa dagli stessi blocker della preview (cfr. TD-25) |
| Chiave non valida (`401`) | `failed`: *"config: chiave Apollo rifiutata (401). Verifica APOLLO_API_KEY nel .env."*; dopo ≥ 1 azienda completata è un esito parziale riuscito con lo stesso testo nel warning, seguito da *"… · completata 1 azienda su 2 · 1 aggiunta a 'X'. I dati salvati fino all'errore restano validi: sistema la chiave, poi rilancia sulle stesse aziende (chi è già in lista non si duplica)."* | Come sopra |
| Rate limit (`429` oltre i ritentativi) — A | Job `succeeded` con warning: *"Limite Apollo raggiunto: letta 1 pagina su 2 (100 aziende). Le candidate della pagina 1 sono salvate; rilancia più tardi: continuo dalla pagina 2."* (SPEC D12: granularità per pagina; limite sulla pagina 1 → `failed`) Tono giallo | "Riprova con gli stessi filtri" dalla card, più tardi |
| Rate limit — C / E (passo contatti) | *"Limite Apollo raggiunto: 6 aziende su 12 lette · 48 aggiunte a 'X'. Rilancia sulle stesse aziende: chi è già in lista non si duplica."* | Rilancio idempotente |
| Rate limit — D (email) | *"Limite Apollo raggiunto: 9 email cercate su 15 · 7 trovate. I 6 restanti restano 'da cercare'."* | Rilancio: i già trovati contano come "già presenti" |
| Endpoint Apollo in errore (`5xx`, rete) | `failed`: *"actor:apollo:mixed_companies/search: <messaggio>. Nessun dato modificato"* (A prima di scrivere) o *"…: i dati salvati fino all'errore restano validi"* (C/D per item) | "Riprova" |
| Risposta Apollo con schema inatteso (0 letti ma pagina dichiarata > 0) | Esito **warning**: *"Apollo ha risposto ma nessuna azienda è stata riconosciuta (100 dichiarate): verifica il provider."* Nessuna candidata scritta | Verifica; nessuna pagina salvata: il rilancio ripaga la pagina |
| 0 risultati (A, C, D) | Esito **neutro** (grigio) con i filtri usati e un suggerimento; non è errore | "Riprova con altri filtri" |
| Cambio stato candidata fallisce (rete/500) | Toast *"Stato non aggiornato: <errore>"*; riga invariata | Riprova |
| `409` dominio/URL già presente (creazione/modifica azienda) | Inline sotto il campo con link all'azienda esistente; nulla salvato. In modifica dal dettaglio azienda anche l'azione **"Unisci in <azienda>"** (SPEC B5) | Apri l'esistente, o unisci |
| Processo figlio muore | `failed`: *"Job interrotto senza esito. I dati scritti fino all'interruzione restano validi."* Per A: le pagine salvate restano e si riparte dalla successiva | "Riprova" |
| Deep-link `?candidates=` non valido | `validateSearch` → default `proposta` | Trasparente |
| Deep-link a ICP/azienda inesistente | *"ICP non trovato"* / *"Azienda non trovata"* + link alla lista padre (esistente) | Naviga |

## Edge cases

- **Una referenza compare tra i risultati di Apollo**: esclusa a monte per dominio/id organizzazione; mai
  candidata dello stesso ICP. Se la referenza era **solo-LinkedIn** e Apollo la restituisce con lo stesso
  URL LinkedIn → le due righe si uniscono, la referenza acquisisce il dominio e l'esito dice *"1 referenza
  riconosciuta e completata con il sito"* (non "nuova candidata"). Referenza di un **altro** ICP → candidata
  normale di questo.
- **Candidata già nota come azienda solo-LinkedIn** (es. inserita a mano o da sourcing): Apollo porta
  dominio + URL LinkedIn → unione (riferimenti, candidature, prospect, fonti e note conservati); contata
  in *"unioni"*; la riga candidata punta all'id sopravvissuto. Un id aperto in un'altra tab può sparire:
  il dettaglio risponde *"Azienda non trovata"* con link ad Aziende (invariante ereditato).
- **Candidata già candidata di un altro ICP**: riga `companies` unica, due candidature indipendenti; il
  dettaglio azienda le elenca entrambe con stato.
- **Rilancio idempotente di A**: già note (in qualunque stato, comprese le `scartata`) non riproposte e
  contate; la ricerca non spende crediti di arricchimento; "Ultima ricerca"
  si aggiorna; le `scartata` restano scartate.
- **Rilancio idempotente di C**: stessi prospect → *"già in lista"*; fonte `apollo_people` unica per
  (prospect, azienda); nessuna membership doppia.
- **Candidata promossa a riferimento** (dal dettaglio azienda, "Riferimento per l'ICP" → stesso ICP): esce
  dalle candidate; toast *"Acme è riferimento di CTO startup IT · rimossa dalle candidate"*; i conteggi
  della card si aggiornano; i prospect già in lista restano.
- **Referenza rimossa dai riferimenti**: non torna candidata da sola (nessun automatismo); un rilancio di
  A può riproporla come nuova candidata.
- **ICP senza liste**: A parte con warning; C non raggiungibile se non creando la lista inline; la spunta
  pipeline è disabilitata con motivo.
- **ICP senza ruoli target**: C e E avvisano (*"prime N persone qualunque per azienda"*), non bloccano;
  stesso testo del sourcing.
- **> 100 aziende**: A con più pagine dichiara *"2 pagine = fino a 200 aziende · 2 crediti"*; C su > 100
  accettate dichiara le richieste previste e il rischio di esito parziale; la tabella candidate è
  paginata e la selezione "tutti i filtrati" ha il cap 500.
- **Aziende senza dominio selezionate per i contatti**: escluse con warning nominativo; se **tutte** →
  blocker; l'esito le conta (*"1 azienda senza sito esclusa"*).
- **Persone senza URL LinkedIn**: saltate e contate (*"3 senza profilo LinkedIn (saltate)"*); se sono > 50 %
  delle lette, warning *"Molte persone senza profilo LinkedIn: valuta ruoli più specifici."*
- **Persona già nota da sync/sourcing**: un prospect, N fonti; se era in Inbox esce dall'Inbox entrando in
  lista (invariante ereditato); lo stato globale non cambia.
- **Slug LinkedIn diverso tra Apollo e CRM**: identità = URL normalizzato + id membro; Apollo di solito non
  porta l'id membro → possibile doppione finché una fonte non li collega (stesso limite di crm-foundation,
  TD-1/TD-37); l'id Apollo non unisce da solo.
- **Aziende esistenti con lo stesso sito** (migrazione B8): la seconda resta senza dominio; nel dettaglio
  la riga *"Dominio: —"* ha la nota *"Dominio acme.it già usato da <altra azienda> (apri)"* e i job Apollo
  la trattano come "senza sito"; nessun blocco all'avvio del server, nessun badge nuovo in tabella.
- **Job avviato e pagina cambiata/ricaricata**: banner ricostruito da `GET /api/jobs/current`; l'esito
  arriva comunque; la sezione Candidate si aggiorna al termine (invalidate).
- **Due tab**: la seconda che avvia riceve il `409`; il triage in due tab converge al `refetch` (ultimo
  clic vince; nessun lock, azioni reversibili).
- **Eliminazione ICP**: la card "Elimina ICP" dice *"Si cancellano anche i suoi riferimenti, le candidate e
  le analisi fatte per questo ICP; le aziende e i prospect restano."*
- **`APOLLO_CREDIT_USD` impostato dopo una ricerca**: gli esiti passati non vengono ricalcolati; solo le
  preview nuove mostrano il costo.

## Friction notes & decisioni

- **Rimosso: passaggio "accetta → cambia filtro → riseleziona → trova contatti".** Il toast dopo un
  Accetta in bulk offre "Trova contatti in queste N": stesso dialog, ambito già impostato. Nessun cambio
  automatico di filtro (continuo a vagliare).
- **Rimosso: conferme su Accetta/Scarta/Riproponi.** Reversibili a un clic; stessa regola dello "Scarta"
  dell'Inbox.
- **Default: filtri derivati precompilati, non vuoti.** Omar li corregge, non li scrive da zero; ogni chip
  dice da dove viene. La mappatura delle fasce è mostrata perché è la parte meno intuitiva.
- **Default: 1 pagina.** Il costo marginale di una pagina è basso ma 100 candidate sono già tante da
  vagliare; più pagine = scelta esplicita.
- **Inferito: lista preselezionata se l'ICP ne ha una sola** (come nel sourcing).
- **Differito (YAGNI):** soglia minima di punteggio (spec OQ-2 chiusa: si propone tutto, ordinato); filtro
  della Lista per azienda; ordinamenti multipli della tabella candidate; storico completo dei job Apollo
  oltre gli ultimi 5 (la distribuzione per ricerca di A.1 copre l'analisi, non la lista completa).
- **Non fatto di proposito:** nessun avvio automatico alla creazione di ICP/referenze/lista; nessuna
  accettazione automatica anche in pipeline; nessun "Trova email" automatico dopo i contatti (è un altro
  costo, un altro dialog).

## Decisioni UX

- **Crediti prima del prezzo.** L'unità che Omar controlla sul piano è il credito: la preview li mostra
  sempre nella riga riassuntiva (anche a 0), e il "Costo stimato" li traduce in dollari solo se
  `APOLLO_CREDIT_USD` esiste; altrimenti "stima non disponibile" con l'indicazione di cosa impostare. Mai
  un prezzo inventato.
- **CTA sempre attive, blocker nella preview + una riga che li anticipa.** Coerente con crm-foundation
  ("tutto ciò che può fallire per configurazione fallisce prima, gratis"): il dialog è il posto dove si
  legge il motivo; la riga nella card/accanto al bottone evita il giro a vuoto.
- **Somiglianza spiegata in chip, valore in percentuale.** Il punteggio 0–1 della SPEC si mostra come
  "82 %" con testo (mai solo barra/colore); le ragioni sono chip corti in tabella e lista completa nel
  tooltip: una colonna di prosa non è vagliabile a 100 righe.
- **Candidate ordinate per punteggio, proposte per default.** Il triage parte dalle più simili; le
  scartate non spariscono (filtro), le accettate sono l'ambito del passo successivo.
- **"Riproponi" invece di "Annulla".** Un unico verbo per tornare a `proposta` da entrambi gli altri stati;
  la reversibilità sostituisce la conferma.
- **Provider come radio in cima all'`EnrichDialog`, con prezzo relativo.** Un solo dialog per due
  provider evita un secondo bottone in BulkBar; il testo dice cosa **non** fa Apollo (niente about →
  l'analisi AI chiederà comunque Apify) così nessuno sceglie Apollo credendo di risparmiare sull'analisi.
  L'arricchimento Apollo aggiorna "con email" ma non "arricchito" (derivato da about/esperienze: resta
  coerente con "l'analisi richiede un prospect arricchito").
- **Esito onesto esteso.** Ai tre toni si aggiungono i conteggi propri di Apollo (già note, senza pagina
  LinkedIn, unioni, senza profilo LinkedIn, non disponibili EU) e il parziale da rate limit è **giallo**
  con i numeri "su previste" e la promessa di idempotenza al rilancio.
- **"Riprova con altri filtri" nel toast e nella card**, non solo nello storico (chiude il pattern di
  TD-9 per questi kind). "Riprova" dei `failed` ripassa dai blocker (TD-25).
- **Fonte "Apollo · <azienda>"** usa la stessa forma di "Dipendente di <azienda>": icona propria,
  `aria-label` "Apollo", filtro sorgente e CSV coerenti.
- **Pipeline = stesso dialog, campi in più, un esito su due righe.** Nessun secondo dialog "a catena";
  il warning sulle persone di aziende che poi scarterò è il prezzo dichiarato della comodità.
- **Badge "Senza pagina LinkedIn" ovunque compaia un'azienda** (tabella, dettaglio, candidate): è lo
  stato che spiega perché "Estrai persone" è bloccato e perché una candidata vale meno finché non la
  collego.

## Accessibilità

Stessa asticella di crm-foundation; in più:

- **Tabella candidate**: checkbox di riga con `aria-label` *"Seleziona Acme"*; header "Seleziona i
  visibili" indeterminato; somiglianza con testo *"82 %"* e barra `aria-hidden`; ragioni come testo (chip
  con `title` e tooltip raggiungibile da tastiera); ordine di tab checkbox → nome (link) → azioni; azioni
  mai `opacity-0`.
- **Dopo Accetta/Scarta/Riproponi** (riga o bulk) il focus va al contatore/riga successiva, non a `body`
  (TD-4); il toast con "Trova contatti in queste N" è un bottone raggiungibile da tastiera e vive in una
  live region `polite`.
- **Dialog A**: `fieldset`/`legend` per "Fasce di dipendenti" e "Seniority"; chip con hint *"Invio aggiunge,
  non avvia"*; la riga dei crediti è dentro la sezione `aria-label="Anteprima del job"` esistente; errore
  del numero di pagine associato via `aria-describedby` + `aria-invalid`; la spunta pipeline disabilitata
  ha il motivo in `aria-describedby`.
- **Radio Provider**: `role="radiogroup"` con etichetta "Provider"; la riga di prezzo fa parte della label.
- **Badge di stato** ("Senza pagina LinkedIn", "proposta/accettata/scartata", "già cercata il <data>"):
  testo sempre presente, colore accessorio.
- **Esiti**: banner `role="status"` con prefisso Completato/Attenzione/Errore; il parziale da rate limit
  è "Attenzione: …", leggibile senza colore.
- **Link esterni al sito**: `rel="noopener noreferrer"`, `aria-label` *"Apri il sito di Acme (nuova
  scheda)"*.

## Open questions

- ~~OQ-1 — Seniority nel dialog contatti~~ (spec OQ-1): risolta 2026-09-17, tutte e 9 le voci, nessuna
  preselezionata (una preselezione salvata nell'ICP è un'estensione se l'uso reale la giustifica).
- Chiuse con l'utente il 2026-09-17 anche spec OQ-2 (località città/regione al posto del paese, sede assente
  esclusa dal punteggio), OQ-3 ("Trova contatti" dal dettaglio azienda, SPEC F12, in C.1 e Entry points) e
  OQ-4 (distribuzione per ricerca in A.1, SPEC D14).

Risolte nella SPEC (v2/v3, 2026-09-16), tenute qui per tracciabilità:

- ~~OQ-5 "Contatti in lista: N"~~ → SPEC E5 (decisione del grill): badge "già cercata il <data>" dalla fonte
  `apollo_people` più recente dell'azienda; il conteggio N è rinviato.

- ~~OQ-2 unione manuale su 409~~ → SPEC B4/B5: 409 con identità dell'altra azienda + azione "Unisci in
  <azienda>" dal dettaglio; unione automatica solo nei job (B6/B7, Regole di unione).
- ~~OQ-3 "cerca di nuovo anche chi ha già un'email"~~ → tolta: SPEC G2, ambito = senza email; "Riprova"
  vale solo sul tentativo Apollo recente.
- ~~OQ-4 Apollo e "arricchito"~~ → SPEC G5/G6: Apollo non tocca `enriched_at`; data propria `apollo_matched_at` scritta solo a risposta ricevuta.
- ~~OQ-6 copy del blocker Apify~~ → accettata l'estensione "(Anagrafica → URL LinkedIn)"; il testo base
  resta quello di SPEC B14.
- ~~OQ-7 nome di default da dominio~~ → SPEC B13: il dominio; nessun arricchimento a pagamento alla
  creazione.
- ~~OQ-8 punteggio in percentuale~~ → sola presentazione; l'API resta 0–1 (SPEC D10).
