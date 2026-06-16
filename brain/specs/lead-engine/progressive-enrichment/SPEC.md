---
domain: lead-engine
type: spec
status: implemented
links:
  - "[[specs/lead-engine/email-draft-guard/SPEC]]"
  - "[[specs/lead-engine/email-segmentation-filters/SPEC]]"
  - "[[domains/lead-engine/04-enrichment-scoring]]"
  - "[[domains/lead-engine/05-selection-email-export]]"
created: 2026-06-14
updated: 2026-06-15
ingested: true
last_ingested: 2026-06-15
---

# Spec: Enrichment progressivo — recupero email mancanti e Selezione figlia del Run

---

## User input

> Vorrei migliorare il flusso per segmentarlo e renderlo arricchibile progressivamente prima di generare una Selezione.
>
> Ora vedo che il flusso di selezione, mostri che ci sono dei contatti pronti e altri da arricchire senza nessuna azione concreta oltre che manuale.
>
> Vorrei che vi fosse una prima possibilità di effettuare enrichment usando questo actor di apify: apimaestro/linkedin-profile-detail
>
> Trovo anche un po strano non vedere questi stati sul Run e la Selezione. Mi piace avere la divisione tra Selezione e Run ma per come sono impostati ora mi da l'imporessione che la "Selezione" debba rappresentare un'export specifico di un Run.

Chiarimenti raccolti in fase di intervista:

- **Cucitura enrichment:** il Run daily resta end-to-end come oggi; l'enrichment progressivo è un'azione **aggiuntiva** per completare i contatti rimasti senza email (modello "top-up").
- **Run ↔ Selezione:** la Selezione resta un concetto distinto ma diventa **figlia di un Run** — registra il Run che l'ha generata, è seminata di default dai contatti di quel Run, e resta editabile potendo pescare anche dal pool storico.
- **Actor:** `apimaestro/linkedin-profile-detail` **affianca** l'attuale `dev_fusion/linkedin-profile-scraper`; non lo sostituisce. dev_fusion resta l'enricher del run batch, apimaestro è l'enricher dell'azione on-demand.
- **Scopo dell'enrichment progressivo:** trovare **email mancanti**. *"Se la mail mancava e viene trovata, deve generare la bozza."*

---

## Context

Il Lead Engine estrae, arricchisce e seleziona ~40 contatti LinkedIn/giorno per cold-email. Oggi il funnel automatico (`runDaily`) arricchisce in batch con `dev_fusion/linkedin-profile-scraper`, che recupera l'email solo **best-effort**: molti contatti scored finiscono in selezione **senza email** e quindi non inviabili. La web UI (vedi [[specs/lead-engine/email-segmentation-filters/SPEC]]) già **segmenta** la Selezione in "✉ pronti" (con email) e "da arricchire" (senza email) — ma il segmento "da arricchire" è un vicolo cieco: l'unica azione possibile è completare l'email a mano, contatto per contatto.

Questa spec dà al segmento "da arricchire" una **azione concreta**: un enrichment progressivo on-demand, mirato al recupero dell'email mancante, che usa l'actor `apimaestro/linkedin-profile-detail` (profilo pubblico completo + email pubblica best-effort, **no cookie**, ~$5/1000). Quando l'azione recupera un'email prima assente, genera anche la **bozza email** così che il contatto passi da "da arricchire" a "pronto" senza intervento manuale.

In parallelo riallinea il modello concettuale **Run ↔ Selezione**: oggi la `daily_selection` è agganciata solo alla data e pesca dall'**intero pool storico** del DB, senza alcun legame esplicito col Run che l'ha prodotta — il che rende opaco il rapporto tra i due. La Selezione diventa l'**export di un Run**: tracciabile al Run d'origine e seminata dai suoi contatti, pur restando editabile a mano.

**Attore:** l'operatore del Lead Engine (uso locale, single-user) che gira il funnel giornaliero, rivede la Selezione e vuole massimizzare i contatti realmente inviabili prima dell'export, con una fotografia chiara e azionabile dello stato "pronto / da arricchire" sia sul Run sia sulla Selezione.

---

## Non-Goals

