# 06 — Evaluation: confronto tra strategie

Da non confondere con lo **scoring** (doc 04), che giudica i singoli profili dentro la pipeline.
L'evaluation confronta le **strategie di estrazione** tra loro sugli esiti reali dell'outreach, ed
è un processo **interamente manuale, guidato dall'operatore**: nel repo non esistono scheduler,
cron o feedback loop automatici. È anche l'unico pezzo del sistema il cui input nasce **fuori dal
repo** (il tool email esterno).

## Il ciclo completo

```
pipeline → export CSV → tool email (ESTERNO) → invii reali
   ▲                                              │
   │                                       l'operatore esporta gli esiti
decisione umana ◀── eval:report ◀── eval:import ◀── CSV degli esiti
```

Il filo che tiene insieme il cerchio è `contacts.source_strategy`: assegnato all'estrazione, mai
modificato, esportato nel CSV e usato per raggruppare le metriche.

## Entry point CLI — `src/cli.ts`

Due comandi, entrambi sottilissimi (tutta la logica sta in `src/eval/`):

- `eval:import <file>` → chiama `importOutcomes(file)` e stampa
  `Outcome importati: N abbinati, M non abbinati.`
- `eval:report` → chiama `printStrategyReport()`.

Il formato del CSV di esempio è in `outcomes.sample.csv` nella root del repo.

## Fase 1 — Import degli esiti: `importOutcomes` (`src/eval/import.ts`)

Legge il file con `fs.readFileSync` e lo passa a `parseCsv`. Per **ogni riga**:

1. **Normalizza gli header** in lowercase: `LinkedIn_URL`, `linkedin_url` e `LINKEDIN_URL` sono
   equivalenti — il tool email può esportare con qualsiasi casing.
2. **Match col contatto** — la parte critica:

   ```ts
   const url = normalizeLinkedinUrl(lower['linkedin_url'] ?? lower['linkedinurl'] ?? lower['url']);
   const contact = (url ? findByUrl(url) : undefined) ?? (email ? findByEmail(email) : undefined);
   ```

   Prima per **URL LinkedIn** (tre nomi di colonna alternativi), passato nella **stessa
   `normalizeLinkedinUrl` di tutto il sistema**: il CSV di export conteneva l'URL già normalizzato
   e l'esito che torna indietro viene rinormalizzato allo stesso modo — anche se il tool email ha
   aggiunto query string o maiuscole, le due forme collassano sulla stessa chiave. Fallback per
   **email** (`findByEmail`, `COLLATE NOCASE`). Nessun match → `unmatched++` e `continue`:
   **niente errori, niente righe create**, coerente con la filosofia best-effort del sistema.
3. **Interpreta i flag** con `truthy` (`src/util/csv.ts`): accetta `1`, `true`, `yes`, `y`, `si`,
   `sì`, `x` (case-insensitive); tutto il resto — incluso campo vuoto — è `false`. Un CSV con
   colonne mancanti importa comunque, con flag a zero.
4. **Scrive** con `upsertOutcome`, passando:
   - `strategy`: **copiata da `contact.source_strategy`**, non dal CSV — il CSV non può "mentire"
     sulla provenienza;
   - `sentAt`: dal CSV (`sent_at`/`sentat`), oppure **il timestamp dell'import** come default.
     ⚠️ Conseguenza: importando un CSV senza colonna `sent_at`, ogni riga risulta "inviata" alla
     data dell'import — e `sent_at IS NOT NULL` è ciò che conta come "inviata" nel report.
     In pratica: importare solo righe di contatti effettivamente contattati.

Ritorna `{ matched, unmatched }`.

### Il parser — `parseCsv` (`src/util/csv.ts`)

CSV scritto a mano ma RFC-4180-corretto: macchina a stati carattere per carattere che gestisce
campi quotati, `""` come escape della virgoletta, virgole e **newline dentro i campi** (il campo
`notes` può contenerne), `\r` ignorato. È il gemello in lettura di `csvCell` in `export/csv.ts`,
che scrive con lo stesso quoting.

### La persistenza — `upsertOutcome` (`src/db/runs.ts`)

Il cuore dell'idempotenza, un solo statement:

