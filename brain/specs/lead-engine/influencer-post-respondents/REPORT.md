---
domain: lead-engine
type: review-report
spec: influencer-post-respondents
links:
  - "[[specs/lead-engine/influencer-post-respondents/SPEC]]"
  - "[[specs/lead-engine/influencer-post-respondents/PLAN]]"
  - "[[specs/lead-engine/influencer-post-respondents/IMPLEMENTATION-NOTES]]"
  - "[[specs/lead-engine/influencer-post-respondents/RUBRIC]]"
ingested: false
last_ingested: null
created: 2026-06-17
updated: 2026-06-17
---

# Review Report — influencer-post-respondents (case B)

Quality gate indipendente (`adversarial-review`): 1 classifier + 6 verifier in contesti
puliti, sul working tree (NON sullo smoke T14 differito). reviewImpact **critical**,
humanInLoop **true**.

## Verdict: **SHIP** ✅ (dopo risoluzione di 1 BLOCKER, ri-verificato)

Un BLOCKER reale è stato trovato dal pass v2 (budget allocator), **risolto**, e
**ri-verificato indipendentemente** (pass fresco → SHIP). Tutti gli altri pass SHIP.

## Esito per pass

| pass | concern | verdetto | findings |
|------|---------|----------|----------|
| v1 | Migrazione DB (backfill rename + colonne additive) | SHIP | 2 NIT (no transaction wrap; guard ridondante su runs.strategy) |
| v2 | Budget `gather` (spesa Apify) | **DO NOT SHIP → FIXED → SHIP** | 1 BLOCKER (under-fill, risolto) + 1 MINOR (floor weight=0) |
| v3 | SQL selezione + report onesto | SHIP | 1 MINOR (tie `created_at`), 1 NIT |
| v4 | Invariante identità/dedup | SHIP | 1 MINOR (test name-fallback, **aggiunto**), 1 NIT |
| v5 | Mapper + adapter actor | SHIP | 2 MINOR (1 **fixato**: truthiness activityId; 1 doc), 2 NIT |
| v6 | Regressione / AC6 | SHIP | 1 MINOR (**fixato**: web Contact type), 1 NIT |

## BLOCKER risolto — under-fill del budget (v2)

**Trovato.** `gather` (a `primaryWeight=0.5` default): quando la primaria ha supply
**oltre** il suo cap E le altre strategie sono supply-thin, il surplus della primaria
non veniva recuperato (il riflusso andava solo primaria→altre, mai indietro). Riprodotto:
primaria 80 (chiesta 50) + altre 5+5 → totale **60** dove **90** erano disponibili.
Viola SPEC AC3 ("riflusso **senza ridurre il totale estratto**").

**Risolto.** Aggiunta una **fase 3 "reclaim"** in `src/pipeline/run.ts`: dopo la fase 2,
se `remaining > 0`, si ri-chiede (primaria per prima) SOLO alle strategie che avevano
reso ≥ del richiesto (segnale di supply residua) il loro target cumulativo
`min(totalLimit, asked + remaining)`, fino a `remaining ≤ 0`. È una seconda chiamata
`source()` **bounded** (≤1 per strategia) che scatta **solo** sul path di under-fill —
nel caso comune (primaria a basso volume, la realtà attesa) la fase 2 riempie il pool e
la fase 3 è saltata (nessun costo extra). Tests RED→GREEN: `gather-primacy.test.ts` casi
(f)/(g) + caso "no-reclaim" (1 chiamata per strategia).

**Ri-verificato** (pass fresco, contesto pulito): VERDICT SHIP. Unico residuo NIT: sul
path di under-fill, se la supply di una strategia è ESATTAMENTE pari al richiesto, una
chiamata extra innocua rende 0 (mai sul path comune). Non bloccante.

## Findings minori risolti in questo gate

- **v6 MINOR** — `web/src/api/types.ts`: aggiunto `source_detail: string | null` a `Contact`
  (allinea il type FE a `ContactRow`, chiude un drift latente).
