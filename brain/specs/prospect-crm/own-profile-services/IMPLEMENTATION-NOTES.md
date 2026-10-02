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
updated: 2026-10-02
---

# Implementation Notes — own-profile-services

## Summary

- Run 1 (2026-09-29): tappa **M1a** (T0–T7) completata e fermata al gate di tappa come da PLAN §16: impronta della
  persona (F7, F11, F13), analisi in blocco che salta sempre chi è già analizzato (F8, G-12), post con testo
  integrale e viste brevi (C6–C9, C15), seed e2e e documenti (H7), smoke senza BLOCKER. M1b non iniziata.
- Run 2 (2026-09-30): tappa **M1b** (T8–T12) completata e fermata al gate di §16: servizi scritti a mano (B2–B4,
  B10, G7), profilo esteso con provenienza e lettura unica `GET /api/profile` (B1, B5–B8, C11, G-11), pagina a una
  colonna con la card rinominata e le ancore di prima (G1, G2, OQ-8). Nessuna migrazione: `settings` è chiave/valore
  e `services`/`profile_field_origin` esistevano da T1. M2 non iniziata. Committata il 2026-09-30 (`1b7f80e`).
- Revisione dopo M1b (2026-09-30): un hint sotto Posizionamento, Prove e risultati e Tono di voce, che dicono cosa
  scriverci (i nomi da soli non bastavano). Testi dell'utente, riportati nel FLOW ("Testi che cambiano").
- Run 3 (2026-09-30): tappa **M2** (T13–T17): l'analisi legge posizionamento, prove, tono e i servizi in ordine (F1)
  e, con almeno un servizio, nomina il più affine col perché (F2); senza servizi il prompt e il formato della risposta
  sono identici byte per byte a M1b (F6, istantanea); il nome si salva com'era (F4) e la scheda dice se non esiste più
  (F5) senza inviti a rifare (F7); una sola stima dell'analisi (`PRICE_ANALYSIS_USD`) per preview in blocco e card
  (F10, D5); testi definitivi di M1b (§10). Nessuna migrazione: le colonne esistevano da T1. Fermata al gate di §16,
  non committata. M3 non iniziata.
- Run 4 (2026-09-30): tappa **M3** (T18–T22): Cloudflare quarto strumento. Catalogo a quattro con due variabili e il
  solo token redatto (A1, A3, A4, A7); card in Connessioni che nomina la variabile mancante, griglia 2×2 (A3, A4); client
  con `fetch` iniettato, richieste in un punto solo, errori a parole e ritmo di una richiesta ogni 10 s; verifica
  manuale `npm run cloudflare:smoke` e README (A2, A8); attribuzione degli errori Cloudflare e dei run **riusciti** con
  una fonte fallita (A6, P-26); emendamento H2. Senza credenziali nessuna chiamata (A9). Nessuna migrazione.
