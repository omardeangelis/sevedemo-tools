---
domain: lead-engine
type: tech-debt
spec: email-segmentation-filters
status: open
links:
  - "[[specs/lead-engine/email-segmentation-filters/SPEC]]"
  - "[[specs/lead-engine/email-segmentation-filters/IMPLEMENTATION-NOTES]]"
  - "[[domains/lead-engine/concepts/presenza-email]]"
  - "[[domains/lead-engine/concepts/stato-filtri-url]]"
created: 2026-06-14
updated: 2026-06-14
---

# Tech debt — `email-segmentation-filters`

Drift durevole emerso/lasciato aperto dall'implementazione della spec #3. Voci da considerare quando si
riapre il dominio della presenza email o dei filtri Contatti. Cleanup **rinviato di proposito**, nessuno
blocca la spec (tutti gli Outcome sono Met).

---

## TD-1 — Tre definizioni di "email presente" (fork non unificato)

**Severità:** medio-bassa (edge case di correttezza + manutenibilità) · **Status:** open

Dopo la spec #3 coesistono **tre** predicati per "il contatto ha un'email", non riconciliati. Le ultime
due sono identiche (non-trim); solo la prima fa `trim()`:

| # | Predicato | Dove | Trim? | Usato da |
|---|-----------|------|-------|----------|
| 1 | `hasEmail` = `typeof === 'string' && trim() !== ''` | `src/util/fields.ts` | **Sì** | solo il guard bozze, `src/email/draft.ts` |
| 2 | `email IS NOT NULL AND email <> ''` | `getStats()`, `src/server/queries.ts` | No | conteggio `withEmail` (dashboard) |
| 3 | stesso SQL + `email != null && email !== ''` | `contactsWhere`/`listCandidates`/`listContactsForExport` (`src/server/queries.ts`), `emailReady` (`src/export/csv.ts`), `isEmailReady` (`src/server/app.ts`), `isEmailReady` (`web/src/api/client.ts`) | No | tutta la segmentazione/filtro/export della spec #3 |

**Perché è stato lasciato così.** La spec #3 imponeva come Constraint la **parità di conteggio con
`getStats().withEmail`**: i totali della segmentazione devono combaciare con quelli mostrati in
dashboard. Riusare `hasEmail` (trim) avrebbe fatto divergere i conteggi → scelta deliberata del
predicato non-trim. Unificare era fuori scope.

**Rischio / impatto.**
- **Incoerenza di semantica sui whitespace-only.** Un contatto con `email` di soli spazi è trattato come
  *con email* dalla segmentazione/export (#2/#3) ma come *senza email* dal guard bozze (#1): finirebbe
  marcato `email_ready` nell'export pur avendo `email_subject`/`email_body` vuoti. Improbabile sui dati
  reali dell'enrichment (`dev_fusion` non produce stringhe di soli spazi note), ma è una divergenza viva.
- **Duplicazione `isEmailReady` server↔client.** Due implementazioni indipendenti (`src/server/app.ts` e
  `web/src/api/client.ts`), nessun modulo condiviso: se una cambia, l'altra può divergere silenziosamente.

**Risoluzione suggerita.** Decidere **una** semantica system-wide per "email presente" (in particolare:
i soli-spazi contano come presente?) e collassare i tre predicati su di essa:
- estrarre un singolo predicato JS condiviso (es. in `src/util/fields.ts`) importato da server **e**
  client, più una costante per il frammento SQL riusata da `getStats` e `contactsWhere`;
- oppure, se si vuole il trim ovunque, allineare `getStats`/segmentazione a `hasEmail` accettandone la
  semantica (e aggiornare i conteggi attesi nei test).
- Aggiungere un test che fissi la semantica scelta sul caso whitespace-only.

Vedi il concetto [[presenza-email]] §«Tre definizioni a confronto».

---

## TD-2 — `ContactFilters`: plumbing incompleto (`sector` / `minFit`)

**Severità:** bassa (capacità backend non esposta, nessun problema di correttezza) · **Status:** open

Il backend `searchContacts` (`src/server/queries.ts`) supporta già i filtri `sector` e `minFit`, ma il
tipo client `ContactFilters` (`web/src/api/types.ts`) e la UI Contatti
(`web/src/routes/contacts.index.tsx`) espongono solo `q`, `bucket`, `status`, `strategy`, `email`,
`page`. La spec #3 ha chiuso il gap **solo** per `email`; il resto era già notato nelle Technical Notes
della SPEC e resta aperto.

**Perché è stato lasciato così.** Fuori scope della spec #3 (segmentazione per sola presenza email).

**Rischio / impatto.** Basso: è solo una capacità backend inutilizzata dalla UI; l'operatore non può
filtrare per settore o fit minimo dalla pagina Contatti.

**Risoluzione suggerita.** Estendere `ContactFilters` + `validateSearch` + la barra filtri per esporre
`sector` e `minFit`, propagandoli via `qs()` esattamente come è stato fatto per `email`. Si innesta
naturalmente sullo stato filtri ora persistito nell'URL ([[stato-filtri-url]]).
