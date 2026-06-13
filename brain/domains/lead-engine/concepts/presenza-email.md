---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-13
links: []
created: 2026-06-13
updated: 2026-06-13
---

# Concetto — Presenza email (`hasEmail`)

## Definition

Definizione canonica di quando un contatto **ha** un indirizzo email utilizzabile, e quindi di cosa
significa essere **"senza email"** nel funnel. Un contatto ha email se il campo `contacts.email` è una
stringa **non vuota dopo `.trim()`**; è "senza email" se il campo è `null`, `undefined`, stringa vuota
(`''`) o composta di **soli spazi**. Si considera **solo la presenza/assenza**: nessuna validazione di
sintassi o correttezza dell'indirizzo.

Il predicato vive in un punto unico: `hasEmail(email)` in `src/util/fields.ts`
(`typeof email === 'string' && email.trim() !== ''`). È il fondamento riusabile su cui poggerà la
segmentazione per presenza email della spec #3.

## Attributes

| Attributo | Valore |
|-----------|--------|
| Predicato | `hasEmail(email: string \| null \| undefined): boolean` (`src/util/fields.ts`) |
| "Ha email" | stringa non vuota dopo `trim()` |
| "Senza email" | `null` / `undefined` / `''` / soli spazi |
| Validazione sintassi | **No** — conta solo presenza/assenza |
| Sorgente del dato | `contacts.email`, popolato best-effort dall'enrichment dev_fusion ([[04-enrichment-scoring]]) |
| Primo uso | guard di costo nelle bozze email ([[bozze-email-guard]]): salta la chiamata Sonnet se `!hasEmail` |
| Effetto a valle | un contatto senza email resta in selezione/export con `email_subject`/`email_body` vuoti; non rimosso né riclassificato (spec #3) |

## Divergenza nota (fork di definizione)

Esiste una **seconda** definizione, inline e a livello dati: `getStats()`
(`src/server/queries.ts`) calcola `withEmail` con SQL `email IS NOT NULL AND email <> ''`, che
**non** intercetta le stringhe di soli spazi. Divergenza minore e innocua oggi (reporting read-only),
lasciata intatta di proposito dalla spec #2 (scope minimale). È il candidato naturale a unificazione
quando la spec
[[../../../specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]] (#3)
toccherà la segmentazione per presenza email.

## Related flows

- [[bozze-email-guard]] — il guard di costo che usa `hasEmail` per saltare la bozza Sonnet.
- [[05-selection-email-export]] — il passo bozze/export in cui la presenza email determina l'esito.

## [Source: SPEC + IMPLEMENTATION-NOTES email-draft-guard]

- Acceptance criterion: «"Senza email" è definito come: campo email `null`, stringa vuota o composta
  solo da spazi».
- Decision log: nessuna validazione di sintassi (evita falsi negativi e complessità: il problema
  osservato è l'assenza, non la malformazione).
