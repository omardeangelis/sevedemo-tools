---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-14
links: []
created: 2026-06-13
updated: 2026-06-14
---

# Concetto — Presenza email (`hasEmail`)

## Definition

Definizione canonica di quando un contatto **ha** un indirizzo email utilizzabile, e quindi di cosa
significa essere **"senza email"** nel funnel. Un contatto ha email se il campo `contacts.email` è una
stringa **non vuota dopo `.trim()`**; è "senza email" se il campo è `null`, `undefined`, stringa vuota
(`''`) o composta di **soli spazi**. Si considera **solo la presenza/assenza**: nessuna validazione di
sintassi o correttezza dell'indirizzo.

Il predicato vive in un punto unico: `hasEmail(email)` in `src/util/fields.ts`
(`typeof email === 'string' && email.trim() !== ''`). **Attenzione:** la segmentazione per presenza
email (spec #3, [[segmentazione-presenza-email]]) **non** riusa `hasEmail` ma una definizione **non-trim**
allineata a `getStats().withEmail` — vedi «Tre definizioni a confronto» più sotto.

## Attributes

| Attributo | Valore |
|-----------|--------|
| Predicato | `hasEmail(email: string \| null \| undefined): boolean` (`src/util/fields.ts`) |
| "Ha email" | stringa non vuota dopo `trim()` |
| "Senza email" | `null` / `undefined` / `''` / soli spazi |
| Validazione sintassi | **No** — conta solo presenza/assenza |
| Sorgente del dato | `contacts.email`, popolato best-effort dall'enrichment dev_fusion ([[04-enrichment-scoring]]) |
| Primo uso | guard di costo nelle bozze email ([[bozze-email-guard]]): salta la chiamata Sonnet se `!hasEmail` |
| Secondo uso | segmentazione/filtro su Contatti, pool, Selezioni ed export ([[segmentazione-presenza-email]], [[export-email-ready]]) — definizione **non-trim** |
| Predicato segmentazione (SQL) | "con": `email IS NOT NULL AND email <> ''` · "senza": `(email IS NULL OR email = '')` (`contactsWhere`/`listCandidates`, `src/server/queries.ts`) |
| Flag per riga | `email_ready` negli export — CSV (`emailReady`, `src/export/csv.ts`) e JSON (`isEmailReady` via `toJsonRow`, `src/server/app.ts`) |
| Predicato lato client | `isEmailReady(email)` (`web/src/api/client.ts`): `email != null && email !== ''` — partiziona la Selezione in pronti/da arricchire |
| Vocabolario query | `email=with \| without` (omesso = tutti), identico su tutti gli endpoint |
| Effetto a valle | un contatto senza email resta in selezione/export con `email_subject`/`email_body` vuoti; non rimosso né riclassificato — ora **segmentabile e contabile** ([[segmentazione-presenza-email]]) |

## Tre definizioni a confronto (fork non ancora unificato)

Dopo la spec #3 coesistono **tre** definizioni di "email presente". Le ultime due sono **non-trim** e
identiche tra loro; solo la prima fa `trim()`:

| # | Definizione | Dove | Trim? | Usata da |
|---|-------------|------|-------|----------|
| 1 | `hasEmail` = `typeof === 'string' && trim() !== ''` | `src/util/fields.ts` | **Sì** | solo il guard bozze ([[bozze-email-guard]]), `src/email/draft.ts` |
| 2 | `email IS NOT NULL AND email <> ''` | `getStats()`, `src/server/queries.ts` | No | conteggio `withEmail` in dashboard |
| 3 | stesso SQL + `email != null && email !== ''` | `contactsWhere`/`listCandidates`/`emailReady`/`isEmailReady` (server `app.ts` + client `client.ts`) | No | tutta la segmentazione/export della spec #3 |

La spec #3 ha scelto **deliberatamente** la definizione non-trim (#2/#3), non `hasEmail`, per **parità di
conteggio con `getStats().withEmail`** (Constraint della SPEC): i totali della segmentazione devono
combaciare con quelli mostrati in dashboard. Conseguenza: i contatti con email di **soli spazi** sono
trattati come "con email" dalla segmentazione (#2/#3) ma come "senza email" dal guard bozze (#1) — caso
limite improbabile sui dati reali dell'enrichment, ma è una divergenza viva.

> [!note] Unificare i tre predicati in un unico helper condiviso è **tech-debt** rinviato
> esplicitamente: vedi
> [[../../../tech-debt/lead-engine/email-segmentation-filters|tech-debt/email-segmentation-filters]] §TD-1
> (Out of Scope della spec #3,
> [[../../../specs/lead-engine/email-segmentation-filters/IMPLEMENTATION-NOTES|IMPLEMENTATION-NOTES]]).
> Nessun modulo condiviso lega `server app.ts` e `client client.ts`: le due `isEmailReady` sono
> indipendenti per coerenza con lo split di file-scope.

## Related flows

- [[bozze-email-guard]] — il guard di costo che usa `hasEmail` (def. #1) per saltare la bozza Sonnet.
- [[segmentazione-presenza-email]] — filtro/segmentazione tri-state su tutte le superfici (def. #3).
- [[export-email-ready]] — export con flag `email_ready` per riga e download "solo email-ready" (def. #3).
- [[stato-filtri-url]] — `email` come campo persistito nei filtri Contatti.
- [[05-selection-email-export]] — il passo bozze/export in cui la presenza email determina l'esito.

## [Source: SPEC + IMPLEMENTATION-NOTES email-draft-guard]

- Acceptance criterion: «"Senza email" è definito come: campo email `null`, stringa vuota o composta
  solo da spazi».
- Decision log: nessuna validazione di sintassi (evita falsi negativi e complessità: il problema
  osservato è l'assenza, non la malformazione).

## [Source: SPEC + IMPLEMENTATION-NOTES email-segmentation-filters]

- La segmentazione è **read-side** e usa la definizione **non-trim** (def. #2/#3) per parità con
  `getStats().withEmail` (Constraint della SPEC): "con email" = `email IS NOT NULL AND email <> ''`.
- Aggiunge il flag per riga `email_ready` agli export (CSV in coda alle `COLUMNS`, JSON via `toJsonRow`)
  e `isEmailReady` lato client per partizionare la Selezione in **pronti / da arricchire**.
- Il fork di definizione **non** è stato unificato: la spec ha aggiunto un terzo predicato non-trim e
  rinviato l'unificazione a tech-debt (vedi «Tre definizioni a confronto»).
