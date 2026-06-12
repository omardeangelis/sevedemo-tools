# 05 — Selezione, bozze email, export

L'ultimo miglio di `runDaily()` (`src/pipeline/run.ts:164-202`): dai profili scored ai file pronti
per il tool email. Quattro passi in quest'ordine: **selezione → bozze → export → log**.

## 1. Selezione — `selectBucket` (`src/pipeline/select.ts`)

Chiamata due volte: `('freelance', TARGET_FREELANCE=20, MIN_FIT_SCORE=50)` e idem per `azienda`.

```sql
SELECT * FROM contacts
 WHERE bucket = ? AND status = 'scored' AND fit_score >= ?
 ORDER BY fit_score DESC, last_evaluated_at DESC
```

Tre proprietà importanti:

- **Il pool è tutto il DB, non il run di oggi.** Un profilo scored giorni fa con fit alto che non
  era entrato nei 20 concorre di nuovo oggi. Il funnel giornaliero alimenta un serbatoio
  persistente; la selezione attinge dal serbatoio.
- **`status = 'scored'` impedisce le ripetizioni.** Chi viene selezionato passa a `selected` (poi
  `exported`) ed esce dal pool per sempre: ogni contatto riceve la cold-email al massimo una volta.
- A parità di fit vince il valutato più di recente.

**Cap anti-monocultura**: `perSectorCap = ceil(target * 0.6)` (12 su 20). Passeggiata greedy in
ordine di punteggio: il candidato entra se il suo settore non ha raggiunto il cap, altrimenti va in
`overflow`; se a fine giro mancano posti, si ripesca dall'overflow in ordine di fit. Il cap è
quindi **morbido**: vale solo finché esistono alternative — meglio 20 contatti tutti tech che 14
diversificati.

## 2. Persistenza della selezione — `saveSelection` (`src/db/runs.ts:35`)

I selezionati diventano `SelectionRow[]` con `rank` = posizione 1..20 in ordine di fit per bucket.
`saveSelection(date, rows)` è una transazione **DELETE + INSERT**: sostituisce la selezione del
giorno, non accumula. Non è solo difesa: è la stessa semantica usata dalla pagina *Selezioni* della
UI quando l'operatore aggiunge/rimuove contatti a mano prima dell'export. `daily_selection` è un
artefatto **editabile**: la pipeline propone i 40, l'umano può correggerli.

Subito dopo, `setStatus(contactId, 'selected')` per ogni riga — è questo a togliere i contatti dal
pool delle selezioni future.

## 3. Bozze email — `draftMany` (`src/email/draft.ts`)

Strutturalmente il gemello di `scoreMany` (doc 04): stesso singleton Anthropic, stesso
`pLimit(SCORING_CONCURRENCY)` (6 in volo), tool-use forzato (`write_email` → `{subject, body}`),
ri-validazione zod, contratto `{ id, draft? , error? }` con isolamento per contatto.

Le differenze sono dove conta:

- **Modello**: `config.emailModel` = **Sonnet** (`claude-sonnet-4-6`). Divisione economica e
  qualitativa: classificare 120 profili è lavoro bulk da Haiku; scrivere 40 email persuasive è
  lavoro di scrittura, e 40 chiamate/giorno a Sonnet costano comunque poco.
- **Input — `contactBrief`**: il brief è costruito quasi interamente con **gli output dello
  scoring** (`bucket`, `role`, `sector`, `short_description`) più about troncato e l'eventuale
  `source_post_url`. È una catena di modelli: Haiku produce la sintesi, Sonnet la usa come materia
  prima — il copywriter non rilegge il profilo grezzo, legge la scheda dell'analista.
- **Il prompt (`EMAIL_SYSTEM`)** codifica i vincoli di prodotto: italiano, 60–110 parole, due
  angoli per bucket (freelance → "trova lavoro su SeVedemo", azienda → "pubblica offerte"),
  aggancio a un dettaglio reale del profilo, citazione naturale del post di provenienza se
  presente, una sola CTA, max 1 emoji, **PS di opt-out obbligatorio** (requisito GDPR trasformato
  in regola di prompt).

Le bozze riuscite vengono scritte con `updateEmail` (UPDATE di `email_subject`/`email_body`). Una
bozza fallita produce solo un warning: il contatto **resta in selezione e nell'export** con le
colonne email vuote — si può completare a mano dalla UI (dettaglio contatto).

## 4. Export — `exportContacts` (`src/export/csv.ts`)

Prima dell'export le righe vengono **rilette dal DB** (`getByIds`): serve la versione consolidata,
comprensiva delle bozze appena scritte. Output in `exports/`:

- **CSV** (`daily-<data>.csv`): 15 colonne in ordine fisso (`COLUMNS`) — è il **contratto
  d'interfaccia col tool email**: full_name, email, linkedin_url, bucket, role, sector, fit_score,
  short_description, score_reason, company, phone, source_strategy, source_post_url,
  email_subject, email_body. `csvCell` applica il quoting RFC-4180 (raddoppio dei `"`, wrapping dei
  valori con virgole/virgolette/a-capo) — indispensabile: i corpi email contengono newline.
  `linkedin_url` e `source_strategy` viaggiano nel CSV apposta: permettono a `eval:import` di
  richiudere il cerchio quando gli esiti tornano indietro (doc 06).
- **JSON** (`daily-<data>.json`): le righe integrali con `signals` deserializzato e `raw_json`
  **rimosso** (l'audit resta solo nel DB).

Infine `setStatus(id, 'exported')` chiude il ciclo di vita
`new → enriched → scored → selected → exported`.

`runStrategy` usa la stessa funzione con label `strategy-<id>-<data>`; il comando CLI
`export --date` e gli endpoint UI `/api/selections/:date/export.*` rileggono `daily_selection` e
ri-esportano — l'export è sempre una **vista** dello stato corrente del DB, mai la fonte di verità.

## 5. Log per strategia — `logRun` (`src/db/runs.ts:13`)

Un INSERT in `runs` per ogni strategia attiva: `items_in` (candidati grezzi resi da `source`) e
`items_new` (quanti erano nuovi nel DB). Telemetria della bocca del funnel: alimenta la pagina
*Run* della UI e segnala quando un seed si sta esaurendo (items_in alto, items_new che crolla →
ora di cambiare le query).

## Perché l'ordine delle operazioni è questo

La selezione viene salvata su DB **prima** di generare le email: se Sonnet fallisse a metà, la
classifica del giorno è già persistita e si rimedia dalla UI o con `export --date`. E poiché ogni
passo scrive subito su SQLite, ri-esportare dopo modifiche manuali produce sempre file aggiornati.