- **v5 MINOR** — `post-extract.ts:activityIdOf`: `if (fromUrn)` → `if (fromUrn != null)`
  (coerenza col contratto di `field()`; difetto non raggiungibile ma tightenato).
- **v4 MINOR** — `company-expansion.test.ts`: aggiunto test dedup cross-post per **nome**
  (ramo fallback `companyKey` senza `companyUrn`).

## Findings minori accettati (debito documentato)

- **v1 NIT** — i due UPDATE di backfill non sono in una transazione esplicita: ognuno è
  atomico e idempotente; un crash tra i due si auto-completa al boot successivo. Cosmetico.
- **v3 MINOR** — stato non-deterministico solo sotto un tie ESATTO di `created_at` tra due
  run della stessa strategia con `run_error` discordante: impossibile in pratica (una riga
  per strategia per invocazione, timestamp wall-clock distinti).
- **v2 MINOR** — con `primaryWeight=0` la primaria è comunque chiesta ≥1 (floor `Math.max(1,…)`):
  scelta deliberata (primaria sempre "primo claim"); `weight=0` è config anomala.
- **v5 NIT** — `normalizeLinkedinUrl` accetta sottodomini `*.linkedin.com`: non raggiungibile
  dal path commenti (legge solo `author.profile_url`).

Vedi `brain/tech-debt/lead-engine/influencer-post-respondents.md` per i debiti aperti
maggiori (RH risolvibilità URN tagged-person, dedup slug-vs-URN).

## Acceptance criteria (giudizio del gate, codice/test)

| AC | stato | note |
|----|-------|------|
| AC1 commentatori > 0 | **pending live** | codice/mapper/test OK; conferma reale = T14 (smoke differito) |
| AC2 taggati persone+aziende espanse | **parziale** | aziende→espansione OK; persone taggate **gated off** fino allo spike (tech-debt) |
| AC3 primaria prima + budget dominante + riflusso | **met** | BLOCKER under-fill risolto + ri-verificato |
| AC4 azienda-first in selezione | **met** | v3 SHIP |
| AC5 report 0/errore + 4 stati + sotto-fonte | **met** | v3 SHIP + verifica agent-browser |
| AC6 nessuna regressione | **met** | v6 SHIP; suite 131/131, typecheck, web build verdi |

## ⚠️ Checklist umana obbligatoria (reviewImpact=critical, humanInLoop=true)

Prima di mettere in produzione / fare il primo run reale, l'operatore DEVE:

1. **Backfill migrazione su DB reale** — fare un **backup** di `data/sevedemo.db`, poi
   avviare una volta (il `migrate()` rinomina `freelance-post-reactors` →
   `influencer-post-respondents` su `contacts.source_strategy` + `runs.strategy`).
   Verificare in `eval:report` che le righe storiche compaiano sotto il nuovo id e che i
   conteggi tornino. (Idempotente e guarded: ri-verificato, ma è una mutazione su dati
   reali → backup comunque.)
2. **AC1 = pending live** — eseguire lo smoke reale **T14**:
   `npm run cli -- pipeline --strategy influencer-post-respondents --limit 50` con
   `APIFY_TOKEN` reale. Confermare > 0 commentatori reali e che la forma del payload
   commenti combaci col fixture (adeguare `actors.ts`/mapper se i campi differiscono).
   ⚠️ Costo Apify + Anthropic, scrive sul DB di produzione.
3. **tagged-person resta OFF** — non attivare `TAGGED_PERSON_ENABLED=true` finché lo spike
   di risolvibilità URN contro l'enrichment **daily** (`dev_fusion`) non passa
   (vedi tech-debt). Finché è off, AC2 "persone taggate" è scoperto by design.

## Gate eseguiti dai verifier
`npm test` (131 pass), `npm run typecheck` (clean), `npm run ui:build` (clean), frontend
via `agent-browser`. Nessun gate di lint configurato.
