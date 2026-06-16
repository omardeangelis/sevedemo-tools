---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-15
links: []
created: 2026-06-15
updated: 2026-06-15
---

# Concetto — Enrichment progressivo con `apimaestro/linkedin-profile-detail`

## Definition

L'enricher **on-demand** (modello "top-up") usato dal flow [[enrichment-progressivo-email]] per recuperare
l'**email mancante** di un contatto. **Affianca** — non sostituisce — `dev_fusion/linkedin-profile-scraper`,
che resta l'enricher del run batch ([[04-enrichment-scoring]]). È **no-cookie** (~$5/1000 profili), actor
**single-profile** (una chiamata per URL, a concorrenza limitata), partendo dal `linkedin_url` salvato
(incluso il formato URN `/in/ACwAAA…`).

Due proprietà dell'actor sono critiche e sono costate due bug, scoperti col **primo run reale** (R1) e ora
incapsulati nel codice:

- **Schema di input** (`profileDetailInput`, `src/apify/actors.ts`): l'unico campo richiesto è
  **`username`** (che accetta anche un URL/URN); `includeEmail` ha **default `false`** e va forzato a
  `true`. Input corretto: `{ username: url, includeEmail: true }`. Passare l'URL come `profileUrl`/`urls`
  viene ignorato → l'actor scrapa il profilo demo `sarptecimer`.
- **Canonicalizzazione dell'URL in output:** l'actor restituisce l'URL **canonicalizzato** (URN → public
  identifier, es. `/in/ACwAAAF1…` → `/in/alessio-maugeri-3322388`), **diverso** dall'input. Perciò
  `enrichProfileDetails` (`src/enrich/profile-detail.ts`) tiene la mappa keyed sull'**URL di input** `u`,
  così il chiamante ritrova l'enrichment con la sua `linkedin_url`. L'output è **annidato** (`basic_info.*`,
  diverso dallo schema piatto di dev_fusion); l'email viene da `basic_info.email` con fallback regex su
  `basic_info.about`.

## Attributes

| Attributo | Valore |
|-----------|--------|
| Actor id | `apimaestro/linkedin-profile-detail` (`ACTORS.profileDetail`) |
| Ruolo | enricher **on-demand** per recupero email; affianca `dev_fusion` (batch), non lo sostituisce |
| Cookie | **no** — fascia "attiva ora"; nessun uso di `LINKEDIN_LI_AT` |
| Costo | ~$5/1000 profili; mai auto-parte, solo su target espliciti senza email |
| Input | `profileDetailInput(urls)` → `{ username: urls[0], includeEmail: true }` (R1 Fix 1) |
| Chiamata | single-profile, **una per URL**, `pLimit(CONCURRENCY=3)` |
| Output | **annidato** `basic_info.*`; email da `basic_info.email` + fallback regex su `basic_info.about` |
| Chiave mappa | **URL di input** `u`, non l'output canonicalizzato (R1 Fix 2) |
| Mapper | `mapProfileDetailItem(it)` → `{ url, enrichment }`; `url` serve solo a scartare item senza profilo |
| Persistenza | `applyProgressiveEnrichment(id, e, 'apimaestro/linkedin-profile-detail')` — refresh COALESCE (valore nuovo non vuoto vince; parziale non azzera) |
| Stamp (sempre) | `last_enrichment_attempt_at` + `last_enrichment_actor`, anche sui miss (`src/db/contacts.ts`) |
| Freshness | `isEnrichmentFresh(id, FRESHNESS_DAYS)` su `last_enrichment_attempt_at` (timestamp **dedicato**, ≠ `last_evaluated_at`) |
| Non fa | re-scoring / re-bucketizzazione: `bucket`/`sector`/`fit_score` invariati (Non-Goal) |

## Related flows

- [[enrichment-progressivo-email]] — il flow on-demand che orchestra target → freshness → actor →
  persistenza → bozza.

## [Source: SPEC + IMPLEMENTATION-NOTES progressive-enrichment]

- **T4:** `enrichProfileDetails` + `mapProfileDetailItem`, output annidato `basic_info.*`, fallback email
  da `about` (`tests/profile-detail.test.ts`).
- **R1 — smoke reale (2026-06-15), APIFY_TOKEN reale:** i due fix sopra (input schema, chiave della mappa)
  sono emersi **solo** girando il job vero — la probe isolata non li catturava (Fix 2 era invisibile ai
  test perché il campione usava input-url == output-url). Aggiunto test di regressione con input URN ≠
  output canonicalizzato. Esito: **7/21 email recuperate (33%)**, 7 bozze.
- **Refresh:** `applyProgressiveEnrichment` riusa la semantica COALESCE di `updateEnrichment` (Persistenza
  refresh della SPEC); lo stamp del tentativo (anche sui miss) abilita la distinzione "tentato senza email"
  in [[modello-stati-membership]].