- Verifica reale di M3 (2026-10-02, lanciata dall'utente): con il browser il piano gratuito legge solo la pagina
  iniziale, senza browser tutto il sito (7 su 7). Modalità decisa dall'utente: `readSite`, senza browser e con il
  browser solo se le pagine arrivano quasi vuote (Decision Log della SPEC). A8 chiuso. M2 e M3 committate separate il
  2026-10-02. M4 non iniziata.
- `simplify` applicato a fine tappa (riuso, semplificazione, efficienza, altitudine): vedi PLAN T7 (M1a), T12 (M1b), T17 (M2) e T22 (M3). Scartati con
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

- **T9 (f) — in M1b il contesto dell'analisi non legge i campi nuovi.** La validazione (f) di T9 dice che il contesto
  "legge i campi nuovi quando ci sono"; T13 (1) dice che è M2 ad aggiungerli ad `AnalysisContext`, e la copy
  provvisoria di §10 (*"Tutti facoltativi."* al posto di *"Usati dall'analisi AI…"*) esiste proprio perché in M1b
  l'analisi non li usa. Vale T13: T9 prova la metà permanente di (f) — con i campi nuovi vuoti l'input è identico
  byte per byte, e profilo e servizi non segnano nessuna analisi.
- **T9 — `pending_proposal: null` invece di `has_pending_proposal`.** Una proposta pendente servirà con la sua data
  (titolo *"Proposta del 20 set"*): M4 ci metterà un oggetto; `null` = nessuna. Le altre chiavi di M4:
  `sources: null`, `last_generation: null`. Il record Apollo (`apollo_record`) invece si legge già da
  `profile_sources` (`{read_at, record}` col JSON grezzo), come chiesto.
- **T9 — `GET /api/settings` guadagna le quattro chiavi nuove.** Le quattro di prima e `readiness` restano identiche
  (test B8, validazione (c) del PLAN); il `PUT` risponde anche `warnings` (C11).
- **T10 — conferma di eliminazione col solo titolo.** §10 dice "versione breve, senza la frase su F5" e la
  validazione (f) di T10 "testo senza «da rifare»": la versione di M1b è quindi solo *"Eliminare il servizio «X»?"*
  con **Annulla** · **Elimina servizio**. Le due frasi sulle analisi (F5 e F7) le porta T16, quando i servizi entrano
  nell'analisi: prima parlerebbero di analisi che non possono citarli.

- **T13 — il modello finto dell'e2e cambia in T13, non in T14.** Con un servizio lo schema esige `best_service`: la
  risposta di prima del finto sarebbe stata fuori schema (due tentativi, poi *"Risposta del modello non valida"*) per
  ogni analisi e2e con servizi. `servicesIn` legge l'elenco dal system prompt come il vero modello; il marcatore
  `e2e-servizio-inesistente` fa nominare un servizio che non c'è (F3).
- **T15 — un avviso in più nella preview in blocco.** Con `PRICE_ANALYSIS_USD` vuota la preview dice *"Prezzo
  dell'analisi non configurato (PRICE_ANALYSIS_USD): stima non disponibile."* (come `APOLLO_CREDIT_USD` nei dialog
  Apollo) e non dice più *"la stima copre solo l'analisi"* dell'arricchimento, che sarebbe falso.
- **T15 — il ramo "arricchisci e analizza" dell'hint.** Il FLOW dà solo il testo della rianalisi. Gli altri due rami
  tengono le parole di oggi con il numero servito: *"… prima lo arricchisce e poi lo analizza (≈ $0,04 in tutto)."*
  col prezzo del profilo, *"… prima lo arricchisce (costo del profilo non stimato) e poi lo analizza (≈ $0,03)."*
  senza, *"(stima non disponibile)"* senza prezzo dell'analisi.
- **T16 (e) non è raggiungibile in M2.** *"Corrisponde al tuo servizio «…» (il confronto ignora maiuscole e spazi). Il
  nome resta il tuo."* è la riga di una **voce della proposta** (FLOW, edge case B10 e OQ-4): la proposta nasce in M4,
  quindi la prova passa a T31. Nell'analisi lo stesso confronto c'è già: se il modello scrive il nome in un altro modo
  si salva quello dell'utente (T14).
- **T16 — nel caso "non è più tra i tuoi servizi" resta anche il perché.** Il FLOW F.2 dà solo la frase col nome di
  allora; il motivo scritto dall'analisi segue in una riga a parte, perché toglierlo cancellerebbe una parte
  dell'analisi salvata (F5: niente si riscrive).

- **T18 — il payload di Connessioni dice quale variabile manca.** Il PLAN (§13) dà `env_var` → `env_vars: string[]`;
  per A4 ("la card dice **quale**") serve anche `missing_env_vars` (stesso ordine). `configured` resta, derivato.
- **T19 — con una sola variabile mancante la presente resta su una riga "· Presente".** Il FLOW E.5 dà solo la riga
  della mancante; senza l'altra la card non mostrerebbe "tutte le variabili" (T19). Tutte mancanti ⇒ *"Mancanti:
  aggiungile…"*.
