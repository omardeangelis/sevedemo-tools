---
domain: prospect-crm
type: implementation-notes
spec: people-first-crm
links:
  - "[[specs/prospect-crm/people-first-crm/SPEC]]"
  - "[[specs/prospect-crm/people-first-crm/PLAN]]"
  - "[[specs/prospect-crm/people-first-crm/FLOW]]"
ingested: false
last_ingested: null
created: 2026-09-18
updated: 2026-09-18
---

# Implementation Notes — people-first-crm

## Summary

- **M1 (Persone e contatti manuali, T0–T16) completata il 2026-09-18**, in attesa del via dell'utente per M2. Smoke
  di tappa (`tests/e2e/smoke-people.md`, agente separato con sessione agent-browser propria): 0 BLOCKER, 2 MAJOR, 18
  MINOR; corretti i 2 MAJOR e 16 MINOR del tutto o in parte, restano 3 MINOR (sotto, Remaining Work).

## Execution Mode

- `sequential` (PLAN G-3): un task alla volta nell'ordine di PLAN §8, stop alla fine di ogni tappa (M1, M2, M3) in
  attesa del via dell'utente. L'utente ha validato l'anteprima HTML delle tre tappe
  (https://claude.ai/artifact/F8nz41avEip8hUWFH853Co) senza modifiche il 2026-09-18.

## Deviations From the Plan

- T0: il branch `people-first-crm` è creato da `origin/main` ma senza upstream (`git branch --unset-upstream`): con
  l'upstream su `origin/main` un `git push` finirebbe su `main`.
- T1: CHECK della prossima azione `date(next_action_on) IS next_action_on` invece di `=` (PLAN §6): con `=` una data
  invalida (`date()` → NULL) rende il CHECK NULL, che SQLite fa passare.
- T1: `SchemaMigrationPlan.prospectsColumns` (colonne Apollo con ALTER) sparisce: la ricostruzione di `prospects`
  copia le colonne Apollo se ci sono e le crea se mancano (DB crm-foundation).
- T5: `PersonRef.first_source.label` è il tipo di fonte in italiano senza data ("commento", "persone di Acme"): la data
  la formatta la FE (fuso dell'utente). Nessuna nota dell'incontro se "Come vi siete conosciuti" è vuoto (C5 la chiede
  solo se compilato).
- T8: `view` assente nell'API = nessun filtro di vista (Lista e Azienda mostrano anche le scartate); la pagina Persone
  manda sempre `view` (`tutte` quando l'URL non la ha). Il PLAN (§12) diceva "assente = Tutte": vale per l'URL della FE.
- T8: `calendarDate` (zod) sta in `src/server/http.ts`, non in `routes/next-actions.ts`: evita un ciclo d'import fra
  router.
- T14: due piccole aggiunte server non scritte nel PLAN, necessarie ai testi del FLOW: `linkedin.member_urn_from`
  nell'anteprima di Unisci (*"con l'id membro di #812"*, F.3) e `mergeable`/`reason` per ogni persona nel 409
  `email_taken` (F.5: niente Unisci con due profili distinti anche nel caso email, senza una richiesta in più).
- T15: il promemoria *"Da completare"* dell'onboarding non ha "Nascondi" (P-15 lo prevede in Oggi, M2): l'onboarding
  sparisce con la prima persona. Il FLOW H.1 indica `/settings/profile#profilo` e `/companies?add=1`: in M1 i link
  vanno a `/settings#profilo` e `/settings#azienda` (P-24; `#azienda` è un'ancora nuova con focus sulla descrizione).
- T15: A3 esteso a qualche testo non elencato nella tabella del FLOW ma con la stessa parola: "sourcing" nei testi
  della lista archiviata e delle Impostazioni (→ *"persone di un'azienda"*), il riassunto del job *"Persone di
  <azienda>: …"* (era *"Sourcing <azienda> completato: …"*), l'export al femminile (*"Verranno esportate N
  persone"*). Restano "N selezionati" e simili, senza sostantivo.

## Surprises and Decisions

- T1: `legacyRunTools` (strumenti dei run storici) vive in `src/db/schema.ts` e non in un modulo dei run: lo script di
  T2 deve importare solo `schema.ts` e le sue dipendenze senza DB.
- T2 (prova sulla copia del DB reale): tutto uguale (67 persone, 77 fonti, 85 attività, 12 analisi, 3 job, 1 azienda;
  FK 0; Inbox prima 0 = Da smistare dopo 0; nessuna azienda si accorcia con D5); file reali con stessa dimensione e
  mtime prima e dopo. **Il DB reale è ancora allo schema di crm-foundation**: il primo avvio dopo M1 migrerà anche
  companies, sources e jobs di apollo-lookalike, nella stessa transazione e con un solo backup.
- T4: l'unione automatica (`mergeProspects`) ora passa da `src/db/person-merge.ts` (`autoMergedValues` + `applyMerge`);
  lo stesso nucleo serve "Unisci" (T7). `nameTwin` non aggancia mai righe senza LinkedIn.
- T6: `no_linkedin` è una chiave nuova nei conteggi delle preview e dei job di arricchimento e analisi (sempre
  presente, anche a 0); `email_cleared` (D9) nella preview e nei conteggi dell'arricchimento Apollo.
- T7: la `patch` di "Unisci" usa gli stessi campi del PATCH (`patchFields` esportati da `routes/prospects.ts`); nel
  caso LinkedIn (E5) l'unione è rifiutata solo se gli id membro differiscono (l'URL della persona tenuta viene
  sostituito da quello che si sta salvando).
- T9: `fail-next` confronta il path senza query string; il server e2e ora è un'app esterna che delega a `createApp()`.
- T10–T13: i `Link` di TanStack prendono `aria-current` anche quando sono attivi "a spanne" (un prefisso del path):
  breadcrumb, viste e badge usano `activeOptions={{ exact: true, includeSearch: true }}`, altrimenti più voci
  risultano "pagina corrente".
- T14: i dialog senza `DialogTrigger` (Unisci) non ridanno il focus da soli: si salva l'elemento attivo all'apertura e
  lo si rifocalizza in `onCloseAutoFocus` (stesso schema di `JobPreviewDialog`). Il `sr-only` "Close" della X di
  shadcn diventa "Chiudi" (A3).
- T16 (dallo smoke): la ricerca confrontava l'URL grezzo; ora Persone e Aziende confrontano anche il profilo, il
  dominio e la pagina LinkedIn normalizzati (regola di identità). L'anteprima di Unisci ha `moving_labels` (fonti e
  ultima analisi per ICP in parole, FLOW F.3). Il picker d'azienda offre "Crea …" anche con risultati parziali (un
  solo picker, D3; il FLOW I.2 lo diceva solo per "nessun risultato") e Invio senza risultati non apre la creazione.
- T16: lo smoke l'ha fatto un agente separato (sessione `smoke-m1`) per non consumare il contesto dell'orchestratore;
  un `seed` lanciato per errore dall'orchestratore a metà giro è stato segnalato all'agente, che ha rifatto il passo.
- Validazione con agent-browser: `fill` con stringa vuota non manda l'evento di cambio a React (il campo sembra vuoto
  ma lo stato no): per svuotare un campo si usa `press End` + `Backspace`. I click su elementi fuori viewport vanno
  preceduti da `scrollintoview`.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| Baseline (T0): `npm run typecheck`, `npm test`, web build, web typecheck | ✓ | 37 file / 520 test |
