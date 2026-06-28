---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-28
links: []
created: 2026-06-28
updated: 2026-06-28
---

# Concetto — Esito strategia onesto (4 stati + drill-down sotto-fonte)

## Definition

Il modello di **osservabilità onesta** del "Report strategie" (AC5): ogni strategia compare nel report
**anche a 0 estratti**, e lo **stato derivato** distingue *perché* è a 0. Risolve il problema originario —
`freelance-post-reactors` spariva dal report rendendo 0, impedendo all'operatore di capire se la fonte
fosse rotta o solo vuota. `reportByStrategy` (`src/db/runs.ts`) calcola l'universo delle strategie come
**unione** di: quelle con **contatti**, quelle presenti in **`runs`**, e le `knownStrategies` passate dal
chiamante (il registry) — così una strategia mai girata non è mai omessa. È **un'unica fonte, due viste**:
la stessa funzione alimenta la CLI (`src/eval/report.ts`) e la UI (doc [[06-evaluation]]).

Il drill-down per [[sotto-fonte-respondents|sotto-fonte]] (`reportBySourceDetail`) raggruppa i contatti per
`(source_strategy, source_detail)`: mostra quanto rendono `commenter` / `tagged-person` / `company-expansion`
separatamente (CLI: `pipeline report --detail`).

## Attributes

| Stato (`StrategyState`) | Etichetta CLI | Condizione derivata |
|-------------------------|---------------|---------------------|
| `errored` | `ERRORE` | `run_error` dell'**ultimo** run (max `created_at`) non nullo |
| `never-ran` | `mai girata` | nessuna riga in `runs` **e** `extracted === 0` |
| `clean-0` | `pulita-0` | ha un run, ma `sourced === 0` **e** `extracted === 0` (girata, nulla visto) |
| `all-duplicates` | `tutti-dup` | `sourced > 0` **e** `new === 0` (visti grezzi, tutti già in DB) |
| `ok` | `ok` | altrimenti |

Note di calcolo (`reportByStrategy`):

- **Precedenza:** l'errore vince su tutto (controllato per primo); `never-ran`/`clean-0`/`all-duplicates`
  poi, infine `ok`.
- **`sourced`** = Σ `items_in` dei run (grezzi visti); **`new`** = Σ `items_new` (persistiti); **`extracted`**
  = COUNT contatti con quella `source_strategy`.
- **`errored`** legge il `run_error` solo dell'**ultimo** run per strategia (max `created_at`).
- **`knownStrategies`** è iniettato dal chiamante (`listStrategies().map(id)`) per evitare un ciclo
  `db → registry`.
- Ordinamento righe: vincitore in cima (`positive`, poi `replied`, poi `extracted`), righe a 0 in coda.

## Related flows

- [[gather-primaria-budget-riflusso]] — popola `sourcedByStrategy`/`errorByStrategy` che `logRun` scrive su
  `runs` (canale onestà: `sourced` ed `error`).
- [[respondents-azienda-first]] — produce le sotto-fonti che il drill-down poi separa.

## [Source: SPEC + IMPLEMENTATION-NOTES influencer-post-respondents]

- **AC5 (met):** una riga per strategia anche con `estratti = 0`, 4 stati (mai-girata / pulita-0 /
  tutti-duplicati / errore) + attribuzione per sotto-fonte; CLI e UI restano **un'unica fonte, due viste**
  (verifier v3 → SHIP + verifica `agent-browser` sul DB demo).
- **Verità del canale errore:** `gather` popola `errorByStrategy` nel `catch` di `runOne`; `logRun` lo
  scrive in `runs.run_error` → lo stato `errored` è osservabile, non inferito.
- **Tie su `created_at` (NIT, §3):** se due run della **stessa** strategia hanno `created_at` identico ma
  `run_error` discordante, lo stato dell'errore è non-deterministico — impossibile in pratica (una riga per
  strategia per invocazione, timestamp distinti). Fix opzionale: `ORDER BY created_at DESC, id DESC LIMIT 1`.