- **Non** sostituire `dev_fusion` nel run batch: `apimaestro` alimenta **solo** l'azione on-demand.
- **Non** ri-valutare (re-scoring) né ri-bucketizzare i contatti dopo l'enrichment: lo scopo è il recupero email, `bucket`/`sector`/`fit_score` restano quelli dello scoring originale. (Possibile evoluzione futura, fuori scope qui.)
- **Non** introdurre actor cookie-gated o login LinkedIn.
- **Non** rendere la Selezione **strettamente** run-scoped: l'editing a mano può ancora pescare dal pool storico (l'opzione "solo contatti del Run" è stata esplicitamente scartata).
- **Non** modificare il gate geografico, la rubric di scoring, l'ordine/colonne del CSV d'export oltre a quanto serve a riflettere i nuovi stati.
- **Non** arricchire in massa l'intero DB: l'azione opera solo su contatti esplicitamente targettizzati (una Selezione / un suo segmento / un singolo contatto).
- **Non** introdurre auth o esposizione remota: resta tutto locale.

---

## Acceptance Criteria

### Azione di enrichment progressivo (recupero email)

- Dal segmento "da arricchire" della Selezione l'operatore può lanciare un'azione di enrichment su **un singolo contatto** e sull'**intero segmento "da arricchire"** di un bucket.
- L'azione invoca l'actor Apify `apimaestro/linkedin-profile-detail` sui contatti targettizzati, partendo dal loro `linkedin_url`, **senza cookie**.
- I dati di profilo recuperati sono persistiti con semantica **refresh** (un valore nuovo non vuoto vince; un enrichment parziale non cancella dati già noti), coerente con l'attuale `updateEnrichment`.
- L'azione opera **solo** su contatti senza email (predicato di [[domains/lead-engine/04-enrichment-scoring|presenza email]]); un contatto già "pronto" non viene ri-arricchito da questa azione.
- Al termine la UI mostra l'esito aggregato dell'azione: numero di contatti tentati, email recuperate, bozze generate.
- L'azione gira come **processo asincrono riusabile** con lo stesso meccanismo di job/stato della pipeline (`ui_job` in `kv`): l'operatore vede progresso ed esito in-app. Oggi è a **trigger manuale** (fase di validazione umana); il processo è pensato per essere **automatizzato in futuro** senza riscriverlo.

### Recupero email → bozza → "pronto"

- Quando l'azione recupera un'email per un contatto che **prima non l'aveva**, l'email è persistita su `contacts.email` e il contatto viene riconteggiato come "pronto" su tutte le superfici (stesso predicato della segmentazione esistente).
- Per ogni contatto che passa da "senza email" a "con email", il sistema genera la **bozza email** (stesso percorso/prompt di `draftMany`, modello Sonnet) popolando `email_subject` ed `email_body` — di fatto "riapre" il guard di [[specs/lead-engine/email-draft-guard/SPEC|email-draft-guard]] per quel contatto.
- Se l'enrichment **non** recupera un'email, il contatto **resta** "da arricchire": nessuna bozza viene generata, nessun errore.

### Tracciamento del tentativo

- Ogni tentativo di enrichment progressivo è registrato sul contatto (almeno: timestamp del tentativo e actor usato) così che la UI distingua "mai tentato" da "tentato senza email trovata".
- Nel segmento "da arricchire" della Selezione i contatti "tentati senza email" sono visivamente distinti da quelli "mai tentati".
- Un contatto "tentato senza email" torna eleggibile per un nuovo tentativo **solo quando il tentativo è "stale" secondo la stessa logica di `isFresh`** (finestra `FRESHNESS_DAYS`); entro la finestra non viene ri-arricchito (né a mano né in automatico), per non ri-spendere su Apify.

### Stati visibili su Run e Selezione

- La pagina **Run** mostra, per ciascun Run, il conteggio "pronti" vs "da arricchire" della Selezione che ne deriva, e un link navigabile a quella Selezione.
- Dalla **Selezione** è raggiungibile/visibile il Run che l'ha generata (provenienza bidirezionale Run ↔ Selezione).

### Selezione figlia del Run

- Ogni `daily_selection` registra un riferimento esplicito al Run (esecuzione di `runDaily`) che l'ha generata (`run_id`-equivalente), interrogabile e mostrato in UI.
- Una Selezione è composta dai **migliori contatti eleggibili** in quel momento — i **nuovi** prodotti dal Run più la **riserva** pescata dal pool (contatti `scored`, freschi, **non** `exported`) — così da contattare sempre i contatti migliori di volta in volta.
- L'operatore può comunque **aggiungere a mano** alla Selezione contatti presi dal pool storico (comportamento di editing manuale invariato rispetto a oggi).