```sql
INSERT INTO outcomes (...) VALUES (...)
ON CONFLICT(contact_id) DO UPDATE SET
  strategy       = COALESCE(excluded.strategy, outcomes.strategy),
  sent_at        = COALESCE(excluded.sent_at, outcomes.sent_at),
  opened         = MAX(outcomes.opened, excluded.opened),
  replied        = MAX(outcomes.replied, excluded.replied),
  positive_reply = MAX(outcomes.positive_reply, excluded.positive_reply),
  converted      = MAX(outcomes.converted, excluded.converted),
  notes          = COALESCE(excluded.notes, outcomes.notes)
```

Semantica **"mai retrocedere"** (la terza convenzione COALESCE del sistema, doc 02):

- i **flag booleani** usano `MAX(vecchio, nuovo)`: una volta `replied=1`, nessun re-import lo
  riporta a 0 — "ha risposto" è un evento accaduto, un CSV successivo che non lo riporta non lo
  cancella;
- i **campi testuali** usano `COALESCE(nuovo, vecchio)`: il nuovo vince se presente;
- `UNIQUE(contact_id)` garantisce **una sola riga di esito per contatto, per sempre**.

L'import è quindi **idempotente e incrementale**: si può rilanciare con CSV cumulativi o parziali
(oggi "inviata", domani "ha aperto", dopodomani "ha risposto positivo") e lo stato converge sempre
al massimo conosciuto.

## Fase 2 — Report: `printStrategyReport` (`src/eval/report.ts`)

Pura presentazione: chiama `reportByStrategy()`; se non ci sono righe stampa il suggerimento di
eseguire estrazioni e import. Altrimenti tabella console allineata (larghezza colonne calcolata
sul contenuto + `padEnd`) con header
`strategy, estratti, selez., inviate, reply, reply%, positive, pos%, sel%` e legenda finale.

### Le metriche — `reportByStrategy` (`src/db/runs.ts`)

Le metriche **non sono mai materializzate**: un'unica query ricalcolata a ogni lettura:

```sql
SELECT c.source_strategy AS strategy,
       COUNT(*)                                              AS extracted,
       SUM(CASE WHEN c.id IN (SELECT contact_id FROM daily_selection) THEN 1 ELSE 0 END) AS selected,
       SUM(CASE WHEN o.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
       SUM(COALESCE(o.opened,0)), SUM(COALESCE(o.replied,0)),
       SUM(COALESCE(o.positive_reply,0)), SUM(COALESCE(o.converted,0))
  FROM contacts c LEFT JOIN outcomes o ON o.contact_id = c.id
 WHERE c.source_strategy IS NOT NULL
 GROUP BY c.source_strategy
 ORDER BY positive DESC, replied DESC, extracted DESC
```

Da notare:

- il `LEFT JOIN` fa contare **ogni contatto estratto**, anche senza esito: `extracted` e
  `selected` si popolano dal giorno uno, prima di qualsiasi import;
- `selected` usa una subquery su **tutta** `daily_selection`: un contatto selezionato in qualunque
  data conta;
- l'ordinamento mette in cima la strategia con più risposte positive — il "vincitore" è la prima riga.

I **rate** sono calcolati in JS (`toFixed(3)`, guardia sulla divisione per zero):

| Rate | Formula | Cosa misura |
|---|---|---|
| `reply_rate` | `replied / sent` | qualità del contatto (sulle **inviate**, non sugli estratti) |
| `positive_rate` | `positive / sent` | idem, ma solo risposte positive |
| `selected_rate` | `selected / extracted` | quota di estratti finiti nei 40 → quanto la strategia supera il giudizio di Claude |

I tre rate raccontano cose diverse: una strategia può avere `sel%` alto (Claude la promuove) ma
`reply%` basso (le persone non rispondono) — e viceversa. `selected_rate` è l'unico disponibile
anche senza aver mai importato esiti.

## Divisione delle responsabilità

Il punto chiave: **non esiste nessun feedback loop automatico**. Il report è uno strumento di
*lettura*; chi agisce è l'operatore.

