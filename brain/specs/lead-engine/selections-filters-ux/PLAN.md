---
domain: lead-engine
type: plan
spec: selections-filters-ux
links:
  - "[[specs/lead-engine/selections-filters-ux/SPEC|selections-filters-ux]]"
  - "[[specs/lead-engine/selections-filters-ux/FLOW|FLOW]]"
  - "[[domains/lead-engine/07-web-ui|07 — Web UI]]"
  - "[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]"
  - "[[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]]"
created: 2026-06-16
updated: 2026-06-16
---

# PLAN — UX dei filtri e redesign della sezione Selezioni (`selections-filters-ux`)

**Status:** Done
**Execution mode (suggerito):** `parallel` a ondate. **Solo frontend** (`web/`): `T1` (fondazione shadcn)
blocca tutto; poi due catene FE per-file (`contacts.index.tsx` e `selections.$date.tsx`) corrono in
parallelo tra loro ma sono **sequenziali al loro interno** (stesso file → niente co-edit in worktree
paralleli).

> **A invarianza funzionale.** Nessun cambio di schema, query SQL, endpoint, selezione 20+20, prompt o
> pipeline. Il bulk-add riusa l'endpoint `POST /api/selections/:date/contacts` esistente con **N chiamate
> client-side**. La persistenza filtri resta **solo nell'URL** (sessione) via il `validateSearch`
> hand-rolled già presente. → **Zero task server, zero vitest**: la validazione è `tsc --noEmit` +
> `agent-browser` (nessun runner FE, decisione di progetto — vedi [[domains/lead-engine/07-web-ui]] e la
> testing-convention del dominio).

---

## 1. Situazione iniziale

Web UI locale (Hono :8787 + **React 19 + TanStack Router/Query + Tailwind 4** in `web/`, no auth,
single-user). Stato attuale verificato in discovery:

- **`web/` non ha component library** (`web/package.json`): solo React + TanStack + Tailwind 4
  (`@tailwindcss/vite`). Niente Radix, `class-variance-authority`, `tailwind-merge`, `clsx`. Helper
  custom `cls()` + set `btn`/`Badge`/`Card`/`inputCls`/`Modal` in `web/src/components/ui.tsx` (~280 righe).
- **Filtri Contatti già nell'URL** (`web/src/routes/contacts.index.tsx:30-43`): `validateSearch`
  hand-rolled (no zod), campi `q/bucket/status/strategy/email/page`, default strippati, `page` persistito,
  `setFilter` azzera `page` (`:80-81`). 4 `<select>` `inputCls w-auto` impilati con `flex-wrap` (`:123-158`).
- **Toggle "solo email-ready"** è `useState` locale (`contacts.index.tsx:70`), incide **solo** sull'href
  di export (`:88-95`), **non** nell'URL → perso a reload/navigazione.
- **Fork opzioni email**: `EMAIL_OPTIONS` (`contacts.index.tsx:56-60`) vs `EMAIL_FILTER_OPTIONS`
  (`selections.$date.tsx:427-431`) — stessa cosa, due definizioni (tech-debt §TD-1).
- **Selezione** (`selections.$date.tsx`): grid `xl:grid-cols-2` (`:178`) di due `BucketPanel`
  (`:288-425`); `SelectionRow` (`:211-286`) densa (`py-3`, `:235`), header segmento `text-[11px]`
  (`:373,390`), hint `pb-1` (`:404`), `Card` senza padding sul body. **Rimuovi ✕ è hover-only**
  (`opacity-0 group-hover:opacity-100`, `:277`). ✉ marker solo colore (`:247-255`).
- **Aggiunta contatti**: `AddPanel` inline (`:433-506`), pool via `api.candidates(date,bucket,q,email)`
  (`client.ts:54`), **un contatto alla volta** (`add.mutate(c.id)`, `:492`); un `409` (duplicato) finisce
  come **errore bloccante** (`add.isError`, `:468`). Pool max 30 lato server.
- **`Modal` esistente** (`ui.tsx:249-275`): overlay + `role="dialog"`/`aria-modal`, chiude su click overlay,
  ma **niente focus-trap, niente `Escape`, niente restore-focus**.
- **`addToSelection`** (`client.ts:56`) → `POST .../contacts {contactId,bucket}`: rank `MAX+1`, `409` su
  `UNIQUE(date,contact_id)`; `removeFromSelection` rinumera i rank. **Nessun cap target/settore**
  sull'aggiunta manuale (per design).

## 2. Problema

Da SPEC, due limiti d'uso su Contatti + Selezioni:

1. **Filtri ingombranti/poco gestibili**: 4 dropdown full-width impilati, nessun colpo d'occhio sui filtri
   attivi, nessun reset unico; pattern duplicato nel pool.
2. **Sezione Selezioni "schiacciata"** e aggiunta contatti angusta (pannellino inline, un contatto alla
   volta), con rimuovi hover-only (inaccessibile da tastiera/touch).

## 3. Forma della soluzione

Refresh **a invarianza funzionale** in tre aree + una fondazione, tutto FE:

- **Fondazione (T1):** adottare **`shadcn/ui`** come standard di componenti (Radix sotto → chiude il gap
  a11y del `Modal`), con `components.json`, alias `@/`, `cn()`, CSS variables, e i primitivi necessari
  (Button/Input/Select/Checkbox/Dialog/Badge/Popover). Coesiste con `ui.tsx` esistente; nessun big-bang.
- **Filtri (T2, T3):** barra compatta su una riga + **chip dei filtri attivi** + **"Pulisci"** unico,
  in un componente **FilterBar state-source-agnostic** (controlled `value`+`onChange`) riusato da Contatti
  (URL-backed) e dal pool (local-state). Una sola definizione delle opzioni email. "solo email-ready"
  **persistito nell'URL** + chip (OQ-1 risolta = sì).
- **Layout Selezioni (T4):** due pannelli affiancati più respirati (collasso < `xl`), tipografia ≥12px per
  le info chiave, segmenti Pronti/Da-arricchire + conteggi invariati, **rimuovi non più hover-only**
  (sempre presente/focusabile), ✉ con testo alternativo (non solo colore).
