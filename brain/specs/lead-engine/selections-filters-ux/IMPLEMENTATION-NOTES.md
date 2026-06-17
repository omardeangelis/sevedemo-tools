---
domain: lead-engine
type: implementation-notes
spec: selections-filters-ux
links:
  - "[[specs/lead-engine/selections-filters-ux/SPEC]]"
  - "[[specs/lead-engine/selections-filters-ux/PLAN]]"
  - "[[specs/lead-engine/selections-filters-ux/FLOW]]"
ingested: false
last_ingested: null
created: 2026-06-16
updated: 2026-06-16
---

# Implementation Notes

## Summary

- Implementazione FE-only del refresh UX di Contatti + Selezioni (spec `selections-filters-ux`), a
  invarianza funzionale. 7 task in 5 ondate; orchestrazione `parallel` con worker `general-purpose`.

## Execution Mode

- **parallel** (a ondate). Worker template: `general-purpose` (nessun `manifest.mjs` di subagent in repo;
  gli unici agenti in `.agents/agents/` sono advisor). **Niente worktree isolation**: il dev server vite
  (`:5173`) gira sul tree principale, quindi la validazione `agent-browser` vede gli edit solo se
  atterrano lì. Entro ogni ondata i file sono disgiunti → worker concorrenti sicuri sullo stesso tree.
  Catene per-file serializzate via `depends_on`: `contacts.index.tsx` (T2→T3),
  `selections.$date.tsx` (T4→T5→T6).
- Validazione: `npm --prefix web run typecheck` (+ `build` su T1/T7) + `agent-browser` con `--session`
  dedicata per worker. Server attivi a inizio run: vite `:5173` UP, Hono `:8787` UP.

## Deviations From the Plan

- **T1 — `baseUrl` omesso dal tsconfig.** Il PLAN chiedeva `compilerOptions.baseUrl: "."`, ma la
  TypeScript installata (6.0.3) **deprecava** `baseUrl` (TS5101 → typecheck rosso). Con
  `moduleResolution: "bundler"` i `paths` risolvono relativi alla dir del tsconfig senza `baseUrl`, quindi
  l'alias `@/` funziona e il typecheck è pulito. Scelta: rispettare il contratto GREEN (typecheck/build
  verdi) sopra la riga letterale del piano.