| Passo | Chi | Dettaglio |
|---|---|---|
| Inviare le email | **Operatore** (tool esterno) | il sistema si ferma all'export CSV |
| Tracciare aperture/risposte | **Operatore** (tool esterno) | il tool email è la fonte degli esiti |
| Esportare il CSV degli esiti | **Operatore** | deve contenere `linkedin_url` e/o `email` per il match |
| Lanciare `eval:import` | **Operatore** | quando vuole, quante volte vuole |
| Match esito → contatto | Sistema | URL normalizzato prima, email fallback |
| Idempotenza / mai-retrocedere | Sistema | `upsertOutcome` con MAX/COALESCE |
| Calcolo metriche | Sistema | live a ogni lettura, mai salvate |
| Interpretare il report e decidere | **Operatore** | vedi le leve qui sotto |

Anche dopo che il report segnala una strategia poco redditizia, **la pipeline continua a dividere
il budget equamente** tra le strategie abilitate (`gather` in `pipeline/run.ts` fa
`perStrategy = ceil(POOL_SIZE / n)` senza guardare le performance). Le leve sono tutte manuali:

1. **disattivare una strategia**: rimuoverla da `ALL` in `src/strategies/registry.ts` (o, per le
   gated, non valorizzare `LINKEDIN_LI_AT`);
2. **cambiarne i seed**: editare le query in `data/seeds/` (senza ricompilare);
3. **accumulare più dati su una strategia sospetta**: run mirati con
   `pipeline --strategy <id> --limit <n>`.

L'import degli esiti è **solo CLI**: non esiste un endpoint `POST /api/outcomes` né una pagina di
upload nella UI.

## Cosa si vede in UI

La pagina **Report strategie** (`web/src/routes/report.tsx`) chiama `GET /api/report`, che
restituisce **lo stesso `reportByStrategy()`** del comando CLI — un'unica fonte, due viste. La
tabella mostra una colonna in più rispetto alla console: **Convertiti**.

| Colonna UI | Disponibilità |
|---|---|
| Strategia, Estratti, Selezionati, Sel% | da subito, senza import |
| Inviate, Reply, Reply%, Positive, Pos%, Convertiti | richiedono almeno un `eval:import` |

Tre stati della pagina:

- **DB vuoto** → empty state "Nessun dato" con l'hint di eseguire estrazioni;
- **contatti presenti ma zero esiti** (`rows.every(r => r.sent === 0)`) → banner giallo che invita
  esplicitamente a lanciare `npm run cli -- eval:import <file>` — la UI sa di non poterlo fare lei;
- **esiti presenti** → tabella completa, strategia migliore (più positive) in cima.

Essendo le metriche calcolate live, ogni refresh riflette l'ultimo import: non c'è nulla da
"rigenerare".

## Cosa viene salvato

**Una sola tabella: `outcomes`** (`src/db/index.ts`):

```sql
CREATE TABLE outcomes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id     INTEGER NOT NULL UNIQUE,     -- max 1 esito per contatto, per sempre
  strategy       TEXT,                        -- copia di source_strategy al momento dell'import
  sent_at        TEXT,                        -- "è stata inviata" = sent_at IS NOT NULL
  opened         INTEGER DEFAULT 0,           -- flag 0/1, solo crescenti (MAX)
  replied        INTEGER DEFAULT 0,
  positive_reply INTEGER DEFAULT 0,
  converted      INTEGER DEFAULT 0,
  notes          TEXT,
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
```

Altrettanto importante è cosa **non** viene salvato:

- **le metriche aggregate**: mai — nessuna tabella di report, nessuna cache;
- **le righe unmatched**: scartate, sopravvivono solo nel contatore stampato a fine import;
- **nessuna modifica a `contacts`**: l'import non tocca `status` né altro — il contatto resta
  `exported`; l'esito vive in una tabella affiancata, collegata solo da `contact_id`;
- **nessuno storico per-import**: `UNIQUE(contact_id)` significa che esiste solo lo *stato
  consolidato* dell'esito, non la sequenza degli import che l'hanno costruito (se servisse un
  audit trail degli import, andrebbe aggiunto).

In sintesi: il sistema offre un meccanismo robusto e idempotente per richiudere il cerchio sugli
esiti e una vista comparativa sempre aggiornata; tutto ciò che è *azione* — inviare, importare e
soprattutto decidere quali strategie tenere — resta deliberatamente in mano all'operatore.
