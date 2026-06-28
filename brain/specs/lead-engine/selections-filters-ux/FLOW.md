---
domain: lead-engine
type: flow
links:
  - "[[specs/lead-engine/selections-filters-ux/SPEC]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
  - "[[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]]"
  - "[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]"
created: 2026-06-16
updated: 2026-06-16
---

# Flow: UX dei filtri e redesign delle Selezioni

> Contratto di flusso per [[specs/lead-engine/selections-filters-ux/SPEC|SPEC]]. Copre tre superfici:
> (1) filtri Contatti + pool Selezioni, (2) layout della Selezione del giorno, (3) modale di aggiunta
> contatti bulk. Descrive comportamento osservabile e stati, non implementazione. Il "come" (componenti
> shadcn, endpoint batch vs N POST) è deciso in PLAN.

## Goal

Dare all'operatore filtri compatti con colpo d'occhio sui filtri attivi e reset unico, una vista
Selezione che "respira" ed è scansionabile, e un'aggiunta contatti guidata e multipla — **a invarianza
funzionale** (nessun cambio di pipeline o semantica DB).
**Segnale di successo:** l'operatore non tecnico cura i 40 contatti del giorno (rimuove, arricchisce,
aggiunge in blocco) senza scroll per arrivare alla lista, senza perdere filtri navigando, e senza che un
duplicato blocchi un'aggiunta multipla. Verifica visiva con `agent-browser` (niente runner FE).

## Personas

- **Omar (oggi, in test):** tecnico, costruisce e collauda. Tollera densità e scorciatoie; serve a lui
  che lo stato URL e gli endpoint non regrediscano. Stato emotivo: pragmatico.
- **Operatore SeVedemo (a breve, persona-bersaglio):** *non tecnico*, novizio del dominio. JTBD: ripulire
  e completare la selezione giornaliera (40 contatti) prima dell'export verso il tool email. Stato
  emotivo: ripetitivo/quotidiano, vuole velocità senza paura di rompere qualcosa. Ha bisogno di:
  etichette in chiaro, azioni scopribili senza mouse, bulk perdonante (un errore non blocca il resto),
  feedback esplicito su cosa è successo. **Tutta la UX si ottimizza per questo persona** (cf. SPEC).
  > Personas lette dal dominio lead-engine (single-user locale, no-auth). Nessuna definizione formale
  > altrove: questa caratterizzazione è coerente con SPEC §Context ed è l'assunzione su cui si progetta.

---

## DECISIONE 1 — Pattern filtri (chiude Open Question 5)

**Scelta: barra filtri compatta su una riga + chip dei filtri attivi sotto + "Pulisci" unico** (candidato
A, non il bottone "Filtri (n)" con popover — candidato B).

**Perché A per l'operatore non tecnico:**
- I filtri di Contatti sono **pochi e di alto uso quotidiano** (testo, bucket, status, strategia, email).
  Nasconderli dietro un bottone "Filtri (n)" (B) aggiunge un clic e un livello di indirezione per il
  controllo più frequente: penalizza chi filtra di continuo. B conviene quando i filtri sono molti/rari;
  qui non lo sono.
- Il problema reale non è "troppi controlli" ma "**troppo ingombro verticale**": 4 dropdown full-width
  impilati. Si risolve **collassando su una singola riga** (`flex-wrap`, select a larghezza intrinseca),
  non spostando i filtri altrove.
- I **chip dei filtri attivi** danno il colpo d'occhio richiesto dall'Outcome A e rendono ovvio cosa
  toglie ogni filtro (ogni chip ha la sua ✕). Più scopribile di un badge numerico nel bottone (B).

**Comportamento concreto della barra filtri (condivisa Contatti ↔ pool Selezioni):**
- Una riga: campo ricerca (con icona) + select compatte `bucket`, `status`, `strategia`, `presenza email`
  (tri-state: Tutti / Con email / Senza email). Su viewport stretti va a capo con `flex-wrap`, **non**
  impila a tutta larghezza.