- **T1 — shadcn via preset `radix`/`nova`, non il template "vanilla".** Il CLI shadcn 3.x/4.x richiede un
  preset interattivo anche con `--yes`; l'unico path headless è `init --template vite --base radix
  --preset nova`. Conseguenze gestite: i componenti usano il pacchetto unificato `radix-ui` (non i singoli
  `@radix-ui/react-*`) e `styles.css` importa `shadcn/tailwind.css`; il preset `nova` aveva iniettato il
  font Geist → rimosso e `@fontsource-variable/geist` disinstallato per preservare **Inter** come
  `--font-sans`; rimossa la base-rule `body { bg-background }` di shadcn per non sovrascrivere
  `body { bg-slate-100 }`. Deps aggiunte (solo in `web/`): `radix-ui`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `tw-animate-css`, `shadcn`.
- **T1 — Button minimale su `runs.tsx`.** Per esercitare un componente shadcn in build/app, il Link
  "Apri selezione" è stato avvolto in `<Button asChild variant="outline" size="sm">`. `runs.tsx` è una
  pagina fuori scope non posseduta da altri task → nessun conflitto; T7 ricontrolla che resti accettabile.
- **T4 — index grid con `Card` legacy, non shadcn `Card`.** T1 ha installato solo i 6 primitivi del piano
  (button/input/select/checkbox/dialog/badge); shadcn `card` non esiste. T4 ha usato il `Card` legacy di
  `ui.tsx` per la grid `/selections` → look coerente senza installare un nuovo primitivo fuori scope.
  Accettabile (Outcome B chiede coerenza, non shadcn-Card specificamente).

## Surprises and Decisions

- **Dialog/Select Radix-based confermati** (`@/components/ui/{dialog,select}.tsx` importano da `radix-ui`):
  Radix Dialog porta focus-trap/Escape/restore-focus nativi → chiude il gap a11y del `Modal` legacy per T5.
- **`ui.tsx` legacy intatto**: shadcn coesiste come standard going-forward (Outcome D / decisione utente).
- **T5 — classificazione `409` via `ApiError { status }` (FE-only).** `request()` ora lancia `ApiError`
  (estende `Error` → callers `instanceof Error` invariati). `classifyAddResult(err)` puro/esportato mappa:
  2xx→`aggiunto`, `409`+`/esportat/i`→`exported` (fatale, chiude il Dialog + toast sola-lettura),
  `409` altrimenti→`saltato`, altro→`errore`. Verificato end-to-end nel browser il ramo duplicato→`saltato`.
- **T5 — verifiche non click-abili (dichiarate).** (1) Ramo **`exported` (409-lock)**: le selezioni esportate
  disabilitano "+ Aggiungi" e non esiste una selezione esportata locale → verificato via probe `curl`
  (server ritorna i due messaggi 409 distinti, confermati) + regex + codice, non via click. (2) **>30
  warning** e **pool error/Riprova**: verificati per codice (pool reale = 11, nessun fallimento di rete
  naturale). (3) Nota Vite: un `import()` dinamico in `eval` mostrava `instanceof ApiError` fallire
  (doppia istanza di modulo) — **artefatto del solo eval dinamico**, non del runtime bundlato; il path UI
  reale classifica correttamente (provato dal test duplicato nel browser).
- **Dati seed reali**: la selezione `2026-06-15` è **20 freelance + 2 azienda** (non 20+20); i contatti di
  test aggiunti durante la validazione T5 sono stati rimossi (contatti tornati a 20/2 — verificato via API).
- **Post-review fix (adversarial-review v3, MAJOR + MINOR) — `emailReady` da `'1'` a `boolean`.** Il gate
  indipendente ha trovato che `emailReady: '1'` veniva serializzato da TanStack Router come
  `emailReady=%221%22` (TanStack ri-JSON-encoda i valori che parsano come JSON, e `'1'` parsa come numero),
  violando l'invariante "URL puliti e condivisibili" di [[domains/lead-engine/concepts/stato-filtri-url]];
  inoltre `validateSearch` accettava qualsiasi stringa truthy. **Risolto in-sessione** ritipizzando
  `emailReady` a `boolean` (`validateSearch` → `s.emailReady === true ? true : undefined`; `setEmailReady`
  scrive `true`/`undefined`; lettura `=== true`). Ri-verificato via agent-browser: URL attivo
  `emailReady=true` (pulito), round-trip su reload, export href `email=with`, chip presente, toggle pulito,
  `?emailReady=badvalue`/`=1` scartati. typecheck/build verdi. Unico finding bloccante dell'intera review.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm --prefix web run typecheck` (post-T1) | ✅ exit 0 | nessun errore |