- **T20 — i limiti veri del piano gratuito sono più stretti di quelli della SPEC** (documentazione riletta il
  2026-09-30): oltre a 10 minuti al giorno e 3 browser, **5 letture al giorno**, 100 pagine per lettura e **1 richiesta
  ogni 10 secondi**. Il client lo impone in `send()` per ogni richiesta, ritentativi compresi (`retry-after` mai sotto
  i 10 s); lo stato si legge **senza** `limit: 1` (la documentazione lo suggerisce per il polling), così quando la
  lettura è finita le pagine ci sono già e si risparmia una richiesta. README e parole dei limiti riportano questi numeri.
- **T20 — un file in più**: `src/cloudflare/mappers.ts` (lettura tollerante con `field()`, come i mapper Apollo). La
  verifica manuale legge anche il `robots.txt` del sito (una richiesta al sito, non a Cloudflare) per confrontare i
  limiti che il sito espone con l'esito delle pagine (`disallowed`).
- **T21 — il FE non era nella `location`**, ma con P-26 un run riuscito conta come fallito per uno strumento mentre
  `error` è `null`: card, avvisi di Oggi, dettaglio del run e pagina dello strumento leggono il motivo da
  `RunView.tool_errors`, e `describeJobError` legge `actor:<strumento>:<op>:` per ogni strumento del catalogo.
- **M3 `simplify` — gli helper HTTP di Apollo sono ora condivisi** (`src/util/http.ts`: `isRecord`, `shorten`,
  `retryAfterMs`, `networkReason`): la copia per Cloudflare aveva già perso la forma "data HTTP" di `retry-after`. Tocca
  `src/apollo/client.ts` senza cambiarne il comportamento (test Apollo verdi).

## Surprises and Decisions

- **M3 — nel `.env` reale c'è `CLOUDFLARE_API_TOKEN` ma non `CLOUDFLARE_ACCOUNT_ID`** (prova a secco della verifica,
  nessuna chiamata): senza, Connessioni dice *"Mancante"* e la verifica non parte. Va aggiunto dall'utente.
- **M3 — la prima verifica reale (2026-09-30) non si è conclusa**: avvio accettato, prima pagina letta in meno di 10 s,
  poi stato fermo (`running`, 1 letta, 2 in coda, 0,7 s di browser) fino all'annullamento a 5 minuti. I controlli ogni
  10 s usavano tutto il ritmo del gratuito: ora sono ogni 30 s. Le risposte grezze non dicevano quali pagine fossero
  in coda (la potatura toglieva i record): ora tengono indirizzo e stato. `X-Browser-Ms-Used` vale sempre `0`. Il
  consiglio sul permesso del token compariva anche per un timeout: ora solo per gli errori `config:`. Dettagli nel
  log di T20.
- **M3 — la seconda verifica reale si conclude, ma legge solo la home**: `completed` in 32 s con `/pricing` e `/termini`
  ancora `queued` e le 4 pagine `/case-study/…` mai elencate. Sul gratuito, con il browser, la lettura non segue i
  link: il tetto di 10 pagine e i percorsi di OQ-2 oggi non si raggiungono. Il riepilogo dello smoke contava su
  `total` (*"1 pagina letta su 3 trovate"*), che non include le pagine in coda: ora conta i record per esito.
- **M3 — senza browser la lettura segue i link** (terza verifica, 2026-10-02, `--no-render`): 7 pagine su 7 in 34 s,
  0 s di browser. Con il browser 1 pagina, senza 7: la modalità di T23 diventa una decisione dell'utente. I titoli
  arrivano con le entità HTML del sito (`&#39;`): il mapper le decodifica.
