---
domain: prospect-crm
type: implementation-notes
spec: own-profile-services
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/PLAN]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW]]"
ingested: false
last_ingested: null
created: 2026-09-29
updated: 2026-09-29
---

# Implementation Notes — own-profile-services

## Summary

- Run 1 (2026-09-29): tappa **M1a** (T0–T7) completata e fermata al gate di tappa come da PLAN §16: impronta della
  persona (F7, F11, F13), analisi in blocco che salta sempre chi è già analizzato (F8, G-12), post con testo
  integrale e viste brevi (C6–C9, C15), seed e2e e documenti (H7), smoke senza BLOCKER. M1b non iniziata.
- `simplify` applicato a fine tappa (riuso, semplificazione, efficienza, altitudine): vedi PLAN T7. Scartati con
  motivo: rimozione della prop `onlyMissing` del dialog (P-9 la tiene), rinomina di `text_excerpt` nel repo
  (OP-TD-1), `ensureColumn` morto in `src/db/index.ts` (preesistente, fuori dal diff), registro delle colonne
  additive (facoltativo), unificazione `nameKey`/`serviceNameKey` (cambierebbe il confronto dei nomi delle persone).

## Execution Mode

- `sequential` (PLAN P-1): un task alla volta, nessun worker. Lo sceglie il piano e lo conferma l'utente.

## Deviations From the Plan

- **T1 — il marcatore dei post non usa `length()` di SQLite.** Il piano (P-24, §6) scrive la condizione come
  `length(text_excerpt) = 301 AND substr(text_excerpt, -1) = '…'`. Provato sul vero `truncate`: `length()` di
  SQLite conta i code point, mentre `truncate` taglia a 300 **unità UTF-16**; un post troncato che contiene
  emoji risulta lungo 264 per SQLite (301 per JavaScript) e con la condizione del piano verrebbe marcato
  **integrale** — esattamente l'errore che P-24 esiste per evitare. Un taglio a metà di un'emoji lascia poi un
  surrogato spaiato che torna dal DB lungo 303. Il backfill è quindi calcolato in JavaScript con la forma vera
  di `truncate` (lunghezza *e* suffisso, come chiede la SPEC): `text.length > 300 && text.endsWith('…')`
  (`isTruncatedExcerpt` in `src/db/schema.ts`). Per il testo senza emoji coincide con la condizione del piano.
  Test con un post con emoji prodotto dal vero `upsertPost`.
- **T1 — la fixture dei post è un'istantanea del vero `upsertPost`.** `tests/fixtures/posts-people-first-crm.json`
  è l'output di `upsertPost` di `1c2ea85` eseguito su un DB temporaneo (500, 120 e 450 caratteri con emoji), non
  righe scritte a mano: T5 cambia `upsertPost` (testo integrale), quindi il test non potrebbe più chiamarlo per
  ottenere la forma di prima. Un test asserisce che ogni estratto è `truncate(testo, 300)`.
- **T1 — `posts.text_complete` ha un `CHECK (text_complete IN (0, 1))`** in più rispetto alla DDL di §6
  (convenzione del repo sugli enum); `NULL` resta ammesso (= non noto).
- **T2/T3 — "da aggiornare" sulla copia lo conta un processo figlio.** Il conteggio richiede il codice della
  scheda, che legge il DB globale di `src/db/index.ts`: `scripts/migration-check.ts` continua a non importarlo e
  lancia `scripts/migration-check-analyses.ts` con `DB_PATH` = la copia (rifiuta percorsi fuori da
  `os.tmpdir()`, dentro `data/` o nel repo; `.env` non letto). Lo stesso figlio fa girare il backfill (T3): è la
  seconda prova su righe vere chiesta dal gate. In più il report confronta l'impronta dei **valori** delle colonne
  preesistenti prima/dopo (`contentChanged`), che avrebbe colto il difetto di `JOBS_COLUMNS` (mutazione verificata).
- **T4 — testo della riga "già analizzate".** La validazione del PLAN cita l'etichetta di oggi (*"3 già analizzate
  (saltate)"*); il FLOW F.5 dà *"128 persone hanno già un'analisi per questo ICP: restano fuori."*: vale il FLOW
  (superficie di accettazione). Aggiunto il conteggio `to_redo` per il gruppo *"Da rifare"*, che i conteggi
  esistenti non permettevano di separare dai mai analizzati.
- **T5 — la scheda non era protetta dal taglio a 120.** Il PLAN dava il `title` del riferimento al post sulla scheda
  per sicuro grazie a `src/db/prospects.ts:589`; quel taglio vale solo per le righe delle tabelle, mentre
  `GET /api/prospects/:id` restituiva il testo conservato. Con il testo integrale avrebbe messo l'intero post nel
  `title`. Il taglio è ora una lettura unica (`excerptOf`) applicata a `GET /api/posts` e a `loadSources` (scheda
  e righe); le righe restano tagliate a 120 sopra, com'erano.
- **T6 — persona "da aggiornare" del seed.** Una persona **nuova** aggiunta a mano (Elena Sartori) invece di
  cambiare una del sync: così Da smistare (9), liste e conteggi asseriti dagli altri scenari non cambiano.
- **T6 — `README.md` sulle scritture Apollo** era vero solo a metà (H7 diceva di lasciarlo): corretta la metà
  sulle aziende di riferimento, che ora sono dati dell'ICP e non scadono l'analisi.
- **T6 — `.env.example`**: le chiavi di §6 sono aggiunte **commentate e dichiarate non ancora lette**, con la tappa
  che le introduce; le tappe M2–M4 devono togliere la dicitura quando le leggono.
