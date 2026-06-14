---
domain: lead-engine
type: flow
status: implemented
ingested: true
last_ingested: 2026-06-14
links:
  - "[[specs/lead-engine/email-segmentation-filters/SPEC]]"
  - "[[specs/lead-engine/email-segmentation-filters/IMPLEMENTATION-NOTES]]"
created: 2026-06-14
updated: 2026-06-14
---

# Flow — Persistenza dei filtri nell'URL (ambito sessione)

Ciclo di vita dei filtri della pagina **Contatti**: prima vivevano in `useState` di React (persi a ogni
navigazione/reload), ora vivono **nell'URL** come search param gestiti da TanStack Router. Persistono
per tutta la sessione e si azzerano alla chiusura del browser. La forma dello stato è descritta dal
concetto [[stato-filtri-url]]; questo flow ne descrive il comportamento dinamico.

**Trigger:** l'operatore imposta o modifica un filtro (testo, bucket, status, strategia, presenza
[[presenza-email|email]]) o cambia pagina nella lista Contatti.

**Attori:** la route `web/src/routes/contacts.index.tsx` (`validateSearch` hand-rolled,
`Route.useSearch()`, `navigate`), TanStack Router (sorgente di verità nell'URL), il browser (history,
reload, condivisione link).

```mermaid
flowchart TD
    A[Operatore cambia un filtro o pagina] --> B{Cosa cambia?}
    B -- filtro --> C[navigate: search prev → ...prev, field:value||undefined, page:undefined]
    B -- pagina --> D[goToPage p → navigate page:p]
    C --> E[URL search param aggiornati]
    D --> E
    E --> F[validateSearch normalizza e valida<br/>email ∈ with|without · page&gt;1 altrimenti omessa<br/>default rimossi → URL pulito]
    F --> G[Route.useSearch legge lo stato<br/>page = search.page ?? 1 · niente useState]
    G --> H[Lista renderizzata dallo stato URL]
    H --> I{Evento di navigazione}
    I -- dettaglio contatto e back --> F
    I -- altra pagina e ritorno --> F
    I -- reload --> F
    I -- copia/condivide URL --> F
    I -- chiusura browser --> J[Stato perso: reset di sessione<br/>nessun localStorage, nessun auth]
```

## Passi

1. **Scrittura.** Un cambio di filtro chiama
   `navigate({ search: (prev) => ({ ...prev, [field]: value || undefined, page: undefined }) })`: il
   nuovo valore entra nell'URL e la **pagina si resetta** (un nuovo filtro riparte da pagina 1). Il
   cambio pagina passa invece per `goToPage(p)` che scrive `page`.
2. **Normalizzazione (`validateSearch`).** Funzione **hand-rolled** (in `web/` non c'è zod): valida i
   campi (`email` solo `with|without`, altrimenti scartato; helper `str()` per le stringhe) e **rimuove
   i default dall'URL** (`page > 1` altrimenti omessa, filtri vuoti omessi) per URL puliti e
   condivisibili.
3. **Lettura.** Il componente non usa più `useState`: legge tutto da `Route.useSearch()`, con
   `page = search.page ?? 1`. L'URL è l'unica sorgente di verità.
4. **Sopravvivenza.** Lo stato sopravvive a: apertura del dettaglio di un contatto e ritorno alla lista,
   navigazione verso un'altra pagina e ritorno, **reload**, e **copia/condivisione del link** (chi apre
   l'URL riottiene la stessa lista filtrata, pagina inclusa).
5. **Reset di sessione.** Alla chiusura/riapertura del browser i filtri si azzerano: ambito **sessione**,
   nessuna persistenza cross-session, niente `localStorage`, niente account/auth (Non-Goal della SPEC,
   coerente con il single-user locale).

## [Source: SPEC + IMPLEMENTATION-NOTES email-segmentation-filters]

- **Motivazione del design:** niente auth e single-user locale → lo stato non può appoggiarsi al server;
  TanStack Router era già in uso, quindi l'URL è la sede naturale e regala la condivisibilità del link.
- **`page` fa parte dello stato persistito** insieme ai filtri (Outcome 2 della SPEC).
- **Verifica:** `agent-browser` contro l'app reale — F1 PASS su tutti i sotto-casi (filtri+pagina
  sopravvivono a dettaglio↔lista e reload; il cambio filtro resetta la pagina; un URL filtrato diretto
  apre la lista corretta).