- Sotto la barra, **riga di chip** dei soli filtri attivi: ogni chip mostra `etichetta: valore` (es.
  "Bucket: Freelance", "Email: con email") con ✕ per rimuovere quel singolo filtro. Niente chip = niente
  riga (zero ingombro a filtri vuoti).
- Quando c'è ≥1 filtro attivo compare l'azione **"Pulisci"** (reset di tutti i filtri in un colpo;
  riporta anche la pagina a 1). Assente se non c'è nulla da pulire.
- Lo stesso componente è usato nel **pool delle Selezioni** (testo + presenza email): niente fork del
  pattern, una sola definizione delle opzioni email (unifica `EMAIL_OPTIONS`/`EMAIL_FILTER_OPTIONS`, cf.
  SPEC §Technical Notes / tech-debt §TD-1). Nel pool i chip/Pulisci sono **locali** allo stato del pool,
  non scritti nell'URL della pagina (vedi Edge cases).

**Invariante non negoziabile (no-regression):** lo stato dei filtri *Contatti* resta **solo nell'URL**
(ambito sessione), via il `validateSearch` hand-rolled esistente (niente zod, niente `useState` come
sorgente di verità). Le chip e il Pulisci sono **viste/azioni** sopra l'URL: cliccare una ✕ o "Pulisci"
fa `navigate({ search: … })` esattamente come oggi `setFilter`. Persistenza, default-stripping, reset
pagina al cambio filtro: invariati (cf. [[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]],
[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]).

## DECISIONE 2 — Layout Selezioni (chiude Open Question 4)

**Scelta: due pannelli bucket affiancati ma più respirati su desktop largo (≥ `xl`), che collassano in
colonna singola sotto quella soglia.** Non tab/sheet per bucket.

**Perché affiancati, non tab:**
- L'operatore lavora su **una selezione di 40 = 20 Freelance + 20 Azienda**: i bucket vanno **confrontati
  a colpo d'occhio** (chi è pronto vs da arricchire in entrambi). Le tab nascondono metà del lavoro
  dietro un clic e perdono il colpo d'occhio sui conteggi totali — costo cognitivo per un novizio.
- La griglia 2-colonne `xl` esiste già; il problema non è il layout a 2 colonne ma la **densità interna**
  delle righe. Si interviene lì (vedi sotto), non sulla struttura.
- Su viewport sotto `xl` i pannelli **impilano** (colonna singola), evitando lo schiacciamento orizzontale.

**Respiro interno (criteri concreti, verifica `agent-browser`):**
- Righe con più aria: alza il padding verticale (da `py-3` a una densità più comoda) e dà al `Card` un
  padding sul body (oggi le liste partono dal bordo).
- Gerarchia tipografica: header di segmento non più a `text-[11px]` strizzato; nome contatto leggibile,
  headline come riga secondaria attenuata. Niente testo a 11px per le info chiave.
- I due segmenti **"Pronti per email"** e **"Da arricchire"** restano nettamente distinti (verde/ambra) e
  con i **conteggi per bucket** — invariante di email-segmentation-filters, non si tocca la semantica.
- Per riga restano scansionabili: rank, avatar, nome, headline, **marker ✉** (con/senza email), fit,
  badge stato ("bozza da rigenerare", "tentato/mai tentato").

---

## Entry points

- **Contatti** — voce di nav → `/contacts`. Precondizione: nessuna (no-auth, single-user). Stato filtri
  ricostruito dall'URL (deep-link/condivisione/reload restano validi).
- **Selezione del giorno** — da indice `/selections` o dal Run → `/selections/$date`. Se `state ==
  exported`, la vista è in **sola lettura** (niente aggiungi/rimuovi/arricchisci) — invariante attuale.
- **Modale "Aggiungi contatti"** — dal pulsante "+ Aggiungi" su un `BucketPanel` *non* esportato. Apre il
  modale già contestualizzato sul bucket di quel pannello (Freelance o Azienda). Precondizione: selezione
  non esportata.

---

## Happy path

### A. Filtrare i contatti
1. L'operatore arriva su `/contacts` — la lista è visibile **senza scroll** (barra filtri su una riga).
2. Digita testo / sceglie bucket/status/strategia/email → ogni cambio aggiorna l'URL, **resetta la
   pagina a 1**, ricarica la lista. → Sotto la barra compaiono i **chip** dei filtri attivi + "Pulisci".