- **M3 — decisione dell'utente (2026-10-02): senza browser, poi con il browser se le pagine arrivano quasi vuote.**
  Scostamento dalla SPEC (che aveva scelto Cloudflare anche per il JavaScript), registrato nel suo Decision Log.
  Codice: `readSite` nel client (soglia `CLOUDFLARE_MIN_PAGE_TEXT_CHARS` = 300 caratteri sulla pagina più ricca);
  lo smoke di default fa la stessa lettura dei job. T23 la usa come dep del sito.
- **T20 — lo user agent della lettura non si può scegliere**: è `CloudflareBrowserRenderingCrawler/1.0`; lo scopo si
  dichiara con `crawlPurposes: ['ai-input']` e Cloudflare lo confronta coi `Content-Signal` del sito. `robots.txt` e
  `crawl-delay` li rispetta l'endpoint. Resta a T23 la scelta dei percorsi (OQ-2), da decidere coi numeri della verifica.
- **T21 — un solo punto per "perché il run conta come fallito per X"**: `toolErrors(run)` (`src/runs/tools.ts`); la
  salute, gli avvisi e `RunView.tool_errors` lo leggono. Il filtro *Falliti* della pagina di uno strumento resta
  sull'esito del run (colonna Esito, J6): un run riuscito con il sito non letto è *"Completato con avvisi"* e dice
  *"Non riuscito per Cloudflare"*.

