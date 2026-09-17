---
domain: prospect-crm
type: tech-debt
spec: apollo-lookalike
links:
  - "[[specs/prospect-crm/apollo-lookalike/SPEC]]"
  - "[[specs/prospect-crm/apollo-lookalike/PLAN]]"
  - "[[specs/prospect-crm/apollo-lookalike/IMPLEMENTATION-NOTES]]"
created: 2026-09-17
updated: 2026-09-17
---

# Tech debt — apollo-lookalike

Drift durevole emerso durante l'implementazione di [[specs/prospect-crm/apollo-lookalike/PLAN]] (run
`implement-spec` del 2026-09-17). Legenda: **Stato** APERTO · **Tipo** limite accettato / deviazione / bug ·
**Gravità** MAJOR / MINOR.

### AL-TD-1 — Candidate senza dati Apollo mai ripunteggiate — APERTO · limite accettato · MINOR

**Cosa.** Se l'arricchimento dentro la ricerca (S-7) si ferma (limite orario/giornaliero, 401/403, errore di
lotto), le candidate della pagina vengono salvate con il punteggio calcolato sui dati disponibili (di solito 0
e località esclusa). Un rilancio le conta come "già note" e `upsertCandidate` non tocca le righe esistenti,
quindi restano a 0 anche dopo un arricchimento riuscito (dal dettaglio azienda o da una ricerca successiva).
**Dove.** `src/jobs/lookalike-companies.ts` (`runLookalike`), `src/db/candidates.ts#upsertCandidate`.
**Proposta.** Ricalcolare `score`/`score_parts`/`reasons` quando un'azienda candidata viene arricchita, se la
candidata è ancora `proposta` e il punteggio era stato calcolato senza dati Apollo (versione regola invariata).

### AL-TD-2 — Morte del processo durante la ricerca: ripartenza da pagina 1 — APERTO · limite accettato (P-15) · MINOR

**Cosa.** Se il processo figlio muore (kill, crash), il controller scrive `failed` con `result` nullo: le pagine
già salvate restano (aziende e candidate non riproposte), ma la ripartenza D6 non le vede e riparte da pagina 1,
ripagando le pagine già lette. Gli altri arresti (429, 5xx, 403) sono esiti parziali `succeeded`.
**Dove.** `src/server/jobs.ts` (`failIfRunning`), `src/db/candidates.ts#lastLookalikeRun`.

### AL-TD-3 — Collisioni di dominio in migrazione solo nel log — APERTO · deviazione dichiarata (P-18) · MINOR

**Cosa.** L'edge case del FLOW "Dominio già usato da <altra azienda>" nel dettaglio azienda non è mostrato: alla
migrazione le collisioni finiscono solo nel log del server (SPEC B8), e l'utente le scopre con un 409 alla
modifica manuale.
**Dove.** `src/db/schema.ts#migrateSchema` (backfill), `web/src/routes/companies.$id.tsx`.

### AL-TD-4 — "Riprova" su record cancellati per i kind con blocker non di stato — APERTO · bug · MINOR

**Cosa.** Dopo T6, `enrich` con lista cancellata e `enrich_companies` / `lookalike_companies` con ICP cancellato
non sono bloccati da "Riprova": il nuovo job parte e fallisce subito con `config:` (nessuna spesa, ma un job
fallito in più nello storico).
**Dove.** `configBlockers` di `src/jobs/enrich.ts`, `src/jobs/enrich-companies.ts`, `src/jobs/lookalike-companies.ts`.

### AL-TD-5 — Crediti persi nell'esito quando il passo contatti lancia — CHIUSO 2026-09-17 · bug · MINOR

**Cosa.** `runApolloPeople` lancia un errore (senza conteggi) quando nessuna azienda è completata: se un lotto di
match è già stato pagato prima dell'errore, l'esito del job contatti (fallito) e quello della pipeline (warning)
riportano 0 crediti usati. Viola "esito onesto" sul numero di crediti.
**Dove.** `src/jobs/apollo-people.ts#runApolloPeople`, `src/jobs/lookalike-companies.ts` (pipeline).
**Proposta.** Allegare i conteggi parziali all'errore lanciato e riportarli nell'errore del job e nel warning.

### AL-TD-6 — "Riprova con altri filtri" assente dai toast degli esiti a zero — APERTO · deviazione · MINOR