3. Clicca la ✕ di un chip → quel filtro torna a default (rimosso dall'URL); gli altri restano.
4. Clicca "Pulisci" → tutti i filtri spariti, URL pulito, lista intera, pagina 1.
→ **Outcome:** lista filtrata, stato leggibile a colpo d'occhio, reset in un clic; URL condivisibile.

### B. Curare la Selezione del giorno
1. Apre `/selections/$date` → vede due pannelli affiancati respirati, con segmenti Pronti/Da arricchire e
   conteggi per bucket.
2. Scorre una riga "Da arricchire" → clicca **Arricchisci** (on-demand) → job parte, esito notificato
   (invariante progressive-enrichment).
3. Rimuove un contatto che non convince → l'azione **rimuovi è sempre visibile** (non più hover-only,
   vedi sotto) → riga rimossa, rank rinumerati, conteggi aggiornati.
4. Esporta (se pronto) → stato `exported`, lista in sola lettura.
→ **Outcome:** selezione pulita e coerente; conteggi e segmenti riflettono lo stato reale.

### C. Aggiunta contatti bulk (cuore dell'Outcome C)
1. Su un `BucketPanel` non esportato clicca **"+ Aggiungi"** → si apre il **modale "Aggiungi a
   {Freelance|Azienda}"** (più ampio e leggibile del pannello inline).
2. Il modale carica il **pool**: contatti `scored` di *quel* bucket non già nella selezione, ordinati per
   fit (endpoint esistente, max 30 — vedi cap sotto). Mostra ricerca testo + filtro presenza email (lo
   stesso componente filtri).
3. L'operatore **seleziona più candidati** (checkbox per riga + "seleziona tutti i visibili"). Un
   contatore "**N selezionati**" è sempre visibile.
4. Affina con ricerca/filtro email: i candidati **già selezionati restano selezionati** anche se escono
   dal filtro corrente (la selezione è per-id, non per-vista).
5. Clicca **"Aggiungi N contatti"** → bulk **best-effort con isolamento per item**: ogni item viene
   tentato; un duplicato (`409`) o un singolo errore **non annulla** gli altri.
6. Il modale mostra l'**esito**: "X aggiunti · Y saltati (già presenti) · Z errori" (con quali, se Z>0).
   Selezione e pool si **aggiornano** (gli aggiunti spariscono dal pool; conteggi e segmenti del bucket
   si ricalcolano).
7. L'operatore chiude il modale (o continua ad aggiungere). → Focus torna al pulsante "+ Aggiungi".
→ **Outcome:** più contatti aggiunti in un'unica azione; rank = `MAX(rank)+1` per item (nessun target 20,
nessun cap settore — invariante `addToSelection`); nessuno stato parziale ambiguo.

---

## Error paths

| Trigger / fallimento | Comportamento visibile | Recupero |
|---|---|---|
| Caricamento pool candidati fallisce (rete/API) | `ErrorBox` dentro il modale al posto della lista; il modale resta aperto | Bottone "Riprova" ricarica il pool; "Aggiungi" disabilitato finché il pool non c'è |
| Bulk-add, un item è già presente (`409 UNIQUE(date,contact_id)`) | Quell'item conteggiato come **"saltato (già presente)"**, *non* come errore bloccante; gli altri proseguono | Nessuna azione necessaria; il riepilogo lo elenca |
| Bulk-add, un item fallisce per rete/500 | Conteggiato come **errore** con nome del contatto; gli altri item aggiunti restano aggiunti | "Riprova i falliti" ritenta **solo** gli item non riusciti (la selezione utente li conserva) |
| Bulk-add, **tutti** falliscono | Esito "0 aggiunti · …"; il modale resta aperto, nessuna chiusura silenziosa | Riprova o correggi i filtri |
| Rimozione contatto fallisce | Messaggio d'errore nel pannello bucket (come oggi); riga non rimossa | Ritenta l'azione |
| Arricchimento on-demand fallisce | Toast d'errore (invariante progressive-enrichment) | Ritenta quando non "fresco" |
| Selezione diventa `exported` mentre il modale è aperto (concorrenza) | Al confirm il backend rifiuta/azione no-op; il modale segnala "selezione esportata, sola lettura" e si chiude | Ricaricare la pagina mostra lo stato esportato |
| Filtro non valido nell'URL (deep-link malformato) | `validateSearch` scarta i valori non validi → default (invariante esistente) | Trasparente all'utente |

