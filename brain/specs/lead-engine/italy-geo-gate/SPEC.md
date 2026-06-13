---
domain: lead-engine
type: spec
status: draft
links:
  - "[[domains/lead-engine/lead-engine|lead-engine]]"
  - "[[domains/lead-engine/03-extraction-strategies|03 — Strategie di estrazione]]"
  - "[[domains/lead-engine/04-enrichment-scoring|04 — Enrichment e scoring]]"
created: 2026-06-13
updated: 2026-06-13
---

# Spec: Gate geografico Italia sull'estrazione

---

## User input

> Ho notato che dall'export dell'ultima iterazione tutti i profili delle bucket azienda non sono italiani.

Inquadramento dato dall'utente: questa è la prima di tre spec progressive; le prime due "riguardano ottimizzazione delle estrazioni e dei costi".

Chiarimenti raccolti prima della stesura:

- **"Italiano" = basato in Italia (località)**, a prescindere dalla nazionalità. Un decision maker straniero che opera sul mercato italiano (es. recruiter espatriato a Milano) resta un lead valido.
- I profili che non superano il gate vanno **scartati il prima possibile**, idealmente prima di pagarne l'enrichment Apify (è il punto "ottimizzazione costi").
- Il gate si applica a **tutti i bucket** (freelance e azienda), non solo all'azienda dove il problema è stato osservato.
- Vale **solo da ora in avanti**: i contatti non italiani già presenti nel DB non vanno ripuliti in questa spec.

---

## Context

Il Lead Engine estrae ogni giorno profili LinkedIn per cold-email destinate al mercato italiano: SeVedemo è una piattaforma di ricerca lavoro per freelance **italiani**. Le query di people-search passano già `location: "Italy"` all'actor harvestapi, ma nessun passo a valle verifica la provenienza: lo scoring assegna il bucket solo in base al **ruolo** e non scarta i profili fuori dall'Italia. Il risultato osservato è un bucket azienda popolato da profili non italiani, inutili per l'outreach e costati comunque enrichment, scoring e bozza email.

Questa spec introduce un **gate geografico Italia** lungo il funnel: nessun contatto fuori dall'Italia deve arrivare a selezione, export o pool della UI, e i profili fuori target vanno eliminati nel punto più economico possibile del funnel. Il destinatario è l'operatore che usa gli export (oggi Omar in test, domani un operatore SeVedemo) e, indirettamente, il budget Apify/LLM.

---

## Non-Goals

- Ripulire o ri-filtrare i contatti non italiani **già presenti** nel DB e negli export passati (forward-only; eventuale cleanup in una spec successiva).
- Gate basato su **lingua** del profilo o su **nazionalità**: la regola è esclusivamente la località in Italia.
- Rendere il paese **configurabile** o estendere ad altri mercati: l'Italia è l'unico target per ora.
- Cambiare la logica di routing del bucket (resta decisa da Claude in base al ruolo).
- I guard sulle bozze email senza indirizzo e i filtri/segmentazione della UI: sono le altre due spec.

---

## Acceptance Criteria

- Dopo questa modifica, ogni contatto che raggiunge lo stato `selected` o `exported`, **in qualunque bucket**, ha una località riconducibile all'Italia.
- Un profilo la cui località risulta **fuori dall'Italia** viene scartato nel punto più economico del funnel in cui la località è nota:
  - se la località è già presente nel risultato di people-search, il profilo è scartato **prima dell'enrichment Apify** (non si paga enrichment, scoring né bozza email);
  - se la località è nota solo dopo l'enrichment, il profilo è scartato **subito dopo l'enrichment, prima di scoring e bozza email**.
- Un profilo **basato in Italia ma con nome/nazionalità non italiani** viene mantenuto: il gate è geografico, non anagrafico.
- I profili scartati dal gate **non compaiono** in: selezione giornaliera, export CSV/JSON, pool dei candidati della UI (`/api/selections/:date/candidates`), elenco contatti come `selected`/`exported`.
- Il numero di profili scartati dal gate per ciascun run è **osservabile** (log o telemetria del run), così da spiegare un eventuale calo di volume senza dover ispezionare i singoli profili.
- La people-search resta vincolata all'Italia a monte **e** un controllo difensivo a valle intercetta i profili che l'actor restituisce comunque fuori target (cintura + bretelle).
- Il gate non viene allentato per raggiungere il target 20+20: se i profili italiani disponibili sono meno, la selezione resta più corta (la correttezza prevale sul volume).

