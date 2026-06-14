---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-14
links: []
created: 2026-06-14
updated: 2026-06-14
---

# Concetto — Classificazione geografica della località (`classifyLocation`)

## Definition

Definizione canonica di quando una località è **riconducibile all'Italia** ai fini del funnel. La
classificazione è **geografica, non anagrafica/linguistica**: si guarda la *stringa di località*, mai il
nome o la nazionalità della persona (un decision maker straniero basato a Milano resta un lead valido).
Vive in una funzione pura, deterministica e **totale** (non lancia mai):
`classifyLocation(loc): 'italy' | 'foreign' | 'unknown'` in `src/pipeline/geo-gate.ts`.

Il match è **case-insensitive e per parola/frase intera** (token, non substring nudo): la normalizzazione
`tokenize()` fa `toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u)` e confronta frasi delimitate da
spazi. Questo dà un vero word-boundary (`"india"` non matcha dentro `"indiana"`), gestisce gli accenti
(`"Città del Vaticano"`) e le abbreviazioni puntate (`"U.S."` → `u s`, matchata dal token `u.s.`).

La classe `unknown` non è un errore: è la mancanza di un segnale geografico riconosciuto (vuoto, `"Remote"`,
`"Earth"`, città non in lista). Il suo trattamento **dipende dal gate** (vedi [[stato-rejected-geo]] e il
flow [[gate-geografico-italia]]): il pre-gate lascia passare `unknown`, il post-gate lo scarta.

## Procedura ordinata (l'ordine conta)

1. **Paese estero presente → `foreign` (domina).** Lista **completa** dei paesi del mondo (~195 nomi EN +
   abbreviazioni `usa`/`uk`/`uae`/… + nomi IT dei più frequenti). La precedenza del paese estero risolve
   la collisione: `"San Marino, California, United States"` → `foreign` (qui "San Marino" è la città
   californiana, qualificata da "United States").
2. **Token-paese Italia, enclavi incluse → `italy`.** `italy`/`italia`/… **+ San Marino + Città del
   Vaticano** (`vatican`/`vatican city`/`holy see`/`santa sede`), per **decisione D8** (enclavi italofone
   interamente dentro il territorio italiano). `"San Marino"` da solo → `italy`.
3. **Regione/città italiana → `italy`** (milano/milan, roma/rome, lombardia/lombardy, …). Es. `"Greater
   Milan Metropolitan Area"` → `italy`.
4. **Città estera maggiore → `foreign`** (london, paris, madrid, …) in assenza di segnali Italia.
5. **Altrimenti → `unknown`.**

## Attributes

| Attributo | Valore |
|-----------|--------|
| Funzione | `classifyLocation(loc: string \| null \| undefined): 'italy' \| 'foreign' \| 'unknown'` (`src/pipeline/geo-gate.ts`) |
| Natura | pura, deterministica, **totale** (mai throw); nessuna dipendenza esterna / no IP-geolocation |
| Regola | **località geografica**, non lingua né nazionalità (AC#3) |
| Matching | case-insensitive, per token/word-boundary via `tokenize()` (`\p{L}`/`\p{N}` Unicode, accenti inclusi) |
| Perimetro "Italia" | Italia + enclavi **San Marino** e **Città del Vaticano** (D8); **non** è un gate linguistico (Ticino/Svizzera resta `foreign`) |
| Lista `foreign` | **completa** (~195 paesi + varianti): la località di people-search è spesso il solo paese (es. `"Cyprus"`); un paese mancante cadrebbe in `unknown` e sfuggirebbe al pre-gate |
| Estrazione dal raw | `locationFromRaw(raw)`: `location.linkedinText` → `location` (stringa) → `location.parsed.text` → `geoLocation` → `addressWithCountry` → `addressWithoutCountry`; **non** insegue la forma dev_fusion (`source.location`) → `undefined` su quel payload (bloccato da test) |
| Esiti | `italy` (tenuto ovunque) · `foreign` (scartato sempre) · `unknown` (tenuto dal pre-gate, scartato dal post-gate) |
| Fonte pre-enrichment | `contacts.raw_json` (item people-search), letto via `locationFromRaw` |
| Fonte post-enrichment | colonna `contacts.location`, valorizzata da dev_fusion ([[04-enrichment-scoring]]) |
| Taratura | liste regioni/città IT ed estere curate ma non esaustive; da ampliare osservando i conteggi loggati `geo-gate (pre\|post)` (tech-debt solo se emergono falsi negativi ricorrenti) |

## Related flows

- [[gate-geografico-italia]] — il doppio gate che consuma `classifyLocation`/`locationFromRaw`
  per partizionare e tombstonare i profili fuori Italia.
- [[03-extraction-strategies]] — la people-search che produce il `raw_json` (con `location.linkedinText`)
  letto dal pre-gate; il pin `location:'Italy'` a monte ("cintura").
- [[04-enrichment-scoring]] — l'enrichment dev_fusion che valorizza `contacts.location`, fonte del post-gate.

## [Source: SPEC + IMPLEMENTATION-NOTES italy-geo-gate]

- **"Italiano" = basato in Italia (località)**, a prescindere dalla nazionalità (Decision Log SPEC).
- **Perimetro esteso a San Marino e Città del Vaticano (D8):** due micro-stati enclave **nominati**, non
  un gate linguistico generale (il Non-Goal "niente gate su lingua/nazionalità" resta invariato; la regola
  resta la località). La collisione con la città californiana "San Marino" è gestita dalla precedenza
  "paese estero domina" (step 1).
- **Word-boundary deliberato:** `"Indiana"` ≠ India, `"Somalia"` ≠ Mali — coperti da test.
- **Scope di `locationFromRaw`:** mira solo all'item people-search; dopo l'enrichment `updateEnrichment`
  sovrascrive `raw_json` col payload dev_fusion (`{ experience, source }`) — forma **non** inseguita qui,
  perché il pre-gate gira prima dell'enrichment e per i profili arricchiti la fonte è la colonna
  `contacts.location`. Comportamento `undefined` su payload dev_fusion **bloccato da test**.