| `npm --prefix web run build` (post-T1) | ✅ exit 0 | `✓ built`, 271 moduli |
| agent-browser smoke tutte le route (post-T1) | ✅ | /, /contacts, /selections, /selections/$date, /runs, /report renderizzano |
| `typecheck` + `build` (post-Wave 2, autorevole) | ✅ exit 0/0 | dopo T2+T4 concorrenti |
| scope changed-files (post-Wave 2) | ✅ | solo file di T1/T2/T4; `ui.tsx`/`api/*` intatti |
| fork `EMAIL_OPTIONS` rimosso da Contatti | ✅ | unificato in `filters/emailOptions.ts`; fork pool resta per T5 |
| T2 a11y/persistenza (agent-browser) | ✅ | barra 1 riga, chip ✕ da tastiera, Pulisci, reload preserva page |
| T4 a11y (agent-browser) | ✅ | remove ✕ focusabile (no opacity-0), ✉ con sr-only, 2 pannelli ≥xl |
| `typecheck` + `build` (post-Wave 3, autorevole) | ✅ exit 0/0 | dopo T3+T5 concorrenti |
| scope changed-files (post-Wave 3) | ✅ | solo file T3/T5; `ui.tsx`/`api/types` intatti |
| fork pool `EMAIL_FILTER_OPTIONS` rimosso da Selezioni | ✅ | nessun `AddPanel`/`adding`/fork residuo |
| T3 persistenza email-ready URL (agent-browser) | ✅ | `?emailReady`, chip, reload persiste, export `email=with`, Pulisci |
| T5 Dialog single-add + a11y (agent-browser) | ✅ | focus su ricerca, Escape→restore-focus, duplicato→saltato, empty state |
| T5 probe server `409` (curl) | ✅ | `Contatto già presente` (409) confermato; messaggio export-lock = costante server |
| `typecheck` + `build` (post-Wave 4) | ✅ exit 0/0 | dopo T6 |
| T6 bulk + per-id + retry (agent-browser) | ✅ | per-id sopravvive al cambio filtro, select-all-visible, fan-out, duplicato→"1 aggiunti · 1 saltati", live region |
| T6 seed ripristinato | ✅ | `GET /api/selections` = `[{date:2026-06-15,freelance:20,azienda:2}]` |
| **adversarial-review** (5 verifier, clean-context) | ✅ SHIP | v1/v2/v4/v5 SHIP; v3 DO NOT SHIP (1 MAJOR + 1 MINOR) → fixed in-sessione |
| post-fix `typecheck` + `build` | ✅ exit 0/0 | dopo il fix `emailReady` boolean |
| post-fix URL pulito (agent-browser) | ✅ | `emailReady=true` (no `%221%22`), round-trip, strip di valori non-`true` |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Outcome A — filtri compatti (barra 1 riga + chip + Pulisci), tutti componibili, persistenza URL incl. `page`, pool condiviso | Met | T2 + T3; v3 (post-fix) + v4. Reload page-3→page-3; cambio filtro→page 1; `emailReady=true` pulito. |
| Outcome B — Selezioni respirata (≥12px, padding), tutte le info di riga, rimuovi non hover-only, ✉ non solo colore, segmenti+conteggi, grid indice coerente | Met | T4; v5. Rimuovi ✕ focusabile (opacity-40→focus-visible), ✉ con sr-only; ring esplicito = nit opzionale. |
| Outcome C — Dialog guidato, bulk per-id best-effort, aggiunti/saltati/errori + riprova-falliti, pool cap 30 + avviso >30, nessun vincolo auto-selezione, refresh coerente | Met | T5 + T6; v1 + v2. 409 dual-meaning corretto (duplicato→saltato, esportata→stop fatale); isolamento + retry + tally esatto. |
| Outcome D — componenti condivisi (no fork/duplicazione), pagine fuori scope funzionanti/accettabili | Met | T2/T5 + T7; v4 (singolo `emailOptions`, `FilterBar` condivisa) + v5 (Dashboard/Run/Report intatti, gate verdi). |
| FLOW error/edge (duplicato→skip, exported-while-open→close, all-fail→open, empty/error/Riprova, cap-30, per-id) | Met | v1/v2/v5. Ramo export-lock verificato via probe API+codice (non click-abile: l'export disabilita il trigger). |

## Pre-existing Issues

- Nessuna scoperta durante l'esecuzione (server/DB/query non toccati; refactor a invarianza funzionale).

## Out of Scope Observations

- **A11y nit opzionale (durable, → tech-debt):** la rimozione ✕ in `selections.$date.tsx` si affida
  all'outline di default del browser (nessun `focus-visible:ring-*` esplicito su `btn.danger`); funzionale
  e raggiungibile, ma un ring disegnato sarebbe più chiaro.
- **A11y nit opzionale (durable, → tech-debt):** il marker ✉ in `runs.tsx` (RunCard, pagina fuori scope)
  non ha testo alternativo/`aria-hidden` — pattern preesistente su pagina non in scope.
- **Nit naming:** il modulo unificato esporta `EMAIL_FILTER_OPTIONS` (stesso nome di uno dei fork rimossi)
  — nessuna divergenza oggi, ma un merge da branch stale potrebbe saltare il rename con un grep-by-name.

## Remaining Work

- Nessuna voce bloccante. Solo i 2-3 nit a11y/hygiene opzionali sopra (candidati a `tech-debt` in fase di
  `docs-maintenance`), non richiesti per lo ship.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-06-16 | adversarial-review v3: `emailReady=%221%22` viola "URL puliti e condivisibili" + validazione lasca | Ritipizzato `emailReady` a `boolean` (URL `emailReady=true`) + validazione stretta; ri-verificato; review → SHIP |
