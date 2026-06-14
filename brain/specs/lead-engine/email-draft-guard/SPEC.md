---
domain: lead-engine
type: spec
status: implemented
links:
  - "[[domains/lead-engine/lead-engine|lead-engine]]"
  - "[[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]"
created: 2026-06-13
updated: 2026-06-13
ingested: true
last_ingested: 2026-06-13
---

# Spec: Niente bozza email senza indirizzo

---

## User input

> Dalle estrazioni, vedo che è stata creata una bozza mail anche per coloro di cui non si riesce ad estrarre una mail

Inquadramento dato dall'utente: seconda di tre spec progressive; le prime due "riguardano ottimizzazione delle estrazioni e dei costi". La separazione dei contatti per presenza email e l'instradamento nei flussi è esplicitamente la terza spec ("estrapolare e inserire in flussi di email solo i contatti giusti").

---

## Context

Nel run giornaliero le bozze email vengono generate con Claude **Sonnet** per **tutti** i contatti selezionati, senza verificare se il contatto ha un indirizzo email. Molti profili escono dall'enrichment senza email (è un campo best-effort), quindi oggi il sistema paga una chiamata Sonnet per produrre una bozza che **non potrà mai essere inviata** a nessuno.

Questa spec elimina lo spreco: nessuna bozza viene generata per un contatto privo di email. È un intervento di **sola ottimizzazione dei costi**, deliberatamente minimale. Riguarda chi lancia il run (oggi Omar in test, domani un operatore SeVedemo) e il budget LLM. La separazione "pronti per email vs da arricchire" e l'instradamento nei flussi sono la spec successiva: qui non si tocca né la selezione né l'export.

---

## Non-Goals

- Separare o segmentare i contatti per presenza email in selezione, export o UI: è la spec #3.
- Rimuovere i contatti senza email dalla selezione o togliergli lo "slot" a favore di contatti contattabili: è la spec #3.
- Validare la **sintassi/correttezza** di un'email presente: si considera solo presenza/assenza.
- Tentare enrichment aggiuntivo per recuperare l'email mancante: è materia di futuri flussi di enrichment.
- Cambiare modello, prompt o formato delle bozze email.

---

## Acceptance Criteria

- Nessuna chiamata al modello email (Sonnet) viene effettuata per un contatto selezionato il cui indirizzo email è assente o vuoto.
- Per un contatto senza email, i campi `email_subject` ed `email_body` restano vuoti, **senza** generare un errore di pipeline (esito identico a quello di una bozza non riuscita, ma senza spendere la chiamata).
- I contatti senza email **restano** nella selezione del giorno e nell'export CSV/JSON, con colonne email e bozza vuote: questa spec non li rimuove né li riclassifica.
- I contatti **con** email continuano a ricevere la bozza esattamente come prima (nessuna regressione di contenuto o qualità).
- Il numero di bozze saltate per email mancante in un run è **osservabile** (log o telemetria del run).
- Il guard vale per il run lanciato sia da CLI sia da web UI.
- "Senza email" è definito come: campo email `null`, stringa vuota o composta solo da spazi.

---

## Constraints

- **Best-effort**: il guard non deve introdurre nuovi punti di fallimento; un contatto saltato non deve interrompere la generazione delle altre bozze (coerente con l'isolamento per-contatto già presente in `draftMany`).
- CLI e web UI condividono lo stesso SQLite: il guard deve valere indipendentemente dal canale di lancio.
- Il risparmio è proporzionale al numero di selezionati senza email (tetto ~40 bozze/giorno): intervento a basso rischio e alto rapporto valore/sforzo.

---

## Technical Notes

Osservazioni dalla discovery (stato attuale, non scelte di design):

- `src/pipeline/run.ts:179` chiama `draftMany(selectedRows)` su **tutti** i selezionati; `src/email/draft.ts` (`draftMany`/`draftOne`) non controlla `contact.email` prima di invocare il modello.
- Oggi una bozza **fallita** lascia comunque il contatto in selezione/export con colonne email vuote (vedi `05-selection-email-export.md`): l'esito desiderato per "email mancante" può riusare lo stesso stato finale (campi vuoti), evitando però la spesa della chiamata.
- `contacts.email` è popolato (best-effort) dall'enrichment dev_fusion (`src/enrich/profile.ts`): da qui la frequenza dei contatti senza email.
- Il sistema ha già il concetto di "contatto con email": `getStats()` (`src/server/queries.ts`) calcola `withEmail` con la condizione `email IS NOT NULL AND email <> ''`.

---

## Open Questions

| # | Question | Affects | Owner | Status |
|---|----------|---------|-------|--------|
| 1 | Marcare già qui i contatti senza email con un segnale ("non contattabile / da arricchire") per agevolare la spec #3, o lasciare tutto il modello di segmentazione alla #3? Proposta: lasciare alla #3; la #2 si limita a non spendere. | Confine tra spec #2 e #3 | Omar | Resolved — defer a #3 (solo skip della bozza, nessun flag/colonna); vedi PLAN.md |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| La spec #2 è **solo** un guard di costo: salta la generazione della bozza, non rimuove né riclassifica i contatti | Mantiene l'intervento minimale e a basso rischio; la separazione è responsabilità della spec #3 |
| "Senza email" = assente/vuota, nessuna validazione di sintassi | Evita falsi negativi e complessità: il problema osservato è l'assenza, non la malformazione |
| I contatti senza email restano in selezione ed export con colonne vuote | Riusa l'esito già previsto per le bozze fallite; nessuna regressione di comportamento a valle |
