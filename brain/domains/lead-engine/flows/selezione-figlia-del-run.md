---
domain: lead-engine
type: flow
status: implemented
ingested: true
last_ingested: 2026-06-15
links:
  - "[[specs/lead-engine/progressive-enrichment/SPEC]]"
  - "[[specs/lead-engine/progressive-enrichment/IMPLEMENTATION-NOTES]]"
created: 2026-06-15
updated: 2026-06-16
---

# Flow — Selezione figlia del Run (generazione, provenienza, export)

Riallinea il modello concettuale **Run ↔ Selezione**: la `daily_selection` smette di essere agganciata
alla sola data e diventa l'**export di un Run** — registra il `run_id` dell'esecuzione che l'ha generata,
è seminata dai migliori contatti eleggibili di quel momento, e ha un **ciclo di vita proprio**
(`in_review → exported`). Resta editabile a mano (si può ancora pescare dal pool storico). Eleggibilità
e "già contattato" diventano **derivate dalla membership**, non dallo `status` del contatto — vedi il
concetto [[modello-stati-membership]] e l'identità [[run-come-esecuzione]].

> [!note] Stato cold-email = `daily_selection.state`, non il contatto
> `runDaily` non marca più i contatti `selected`/`exported` (rimossi): lo stato del ciclo cold-email
> vive su `daily_selection.state` (`in_review → exported`). Le pagine di panoramica [[01-architecture]],
> [[02-database]] e [[05-selection-email-export]] e l'indice [[lead-engine]] sono state riallineate a
> questo modello il 2026-06-16; il riferimento canonico è [[concepts/modello-stati-membership]].

**Trigger:** l'esecuzione di `runDaily` (genera una Selezione figlia); oppure l'operatore che apre la
pagina Run o la Selezione (legge la provenienza) o lancia "Esporta".

**Attori:** `runDaily` (`src/pipeline/run.ts`), `newRunId`/`saveSelection`/`logRun` (`src/db/runs.ts`),
`selectBucket` (`src/pipeline/select.ts`), il layer query `listRunExecutions`/`getSelectionMeta`
(`src/server/queries.ts`), le route `web/src/routes/runs.tsx` e `selections.$date.tsx`.

```mermaid
flowchart TD
    A[runDaily parte] --> B[newRunId date → run_id YYYY-MM-DD-N]
    B --> C[Estrazione → enrichment dev_fusion → scoring<br/>fasi batch invariate]
    C --> D[selectBucket x2: migliori eleggibili<br/>scored, fit≥min, NOT IN alcuna daily_selection]
    D --> E[saveSelection date, rows, run_id<br/>DELETE+INSERT, state = in_review]
    E --> F[logRun: N righe runs con lo stesso run_id]
    F --> G[Run page: listRunExecutions<br/>GROUP BY COALESCE run_id, date:run_date]
    G --> H[Per esecuzione: strategies[] + selection<br/>date, state, total, ready, toEnrich + link]
    H --> I[Selezione: getSelectionMeta → run_id, state<br/>link al Run /runs provenienza bidirezionale]
    I --> J{Esporta?}
    J -- sì --> K[state in_review → exported<br/>CSV invariato su disco]
    J -- no --> L[resta in_review, editabile dal pool]
    K --> M[Contatti exported: mai ri-bersaglio,<br/>mai rientrano in un Run]
```

## Passi

1. **Identità del Run.** All'avvio `runDaily` chiama `newRunId(date)` → `YYYY-MM-DD-N` (N progressivo del
   giorno): identifica l'**esecuzione** (che scrive N righe `runs`, una per strategia, + una
   `daily_selection`), così due run nello stesso giorno restano distinti. Vedi [[run-come-esecuzione]].
2. **Fasi batch invariate.** Estrazione, enrichment `dev_fusion`, scoring Haiku girano come oggi: il
   remodel è **additivo** sulla pipeline (eccezione deliberata: i `setStatus('selected'/'exported')` sono
   rimossi — vedi contraddizione sopra).