**Cosa.** Con 0 risultati (aziende simili `apollo-empty`, contatti con lista `… apollo-empty`) toast e banner sono
neutri e corretti ma senza azione: "Riprova con altri filtri" esiste solo nella card "Aziende simili" / "Ricerche
precedenti" e nella fascia sopra la tabella candidate. FLOW A.3 e C.3 (e Decisioni UX: "nel toast e nella card")
la vogliono anche nel toast, per non dover cercare la card dopo l'esito.
**Dove.** `web/src/lib/jobs.ts#jobOutcomeLinks` (azioni d'esito dei kind `lookalike_companies` e `apollo_people`),
`web/src/components/JobBanner.tsx`; azione già esistente in `LookalikeCard.tsx` e `CandidatesTable.tsx`.
**Evidenza.** `tests/e2e/smoke-apollo.md` righe ERR22, C10.
**Proposta.** Sugli esiti zero dei due kind aggiungere al toast l'azione che naviga all'ICP e riapre il dialog con i
`params` del job (come fa la card).

### AL-TD-7 — Warning di "Arricchisci referenze" parziale conta le non trovate come arricchite — APERTO · bug · MINOR

**Cosa.** Se il limite Apollo ferma il job dopo un lotto di sole referenze non trovate (o in conflitto), il summary dice
"0 referenze arricchite · 10 non trovate su Apollo" ma il warning dice "Limite Apollo raggiunto: arricchite 10
referenze su 12": il contatore è `saved = enriched + not_found + key_conflicts`. Contraddice l'esito onesto.
**Dove.** `src/jobs/enrich-companies.ts#handler` (costruzione del warning su `run.stoppedBy`).
**Evidenza.** `tests/e2e/smoke-apollo.md` riga ERR4 (ICP con 12 referenze solo-dominio inventate + `apollo-hourly`).
**Proposta.** Testo su "elaborate/tentate N su M" (o separare "arricchite X · non trovate Y") e test sul caso
0 arricchite + limite.

### AL-TD-8 — Referenze solo-dominio senza dominio né badge nella pagina ICP — APERTO · bug · MINOR

**Cosa.** Nella lista "Aziende di riferimento" di `/icps/$id` sotto il nome compare solo l'URL LinkedIn: una referenza
con solo il sito (Beta Payroll prima dell'arricchimento, Non Trovata Srl) non mostra né il dominio né il badge
"Senza pagina LinkedIn", che le Decisioni UX del FLOW vogliono "ovunque compaia un'azienda". È anche la riga da cui
si capisce perché la referenza non entra nei filtri.
**Dove.** `web/src/routes/icps.$id.tsx` (riga referenza: rende solo `company.linkedin_url`).
**Evidenza.** `tests/e2e/smoke-apollo.md` riga F10 (`t18-01`, `t18-58`).
**Proposta.** Mostrare il dominio quando manca l'URL (o sempre) e il badge testuale come in `/companies`.

### AL-TD-9 — Nome predefinito (slug/dominio) mai sostituito dal nome Apollo — APERTO · limite di SPEC · MINOR

**Cosa.** Un'azienda creata senza nome prende lo slug LinkedIn o il dominio (SPEC B13); arricchimento e unioni nei job
riempiono solo i campi vuoti (SPEC C3), quindi il segnaposto resta: dopo l'unione automatica di Omega Paghe la
candidata si chiama "omega-paghe-e2e" in triage, dettaglio e contatti anche se Apollo porta "Omega Paghe Srl".
**Dove.** `src/db/companies.ts` (nome predefinito `values.name ??= slug | dominio`, `upsertCompany`),
`src/db/company-identity.ts` (unione), `src/jobs/enrich-companies.ts`.
**Evidenza.** `tests/e2e/smoke-apollo.md` riga EDGE3.
**Proposta.** Trattare come vuoto un nome uguale allo slug o al dominio della riga (mai un nome scritto dall'utente);
decisione di prodotto da confermare in SPEC.

### AL-TD-10 — "località non disponibile da Apollo" quando mancano le località delle referenze — APERTO · deviazione di copy · MINOR

**Cosa.** Se nessuna referenza arricchita ha città/regione (es. ICP senza referenze, pipeline "Pipeline smoke") la
componente località è esclusa per tutte le candidate, come da Regole di somiglianza, ma la ragione mostrata è
"località non disponibile da Apollo" anche per aziende con sede nota (Recluta Facile, Milan) e il run conta "23
senza località" in "Ricerche precedenti" (D14): il testo attribuisce ad Apollo un dato che manca alle referenze e
la statistica non distingue i due casi.
**Dove.** `src/apollo/similarity.ts` (ragioni), `src/jobs/lookalike-companies.ts` (`without_location`),
`src/db/candidates.ts#runStats`.
**Evidenza.** `tests/e2e/smoke-apollo.md` riga E6.
**Proposta.** Ragione distinta ("nessuna referenza con sede: località non confrontata") e contatore solo per le
candidate davvero senza città né regione.

### AL-TD-11 — `apollo_json` nelle risposte delle route ICP — APERTO · deviazione dal contratto · MINOR

**Cosa.** PLAN §12-bis: risposte aziende "senza `apollo_json`" (`toPayload` in `companies.ts`). `GET /api/icps/:id`
(`reference_companies[].company`) e `PUT /api/icps/:id/reference-companies/:companyId` (`company`) selezionano `c.*` e
restituiscono la risposta grezza di Apollo (indirizzo, descrizione, …) al frontend.
**Dove.** `src/db/icps.ts#listReferenceCompanies` / `getReferenceCompany`, `src/server/routes/icps.ts`.
**Evidenza.** `tests/e2e/smoke-apollo.md` riga B6 (risposta della PUT usata per preparare il caso).
**Proposta.** Escludere `apollo_json` nella select (o riusare `toPayload`) e aggiungere l'asserzione in `tests/api-icps.test.ts`.
