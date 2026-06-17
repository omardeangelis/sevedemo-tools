---
domain: lead-engine
type: spec
status: implemented
links:
  - "[[domains/lead-engine/lead-engine|lead-engine]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
  - "[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]"
  - "[[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]]"
created: 2026-06-16
updated: 2026-06-16
---

# Spec: UX dei filtri e redesign della sezione Selezioni

---

## User input

> Vorrei migliorare la gestione e la UI dei filtri:
> Nella sezione contatti [immagine: barra con ricerca + 4 dropdown a tutta larghezza impilati — "Tutti i bucket", "Tutti gli stati", "Tutte le strategie", "Tutti" — più checkbox "solo email-ready" e bottoni Scarica CSV / JSON]
> Nella sezione Selezioni: [immagine: card "Freelance 20 contatti" con bottone "Chiudi", e un dropdown "Tutti" con tooltip "Filtra il pool per presenza email" sopra le righe dei contatti]
>
> Vorrei anche migliorare la UI/UX della sezione Selezioni in generale, mi sembra che sia tutto schiacciato poco user friendly.
>
> Hai massima libertà di azione, anche se volessi installare e usare componenti da shadcn per migliorare la UI in generale, ripensare l'organizzazione delle sezione, aggiungere modali o sheet per l'aggiunta dei contatti su più livelli

Chiarimenti raccolti prima della stesura:

- **Ambito**: il refresh riguarda **Contatti + Selezioni**; si costruiscono componenti condivisi riutilizzabili, ma Dashboard / Run / Report restano invariati per ora.
- **Aggiunta contatti "su più livelli"** = **flusso guidato in modale/sheet** + **aggiunta multipla (bulk)** dal pool. Esclusi: aggiungere a una selezione da altre sezioni, e operazioni bulk sui contatti già in selezione.
- **Pattern dei filtri**: nessuna preferenza forte → lo definisce la fase `ux-advisor` (FLOW.md), ottimizzando per ingombro ridotto e chiarezza.
- È **ammesso e incoraggiato** introdurre componenti shadcn-style (Radix-based) nel workspace `web/`.

---

## Context

La web UI locale (single-user, niente auth) serve a consultare la pipeline e a **correggere a mano** contatti e selezioni prima dell'export verso il tool email. Due superfici sono diventate scomode all'uso:

1. **I filtri sono ingombranti e poco gestibili.** Nella pagina **Contatti** la ricerca e i quattro dropdown ("Tutti i bucket", "Tutti gli stati", "Tutte le strategie", presenza email) sono resi a tutta larghezza e impilati: occupano molto spazio verticale, spingono giù la lista e non c'è un colpo d'occhio sui filtri attivi né un reset unico. Lo stesso pattern, in versione mignon, ricompare nel pool delle **Selezioni**.
2. **La sezione Selezioni è "schiacciata".** La vista della Selezione del giorno impila righe molto dense (padding stretti, tipografia 11–12px, segmenti senza respiro) e l'aggiunta di contatti avviene in un pannellino inline angusto, un contatto alla volta.

Questa spec dà all'operatore (oggi Omar in test, domani un operatore SeVedemo non tecnico) **filtri compatti e leggibili** con persistenza invariata, una **sezione Selezioni che respira** ed è scansionabile, e un'**aggiunta contatti guidata e multipla** tramite modale/sheet. È un lavoro di UI/UX a invarianza funzionale: non cambia la semantica della pipeline, riorganizza e ripulisce la superficie già esistente.

---

## Non-Goals

- Cambiare la **selezione automatica** 20+20 (resta fit-based) o qualsiasi logica di pipeline (acquisition/enrichment/scoring/export).
- Aggiungere contatti a una selezione **da altre sezioni** (pagina Contatti / dettaglio contatto): escluso da scope.
- **Operazioni bulk sui contatti già in selezione** (rimozione multipla, spostamento tra bucket): escluse.
- Ridisegnare **Dashboard, Run, Report**: restano invariati (potranno adottare i nuovi componenti in futuro, non richiesto ora).
- Persistenza filtri **cross-sessione** o per-utente (niente localStorage/account): resta lo stato di sessione nell'URL.
- Integrazione diretta col tool email: l'handoff resta l'export CSV/JSON.
- Modifiche obbligatorie allo **schema DB** o alla CLI.