---

## Constraints

- **Costo**: l'enrichment Apify è il costo dominante del funnel (lo scoring Haiku ≈ 5 $/mese, le bozze Sonnet sono ~40/giorno). Il gate ha valore economico solo se taglia i profili fuori target **prima** dei passi a pagamento più cari raggiungibili.
- La località di un profilo è strutturata su `contacts.location` solo dopo l'enrichment dev_fusion; in people-search è disponibile unicamente se l'actor la include nel payload grezzo. Il gate deve degradare con grazia quando la località non è ancora nota (vedi Open Questions).
- CLI e web UI condividono lo stesso SQLite: il gate deve valere per il run lanciato sia da CLI sia da UI.
- Best-effort: un errore nel gate non deve fermare il run (coerente con il principio "best-effort ovunque" del sistema).

---

## Technical Notes

Osservazioni dalla discovery (stato attuale, non scelte di design):

- `decisionmaker-queries.json` e `freelance-queries.json` passano già `location: "Italy"` ad harvestapi via `profileSearchInput` (`src/apify/actors.ts`), ma nessun passo verifica l'esito: i profili non italiani osservati nel bucket azienda indicano che il filtro dell'actor non è affidabile da solo.
- Il system prompt di scoring (`src/score/rubric.ts`) classifica per ruolo; riceve `Località` nel testo del profilo ma non ha alcuna regola di esclusione geografica.
- `RawCandidate` (`src/strategies/types.ts`) porta solo `linkedinUrl`/`fullName`/`headline` + `raw`; la colonna `location` di `contacts` è valorizzata solo da `updateEnrichment` (`src/db/contacts.ts`) a partire dall'output dev_fusion (`src/enrich/profile.ts`, campi `location`/`addressWithCountry`/`geoLocation`). Quindi al momento della people-search la località esiste solo dentro `raw`, se l'actor la espone.
- Funnel di riferimento (`src/pipeline/run.ts`): `gather → persist → prefilter → enrichAndScore → selectBucket → draftMany → export`. Il punto naturale per un gate pre-enrichment è tra `persist`/`prefilter` ed `enrichAndScore`; il gate post-enrichment va tra `updateEnrichment` e `scoreMany`.
- `prefilter` riduce già il pool per keyword sull'headline prima dell'enrichment: il gate geografico è un filtro analogo, ma per esclusione anziché per ranking.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | Località **assente/non determinabile**: scartare il profilo o lasciarlo passare all'enrichment (che riempie `location`) e applicare il gate lì? Proposta: scartare solo con evidenza positiva di non-Italia; località ignota prosegue fino al gate post-enrichment. | Volume estratto, falsi negativi su italiani con dati sparsi | Omar | Open |
| 2 | L'actor harvestapi profile-search ("Short" mode) espone una località usabile nei risultati? Se sì, il gate pre-enrichment è pienamente realizzabile; se no, il punto più precoce è post-enrichment. | Quanto risparmio Apify è effettivamente ottenibile | Omar (verifica in implementazione) | Open |
| 3 | I profili non italiani vanno persistiti come "tombstone" per non ri-processarli (e ri-pagarli) a ogni run, oppure scartati senza traccia? | Costo ricorrente della people-search su profili già scartati | Omar | Open |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Gate basato sulla **località in Italia**, non su lingua o nazionalità | Cattura il mercato target reale e non perde decision maker stranieri che assumono in Italia |
| Scartare i profili fuori target **il prima possibile** (idealmente pre-enrichment) | L'enrichment Apify è il costo dominante: tagliare prima massimizza il risparmio |
| Gate applicato a **tutti i bucket** | SeVedemo è una piattaforma solo-Italia; la regola è universale anche se il bug è emerso sull'azienda |
| **Forward-only**: nessun cleanup dei dati esistenti in questa spec | Primo passo a basso rischio; la pulizia dell'esistente è separabile |
| **Correttezza sul volume**: il gate non si allenta per fare 20+20 | Meglio meno lead corretti che lead non italiani inutilizzabili per l'outreach italiano |
