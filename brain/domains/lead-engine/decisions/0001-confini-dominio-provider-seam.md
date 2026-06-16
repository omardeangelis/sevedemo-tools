---
domain: lead-engine
type: decision
ingested: true
last_ingested: 2026-06-16
links:
  - "[[domains/lead-engine/lead-engine-contract]]"
  - "[[domains/lead-engine/lead-engine]]"
created: 2026-06-16
updated: 2026-06-16
---

# ADR 0001 — Un dominio `lead-engine`, confini disegnati sui provider seam

**Status:** Accepted (2026-06-16) · **Decisori:** Omar (owner), Claude

## Context

Il brain di `lead-engine` è cresciuto (≈21 pagine in un dominio) e si poneva la domanda se stadi come
**enrichment**, **scoring**, **evaluation** dovessero diventare domini separati (lead-engine = solo
extraction).

La roadmap (registrata nella memory di progetto) chiarisce la forma reale del sistema: **una pipeline di
contatti con provider sostituibili a ogni seam + un loop di feedback sulla qualità**:

- enrichment oggi è Apify ma **provider-agnostico per disegno** (futuro: Apollo o altro);
- outreach (invio + lifecycle del contatto) oggi è in-repo (bozza Sonnet + export CSV) ma in roadmap va
  **delegato a Brevo**;
- evaluation oggi è un import/report **manuale** ma serve a **scegliere dinamicamente strategie migliori**.

Tensioni:
1. Questi seam danno a ogni capability un **asse di evoluzione indipendente** → argomento *a favore* di
   confini netti.
2. Ma il codice è ancora **un monolite su un'unica tabella `contacts`** (kernel condiviso: identità,
   status, freshness, convenzioni `COALESCE`), e **Apollo/Brevo non esistono ancora**. La regola del
   brain è documentare la verità corrente, non lo stato futuro.

## Decision

**Tenere `lead-engine` come singolo dominio adesso**, ma renderlo *seam-aware*:

1. **Una capability ≠ un dominio**: gli stadi sono capability della stessa pipeline, organizzate nel
   domain map per capability (acquisition / enrichment / scoring / outreach / evaluation / web-ui +
   contacts kernel).
2. **Confini documentati ma non materializzati**: i seam di provider sono registrati nel
   [[lead-engine-contract|contract]] (sezioni *Does Not Own* e *Capability ↔ provider seam*) e qui,
   come **direzione**, senza documentare Apollo/Brevo come verità corrente.
3. **Regola di graduazione** — una capability **diventa un dominio a sé quando il suo seam si indurisce
   nel codice**, non prima:
   - **enrichment** → dominio proprio quando atterra un **secondo provider** (es. Apollo) dietro
     l'adapter `src/apify/actors.ts`;
   - **outreach** → dominio proprio quando viene costruita l'integrazione **Brevo** (invio + lifecycle);
   - **evaluation** → dominio proprio quando smette di essere **read-only** e guida la scelta strategie.
4. **De-staling**: le pagine narrative `01`/`02`/`05`/`07` (pre-remodel, `ingested: false`) vanno
   allineate al [[modello-stati-membership|modello degli stati]] corrente (erano in contraddizione).

## Consequences

- **Pro:** ~90% del beneficio di navigabilità (organizzazione per capability + contract) con ~20% del
  churn; zero speculazione; ogni split futuro è un taglio **pre-pianificato** (questa ADR), non un
  redesign. Il kernel `contacts` resta in un unico posto.
- **Contro:** il dominio resta grande nel breve; chi cerca "enrichment" o "evaluation" trova capability,
  non domini. Mitigato dal raggruppamento per capability nel domain map e da questo ADR.
- **Trigger di revisione:** alla prima PR che introduce Apollo, l'integrazione Brevo, o l'uso
  dell'evaluation per pesare le strategie → rivisitare questo ADR ed eseguire la graduazione
  corrispondente.