- **Aggiunta contatti (T5, T6):** **Dialog** guidato (focus-trap/Escape/restore-focus) che sostituisce
  l'`AddPanel`; pool via FilterBar in local-state; **modello esito per-item** (`aggiunto`/`saltato (409)`/
  `errore`) + riepilogo "X·Y·Z" **già sul single-add** (T5); poi **multi-select + "seleziona visibili" +
  fan-out N POST + "riprova i falliti"** (T6). Best-effort con isolamento per item.

## 4. Decision ledger (risolto)

| Decisione | Esito | Rationale |
|-----------|-------|-----------|
| Standard componenti | **Full `shadcn/ui`** (CLI init, `@/` alias, `cn()`, CSS vars, cva/tailwind-merge/clsx, Radix), come standard per i componenti futuri | Scelta utente ("Want shadcn to create a standard for the future components"). Radix chiude il gap a11y del `Modal`. Coesiste con `ui.tsx`; migrazione incrementale, no big-bang. |
| OQ-1 — "solo email-ready" nell'URL | **Sì**: persistito come gli altri filtri + reso come **chip** | Scelta utente ("Yes persist the filter too"). Coerenza con la persistenza di sessione; mai un toggle attivo invisibile. |
| OQ-2 — meccanismo bulk-add | **N `POST` client-side** (no endpoint batch) in prima iterazione | A invarianza funzionale (nessun cambio backend); esiti per-item più semplici. Batch solo se la latenza su ~20 item desse fastidio (rimandato). |
| OQ-3 — pool oltre i 30 | **Cap 30 + avviso non bloccante + ricerca**; niente lazy-load ora | YAGNI: il pool è di sostituti, non un catalogo. |
| Add UI — modale vs sheet | **Dialog centrato** (Radix) | Azione focalizzata cerca→seleziona→conferma; chiude il gap a11y. |
| Pattern filtri | **Barra compatta + chip + "Pulisci"** (no bottone "Filtri" + popover) | Filtri pochi e ad alto uso; il problema è l'ingombro verticale, non il numero (FLOW DECISIONE 1). |
| Layout Selezioni | **Due pannelli affiancati, collasso < `xl`** (no tab) | I bucket vanno confrontati a colpo d'occhio; il problema è la densità interna (FLOW DECISIONE 2). |
| FilterBar condivisa | **State-source-agnostic** (controlled value+onChange) | Contatti la cabla all'URL, il pool a `useState` — un solo componente, due sorgenti di stato (FLOW Edge "filtri pool non nell'URL"). |
| Modello esito per-item | **Costruito sul single-add (T5)**, riusato nel bulk (T6). **Il `409` è ambiguo lato server** (`app.ts:96` "Selezione esportata: editing bloccato" = **fatale**; `app.ts:105` "Contatto già presente" = **saltato**) → classificazione esplicita per status+messaggio (vedi T5) | Valida la semantica più rischiosa con N=1 una wave prima; ma `409`≠sempre "saltato": l'export-lock va trattato come stop, non come skip silenzioso. |
| a11y | **Nei task che possiedono la superficie** (T2/T4/T5/T6), non in un bucket "polish" finale | a11y rinviata = a11y persa; ogni obbligo FLOW §Accessibilità mappa sul suo owner (ux-advisor). |
| "Riprova i falliti" | Ritenta **solo** gli item falliti, **conservando** la selezione utente | Dettaglio di interazione fissato (FLOW Open question). |

## 5. Assunzioni e vincoli

- **Solo FE, a invarianza funzionale**: nessun task server, nessun cambio schema/endpoint/SQL/selezione.
  Bulk = N `addToSelection` client-side. Persistenza filtri = URL (sessione).
- **No-regression (hard)**: stato URL Contatti incl. `page` (reload/back/link), email tri-state, export
  "solo email-ready", marker ✉, segmenti Pronti/Da-arricchire + conteggi, azione "arricchisci" on-demand
  con esito notificato. Riferimenti: [[specs/lead-engine/email-segmentation-filters/SPEC]],
  [[domains/lead-engine/concepts/stato-filtri-url]].
- **FilterBar agnostica allo stato**: `value`+`onChange` controllati; Contatti scrive nell'URL
  (`navigate({search})`), il pool in `useState`. **Niente nuovo store**, niente localStorage.
- **`web/` non ha zod**: il `validateSearch` resta hand-rolled; estenderlo per `emailReady` mantenendo il
  default-stripping.
- **shadcn ↔ Tailwind v4 + React 19**: setup via guida ufficiale shadcn per **Vite + Tailwind v4** (alias
  `@/` in `tsconfig`+`vite.config.ts`; `cn()` in `@/lib/utils`; CSS vars in `styles.css`). Import relativi
  esistenti (`../api/client`) restano validi; i nuovi componenti shadcn vivono sotto `@/components/ui`.
- **Pagine fuori scope** (Dashboard/Run/Report): non ridisegnate, ma devono **buildare e restare
  visivamente accettabili** dopo l'introduzione di deps/CSS-vars shadcn (gate in T7).
- **Pool cap 30**: invariato lato server; il modale mostra un avviso non bloccante quando i match
  superano i 30 mostrati. "Seleziona tutti i visibili" agisce solo sui ≤30 resi.
- **`agent-browser`** disponibile per la validazione delle superfici visive.

## 6. Findings dal codice (riassunto operativo)

