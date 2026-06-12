# 04 — Enrichment e scoring

I due passi centrali del funnel, orchestrati da `enrichAndScore(rows)` in `src/pipeline/run.ts:112`.
L'enrichment lo esegue **Apify** (actor scraper), lo scoring lo esegue **Claude Haiku**. L'input
sono righe `contacts` già persistite (status `new` o stale), massimo `ENRICH_CAP` (120) dopo il
prefiltro keyword.

```
enrichAndScore(rows)
  1. enrichProfiles(urls)            # UNA chiamata Apify per tutto il batch
  2. updateEnrichment per riga       # status → 'enriched'
  3. getByIds(...)                   # RILETTURA dal DB: Claude vede i dati consolidati
  4. scoreMany(refreshed)            # N chiamate Claude, max 6 in volo
  5. updateScore per riga riuscita   # status → 'scored', timbra last_evaluated_at
  6. return solo le righe 'scored'   # chi è fallito resta 'enriched' e verrà ritentato
```

## Enrichment — `src/enrich/profile.ts`

**Actor**: `dev_fusion/linkedin-profile-scraper` (no cookie), invocato con `runActor` in una sola
chiamata batch per tutti gli URL. L'input li passa su due chiavi (`profileUrls` e `urls`) per
tolleranza ai rename.

**Output**: `Map<urlNormalizzato, Enrichment>`. Per ogni item dell'actor:
- l'URL viene ricavato con `field(...)` su 5 chiavi alternative e normalizzato — è così che il
  chiamante riassocia il risultato alla riga giusta (`enrichment.get(r.linkedin_url)`);
- si estraggono `about` (troncato a 2000 char per non gonfiare i prompt), `location`, `company`,
  **`email` e `phone` best-effort** (è qui che entra la contattabilità: le strategie non hanno
  email), più le esperienze lavorative nel campo `raw`.

**Best-effort puro**: URL non risolti sono semplicemente assenti dalla mappa, nessun errore. Il
profilo non arricchito prosegue comunque verso lo scoring con i soli dati della strategia.

**Persistenza** — `updateEnrichment` (`db/contacts.ts:96`): semantica *refresh* (`COALESCE(?,
colonna)`: il nuovo vince se presente, un enrichment parziale non cancella dati già noti),
`status = 'enriched'`, `raw_json` sovrascritto col payload (esperienze incluse: serviranno al
prompt di scoring).

**Costo**: ~ $2/giorno per 120 profili. È il motivo per cui esiste il prefiltro: si arricchiscono
solo i candidati più promettenti dei ~200 estratti.

## Scoring — `src/score/claude.ts` + `src/score/rubric.ts`

**Modello**: `config.scoringModel` (default `claude-haiku-4-5-20251001`) — lavoro bulk di
classificazione, modello piccolo ed economico (~$5/mese totali).

### Concorrenza — `scoreMany`

`Promise.all` su tutti i contatti dentro `pLimit(SCORING_CONCURRENCY)` (default 6 chiamate in
volo). Ogni task ha il proprio try/catch e ritorna `{ id, result }` **oppure** `{ id, error }`:
un profilo fallito non fa fallire il batch, il chiamante logga e prosegue.

### La singola classificazione — `scoreOne`

Tre scelte di design:

1. **Tool-use forzato**: `tool_choice: { type: 'tool', name: 'classify_profile' }` — il modello
   non può rispondere a testo libero, deve compilare lo schema JSON del tool (`CLASSIFY_TOOL` in
   `rubric.ts`): `bucket` (enum `freelance|azienda|scarta`), `role`, `sector` (enum
   `tech|design|marketing|other`), `fit_score` (intero 0–100), `short_description`, `reason`,
   `signals` (`pIva`/`openToWork`/`hiring`). Niente parsing di testo.
2. **Doppia validazione**: l'input del `tool_use` viene ri-validato lato codice con zod
   (`ScoreSchema.parse`). Un output fuori schema finisce nel ramo `error` di `scoreMany`.
3. **`max_tokens: 700`**: la risposta è solo il JSON del tool.

### Cosa vede il modello — `buildProfileText` (`rubric.ts:51`)

Costruito dalla riga DB consolidata: nome, headline, località, azienda, about (troncato a 1500),
le esperienze ripescate da `raw_json` (troncate a 1200) e la **fonte di estrazione**
(`source_strategy` + eventuale post) come indizio di contesto, non come vincolo.

### Le istruzioni — `SCORING_SYSTEM` (`rubric.ts:5`)

Il system prompt codifica l'ICP di SeVedemo e **la regola architetturale chiave del sistema**:

> il bucket si decide per RUOLO. Freelance/P.IVA → `freelance` (potenziali utenti); chi assume o
> decide le assunzioni → `azienda` (potenziali clienti); il resto → `scarta`. In caso di
> ambiguità, decide chi prende le decisioni di hiring.

È qui — non nelle strategie — che il `bucketHint` viene di fatto ignorato: un profilo estratto
dalla strategia freelance può legittimamente finire nel bucket azienda. Il prompt definisce anche
il `fit_score`: premia settore affine (tech/design/marketing), segnali espliciti ("P.IVA",
"open to work", "we're hiring", ruoli recruiter/talent/founder) e contattabilità; penalizza
profili vaghi o fuori settore.

### Persistenza — `updateScore` (`db/contacts.ts:132`)

Scrive role/bucket/sector/fit_score/descrizioni/signals, porta `status = 'scored'` e — cruciale —
timbra **`last_evaluated_at = now`**. Questo timestamp alimenta `isFresh`: il profilo non verrà
ri-arricchito né ri-scorato per i prossimi `FRESHNESS_DAYS` (90) giorni anche se le strategie lo
ripescano. È il meccanismo che evita di pagare due volte Apify e Claude per lo stesso profilo.

## Riepilogo della divisione del lavoro

| Chi | Cosa | Come |
|---|---|---|
| Apify (dev_fusion) | dati di fatto: email, about, esperienze | 1 chiamata batch, best-effort |
| Claude Haiku | giudizio: bucket, settore, fit | 1 chiamata per profilo, 6 in volo, output forzato a schema + zod |
| SQLite | il filo | UPDATE incrementali sulla stessa riga, status che avanza, freshness |