| T1: `npm test` | ✓ | 525 test |
| T2: `npm run db:migration-check -- data/crm.db` (copia in tmp) | ✓ | report di soli numeri, file reali invariati |
| T3–T9: typecheck + `npm test` dopo ogni task | ✓ | 579 test dopo T9 |
| T9: `curl` su `fail-next` (server e2e :8833, fermato per PID) | ✓ | 500→201; `times: 2` → 500, 500, 200 |
| T10–T13: web typecheck + agent-browser sul server e2e (:8841 + Vite :5191) | ✓ | righe d'errore del FLOW A, B, C, I |
| T14: `npm test` (api-people-identity) + agent-browser | ✓ | F.1–F.5 e righe "Unisci: sparita / 500", E3, E4, E7 |
| T15: 4 gate + checklist `rg` + agent-browser | ✓ | 44 file / 579 test; onboarding a DB vuoto, `/` → `/people`, testo di 12 pagine |
| T16: smoke M1 (`tests/e2e/smoke-people.md`) | ✓ | 0 BLOCKER; MAJOR corretti e ricontrollati nel browser |
| T16: 4 gate finali | ✓ | 44 file / 579 test, build e typecheck web |

## Pre-existing Issues

- `tests/analyze.test.ts` › *"latest, history, stale dopo il cambio profilo…"* è instabile: in un giro su cinque
  l'analisi fallita e quella salvata hanno lo stesso `created_at` al millisecondo e lo stato non diventa `rifiutata`
  (confronto `fa.created_at > an.created_at` in `analysisStateSql`). Non toccato da questo piano.

## Remaining Work

- M2 (T17–T27) e M3 (T28–T36) dopo il via dell'utente. Alla ripresa di M2 (T17) l'agente ferma il server reale se è
  acceso (per PID, mai durante un job).
- MINOR aperti dallo smoke M1: focus dopo alcuni esiti asincroni (salvataggio fallito, corsa C7, persona o azienda
  sparite, "Resta" del guard d'uscita, Collega/Scollega, Rimuovi prossima azione, bulk "Aggiungi a lista"); prefisso
  "Il dominio …" nel conflitto di "Crea l'azienda"; avviso bulk "N persone selezionate hanno una prossima azione".
- Il primo avvio sul DB reale dopo M1 fa il backup `data/crm.db.bak-<ISO>` e migra in una transazione (anche lo schema
  di apollo-lookalike, vedi T2).
- Post-implementazione (fine spec, dopo M3): walkthrough `ux-advisor` → `UX-REVIEW.md`; `adversarial-review` solo in
  una sessione separata.
