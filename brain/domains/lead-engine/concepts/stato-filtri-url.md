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

# Concetto — Stato dei filtri nell'URL (search params)

## Definition

Lo **stato dei filtri della pagina Contatti**, prima conservato in `useState` di React (volatile), è ora
codificato **interamente nell'URL** come search param gestiti da TanStack Router. È l'unica sorgente di
verità della lista: niente stato locale duplicato. L'ambito è la **sessione** — sopravvive a
navigazione, back/forward, reload ed è condivisibile via link; si azzera alla chiusura del browser
(nessun `localStorage`, nessun account/auth, coerente con il single-user locale). Il comportamento
dinamico è descritto dal flow [[filtri-persistenti-url]].

I valori sono validati e normalizzati da una funzione `validateSearch` **hand-rolled** in
`web/src/routes/contacts.index.tsx` (in `web/` non c'è zod): tipizza i campi tramite un `ContactSearch`,
scarta i valori non validi (`email` solo `with|without`) e **rimuove i default dall'URL** (pagina `> 1`
altrimenti omessa, filtri vuoti omessi) per ottenere URL puliti e condivisibili. Il componente legge
tutto da `Route.useSearch()` con `page = search.page ?? 1`.

## Attributes

| Campo | Tipo | Default (omesso dall'URL) | Note |
|-------|------|---------------------------|------|
| `q` | string | vuoto | ricerca testuale |
| `bucket` | `freelance \| azienda` | tutti | bucket del contatto |
| `status` | string | tutti | status pipeline (`new`…`exported`) |
| `strategy` | string | tutte | strategia di estrazione di origine |
| `email` | `with \| without` | tutti | presenza [[presenza-email\|email]] tri-state (questa spec) |
| `page` | number | `1` | parte dello stato persistito; `> 1` altrimenti omessa |

| Attributo | Valore |
|-----------|--------|
| Sorgente di verità | URL search param (TanStack Router) — niente `useState` |
| Validazione | `validateSearch` hand-rolled (`contacts.index.tsx`), niente zod |
| Scrittura | `navigate({ search: (prev) => ({ ...prev, [field]: value \|\| undefined, page: undefined }) })` |
| Reset pagina | un cambio filtro azzera `page`; `goToPage(p)` scrive `page` |
| Lettura | `Route.useSearch()`, `page = search.page ?? 1` |
| Ambito | sessione (URL): nav/reload/link sì, cross-session no |
| Default-stripping | filtri vuoti e `page = 1` non compaiono nell'URL |

## Gap noto

Il tipo client `ContactFilters` (`web/src/api/types.ts`) continua a **non** esporre `sector`/`minFit`,
che il backend già supporta: questa spec ha chiuso il gap solo per `email`. Allineare l'intero
`ContactFilters` resta un cleanup futuro tracciato in
[[../../../tech-debt/lead-engine/email-segmentation-filters|tech-debt/email-segmentation-filters]] §TD-2.

## Related flows

- [[filtri-persistenti-url]] — il ciclo di vita scrittura → normalizzazione → lettura → sopravvivenza → reset.
- [[segmentazione-presenza-email]] — `email` è uno dei campi persistiti; la persistenza vale per tutti i filtri Contatti.

## [Source: SPEC + IMPLEMENTATION-NOTES email-segmentation-filters]

- Decision log SPEC: persistenza via **URL, ambito sessione** (no cross-session, no auth) — TanStack
  Router già in uso rende l'URL la sede naturale e aggiunge la condivisibilità del link.
- Outcome 2: `page` fa parte dello stato persistito insieme ai filtri; reset alla chiusura del browser.
- Verifica: `agent-browser` F1 PASS (persistenza su dettaglio↔lista, navigazione, reload, link diretto;
  cambio filtro resetta la pagina).