### Invarianti preservate

- Il run batch automatico (`dev_fusion` + scoring + generazione Selezione) continua a funzionare come oggi nelle sue fasi di estrazione/enrichment/scoring; l'enrichment progressivo è puramente additivo. **Eccezione deliberata — remodel degli stati (vedi Decision Log):** `contacts.status` rappresenta ora solo lo *stadio del dato* (`new → enriched → scored → discarded → rejected_geo`); `runDaily` non marca più i contatti `selected`/`exported` (quei valori sono rimossi dal contatto). La Selezione ha un ciclo proprio `in_review → exported` (colonna `daily_selection.state`); `exported` è assegnato solo dall'azione esplicita "Esporta". L'artefatto CSV su disco è invariato.
- **Eleggibilità e "già contattato" sono derivate dalla membership, non dallo status:** un Run propone i migliori contatti `scored` **non già presenti in alcuna Selezione**; un contatto rimosso da una Selezione torna eleggibile automaticamente; "max una email" = non riproporre chi è in una Selezione `exported`.
- **"pronto" / "da arricchire" restano _derivati_** dalla presenza email (predicato canonico) + `last_enrichment_attempt_at`, mai promossi a `status`.
- Un contatto continua a ricevere la cold-email al più una volta: l'azione non re-immette nel pool contatti già `selected`/`exported`.
- I contatti già `exported` **non** sono mai bersaglio dell'enrichment progressivo né rientrano in un Run: un Run lavora solo su nuovi + riserva eleggibile (`scored`, freschi, non `exported`).

---

## Constraints

- **Costo Apify:** `apimaestro/linkedin-profile-detail` costa ~$5/1000 profili. L'azione non deve mai auto-partire e deve operare solo su contatti esplicitamente targettizzati e privi di email; il retry su un contatto già tentato senza esito è vincolato dalla **stessa logica di `isFresh`** (`FRESHNESS_DAYS`) per non ri-spendere.
- **Riuso del processo job:** l'azione riusa il meccanismo di job/stato della pipeline (`ui_job`), a trigger manuale per ora (validazione umana), ma progettata per essere automatizzata in futuro senza riscritture.
- **No cookie / ToS:** l'actor è no-cookie; resta nella fascia "attiva ora" delle strategie ([[lead-engine-architecture]]). Nessun uso di `LINKEDIN_LI_AT`.
- **Predicato presenza email:** riusare la definizione canonica già in uso ([[domains/lead-engine/04-enrichment-scoring]] / concept presenza-email) per decidere "da arricchire" → "pronto"; non introdurre una quarta definizione divergente.
- **Generazione bozza:** riusare il percorso e il prompt esistenti delle bozze (`EMAIL_SYSTEM`, vincoli di prodotto: italiano, 60–110 parole, CTA singola, PS di opt-out GDPR) — nessun prompt parallelo.
- **Storage:** SQLite resta l'unica fonte di verità; export sempre **vista** dello stato corrente, mai fonte di verità.
- **Locale, single-user:** nessuna auth, porta 8787 non esposta.

---

## Technical Notes

- **Identità di Run:** oggi la tabella `runs` ha **una riga per strategia per data**, quindi "il Run" va inteso come l'**esecuzione di `runDaily`** (che scrive N righe `runs` + una `daily_selection`). Il `run_id` della Selezione deve puntare a quell'esecuzione; non serve taggare i singoli `contacts` con il Run, perché "i contatti del Run" coincidono con i migliori eleggibili del momento (nuovi + riserva) — vedi Open Questions #1.
- **Freshness del tentativo:** il retry per freshness richiede un timestamp dedicato del tentativo di enrichment (es. `last_enrichment_attempt_at`), **distinto** da `last_evaluated_at` (scoring) per non conflarli.
- La `daily_selection` attuale è una transazione DELETE+INSERT per data, già editabile da UI (`addToSelection`/`removeFromSelection`): il legame `run_id` e il seeding da Run si innestano su questo artefatto editabile, non lo sostituiscono.
- Esiste già un fork di definizione "email presente" (`hasEmail` con trim nel guard bozze vs predicato non-trim nella segmentazione). Questa spec **non** lo unifica; per un'email reale appena recuperata le definizioni coincidono. Mantenere coerenza con la segmentazione esistente.
- Pattern di esecuzione job già presente per il run pipeline (stato `ui_job` in `kv`): candidato naturale per dare feedback di progresso all'azione di enrichment (vedi Open Questions #5).