- **T8/T9 — la provenienza si scrive solo per un valore che cambia davvero.** Il form dell'azienda manda sempre tutti
  i suoi campi: marcare ogni chiave del `PUT` avrebbe dato provenienza ai campi legacy correggendone uno solo (G-11
  cade: il conteggio passerebbe da 3 a 0). Stessa regola per i servizi (`PATCH` senza cambi = nessun "scritto da
  te": una voce di una proposta non diventa un conflitto per un salvataggio a vuoto). Un valore svuotato perde la
  provenienza. Mutazione verificata.
- **T9 — la provenienza la scrive solo il `PUT /api/settings`** (`saveProfileByHand`, `src/db/profile.ts`);
  `updateSettings` resta senza, quindi il seed e2e e i test rappresentano i valori di prima del rilascio. Vale per
  **ogni** campo del profilo (B6, anche i due indirizzi), non solo per i generabili; `filled_without_origin` conta
  solo i generabili (E14).
- **T9 — il sito si salva com'è scritto** (precedente: `companies.website`), il dominio si ricava a ogni lettura con
  `normalizeDomain`; la frase di C11 vive solo nel server (`websiteWarning`) e arriva sia nella risposta del `PUT` sia
  in `GET /api/profile`, così dopo un ricarico resta sotto il campo.
- **T8 — il riordino tollera un ordine visto da un'altra scheda**: id sconosciuti ignorati, quelli mancanti in coda
  nel loro ordine (FLOW "Due tab": converge all'ultimo clic); un id ripetuto → 400.
- **T10 — ↑ ↓ con `aria-disabled` e focus rimesso a mano.** Un bottone `disabled` perde il focus quando la riga
  arriva in cima, e React sposta nel DOM la riga riordinata (il focus cade su `body`): il bottone premuto torna a
  fuoco dopo il render. I dialog non hanno `DialogTrigger`: la card decide dove va il focus alla chiusura (chi ha
  aperto; la riga nuova dopo un'aggiunta; la riga che prende il posto dopo un'eliminazione).
- **T11 — il sito è un secondo form nella card** *"I tuoi indirizzi pubblici"*, con **Salva sito**: il form
  `#profilo` resta quello di oggi (campo, testi, toast, errore). L'hint della card azienda resta quello di oggi sui
  tre campi di prima; i tre nuovi hanno il loro *"Tutti facoltativi."* (§10).

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
| Baseline M1b: server reale fermato per PID (nessun `job-entry`, nessun job in corso), 4 gate | ✅ | typecheck, `npm test` 660/660 (53 file), build e typecheck web |
| `npx vitest run tests/api-services.test.ts` (T8) | ✅ 8/8 | RED→GREEN per comportamento |
| `npx vitest run tests/api-profile.test.ts` (T9) | ✅ 8/8 | mutazione "cambia davvero" tolta ⇒ G-11 e B6 rossi |
| `npm test` dopo T9 | ✅ 676/676 | 55 file |
| `agent-browser` T10 (a–i) e T11 (a–f) | ✅ | e2e :8851 + Vite :5251, sessioni `t10` e `op-t12` |
| Smoke M1b (`tests/e2e/smoke-profile.md`, S18–S33) | ✅ 16/16 OK | dopo `simplify`; nessun BLOCKER |
| Gate finali M1b | ✅ | typecheck, `npm test` 676/676 (55 file), build web, typecheck web |
| Istantanea del prompt di M1b prima di T13 (system, user, JSON-only, impronte, JSON Schema) | ✅ | script in scratchpad; valori nella guardia F6 di `tests/analysis-prompt.test.ts` |
| `npx vitest run` di `analysis-prompt`, `analyze`, `api-icps`, `e2e-deps` (T13–T15) | ✅ | RED→GREEN per comportamento |
| `npm test` dopo T13, T14, T15 | ✅ 681 → 685 → 687 | 55 file |
| `agent-browser` T15 (d, e) e T16 (a–d, f) | ✅ | e2e :8851 (anche con `PRICE_PROFILE_DETAIL_USD=0.01` e `PRICE_ANALYSIS_USD=`) + Vite :5251, sessione `op-m2` |
| Smoke M2 (`tests/e2e/smoke-profile.md`, S34–S45) | ✅ 12/12 OK | dopo `simplify`; nessun BLOCKER; 0 token finti nei log di 5 run |
| Gate finali M2 | ✅ | typecheck, `npm test` 687/687 (55 file), build web, typecheck web |
| `npx vitest run tests/runs-tools.test.ts` (T18, T21) | ✅ | RED→GREEN: tdd_target di T18 e di T21 rossi prima del codice |
| `npx vitest run tests/cloudflare-{client,smoke}.test.ts` (T20) | ✅ 12 + 6 | tdd_target 401 rosso prima del client; soglia dei 10 s: senza, il test cade |
| `agent-browser` T19 (a–d) e T21 (card, Oggi, dettaglio, pagine strumento) | ✅ | e2e :8851 (`E2E_NO_CLOUDFLARE=account`, `1`, nessuno) + Vite :5251, sessione `m3`; per T21 un run riuscito col sito non letto scritto nel DB temporaneo |
| `npm run cloudflare:smoke -- --site esempio.it` (senza `--yes`) | ✅ codice 2 | nessuna chiamata; `.env` reale: token presente, **account id mancante** |
| `npm run cloudflare:smoke -- --site <sito> --yes` (verifica reale A8, 1ª) | ❌ codice 1 | lanciata dall'utente il 2026-09-30: credenziali ok, lettura ferma dopo 1 pagina e annullata a 5 minuti |
| `npx vitest run tests/cloudflare-{client,smoke}.test.ts` dopo la 1ª verifica | ✅ 12 + 8 | controlli ogni 30 s, avanzamento nel timeout, pagine viste per ultime, `--no-render` |
| `npm run cloudflare:smoke -- --site <sito> --yes` (verifica reale A8, 2ª) | ⚠️ codice 0 | conclusa in 32 s ma con la sola home letta, 2 pagine rimaste in coda |
| `npx vitest run tests/cloudflare-smoke.test.ts` dopo la 2ª verifica | ✅ 9 | riepilogo per esito, lettura conclusa con pagine in coda |
| `npm run cloudflare:smoke -- --site <sito> --no-render --yes` (verifica reale A8, 3ª) | ✅ codice 0 | 2026-10-02: 7 pagine su 7 in 34 s, 0 s di browser |
| Gate finali M3 | ✅ | typecheck, `npm test` 716/716 (58 file), build web, typecheck web |
| Gate di chiusura M3 dopo le verifiche reali e `readSite` (2026-10-02) | ✅ | typecheck, `npm test` 726/726 (58 file), build web, typecheck web |

## Acceptance Criteria Status — M2

| Criterio | Stato | Note |
|-----------|--------|-------|
| F1 (contesto con posizionamento, prove, tono, servizi con a chi servono e problema) | met | `<azienda_utente>` in ordine dell'utente; campi vuoti omessi |
| F2 (con ≥ 1 servizio il servizio più affine e il perché; senza, nulla in più) | met | schema e consegna condizionati da `asksService`; istantanea byte per byte senza servizi |
| F3 (nessun servizio o risposta non riconducibile ⇒ campo vuoto, analisi valida) | met | test + smoke S37, S42 |
| F4 (nome del servizio come testo di allora) | met | si salva il nome dell'utente, anche se il modello lo scrive diverso |
| F5 (rinomina/elimina non riscrive; "non esiste più", senza errori) | met | `best_service_exists` derivato; smoke S38–S40 |
| F6 (al rilascio nulla perde valore, nessuna rianalisi proposta) | met | metà di M2: nessun servizio affine sulle analisi vecchie (S34); il reset del badge era di M1a |
| F7 (una modifica dell'utente non scade un'analisi) | met | ora anche per i servizi, che entrano nel prompt (test T13 (d), smoke S35, S41) |
| F9 (analisi di prima del rilascio leggibili, senza servizio affine) | met | S34 |
| F10 (rifare un'analisi con stima dichiarata) | met | una funzione per preview e card, `PRICE_ANALYSIS_USD` (S36, S44) |
| D5 (mai un numero inventato) | met per l'analisi | "stima non disponibile" nei tre rami e nel dialog in blocco |
| G8 (testi in italiano) | met per M2 | S45 |
| G9, G10 (tastiera, screen reader) | met per M2 | riga come regione con intestazione; conferma di eliminazione legata con `aria-describedby` (S40) |
| F8, F11–F13 | met (M1a) | invariati; S42 riprova F8 con i servizi |
| Tutti gli altri (A, C1–C5, C8, C10–C14, D1–D4, D6–D14, E, H1–H3, H5, H6, H8, G3–G6) | non in scope di M2 | M3–M4 |

### Copy provvisoria di PLAN §10 dopo M2

| Dove | Stato |
|---|---|
| `#servizi`, hint dell'ordine | **definitivo** (T16) |
| `#azienda`, hint dei campi nuovi | **definitivo**: un solo hint della card (T16) |
| Conferma di eliminazione di un servizio | **definitiva**, con le frasi su F5 e F7 (T16) |
| Hint di **Rianalizza** | **definitivo**, dalla funzione condivisa (T15) |
| `#servizi` vuoto (CTA di generazione) | provvisorio fino a T30 |
| `#profilo`, campo Sito | provvisorio fino a T30 |
| "Da completare" di Oggi | provvisorio fino a T32 |

## Acceptance Criteria Status — M1b

| Criterio | Stato | Note |
|-----------|--------|-------|
| B1 (profilo in un posto: di oggi + sito, posizionamento, prove, tono) | met | `SETTING_KEYS` estese, card `#azienda` e sito in `#profilo` |
| B2 (servizio col solo nome) | met | API (400 col testo del FLOW) e dialog |
| B3 (CRUD a mano in qualsiasi momento) | met | smoke S19–S27 |
| B4 (ordine dell'utente in ogni lettura) | met | `PUT /api/services/order`, posizioni contigue; smoke S22 |
| B5 (niente di obbligatorio) | met | `GET /api/profile` a DB vuoto 200; smoke S31 |
| B6 (provenienza e data di ogni valore) | met | solo per valori che cambiano; `null` per i legacy (E14) |
| B7 (una sola lettura con profilo, servizi, provenienza, data dell'ultima generazione) | met per M1b | la data dell'ultima generazione è `last_generation: null` finché M4 non genera (P-21) |
| B8 (consumatori di oggi invariati) | met | `GET /api/settings`/`readiness` per le quattro chiavi di prima, guardia F6 verde |
| B9 (l'azienda dell'utente non è un'azienda del CRM) | parziale (per costruzione) | record Apollo in `apollo_record` in sola lettura, nessuna `companies`; la superficie in pagina è di T30 |
| B10 (nomi unici a meno di maiuscole e spazi) | met | `serviceNameKey` unico, anche `QUALITÀ`/`Qualità`; smoke S21 |
| C11 (senza dominio la fonte Apollo non è disponibile e lo si dice) | met per M1b | avviso sotto il campo e nelle risposte; l'anteprima della generazione è di M4 |
| G1 (la sezione ospita profilo, azienda, servizi, generazione, proposta) | parziale | generazione e proposta in M4 |
| G2 (indirizzi e ancore di prima funzionano) | met | smoke S28, anche dai link di Oggi |
| G7 (servizi: aggiungi, modifica, riordina, elimina con conferma) | met | smoke S19–S27 |
| G8 (testi in italiano) | met per M1b | smoke S33 |
| G9, G10 (tastiera, screen reader) | met per i servizi | la proposta è di M4 |
| E14, H8 (valori di prima senza provenienza, dichiarati) | parziale | `filled_without_origin` 3 → 2 esiste; la testata della proposta che lo dichiara è T31 |
| Tutti gli altri | non in scope di M1b | M2–M4 |

### Copy provvisoria in pagina (PLAN §10) — M1b

| Dove | §10 dice | In pagina |
|---|---|---|
| `#servizi` vuoto | *"Nessun servizio. Aggiungine uno a mano."* + **Aggiungi servizio** | identico, un solo bottone |
| `#servizi`, hint | *"Cosa vendi, un servizio per riga. L'ordine lo decidi tu."* | identico |
| `#azienda`, hint dei campi nuovi | *"Tutti facoltativi."* | identico, sopra Posizionamento · Prove e risultati · Tono di voce; l'hint della card resta quello di oggi sui tre campi di prima. Ognuno dei tre ha poi il suo hint definitivo (revisione dopo M1b, non provvisorio: T16 non lo tocca) |
| `#profilo`, campo Sito | etichetta e hint neutri | **Sito web** · *"Il sito della tua azienda."* |
| Conferma di eliminazione | versione breve, senza la frase su F5 | solo *"Eliminare il servizio «X»?"* (anche senza la frase F7, per T10 (f)) |
| Hint di **Rianalizza** | quello di oggi | invariato (nessun file dell'analisi toccato) |
| "Da completare" di Oggi | invariato | invariato |
| CTA di generazione | nessuna, nemmeno disattivata | nessuna |

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

## Acceptance Criteria Status — M3

| Criterio | Stato | Prova |
|---|---|---|
| A1 due credenziali lette e documentate | ✅ | `src/config.ts`, `.env.example`, README |
| A2 README: permesso, piano, limiti, superamento | ✅ (dalla documentazione) | README "Cloudflare"; i numeri veri arrivano con la verifica |
| A3 quarta card in Connessioni | ✅ | T19, `agent-browser` |
| A4 non configurata se ne manca una, e dice quale | ✅ | T18 (a, b), T19 (b) |
| A5 "Configurata" non vuol dire valida | ✅ in pagina con un run scritto a mano | sul vivo in T33 (P-22) |
| A6 errore attribuito a Cloudflare | ✅ | T21 (a)–(e), card, Oggi, dettaglio; sul vivo in T33 |
| A7 token mai in log, errori, parametri | ✅ | T18 (c), T20 (d), T21 (redazione del motivo) |
| A8 verifica manuale documentata | ✅ | 3 verifiche reali nel README e nel log di T20: con browser 1 pagina, senza 7 su 7; modalità decisa dall'utente (`readSite`) |
| A9 senza credenziali nessuna chiamata, nulla si blocca | ✅ | T18 (e), T20 (e) |

## Remaining Work

- M1a, M1b, M2 e M3 chiuse e committate (M2 e M3 il 2026-10-02, in due commit).
- **A8 chiuso con tre verifiche reali**: con il browser il gratuito legge solo la pagina iniziale (una volta bloccata,
  una volta conclusa con pagine in coda), senza browser legge tutto il sito (7 su 7). Modalità decisa dall'utente:
  `readSite` (senza browser, con il browser se quasi vuoto). Più di 5 letture al giorno chiedono Workers Paid
  (5 $/mese per account; ai volumi di questo CRM l'uso resta nelle quote incluse): non serve oggi.
- M4 (T23–T33): non iniziata. T23 deve creare **un** client per run (il ritmo di 10 s vive nell'istanza) e scrivere
  `tool_errors` dallo stesso elenco per fonte da cui escono gli avvisi.
- **T31** deve provare anche l'edge case *"Corrisponde al tuo servizio «…» (il confronto ignora maiuscole e spazi). Il
  nome resta il tuo."*, che T16 (e) non poteva raggiungere (è una riga della proposta).
- `.env.example`: togliere la dicitura "non ancora lette" dalle chiavi di §6 nella tappa che le legge (fatto per
  `PRICE_ANALYSIS_USD` in M2 e per le due credenziali Cloudflare in M3; M4: `CLOUDFLARE_MAX_PAGES`, `PROFILE_MODEL`,
  `PRICE_PROFILE_GENERATION_USD`).
- Il DB reale è migrato dal primo avvio del server con questo codice (2026-09-30, copia
  `data/crm.db.bak-2026-09-30T09-55-10-451Z`): impronta calcolata per 12 analisi, nessuna "da aggiornare" all'avvio;
  poco dopo una correzione a mano dell'About ne ha resa una "da aggiornare", come vuole F13.
- `UX-REVIEW.md` e la finalizzazione della spec arrivano alla fine di M4 (§16), non a fine tappa.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-09-29 | Eseguire T0–T7 e fermarsi alla fine di M1a; nessun commit senza via | Run limitato a M1a |
| 2026-09-30 | Un filtro "da aggiornare" in Persone (proposto dopo la consegna) non serve: "va bene così"; via al commit di M1a | Nessun cambio di scope; M1a committata |
| 2026-09-30 | Eseguire M1b (T8–T12) e fermarsi dopo lo smoke e il gate di §16; niente M2, niente commit; un solo normalizzatore, nessuna provenienza ai campi legacy, chiavi di M4 a `null`, `app.ts` solo mount | Run limitato a M1b; vincoli rispettati (sopra) |
| 2026-09-30 | Via al commit di M1b; poi: Posizionamento, Prove e risultati e Tono di voce non hanno una descrizione e non si capisce cosa scriverci — un hint per campo, coi testi proposti | M1b committata (`1b7f80e`); tre hint in `ProfileForms.tsx` legati con `aria-describedby`, FLOW aggiornato, commit a parte |
| 2026-09-30 | "procedi con M2": eseguire T13–T17 e fermarsi dopo lo smoke e il gate di §16; niente M3, niente commit senza via | Run limitato a M2 |
| 2026-09-30 | "Continua": M3, con la chiave Cloudflare in `CLOUDFLARE_API_TOKEN` | Commit di M2 tentato e bloccato dai permessi (serve un via esplicito); M3 eseguita fino alla verifica reale, che resta all'utente |
| 2026-10-02 | Tre verifiche reali di `cloudflare:smoke` lanciate dall'utente; lettura del sito: "Senza browser, poi con"; quanto costano più di 5 letture al giorno | `readSite` e decisione nel Decision Log della SPEC; costo: Workers Paid 5 $/mese, nessun cambio di scope |
| 2026-10-02 | "committa m2 e m3 e poi spiegami cosa fa m4 prima di partire" | M2 e M3 committate separate; M4 spiegata, non iniziata |