---

## Acceptance Criteria

### Outcome A — Filtri compatti e gestibili (Contatti + pool Selezioni)

- I filtri della pagina Contatti **non** sono più quattro dropdown a tutta larghezza impilati: ricerca e filtri stanno in una **barra compatta su una riga** che occupa meno spazio verticale e non spinge la lista fuori dalla prima schermata (pattern fissato in FLOW.md: barra compatta + chip dei filtri attivi).
- I **filtri attivi sono mostrati come chip** sotto la barra (uno per filtro attivo, ciascuno rimovibile singolarmente) ed esiste un'**azione unica "Pulisci"** per azzerarli tutti.
- Restano disponibili e **componibili** tutti i filtri attuali: testo, bucket, status, strategia, presenza email (tri-state: tutti / con email / senza email), e la modalità export "solo email-ready" (la sua persistenza nell'URL è Open Question 1).
- La **persistenza nell'URL (ambito sessione)** continua a valere senza regressioni: **filtri e pagina corrente** sopravvivono a dettaglio↔lista, navigazione, reload e link condivisibile (ricaricando sulla pagina 3 si torna alla pagina 3); un **cambio filtro resetta la pagina a 1**. (Invariante di [[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]] / [[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]], dove `page` è uno dei campi persistiti.)
- Il **pool candidati delle Selezioni** usa lo **stesso componente** di ricerca/filtro della pagina Contatti (niente fork del pattern), incluso il filtro presenza email.

### Outcome B — Sezione Selezioni più respirata e leggibile

- La vista della Selezione del giorno **non risulta più schiacciata**. Handle binari minimi: **nessuna informazione chiave resa sotto i 12px** (oggi header di sezione a 11px, body liste a 12px) e **padding di riga e del body delle liste aumentati** rispetto all'attuale (oggi `py-3` per riga, body del `Card` senza padding). I criteri di dettaglio (spaziatura, gerarchia tipografica) sono in FLOW.md; verifica visiva con `agent-browser`.
- Per ciascuna riga restano presenti e più scansionabili le informazioni chiave: nome, headline, **presenza email**, fit, rank, badge di stato (es. "bozza da rigenerare").
- I segmenti **"Pronti per email"** e **"Da arricchire"** con i relativi **conteggi per bucket** restano visibili e nettamente distinti (invariante email-segmentation-filters).
- Le azioni per riga (**arricchisci**, **rimuovi**) e di bucket (**arricchisci tutti**) restano accessibili e leggibili. L'azione "rimuovi", oggi `opacity-0` fino all'hover, **non è più hover-only**: sempre presente e focusabile, piena su hover **e** su focus da tastiera, con touch target adeguato.
- L'azione **"arricchisci"** (per riga e per bucket) continua ad **avviare l'enrichment on-demand con esito notificato in-app**, funzionalmente invariata rispetto a [[specs/lead-engine/progressive-enrichment/SPEC|progressive-enrichment]] (il refresh ne cambia solo la resa visiva, non il comportamento).
- La **grid indice** delle Selezioni (`/selections`) resta coerente con il nuovo look.

### Outcome C — Aggiunta contatti guidata e multipla

- L'aggiunta di contatti a una selezione avviene tramite un **modale/sheet dedicato**, più ampio e leggibile del pannello inline attuale (cerca → anteprima → conferma).
- Dal modale/sheet è possibile **selezionare più candidati e aggiungerli in un'unica azione (bulk)**, non solo uno alla volta. La selezione è **per-id**: cambiare ricerca/filtro nel pool non perde i candidati già spuntati.
- Il pool mostrato è quello corretto: contatti **`scored` del bucket non già nella selezione**, ordinati per fit, filtrabili per testo e presenza email. Il pool mostra al massimo i primi 30 per fit: quando i match sono di più, un **avviso non bloccante** segnala che ne sono mostrati solo i primi 30 e invita a restringere con la ricerca (no lazy-load in prima iterazione — vedi Open Question 3).
- L'aggiunta **non impone i vincoli della selezione automatica**: nessun target 20, nessun cap per settore — l'operatore aggiunge chi vuole, e il contatto compare **in fondo al proprio bucket**. Aggiungere un contatto **già presente non blocca** l'operatore né interrompe il resto del batch. (Meccanismo invariato — `addToSelection`, rank `MAX+1`, `409` su `UNIQUE(date, contact_id)` — in Technical Notes.)
- Il bulk-add è **best-effort con isolamento per item**: un singolo fallimento (es. già presente) non annulla gli altri. L'esito è riportato **per-item** (quanti **aggiunti / saltati / in errore**) con possibilità di **ritentare solo i falliti**.
- Dopo un'aggiunta (singola o bulk) **selezione e pool si aggiornano coerentemente**, senza stati parziali ambigui.

### Outcome D — Base componenti condivisa

- I nuovi controlli (barra filtri, select, chip, modale/sheet) sono **componenti riutilizzabili e coerenti** tra Contatti e Selezioni; niente fork del pattern di filtro né opzioni email duplicate (`EMAIL_OPTIONS` vs `EMAIL_FILTER_OPTIONS` oggi divergono).
- Le pagine **non in scope** (Dashboard, Run, Report) restano **funzionanti e visivamente accettabili** dopo l'introduzione dei nuovi componenti/dipendenze.

---

## Constraints

- **Stack**: React 19 + TanStack Router/Query + Tailwind 4 + Vite in `web/` (workspace npm separato). La segmentazione è **read-side**: nessun cambio di schema o di backend è obbligatorio.
- **Componenti shadcn-style** (Radix-based) ammessi/incoraggiati, ma la spec resta **agnostica sull'implementazione**; eventuali nuove dipendenze restano confinate al workspace `web/`.
- **Niente auth, single-user locale**: persistenza filtri solo via URL (sessione), nessun localStorage/account.
- **Nessuna regressione** delle spec già implementate: email-segmentation-filters (persistenza URL, email tri-state, export "solo email-ready", marker ✉, segmenti pronti/da-arricchire), progressive-enrichment (azione "arricchisci email" on-demand su righe e bucket), email-draft-guard, italy-geo-gate.
- **SQLite unica fonte di verità**; gli export restano sempre una **vista** non distruttiva.
- **Best-effort con isolamento per item** per le operazioni bulk (invariante di dominio).
- **Accessibilità**: modale/sheet, dropdown, chip e azioni di riga devono essere usabili da tastiera con focus management corretto (è una UI operativa, non vetrina). Il `Modal` attuale in `ui.tsx` ha overlay e `role/aria-modal` ma **non** ha focus-trap, gestione `Escape` né restore-focus: il modale di aggiunta deve coprire questi gap (estendere `Modal` o adottare un primitivo Radix/shadcn — decisione di plan). Marker ✉ e conteggi non devono dipendere solo dal colore.

---

## Technical Notes

Osservazioni dalla discovery (stato attuale, non scelte di design):

- Nessuna libreria di componenti oggi: tutto custom in `web/src/components/ui.tsx` (monolitico). Esiste già un componente `Modal` riutilizzabile e un set di `btn`/`inputCls`/`Card`/`Badge`.
- Pagine coinvolte: `web/src/routes/contacts.index.tsx` (filtri Contatti), `web/src/routes/selections.$date.tsx` (vista Selezione, `BucketPanel`, `SelectionRow`, pannello "Aggiungi" inline), `web/src/routes/selections.index.tsx` (grid indice).
- **Filtri Contatti** già nell'URL via TanStack Router con `validateSearch` hand-rolled (no zod in `web/`). Riusare quel meccanismo per non regredire la persistenza.
- **Duplicazione nota**: opzioni filtro email definite due volte (`EMAIL_OPTIONS` in Contatti, `EMAIL_FILTER_OPTIONS` nel pannello Aggiungi); nessun componente `Select` condiviso → unificare. Allinea anche con tech-debt [[../../../tech-debt/lead-engine/email-segmentation-filters|email-segmentation-filters]] §TD-1 (fork dei predicati "email presente") / §TD-2 (`ContactFilters` omette `sector`/`minFit`).
- La checkbox **"solo email-ready"** oggi **non** è persistita nell'URL come gli altri filtri (è stato locale) → vedi Open Question 1.
- **Endpoint esistenti** già sufficienti per il grosso: pool `GET /api/selections/:date/candidates?bucket=&q=&email=` (max 30, ordinati per fit), `POST /api/selections/:date/contacts {contactId,bucket}` (rank MAX+1, `409` se duplicato), `DELETE …/contacts/:contactId` (rinumera rank), export filtrabile `export.csv|.json`. Il **bulk-add** può comporsi lato client su N POST oppure con un endpoint batch (decisione di plan, vedi Open Question 2).
- **Densità attuale** (per riferimento del "schiacciato"): `SelectionRow` con `py-3`, candidati del pannello Aggiungi con `py-2`, header di sezione a `text-[11px]`, hint a `pb-1`, body liste a `text-xs`; il `Card` non ha padding sul body (le liste partono dal bordo).

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | La modalità "solo email-ready" deve diventare parte dello stato URL persistito come gli altri filtri? | Outcome A, persistenza | Omar | Risolta → PLAN (sì, persistito nell'URL + chip) |
| 2 | Bulk-add: comporre N `POST` lato client (semplice, esiti per-item facili) o introdurre un endpoint batch `POST /api/selections/:date/contacts:batch`? *Proposta: client-side nella prima iterazione, batch solo se serve.* | Outcome C, backend | plan | Open |
| 3 | Cap pool a 30: con l'aggiunta multipla, in una iterazione futura serve lazy-load/paginazione nel modale o basta avviso "+ di 30" + ricerca? *Prima iterazione: cap + avviso + ricerca (FLOW).* | Outcome C, pool | plan | Open |
| 4 | Layout Selezioni: due pannelli bucket affiancati vs tab/sheet per bucket. | Outcome B, layout | ux-advisor | Risolta → FLOW (due pannelli affiancati, collasso in colonna singola sotto `xl`) |
| 5 | Pattern preciso dei filtri (barra compatta + chip vs bottone "Filtri" + popover/sheet). | Outcome A, layout | ux-advisor | Risolta → FLOW (barra compatta + chip + "Pulisci") |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Ambito limitato a **Contatti + Selezioni** (Dashboard/Run/Report invariati) | L'utente vuole risultati mirati sulle due sezioni problematiche; i componenti restano riutilizzabili altrove in seguito |
| Aggiunta contatti = **modale/sheet guidato + bulk multi-add**; esclusi "aggiungi da altre sezioni" e "bulk sui già presenti" | Scelta dell'utente per bilanciare valore e ampiezza dello scope |
| **Pattern dei filtri deciso da `ux-advisor`** (FLOW.md) | L'utente non ha preferenza forte; ottimizzare per ingombro ridotto e chiarezza |
| **Componenti shadcn-style ammessi** ma spec agnostica | L'utente li ha esplicitamente autorizzati; il "come" è decisione di plan, non di spec |
| **Nessuna regressione** di email-segmentation-filters / progressive-enrichment | Sono comportamenti di prodotto già validati e in uso; il refresh è a invarianza funzionale |
| Refresh **a invarianza funzionale** (riorganizza la superficie, non la pipeline) | Riduce il rischio: niente cambi di semantica DB/selezione, solo UI/UX e riuso componenti |