- **T7 — la prova del reset usa l'entry reale del server.** Il server e2e azzera il DB e non passa dal backfill:
  per vedere il badge sparire e ricomparire lo smoke avvia `src/server/index.ts` su una copia scratch resa
  "pre-rilascio", con `E2E_FAKE_JOBS=1` e token finti.

## Surprises and Decisions

- **T1 — la ricostruzione di `jobs` avrebbe azzerato strumenti e log di ogni run.** La lista delle colonne
  copiate (`JOBS_COLUMNS`) era quella di crm-foundation: sulla migrazione da apollo-lookalike le colonne di
  people-first-crm non esistevano ancora, ma il DB reale le ha già, e ricostruire `jobs` per
  `generate_profile` le avrebbe riportate ai default (`tools = '[]'`, `logged = 0`: "Log non disponibile" su
  ogni run passato, strumenti ricalcolati dall'euristica legacy). La lista ora include `JOBS_NEW_COLUMNS`
  (saltate da `presentColumns` quando mancano) e il test di T1 confronta le righe di `jobs` prima/dopo.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| Baseline `npm run typecheck` (T0) | ✅ | nessun'altra suite in corso, `pgrep` vuoto |
| Baseline `npm test` (T0) | ✅ 633/633 | 52 file |
| Baseline `npm --prefix web run build` (T0) | ✅ | |
| Baseline `npm --prefix web run typecheck` (T0) | ✅ | |
| `npm run db:migration-check -- data/crm.db` (T2) | ✅ OK | copia in `os.tmpdir()`, sorgente intatto |
| `npm run db:migration-check -- data/crm.db` (T3, copia fresca, backfill incluso) | ✅ OK | 12 analisi, 0 senza impronta, 0 → 0 da aggiornare |
| Confronto dei predicati del marcatore sui post reali (copia in scratchpad) | ✅ | condizione SQL del piano e forma JS danno 5/9: nessun post reale con emoji |
| Mutazioni: `JOBS_COLUMNS` senza colonne nuove; seed senza correzione dell'About | ✅ | i test cadono entrambi |
| `agent-browser` T3 (i, j), T4 (i, j, k, g), T5 (e) | ✅ | e2e :8841 + Vite :5241 |
| Smoke M1a (`tests/e2e/smoke-profile.md`) | ✅ 17/17 OK | nessun BLOCKER; nessun segreto nei log dei run |

## Acceptance Criteria Status (solo la parte di M1a)

| Criterio | Stato | Note |
|-----------|--------|-------|
| F6 (impronta dal rilascio, nessuna rianalisi proposta) | met per M1a | reset una tantum dichiarato (README, console della migrazione e del backfill, consegna); sulla copia reale 0 → 0 da aggiornare. La metà "nessun servizio affine" è di M2 |
| F7 (una modifica dell'utente non scade un'analisi) | met | test API su azienda, offerta, ICP e rinomina; smoke S3–S4 |
| F8 (in blocco chi è già analizzato si salta sempre; casella esistente con semantica nuova) | met | test su selezione e lista, `retry-preview`, avvio 400 con zero da analizzare; smoke S7–S10 |
| F11 (due impronte; `input_hash` solo per l'identico) | met | `subject_hash` scritto da `saveAnalysis` e dal backfill; guardia F6 sul testo del prompt |
| F12 (modello e data sulla scheda) | met | già presente, invariato |
| F13 (la scheda dice che la persona è cambiata, senza attribuire il gesto) | met | arricchimento, About a mano, nuova interazione; smoke S1, S6 |
| H4 (`stale` resta derivato; entra solo l'impronta della persona) | met | nessuna colonna di stato |
| H7 (documenti del comportamento precedente) | met, con deviazione | README (anche la metà falsa della frase su Apollo), README e2e, contract, PLAN di crm-foundation; PLAN di people-first-crm già vero |
| C6 (marcatore integrale/troncato) | met | backfill dalla forma vera di `truncate` (anche con emoji); 4/5 sulla copia reale |
| C7 (testo integrale dal rilascio) | met | `upsertPost`; smoke S12 |
| C9 (nessun recupero retroattivo da sé) | met | solo un sync chiesto dall'utente porta un post a integrale |
| C15 (nessuna vista mostra il testo intero) | met | cinque rese testate; smoke S13–S16 |
| C8 (conteggio letti per intero / estratti) | parziale (per costruzione) | `text_complete` esposto; il conteggio lo fa la generazione (M4) |
| Tutti gli altri (A, B, D, E, G, H1–H3, H5, H6, H8, F1–F5, F9, F10, C1–C5, C10–C14) | non in scope di M1a | tappe M1b–M4 |

## Remaining Work

- M1b, M2, M3, M4 (T8–T33): non iniziate, ripartono col via dell'utente.
- `.env.example`: togliere la dicitura "non ancora lette" dalle chiavi di §6 nella tappa che le legge (M2: `PRICE_ANALYSIS_USD`; M3: `CLOUDFLARE_*`; M4: `PROFILE_MODEL`, `PRICE_PROFILE_GENERATION_USD`).
- Il DB reale è migrato dal primo avvio del server con questo codice (2026-09-30, copia
  `data/crm.db.bak-2026-09-30T09-55-10-451Z`): impronta calcolata per 12 analisi, nessuna "da aggiornare" all'avvio;
  poco dopo una correzione a mano dell'About ne ha resa una "da aggiornare", come vuole F13.
- `UX-REVIEW.md` e la finalizzazione della spec arrivano alla fine di M4 (§16), non a fine tappa.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-09-29 | Eseguire T0–T7 e fermarsi alla fine di M1a; nessun commit senza via | Run limitato a M1a |
| 2026-09-30 | Un filtro "da aggiornare" in Persone (proposto dopo la consegna) non serve: "va bene così"; via al commit di M1a | Nessun cambio di scope; M1a committata |