3. **Selezione = migliori eleggibili (membership).** `selectBucket(bucket, target, minFit)` (×2) pesca i
   contatti `scored`, `fit_score >= minFit`, **non già presenti in alcuna Selezione**
   (`AND id NOT IN (SELECT contact_id FROM daily_selection)`): i **nuovi** del Run più la **riserva** dal
   pool storico (scored, freschi, non `exported`). Rimuovere un contatto da una Selezione lo rende di
   nuovo eleggibile **automaticamente**.
4. **Persistenza figlia del Run.** `saveSelection(date, rows, runId)` è una transazione DELETE+INSERT che
   marca la `daily_selection` con `run_id` e stato iniziale `in_review`. `logRun` scrive le righe `runs`
   con lo stesso `run_id`. Una seconda esecuzione nello stesso giorno rimpiazza la selezione precedente.
5. **Pagina Run (raggruppata per esecuzione).** `listRunExecutions` raggruppa per
   `COALESCE(run_id, 'date:'||run_date)` (i run legacy senza `run_id` restano raggruppati per data) e
   restituisce, per ciascuna esecuzione, `strategies: string[]` e un figlio `selection`
   (`{date, state, total, ready, toEnrich}`) con conteggi "pronti" (`ready`) vs "da arricchire"
   (`toEnrich`) e link navigabile alla Selezione.
6. **Provenienza bidirezionale.** Dalla Selezione, `getSelectionMeta(date)` espone `run_id` + `state`:
   la UI mostra/raggiunge il Run d'origine (`run_id` → `/runs`). Run → Selezione e Selezione → Run sono
   entrambi navigabili.
7. **Export = transizione di stato.** L'azione esplicita "Esporta" porta `daily_selection.state` da
   `in_review` a `exported` (assegnato **solo** qui). L'artefatto CSV su disco è invariato (sempre una
   **vista** dello stato, mai fonte di verità). I contatti di una Selezione `exported` **non** sono mai
   bersaglio dell'enrichment progressivo ([[enrichment-progressivo-email]]) né rientrano in un Run.

**Esito terminale:** una Selezione è l'**export validato di un Run**, tracciabile alla sua esecuzione e
con un ciclo di stato proprio; "pronto/da arricchire" restano **derivati** (mai promossi a `status`);
"max una email" = non riproporre chi è in una Selezione `exported`, per costruzione.

## [Source: SPEC + IMPLEMENTATION-NOTES progressive-enrichment]

- **Remodel degli stati (scelta utente in fase di plan, T1/T3):** `contacts.status` = solo stadio del
  dato; la Selezione ha il ciclo `in_review → exported` (`daily_selection.state`); eleggibilità e "già
  contattato" sono derivate dalla membership in `daily_selection`. Motivazione: `status` confondeva
  stadio-dato e ciclo cold-email (da cui `selected` come stato d'ingresso errato e il bug del contatto
  rimosso lasciato `selected` orfano). Dettaglio in [[modello-stati-membership]].
- **Migrazione idempotente (T1):** colonne nuove aggiunte solo via `migrate()`/`ensureColumn`
  (`run_id` su `runs`+`daily_selection`, `state` su `daily_selection`); remap legacy **one-shot**
  guardato dalla prima comparsa di `daily_selection.state`, naturalmente idempotente per ordine delle
  UPDATE → una selezione `exported` del nuovo modello non viene mai regredita.
- **Verifica:** server via vitest (`tests/run-id-selection.test.ts`, `tests/migration.test.ts`); FE via
  `agent-browser` su DB temp isolato (Run per-esecuzione, provenienza, Esporta→lock verificati). Suite
  finale 81/81 verde.
- **Tech-debt noto (fuori scope):** `scripts/seed-demo.ts` è pre-remodel (non scrive `run_id`, imposta
  status legacy `selected`/`exported`); non rompe (migrazione idempotente + UI tollerante) ma andrebbe
  aggiornato in un chore separato.
