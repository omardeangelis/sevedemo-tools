# 06 — Evaluation: confronto tra strategie

Da non confondere con lo **scoring** (doc 04), che giudica i singoli profili dentro la pipeline.
L'evaluation confronta le **strategie di estrazione** tra loro sugli esiti reali dell'outreach, ed
è un processo **interamente manuale, guidato dall'operatore**: nel repo non esistono scheduler,
cron o feedback loop automatici.

## Il ciclo completo

```
pipeline → export CSV → tool email (esterno) → outreach
   ▲                                              │
   │                                              ▼
decisione umana ◀── eval:report ◀── eval:import ◀── CSV degli esiti
```

Il filo che tiene insieme il cerchio è `contacts.source_strategy`: assegnato all'estrazione, mai
modificato, esportato nel CSV e usato per raggruppare le metriche.

## Fase 1 — Import degli esiti: `eval:import <file.csv>` (`src/eval/import.ts`)

Dopo l'outreach si esporta dal tool email un CSV con gli esiti e lo si importa. Colonne
riconosciute (header case-insensitive): `linkedin_url` (o `linkedinurl`/`url`) e/o `email` per il
match; `sent_at`, `opened`, `replied`, `positive_reply`, `converted`, `notes` come dati.

Per ogni riga:

1. **Match col contatto**: prima per URL (normalizzato con la stessa `normalizeLinkedinUrl` di
   tutto il sistema → `findByUrl`), fallback per email (`findByEmail`, case-insensitive). Righe
   senza match → contate come `unmatched`, nessun errore.
2. **Upsert in `outcomes`** (`upsertOutcome`, `src/db/runs.ts:68`) con semantica **mai
   retrocedere**: i flag booleani usano `MAX(vecchio, nuovo)` — un re-import non trasforma un "ha
   risposto" in "non ha risposto" — i campi testuali usano `COALESCE`. `strategy` viene copiato da
   `contact.source_strategy`; `sent_at` mancante → timestamp dell'import.

L'import è quindi **idempotente e incrementale**: si può rilanciare con CSV cumulativi o parziali
senza perdere informazione.

## Fase 2 — Report: `eval:report` (`src/eval/report.ts`)

Le metriche **non sono mai materializzate**: `reportByStrategy()` (`src/db/runs.ts:107`) le calcola
al volo a ogni lettura con un'unica query:

```sql
SELECT c.source_strategy AS strategy,
       COUNT(*)                                            AS extracted,
       SUM(c.id IN (SELECT contact_id FROM daily_selection)) AS selected,
       SUM(o.sent_at IS NOT NULL)                          AS sent,
       SUM(COALESCE(o.opened,0)), SUM(COALESCE(o.replied,0)),
       SUM(COALESCE(o.positive_reply,0)), SUM(COALESCE(o.converted,0))
  FROM contacts c LEFT JOIN outcomes o ON o.contact_id = c.id
 WHERE c.source_strategy IS NOT NULL
 GROUP BY c.source_strategy
 ORDER BY positive DESC, replied DESC, extracted DESC
```

I rate sono calcolati in JS: `reply_rate = replied/sent`, `positive_rate = positive/sent`
(entrambi **sulle email inviate**), `selected_rate = selected/extracted` (quota di estratti finiti
nei 40 — misura quanto la strategia produce candidati che superano il giudizio di Claude).

Output: tabella console allineata con legenda. **Lo stesso identico report** è esposto dalla UI
sull'endpoint `GET /api/report` (pagina *Report strategie*): un'unica fonte, due viste.

## Chi decide

L'umano. Il report è uno strumento di lettura: la pipeline giornaliera continua a dividere il
budget **equamente** tra le strategie abilitate (`gather` in `pipeline/run.ts`), indipendentemente
dalle performance. Se una strategia rende poco, le leve sono manuali:

- disattivarla (rimuoverla da `ALL` nel registry, o non valorizzare il cookie per le gated);
- cambiarne le query/seed in `data/seeds/`;
- accumulare più dati con run mirati: `pipeline --strategy <id> --limit <n>`.

Le colonne `extracted`/`selected` si popolano da subito; `sent`/`reply`/`positive` richiedono
almeno un `eval:import`. Finché non importi esiti, `reply%` e `pos%` restano a 0 per costruzione.