Per **ogni decision point con scrittura** (aggiungi/rimuovi/arricchisci/esporta) esiste un esito
visibile: successo (aggiornamento ottimistico/invalidate + eventuale toast) o errore inline/toast. Niente
azione silenziosa.

## Edge cases

- **Pool vuoto** (nessun candidato `scored` disponibile per il bucket): stato vuoto esplicito nel modale
  ("Nessun candidato disponibile nel pool"), "Aggiungi" disabilitato. Non un errore.
- **Cap 30 del pool** (Open Question 3): il pool è capato a 30 per richiesta, ordinato per fit. Se il pool
  reale supera 30, il modale mostra un **avviso non bloccante** ("Mostrati i 30 candidati a fit più alto;
  affina la ricerca per vederne altri") così l'operatore sa che esistono altri candidati oltre i visibili.
  Prima iterazione: **cap + ricerca** (nessun lazy-load/paginazione). "Seleziona tutti i visibili" agisce
  sui ≤30 mostrati, mai su un insieme non visibile. *Lazy-load rinviato a PLAN se serve.*
- **Selezione/pannello in sola lettura** (`exported`): "+ Aggiungi", rimuovi, arricchisci assenti/disabili
  in modo coerente (invariante attuale). Il modale non si apre.
- **Selezione vuota**: empty state che invita ad aggiungere dal pool o rilanciare il run (invariante).
- **Bucket "scarta"** in Contatti: resta filtrabile in Contatti come oggi; non è un bucket di selezione,
  quindi **non** compare nel flusso di aggiunta alle Selezioni (i bucket di selezione sono solo
  Freelance/Azienda).
- **Filtri pool non persistiti nell'URL**: lo stato di ricerca/filtro *dentro il modale/pool* è locale
  (effimero, si azzera alla chiusura del modale). Solo i filtri **della pagina Contatti** stanno nell'URL.
  Questo è coerente con la situazione attuale del pannello Aggiungi e va dichiarato per non creare un
  secondo meccanismo di persistenza per sbaglio.
- **Concorrenza pool↔selezione**: se un candidato viene aggiunto altrove tra il caricamento pool e il
  confirm, l'item ricade nel ramo "già presente / saltato" del bulk best-effort: nessun blocco.
- **"solo email-ready" (Open Question 1):** oggi è un toggle locale che incide solo sull'href di export e
  **non** è nell'URL. Proposta di flusso: per coerenza con la persistenza di sessione, **renderlo parte
  dello stato URL** insieme agli altri filtri (così deep-link/reload riproducono anche questa scelta) e
  rappresentarlo come chip ("Export: solo email-ready") con la sua ✕. Resta da confermare da Omar (vedi
  Open questions). Se confermato no, va comunque reso visibile che è attivo (non un toggle "invisibile").

## Friction notes & decisioni

- **Rimuovi non più hover-only (requisito esplicito SPEC/Outcome B).** L'azione ✕ oggi è
  `opacity-0 group-hover:opacity-100`: invisibile da tastiera e touch. Decisione di flusso: l'azione
  rimuovi è **sempre presente e raggiungibile** per ogni riga (non dipende dall'hover). Per non
  reintrodurre rumore visivo su 40 righe, può restare a basso contrasto a riposo ma **diventare piena su
  hover *e* su focus da tastiera**, e deve essere un target toccabile su touch. Mai `opacity-0`: il
  contenuto deve essere percepibile e focusabile (no `display:none`/opacity 0 su un controllo attivo).
- **Bulk add per-id, non per-vista.** Selezionare per id (non per riga corrente del filtro) evita la
  frustrazione di perdere la selezione cambiando ricerca: è il dettaglio che rende il bulk "perdonante".
- **Best-effort esplicito > transazione atomica.** Invariante di dominio: un duplicato non deve far
  fallire l'intero batch. Il riepilogo "aggiunti/saltati/errori" è parte del contratto UX, non un
  optional — è ciò che dà fiducia al persona non tecnico.
- **YAGNI sul pool.** Niente paginazione/lazy-load nella prima iterazione: cap 30 + ricerca copre il caso
  reale (pool di sostituti, non catalogo). L'avviso "+ di 30" evita la falsa impressione di pool esaurito.
- **Niente nuovo store di filtri.** Si riusa l'URL per Contatti e stato locale per il pool: non si
  introduce localStorage né un secondo meccanismo (coerente con single-user/no-auth).
- **Componenti condivisi (Outcome D).** Barra filtri, select, chip e modale sono riusati tra Contatti e
  pool Selezioni: una sola definizione delle opzioni email. Le pagine fuori scope (Dashboard/Run/Report)
  restano funzionanti e visivamente accettabili dopo l'introduzione dei nuovi componenti.

### Accessibilità (UI operativa, non vetrina — requisito SPEC §Constraints)

- **Modale:** focus trap interno; focus iniziale al primo controllo utile (campo ricerca); `Escape`
  chiude; al chiudere il **focus torna** al pulsante "+ Aggiungi" che lo ha aperto; `role="dialog"` +
  `aria-modal` + label/`aria-labelledby` sul titolo. *Nota:* il `Modal` esistente in
  `web/src/components/ui.tsx` ha l'overlay e `role/aria-modal` ma **non** ha focus-trap, gestione
  `Escape`, né restore-focus → il modale di aggiunta deve coprirli (decisione di PLAN se estendere quel
  `Modal` o adottare un primitivo Radix/shadcn).
- **Chip:** ogni chip-filtro e la sua ✕ sono raggiungibili e attivabili da tastiera (Tab + Enter/Space);
  ✕ con `aria-label` esplicito ("Rimuovi filtro Bucket: Freelance"). "Pulisci" è un bottone focusabile.
- **Azioni di riga (arricchisci/rimuovi):** focusabili in ordine logico; visibili anche su `:focus`
  (vedi rimuovi sopra); `aria-label`/title chiari. Il marker ✉ ha testo alternativo (con/senza email),
  non solo colore (verde/grigio): l'informazione non passa **solo** dal colore.
- **Conteggi e segmenti:** i conteggi "Pronti / Da arricchire" sono testo leggibile, non solo badge
  colorati, così l'informazione regge senza percezione del colore.
- **Contatore selezione bulk:** "N selezionati" annunciato (live region) quando cambia, così chi usa
  tastiera/SR sa quanti item sta per aggiungere.

## Open questions

- **OQ-1 (SPEC #1) — "solo email-ready" nello stato URL?** Proposta di flusso: sì, persisterlo come gli
  altri filtri e mostrarlo come chip. Da confermare (Owner: Omar). Decisione di prodotto, non di plan.
- **OQ-2 (SPEC #2) — bulk-add: N `POST` client-side vs endpoint batch.** Indifferente al flusso UX
  *purché* l'esito resti per-item (aggiunti/saltati/errori) e best-effort. Proposta: N POST client-side
  nella prima iterazione (esiti per-item più semplici), batch solo se la latenza su ~20 item dà fastidio.
  Decisione di PLAN.
- **OQ-3 (SPEC #3) — paginazione/lazy-load del pool oltre i 30.** Flusso copre il cap con avviso "+ di
  30"; lazy-load rinviato a PLAN se l'avviso non basta nell'uso reale.
- **Modale vs sheet:** il flusso è agnostico (entrambi soddisfano i requisiti). Raccomandazione:
  **modale centrato** per un'azione focalizzata e bloccante (cerca → seleziona → conferma); uno **sheet**
  laterale è equivalente se si vuole tenere visibile la selezione sottostante. Decisione di PLAN/UI.
- **"Riprova i falliti":** confermare che ritenta solo gli item non riusciti conservando la selezione
  utente (assunzione di questo flusso). Dettaglio di interazione da fissare in PLAN.