| Punto | File:riga | Implicazione |
|-------|-----------|--------------|
| `validateSearch` + `setFilter` (page reset) | `contacts.index.tsx:30-43,80-83` | Estendere con `emailReady`; riusare per i chip (✕ = `navigate` su un campo). |
| 4 select impilate | `contacts.index.tsx:123-158` | Sostituire con `<FilterBar>` compatta + `<FilterChips>` + "Pulisci". |
| Toggle email-ready locale | `contacts.index.tsx:70,88-95` | Spostare nello stato URL (chip) + href export derivato. |
| Fork opzioni email | `contacts.index.tsx:56-60` + `selections.$date.tsx:427-431` | Una sola definizione condivisa (tech-debt §TD-1). |
| `BucketPanel`/`SelectionRow` densi | `selections.$date.tsx:211-286,288-425` | Padding/typografia; `Card` body padding; segmenti invariati. |
| Rimuovi hover-only | `selections.$date.tsx:277` | Mai `opacity-0` su controllo attivo: sempre presente, pieno su hover **e** focus, touch target. |
| ✉ solo colore | `selections.$date.tsx:247-255` | Aggiungere testo alternativo (con/senza email), non solo verde/grigio. |
| `AddPanel` inline, single-add, 409=errore | `selections.$date.tsx:433-506,468,492` | Diventa `Dialog`; 409 → "saltato"; checkbox + bulk fan-out. |
| `Modal` senza focus mgmt | `ui.tsx:249-275` | Adottare Radix Dialog (shadcn) per focus-trap/Escape/restore-focus. |
| `addToSelection` / `candidates` | `client.ts:54-61` | Riusati as-is dal bulk (N POST) e dal pool del Dialog. |
| `+ Aggiungi`/`Chiudi` toggle | `selections.$date.tsx:303,344-354` | Diventa "apri Dialog" + restore-focus al pulsante alla chiusura. |

## 7. Ricerca esterna

- **shadcn/ui — install su Vite + Tailwind v4 + React 19** (unico pezzo realmente nuovo). In **T1**
  consultare la doc primaria shadcn (via Context7 `shadcn` o web) per: `components.json`, alias `@/` in
  `tsconfig`+`vite.config.ts`, `@theme`/CSS variables con Tailwind v4, e l'uso di `cn()`. Verificare la
  compatibilità React 19 (supportata) e che `@tailwindcss/vite` non confligga con la config CSS shadcn.
- **Radix Dialog** (sotto shadcn `dialog`): conferma di focus-trap/`Escape`/restore-focus nativi → chiude
  i gap del `Modal`. Nessun'altra libreria nuova oltre a quelle che shadcn init installa.

## 8. Dependency graph & waves

```
Wave 1 ─► T1 (shadcn foundation)  ── blocca tutto
            │
Wave 2 ─►   ├─ T2 (contacts.index.tsx: FilterBar+chips+Pulisci)      ┐ file distinti
            └─ T4 (selections.$date.tsx + selections.index.tsx: layout/respiro/remove a11y) ┘ → paralleli
            │
Wave 3 ─►   ├─ T3 (contacts.index.tsx: email-ready URL+chip)  ← T2   ┐ file distinti
            └─ T5 (selections.$date.tsx: Dialog + single-add + esito) ┘ → paralleli
                 ← T1,T2,T4
            │
Wave 4 ─►   T6 (selections.$date.tsx: multi-select + bulk + retry)  ← T5
            │
Wave 5 ─►   T7 (typecheck/build + regress out-of-scope + doc)  ← T2,T3,T4,T5,T6
```

- **Wave 2 (parallelo):** T2 (`contacts.index.tsx`) e T4 (`selections.$date.tsx`) — file diversi.
- **Wave 3 (parallelo tra catene):** T3 (`contacts.index.tsx`, dopo T2) e T5 (`selections.$date.tsx`,
  dopo T4) — file diversi tra loro, serializzati dentro la rispettiva catena.
- **Catene per-file (serializzazione anti-conflitto):** `contacts.index.tsx`: T2 → T3.
  `selections.$date.tsx`: T4 → T5 → T6. **Non** co-editare lo stesso file in worktree paralleli.
- T5 dipende da **T2** (riusa `FilterBar`/`FilterChips` + opzioni email) **e** da **T4** (stesso file).

## 9. Testing strategy

- **Nessun task server / nessun vitest**: il change è interamente FE, a invarianza funzionale.
- **Tutti i task FE → `agent-browser`** (niente runner FE). Ogni task definisce un `tdd_target` come
  **comportamento osservabile** (RED = stato attuale/assenza; GREEN = comportamento verificato nel
  browser). `review_mode: browser` (T1/T7 `mixed`: includono gate CLI). `assigned_skills: [agent-browser]`.
- **Gate CLI trasversale** per ogni task: `npm --prefix web run typecheck` pulito; per T1/T7 anche
  `npm --prefix web run build`.
- **a11y verificata nel task owner**: focus-trap/Escape/restore-focus del Dialog (T5), rimuovi
  raggiungibile da tastiera/focus-visible (T4), chip ✕ con `aria-label` (T2/T3), live region "N
  selezionati" (T5/T6), ✉ con testo alternativo (T4) — tutte parte del `tdd_target`/validation del task,
  non rimandate a T7.
- **Sweep finale (T7)**: typecheck+build verdi; Dashboard/Run/Report ancora renderizzano; rilettura dei 4
  Outcome della SPEC contro le superfici reali.

## 10. Rischi & mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| shadcn init confligge con `@tailwindcss/vite` (Tailwind v4) o con TanStack router-plugin | Seguire la guida ufficiale Vite+Tailwind v4 (T1); validare con `typecheck`+`build`+smoke di un componente shadcn **prima** di proseguire; non rimuovere la config Tailwind esistente, solo aggiungere CSS vars/alias. |
| CSS variables/preflight shadcn alterano lo stile delle pagine fuori scope | T1 verifica che Dashboard/Run/Report restino accettabili; T7 lo ri-controlla. Coesistenza con `ui.tsx` (niente rewrite dei componenti esistenti). |
| `FilterBar` accoppiata a TanStack `navigate`/`validateSearch` → inutilizzabile nel pool local-state | Requisito esplicito T2: componente controllato (`value`+`onChange`), agnostico alla sorgente; il pool (T5) la usa con `useState`. |
| Regressione persistenza URL (incl. `page`) migrando i filtri ai chip | I chip/Pulisci sono **viste/azioni** sopra l'URL (stesso `navigate` di `setFilter`); `tdd_target` di T2 verifica reload/back/link con `page` preservato e reset a 1 su cambio filtro. |
| **`409` ambiguo** (duplicato vs selezione esportata) classificato male nel bulk | Il server ritorna `409` sia per "Contatto già presente" (`app.ts:105` → **saltato**) sia per "Selezione esportata: editing bloccato" (`app.ts:96` → **fatale**), e il client (`client.ts:17-24`) **scarta lo status**. T5 introduce un `ApiError { status }` per ramificare: `409`+già-presente → saltato; `409`+esportata → stop ("selezione esportata, sola lettura", chiude il Dialog — ramo concorrenza FLOW); altro → errore. Verifica con duplicato **e** con selezione esportata via browser. |
| Bulk parziale lascia stato ambiguo / "riprova" perde la selezione | Riepilogo "X aggiunti · Y saltati · Z errori" obbligatorio; "riprova i falliti" ritenta solo i falliti conservando la selezione per-id; invalidate di `selection`+`candidates` dopo il batch. |
| Tre task sullo stesso `selections.$date.tsx` (T4→T5→T6) in worktree paralleli | Serializzati via `depends_on`; mai co-editare il file. |
| Cap 30 dà falsa impressione di pool esaurito | Avviso non bloccante "mostrati i 30 a fit più alto; affina la ricerca" (T5). |