---

## Open Questions

Nessuna domanda aperta: tutte risolte in intervista — vedi Decision Log.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Modello "top-up": il Run resta end-to-end, l'enrichment progressivo è additivo | Scelta dell'utente; minimo rischio, non tocca la pipeline batch già testata |
| Selezione figlia del Run: seminata dal Run ma editabile dal pool | Scelta dell'utente; rende la Selezione "l'export di un Run" preservando due concetti distinti. Trade-off: indebolisce il "serbatoio persistente" come default — mitigato dall'editing manuale dal pool (vedi Open Q #2) |
| `apimaestro` affianca `dev_fusion` (solo on-demand), non lo sostituisce | Scelta dell'utente; preserva l'infrastruttura di enrichment batch esistente |
| Scopo = recupero email mancanti; al recupero si genera la bozza | Chiarimento dell'utente; re-scoring escluso per restare focalizzati sull'inviabilità |
| Selezione **non** strettamente run-scoped | Opzione esplicitamente scartata dall'utente in favore di "figlia del Run, editabile" |
| Auto-fill della Selezione dalla riserva (Open Q #2) | La Selezione attinge sempre ai migliori eleggibili (nuovi + riserva) per contattare di volta in volta i contatti migliori; preserva il "serbatoio persistente" come riserva del Run |
| Retry enrichment vincolato dalla freshness (Open Q #3) | Un tentativo senza email è segnalato e ri-tentabile solo quando "stale" secondo `isFresh` (`FRESHNESS_DAYS`); riusa il meccanismo anti-spesa già esistente |
| Stesso processo/job della pipeline, trigger manuale (Open Q #4) | L'azione riusa il job `ui_job`; manuale ora per validazione umana, automatizzabile in futuro senza riscritture |
| Contatti `exported` esclusi da enrichment e da un Run (Open Q #5) | Un Run lavora solo su nuovi + riserva eleggibile; un contatto `exported` ha già ricevuto l'email e non rientra nel ciclo |
| "I contatti del Run" = migliori eleggibili (nuovi + riserva); Selezione con solo `run_id` di provenienza, nessun set separato per Run (Open Q #1) | Modello dati minimale: nessun tag per-contatto né tabella di join; la logica di selezione resta quella odierna (top-N dal pool, esclusi gli `exported`) + etichetta del Run |
| **Run identity: `run_id` reale per esecuzione di `runDaily`** (Opzione A), scritto su righe `runs` + `daily_selection`; pagina Run raggruppata per esecuzione | Scelta utente in fase di plan: rende il Run un'entità di prima classe a cui la Selezione appartiene, distinguendo anche due run nello stesso giorno |
| **Remodel degli stati** (scelta utente in fase di plan): `contacts.status` = solo *stadio del dato* (`new → enriched → scored → discarded → rejected_geo`); la Selezione ha un ciclo proprio `in_review → exported`; eleggibilità e "già contattato" sono *derivate dalla membership* in `daily_selection`. `selected`/`exported` rimossi dal contatto | `status` confondeva stadio-dato e ciclo cold-email: da qui `selected` come stato d'ingresso (errato: un contatto proposto da un Run è in *revisione*, non scelto) e il bug del contatto rimosso da una Selezione lasciato `selected` orfano. Separando le due dimensioni, "una Selezione è l'export validato di un Run" diventa il modello dei dati e il disallineamento status↔membership sparisce per costruzione |
| **`pronto`/`da arricchire` = derivati, mai `status`** (scelta utente): presenza email (predicato canonico) + `last_enrichment_attempt_at`; "email senza bozza" = flag UI, non un segmento | Stesso principio: ciò che è funzione del dato non va congelato in una colonna (eviterebbe la sincronizzazione); coerente con [[specs/lead-engine/email-segmentation-filters/SPEC]] |