## 11. Validation gates

- **Dopo T1:** `npm --prefix web run typecheck` + `npm --prefix web run build` puliti; un componente
  shadcn (es. Button) renderizza in app; Dashboard/Run/Report ancora ok (smoke `agent-browser`).
- **Dopo ogni task FE (T2–T6):** `npm --prefix web run typecheck` pulito + `tdd_target` verificato via
  `agent-browser` + rilettura dell'Acceptance Criterion SPEC corrispondente + i check a11y del task.
- **Gate finale (T7):** typecheck+build verdi; pagine fuori scope intatte; tutti e 4 gli Outcome SPEC
  riletti contro le superfici reali; nota "shadcn = standard" scritta.

## 12. Domande aperte

Nessuna bloccante. OQ-1 (email-ready nell'URL) e tutte le decisioni di plan risolte nel ledger (§4).
OQ-2 (batch endpoint) e OQ-3 (lazy-load pool) restano **rimandate** per design (non necessarie alla prima
iterazione); diventerebbero task server/FE futuri solo se l'uso reale lo richiede.

---

## Tasks

### T1: Fondazione shadcn/ui (standard componenti)

- **depends_on**: []
- **location**: web/ (package.json, vite.config.ts, tsconfig.json, src/styles.css, src/lib/utils.ts, src/components/ui/*)
- **description**: Inizializzare `shadcn/ui` nel workspace `web/` seguendo la guida ufficiale **Vite + Tailwind v4 + React 19**: `components.json`; alias `@/` aggiunto a **`web/tsconfig.json`** — unico tsconfig presente, oggi senza `baseUrl`/`paths` — con `compilerOptions.baseUrl: "."` + `paths: { "@/*": ["./src/*"] }`, **e** a `vite.config.ts` via `resolve.alias` **esplicito** (`'@': path.resolve(__dirname, './src')`, **niente** nuova dipendenza `vite-tsconfig-paths`); `cn()` in `@/lib/utils`; CSS variables/`@theme` in `src/styles.css` (senza rimuovere la config `@tailwindcss/vite` esistente). Installare i primitivi necessari al piano: `button`, `input`, **`select`** (Radix Select, per i select compatti di FilterBar — scelta fissata), `checkbox`, `dialog`, `badge`. **Non** riscrivere i componenti esistenti di `ui.tsx`: shadcn coesiste come standard going-forward. Documentare 1 riga nel `components.json`/README web che shadcn è lo standard (dettaglio in T7).
- **validation**: `npm --prefix web run typecheck` + `npm --prefix web run build` puliti; un componente shadcn (Button) renderizzato in una pagina; smoke `agent-browser` che Dashboard/Run/Report/Contatti/Selezioni caricano senza regressioni visive evidenti.
- **status**: Done
- **log**: shadcn/ui inizializzato via CLI (`init --template vite --base radix --preset nova`, l'unico modo per bypassare il prompt preset interattivo della 3.x; `add input select checkbox dialog badge`). Reconciliato `styles.css`: rimosso l'override font Geist del preset (Inter resta `--font-sans`), tenuto il `body` esistente autoritativo sul base-layer shadcn, conservati `@theme inline` + CSS vars + `@import 'shadcn/tailwind.css'`/`tw-animate-css`. Alias `@/` in tsconfig (`paths`, senza `baseUrl` perché TS6 lo deprecava → typecheck rosso) e in vite (`resolve.alias` con `__dirname` da `fileURLToPath`). `Button` cablato in `runs.tsx` (`asChild` sul Link "Apri selezione"). typecheck + build verdi; smoke agent-browser su tutte le route OK.
- **files edited/created**: `web/package.json` (edit), `web/package-lock.json` (edit), `web/vite.config.ts` (edit), `web/tsconfig.json` (edit), `web/components.json` (create), `web/src/lib/utils.ts` (create), `web/src/styles.css` (edit), `web/src/components/ui/{button,input,select,checkbox,dialog,badge}.tsx` (create), `web/src/routes/runs.tsx` (edit — minimal Button usage), `web/README.md` (create — "shadcn = standard" stub)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: dopo l'init, `npm --prefix web run build` passa e un componente shadcn `Button` importato da `@/components/ui/button` renderizza in app; le pagine esistenti (Contatti/Selezioni/Dashboard/Run/Report) continuano a caricare. RED: alias `@/` non risolto / componente shadcn assente → build fallisce.
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]

### T2: Contatti — barra filtri compatta + chip attivi + "Pulisci" (FilterBar condivisa)

- **depends_on**: [T1]
- **location**: web/src/components/filters/* (create), web/src/routes/contacts.index.tsx
- **description**: Creare i componenti riusabili `<FilterBar>` (ricerca + select compatte) e `<FilterChips>` (chip dei filtri attivi con ✕) + azione "Pulisci", costruiti su shadcn, **state-source-agnostic** (props controllate `value`+`onChange`, nessun accoppiamento a TanStack). Definire **una sola** sorgente di opzioni email in `emailOptions.ts` con **forma esplicita** `export const EMAIL_FILTER_OPTIONS: ReadonlyArray<{ value: '' | 'with' | 'without'; label: string }>` (`'' = Tutti`, `with = Con email`, `without = Senza email`), che **deve servire entrambi i consumatori**: il select Contatti URL-backed (oggi `EMAIL_OPTIONS`, tuple `[value,label]`, `contacts.index.tsx:56-60`) **e** il select pool local-state (oggi `EMAIL_FILTER_OPTIONS`, oggetti, `selections.$date.tsx:427-431`) — entrambi i fork vanno eliminati e rimpiazzati da questo unico modulo (chiude tech-debt §TD-1 / Outcome D). Sostituire in `contacts.index.tsx` le 4 `<select>` full-width impilate (`:123-158`) con `<FilterBar>` su una riga (`flex-wrap`, niente full-width) + `<FilterChips>` sotto (un chip per filtro attivo: `etichetta: valore` + ✕) + "Pulisci" (visibile solo se ≥1 filtro attivo; reset di tutti i filtri e `page`→1). Cablare value/onChange all'URL **riusando** `validateSearch`/`setFilter` esistenti: ✕ di un chip = `navigate` che azzera quel campo; "Pulisci" = `navigate` che li azzera tutti. **a11y**: ogni ✕ con `aria-label` esplicito (es. "Rimuovi filtro Bucket: Freelance"); "Pulisci" focusabile. Persistenza URL (incl. `page`) invariata.
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done
- **log**: Creato `emailOptions.ts` (`EMAIL_FILTER_OPTIONS`, unica fonte tri-state) sostituendo il fork `EMAIL_OPTIONS` in `contacts.index.tsx`. `FilterBar` controllato/state-source-agnostic (`search` + `selects[]`, sentinel `__all` per il vincolo Radix sul value vuoto) e `FilterChips` (chip Badge con ✕ `aria-label`, "Pulisci" visibile solo con ≥1 filtro, nulla se vuoto) su shadcn. Sostituite le 4 select impilate con `<FilterBar>` (una riga) + `<FilterChips>` cablati all'URL via `setFilter` esistente (✕=`setFilter(field,'')`, Pulisci=un solo `updateSearch` che azzera q/bucket/status/strategy/email+page). typecheck pulito; `agent-browser`: barra una riga (tutti i controlli a top=112), chip add/remove (anche da tastiera con Enter), Pulisci, persistenza URL+page verificata (detail↔list, reload su `?bucket=freelance&page=2`), reset page→1 al cambio filtro.
- **files edited/created**: `web/src/components/filters/FilterBar.tsx` (create), `web/src/components/filters/FilterChips.tsx` (create), `web/src/components/filters/emailOptions.ts` (create), `web/src/routes/contacts.index.tsx` (edit)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: su `/contacts` la barra filtri sta **su una riga** e la lista è visibile senza scroll; impostando bucket+email compaiono i **chip** corrispondenti con ✕ funzionante (rimuove solo quel filtro); "Pulisci" azzera tutti i filtri e riporta a pagina 1; **persistenza invariata**: con `page=2` + filtri, dettaglio→indietro e reload mantengono filtri **e** pagina, l'URL è condivisibile; un cambio filtro resetta `page` a 1. Le ✕ sono raggiungibili/attivabili da tastiera con `aria-label`. RED: oggi 4 dropdown impilati, nessun chip, nessun "Pulisci".
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T3: Contatti — "solo email-ready" persistito nell'URL + chip (OQ-1)

- **depends_on**: [T2]
- **location**: web/src/routes/contacts.index.tsx
- **description**: Spostare il toggle "solo email-ready" da `useState` locale (`:70`) allo **stato URL** estendendo `ContactSearch`/`validateSearch` con un campo `emailReady` (es. `'1'` quando attivo, omesso altrimenti, validato e strippato come gli altri). L'href di export (`contactsCsvUrl/contactsJsonUrl`) deriva da quel campo (quando attivo forza `email=with` nel download, come oggi). Rappresentarlo come **chip** ("Export: solo email-ready" + ✕) nel set di `<FilterChips>` (T2) e "Pulisci" lo include. **a11y**: chip ✕ con `aria-label`. (OQ-1 risolta = sì.)
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done
- **log**: Spostato "solo email-ready" da `useState` locale a stato URL: esteso `ContactSearch`/`validateSearch` con `emailReady?: '1'` (default-stripped, URL-shareable; TanStack serializza come `emailReady="1"` ma round-trippa correttamente). La checkbox legge `search.emailReady === '1'` e scrive via `setEmailReady` (nuovo helper che NON resetta `page`, perché il modificatore tocca solo l'export, non la lista). Aggiunto chip "Export: solo email-ready" (✕ pulisce solo `emailReady`, preserva page) e incluso `emailReady` in `clearAllFilters`; `exportFilters.email = emailReady ? 'with' : email`. Rimosso l'import `useState` ora inutilizzato. typecheck pulito; agent-browser (sessione t3): toggle→`?emailReady` + chip + CSV href `email=with`; reload preserva toggle+chip; chip ✕ e Pulisci rimuovono; su `?bucket=freelance&page=2` il toggle mantiene page=2 e lista invariata. **Post-review fix (adversarial-review v3, MAJOR):** `emailReady` ritipizzato da `'1'` a **`boolean`** — TanStack ri-JSON-encodava `'1'` (parsa come numero) in `emailReady=%221%22`, violando l'invariante "URL puliti e condivisibili". Ora `validateSearch` → `s.emailReady === true ? true : undefined` (validazione stretta: `?emailReady=badvalue`/`=1` scartati), `setEmailReady` scrive `true`/`undefined`, letto come `=== true`. Ri-verificato: URL attivo = `emailReady=true` (pulito), round-trip + export href + chip + strip OK; typecheck/build verdi.
- **files edited/created**: `web/src/routes/contacts.index.tsx` (edit)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: attivando "solo email-ready", l'URL porta il campo (es. `?emailReady=1`), compare il chip "Export: solo email-ready", e dopo **reload / nuova scheda** lo stato resta attivo (toggle + chip); l'href "Scarica CSV" contiene `email=with`; "Pulisci" lo rimuove. RED: oggi è `useState` locale → perso a reload, nessun chip.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T4: Selezioni — layout respirato + tipografia + rimuovi accessibile

- **depends_on**: [T1]
- **location**: web/src/routes/selections.$date.tsx, web/src/routes/selections.index.tsx
- **description**: Ridurre la densità di `BucketPanel`/`SelectionRow` (`:211-425`): alzare il padding verticale di riga (da `py-3`) e dare padding al body delle liste/`Card`; tipografia con gerarchia leggibile — **nessuna informazione chiave sotto i 12px** (header segmento non più `text-[11px]`, hint non più `pb-1`). Mantenere i **due pannelli affiancati** che collassano in colonna singola sotto `xl` (grid esistente) e i **segmenti Pronti/Da-arricchire + conteggi per bucket** invariati. **Preservare nel refactor di `SelectionRow` tutte le info di riga** (`:236-261`): rank, avatar, nome, headline, fit, marker ✉, e i badge `needsDraft` ("bozza da rigenerare") / `ToEnrichBadge` ("tentato di recente / tentato, nessuna email / mai tentato"). Allineare anche la **grid indice `/selections`** (`selections.index.tsx:35-53`, card su sfondo bianco con conteggi bucket-colorati) al nuovo look con card shadcn coerenti, senza cambiarne i dati (Outcome B: "la grid indice resta coerente"). **a11y (deliverable di questo task, non rimandata)**: la **rimozione ✕ non è più hover-only** (eliminare `opacity-0 group-hover:opacity-100`, `:277`) — sempre presente nel DOM e focusabile, piena su hover **e** su `:focus-visible`, touch target adeguato; il **marker ✉** ottiene testo alternativo (con/senza email), non solo colore. Azioni "arricchisci" (riga + bucket) invariate funzionalmente. Usare componenti shadcn (Badge/Card) dove sensato senza cambiare semantica.
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done
- **log**: Respiro: riga `py-3`→`py-3.5` + `px-3 sm:px-4`, segmenti `pt-4`/`mt-2`, pill summary `py-1`. Tipografia ≥12px: header segmento `text-[11px]`→`text-xs`, hint `text-[11px] pb-1`→`text-xs pt-1.5 pb-2`, pill summary ed errore bucket `text-xs`→`text-sm`. a11y: rimuovi ✕ ora `opacity-40` + `size-8` (target 32px), pieno su `group-hover`/`focus-visible`, `aria-label` "Rimuovi {nome} dalla lista"; ✉ con `sr-only` "con email"/"email mancante" + glifo `aria-hidden`. Index `/selections` ridisegnato con `Card` legacy + pill conteggi colorati (dati invariati). typecheck pulito; agent-browser: ✕ focusabile da tastiera (`:focus-visible`→opacity 1), ✉ con nome accessibile, due pannelli affiancati ≥`xl` e single-col sotto.
- **files edited/created**: `web/src/routes/selections.$date.tsx` (edit), `web/src/routes/selections.index.tsx` (edit)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: aprendo `/selections/$date`, la vista "respira" (padding riga aumentato, nessun testo chiave <12px), i due pannelli restano affiancati ≥`xl` e impilano sotto; conteggi e segmenti Pronti/Da-arricchire invariati; **tutte le info di riga sopravvivono** (rank, nome, headline, fit, ✉, badge "bozza da rigenerare" e "tentato/mai tentato"); la **rimozione ✕ è raggiungibile e attivabile da tastiera** (focus-visible) senza hover e visibile su touch; il ✉ espone testo (con/senza email) non solo colore; "arricchisci" parte e notifica come prima; la **grid `/selections`** resta coerente col nuovo look. RED: oggi righe `py-3`, header 11px, ✕ `opacity-0` (invisibile senza mouse), grid indice non allineata.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T5: Selezioni — Dialog di aggiunta guidato + single-add + modello esito per-item

- **depends_on**: [T1, T2, T4]  <!-- T4 = serializzazione su selections.$date.tsx -->
- **location**: web/src/components/AddContactsDialog.tsx (create), web/src/routes/selections.$date.tsx, web/src/api/client.ts
- **description**: Sostituire l'`AddPanel` inline (`:433-506`) con un **Dialog shadcn** "Aggiungi a {Freelance|Azienda}" **estratto in `web/src/components/AddContactsDialog.tsx` (creazione obbligatoria, non opzionale — T6 ci costruisce sopra)**, aperto dal pulsante "+ Aggiungi" del `BucketPanel` (contestualizzato al bucket). Dentro il Dialog: ricerca testo + filtro presenza email tramite la **`FilterBar` di T2 in modalità local-state** (`useState`, non URL); lista pool da `api.candidates` (max 30) con stati **vuoto / loading / errore + "Riprova"** ("Aggiungi" disabilitato finché il pool non c'è); **avviso non bloccante** quando i match superano i 30 mostrati. Mantenere il **single-add** funzionante e introdurre **già qui il modello esito per-item con la classificazione corretta del `409`**: il server ritorna `409` per **due casi distinti** — "Contatto già presente nella selezione" (`app.ts:105` → **`saltato`**) e "Selezione esportata: editing bloccato" (`app.ts:96` → **stop fatale**) — e oggi `request()` (`client.ts:17-24`) **scarta lo status** lanciando un `Error` generico. Introdurre in `client.ts` un **`ApiError extends Error { status: number }`** (popolato in `request()` con `res.status`) così il chiamante può ramificare; il classificatore mappa: `aggiunto` (2xx) / **`saltato`** (`409` + messaggio "già presente") / **stop "selezione esportata, sola lettura"** (`409` + messaggio "esportata" → chiude il Dialog, ramo concorrenza FLOW riga 168) / **`errore`** (altri status, con nome contatto). Mostrare un riepilogo "X aggiunti · Y saltati · Z errori". **a11y (deliverable)**: focus-trap nel Dialog, focus iniziale al campo ricerca, `Escape` chiude, **restore-focus** al pulsante "+ Aggiungi" alla chiusura, `role="dialog"`+`aria-labelledby`. Predisporre il contatore "N selezionati" come live region (usato dal bulk in T6). Selezione e pool si aggiornano dopo l'aggiunta (invalidate `selection`+`candidates`). Semantica `addToSelection` invariata (rank `MAX+1`, nessun cap). *Nota: l'aggiunta di `ApiError` resta FE-only — nessun cambio server.*
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done
- **log**: Aggiunto `ApiError extends Error { status }` in `client.ts` (popolato in `request()` con `res.status`; resta `instanceof Error` → callers invariati). Creato `AddContactsDialog.tsx`: Dialog shadcn/Radix con trigger "+ Aggiungi" (`DialogTrigger asChild` → restore-focus nativo), focus iniziale al campo ricerca (`onOpenAutoFocus`), `role=dialog`+`aria-labelledby`, live-region `aria-live` scaffold "N selezionati"=0 per T6; pool via `api.candidates`+FilterBar local-state (q/email da `emailOptions`), stati loading/empty/error+"Riprova", avviso non bloccante a `pool.length>=30`. Modello esito per-item + classifier puro esportato `classifyAddResult(err): {kind:'aggiunto'|'saltato'|'exported'|'errore', message?}`: 409+/esportat/i→exported (toast "sola lettura"+chiude Dialog), 409 altrimenti→saltato, altro→errore; riepilogo "X aggiunti · Y saltati (già presente) · Z errori". In `selections.$date.tsx` rimossi `adding`/AddPanel inline/fork `EMAIL_FILTER_OPTIONS`, `onSelectionUpdate`→`onAdded`, `exported`→trigger disabled. Verifiche: typecheck pulito; agent-browser su 2026-06-15 (single-add reale → "1 aggiunti", contatto sparisce dal pool, count 20→21; Escape chiude + focus torna su "+ Aggiungi"; pool azienda vuoto = stato esplicito; filtro email with 11→1); ramo **409 già-presente → saltato** verificato via UI reale (curl-add di un id poi click sulla riga stale → "0 aggiunti · 1 saltati (già presente) · 0 errori", Dialog resta aperto); ramo **409 esportata → exported/close** verificato via curl (messaggi distinti) + regex `/esportat/i` (gia-presente=false, esportata=true) + codice (export disabilita "+ Aggiungi", non triggerabile da UI). Dati di test ripristinati (rimossi id 65/26). ApiError resta FE-only.
- **files edited/created**: `web/src/components/AddContactsDialog.tsx` (create), `web/src/routes/selections.$date.tsx` (edit), `web/src/api/client.ts` (edit — `ApiError { status }`)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: cliccando "+ Aggiungi" si apre un **Dialog** col pool del bucket (ricerca + filtro email via FilterBar locale); aggiungendo un contatto **già presente** l'esito è **"saltato (già presente)"**, non un errore rosso, e il riepilogo mostra "0 aggiunti · 1 saltato · 0 errori"; se la **selezione è esportata** (409 di lock) il Dialog segnala "selezione esportata, sola lettura" e si chiude (**non** conta come "saltato"); pool vuoto/errore mostrano stato esplicito + "Riprova"; oltre 30 match compare l'avviso. **a11y**: il focus entra nel Dialog, `Escape` chiude e il focus torna su "+ Aggiungi". RED: oggi pannello inline, single-add, `409` (di entrambi i tipi) = errore rosso bloccante, status scartato, nessun focus management.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T6: Selezioni — aggiunta multipla (bulk) + "riprova i falliti"

- **depends_on**: [T5]
- **location**: web/src/routes/selections.$date.tsx, web/src/components/AddContactsDialog.tsx
- **description**: Sul Dialog di T5 aggiungere la **selezione multipla**: checkbox per riga + "seleziona tutti i visibili" (≤30) + contatore "**N selezionati**" annunciato in live region; la selezione è **per-id** (cambiare ricerca/filtro non perde gli spuntati). Pulsante "Aggiungi N contatti" → **fan-out di N `POST` client-side** (`api.addToSelection`) **best-effort con isolamento per item** sul **classificatore esito di T5** (status via `ApiError`): alla fine, riepilogo "X aggiunti · Y saltati (già presenti) · Z errori (con quali)". Se un item ritorna il `409` di **lock export** ("Selezione esportata"), la selezione è bloccata per tutti → **interrompere il batch** e mostrare "selezione esportata, sola lettura" (non contarlo tra i "saltati"). **"Riprova i falliti"** ritenta **solo** gli item in errore **conservando** la selezione utente; se **tutti** falliscono il Dialog resta aperto (nessuna chiusura silenziosa). Dopo il batch, selezione+pool aggiornati (gli aggiunti spariscono dal pool, conteggi/segmenti ricalcolati).
- **validation**: `npm --prefix web run typecheck` + `agent-browser`.
- **status**: Done
- **log**: Esteso `AddContactsDialog` (T5) con multi-select per-id + bulk + retry, **solo FE, N POST client-side**. Stato: `selectedIds: Set<number>` (per-id, sopravvive al cambio ricerca/filtro), `knownContacts: Map<number,Contact>` (identità per le label degli errori e per ri-eseguire il fan-out su id usciti dalla vista), `failedIds`, `running`. Checkbox shadcn per riga + "Seleziona tutti i visibili" (toggle select/deselect, agisce solo sui ≤30 resi) + live-region "N selezionati" cablata. `runBatch(ids)`: fan-out **sequenziale best-effort con isolamento per item** sul classifier puro di T5; **break su primo `exported`** (no altri POST) → toast "sola lettura" + `onClose()` + invalidate selection/selections, **non** contato tra i saltati; gli `aggiunto`+`saltato` (settled) escono dal Set, gli `errore` restano selezionati per il retry; `errori` ri-derivati per run (no doppio conteggio). "Aggiungi N contatti" (disabled a N=0 o pool non pronto) + "Riprova i falliti (N)" (solo se Z>0, ritenta solo i falliti conservando la selezione; se tutti falliscono il Dialog resta aperto). Post-batch: `onAdded(lastUpdated)` (fallback invalidate `['selection',date]`) + invalidate `['candidates',date]` → gli aggiunti spariscono dal pool, conteggi/segmenti ricalcolano. `selections.$date.tsx` non toccato (il Dialog incapsula il flusso; `onAdded` già cablato in T5). Verifiche: typecheck + build verdi; agent-browser (sessione t6) su 2026-06-15 reale: spunta 3 → ricerca che li esclude → restano selezionati (per-id) e "N selezionati" aggiorna → clear → "Aggiungi 3 contatti" → freelance 20→23, "3 aggiunti · 0 · 0", i 3 spariti dal pool; "seleziona tutti i visibili" select/deselect ok; **forced-duplicate bulk**: curl-add di id 57 dietro il Dialog + riga stale 57 + 59 fresco → "Aggiungi 2 contatti" → "4 aggiunti · 1 saltati (già presente) · 0 errori" (cumulativo), 59 aggiunto e **non** annullato, freelance 24→25; nessun "Riprova" con 0 errori; Escape chiude + focus torna su "+ Aggiungi". Rami **exported-abort** e **errore/retry** ragionati (non producibili da UI su selezione sana/non esportata): regex `/esportat/i` confermata sui messaggi reali del server (dup=false→saltato, export-lock=true→exported/abort). Dati ripristinati al seed (rimossi id 26/65/49/57/59 → freelance 20, azienda 2).
- **files edited/created**: `web/src/components/AddContactsDialog.tsx` (edit)
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: selezionando 3 candidati (anche cambiando ricerca tra una spunta e l'altra: restano selezionati) e cliccando "Aggiungi 3 contatti", i 3 entrano nella selezione in fondo al bucket; se uno è un duplicato il riepilogo mostra "2 aggiunti · 1 saltato · 0 errori" e gli altri **non** vengono annullati; "Riprova i falliti" ritenta solo i falliti mantenendo la selezione; "N selezionati" è annunciato. RED: oggi non esiste selezione multipla né bulk.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T7: Integrazione, regressione e documentazione dello standard

- **depends_on**: [T2, T3, T4, T5, T6]
- **location**: web/ (sweep), web/README.md o components.json (doc)
- **description**: Sweep finale **trasversale** (nessuna a11y di superficie qui — vive nei task owner): `npm --prefix web run typecheck` + `npm --prefix web run build` puliti; verifica `agent-browser` che le pagine **fuori scope** (Dashboard, Run, Report) renderizzano e restano visivamente accettabili dopo l'introduzione di shadcn (deps/CSS-vars/preflight); confermare che le opzioni email hanno **una sola** definizione (nessun fork residuo `EMAIL_OPTIONS`/`EMAIL_FILTER_OPTIONS`); rileggere i 4 Outcome della SPEC contro le superfici reali. Scrivere una nota breve ("shadcn/ui è lo standard dei componenti; i nuovi componenti vanno sotto `@/components/ui`, i custom legacy in `ui.tsx` si migrano incrementalmente").
- **validation**: `npm --prefix web run typecheck` + `npm --prefix web run build` + `agent-browser` (pagine fuori scope) + rilettura Outcome SPEC.
- **status**: Done
- **log**: Gate verdi: `typecheck` pulito (`tsc --noEmit`), `build` pulito (vite, 2018 moduli, 0 errori). **Regressione fuori scope (Outcome D)**: Dashboard `/`, Run `/runs`, Report `/report` renderizzano e sono visivamente accettabili dopo l'introduzione shadcn (deps/CSS-vars/preflight + base layer) — verificato con screenshot via `agent-browser --session t7`; il `Button` shadcn su `/runs` ("Apri selezione") è abilitato e ben stilizzato. Smoke in-scope (`/contacts`, `/selections`, `/selections/2026-06-15`) senza breakage. **Fork email**: grep su `web/src` conferma UNA sola definizione `EMAIL_FILTER_OPTIONS` in `components/filters/emailOptions.ts`; nessun `EMAIL_OPTIONS` né secondo `EMAIL_FILTER_OPTIONS` in `selections.$date.tsx` (consuma il modulo canonico via `AddContactsDialog`). **Rilettura 4 Outcome contro le superfici reali**: A=MET (barra compatta una riga, chip con `aria-label` + "Pulisci", email-ready in URL+chip, CSV `email=with`, persistenza `?bucket&email&page=2` sopravvive a reload; pool condiviso la stessa FilterBar nel Dialog); B=MET (due pannelli affiancati, segmenti "PRONTI PER EMAIL · 7"/"DA ARRICCHIRE · 13" con conteggi, header segmento ≥12px, ✉ con alt "con email"/"email mancante", rimuovi focusabile `opacity:1` non hover-only, grid `/selections` con card+pill coerenti); C=MET (Dialog "Aggiungi a Freelance" con ricerca+filtro email, checkbox multi-select + "Seleziona tutti i visibili", live region "N selezionati", "Aggiungi N contatti", focus-trap + Escape chiude + restore-focus su "+ Aggiungi"); D=MET (componenti condivisi `filters/*` + `AddContactsDialog`, legacy `ui.tsx` coesiste, pagine fuori scope ok). **Doc**: `web/README.md` già contiene la nota "shadcn = standard" completa (sezione "Component standard"). Nessun fix di regressione necessario. DB seed intatto (`GET /api/selections` → freelance 20, azienda 2); nessun add committato durante i test del Dialog.
- **files edited/created**: `brain/specs/lead-engine/selections-filters-ux/PLAN.md` (edit — questo task). Nessun file `web/` modificato: `web/README.md` aveva già la nota completa "shadcn = standard"; nessun fork email residuo e nessuna regressione trovata → nessun fix necessario.
- **backlog_item_id**: selections-filters-ux
- **backlog_item_url**: brain/specs/lead-engine/selections-filters-ux/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: typecheck+build verdi; Dashboard/Run/Report caricano e sono visivamente accettabili; nessun fork residuo delle opzioni email; nota "shadcn = standard" presente. RED: una pagina fuori scope rotta dall'init shadcn, o un fork email residuo.
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]

---

## Backlog sync

Nessun tracker esterno (Linear/GitHub Issues) è cablato per questo flusso: la "backlog" del dominio sono
le spec in `brain/specs/lead-engine/`, indicizzate in [[specs/lead-engine/lead-engine-specs|lead-engine-specs]].
L'**epic** è questa SPEC (`selections-filters-ux`); tutti i task puntano ad essa via
`backlog_item_id: selections-filters-ux` (`relation_mode: body-links`). Nessun item esterno creato/modificato.
La spec resta **Draft** nella mappa finché non implementata. OQ-1 della SPEC è risolta (sì, persistito +
chip) — vedi §4; OQ-2/OQ-3 rimandate per design.
