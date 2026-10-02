---
domain: prospect-crm
type: tech-debt
spec: own-profile-services
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/PLAN]]"
  - "[[specs/prospect-crm/own-profile-services/IMPLEMENTATION-NOTES]]"
created: 2026-09-29
updated: 2026-10-02
---

# Tech debt — own-profile-services

Deriva durevole emersa durante l'implementazione di [[specs/prospect-crm/own-profile-services/PLAN]] (run
`implement-spec` dal 2026-09-29, tappe M1a–M4). Legenda: **Stato** APERTO · **Tipo** limite accettato / deviazione /
bug · **Gravità** MAJOR / MINOR.

### OP-TD-1 — `posts.text_excerpt` contiene il testo integrale — APERTO · limite accettato · MINOR

**Cosa.** Da M1a (C7) la colonna `posts.text_excerpt` conserva il testo **integrale** del post (`text_complete = 1`),
mentre il nome e il campo `text_excerpt` delle API (`GET /api/posts`, fonti di scheda e righe) indicano ancora
l'estratto per le viste. Il taglio è una lettura (`excerptOf` in `src/db/posts.ts`), applicata oggi in
`listPostsWithStats` e in `loadSources`: una vista nuova che legge la colonna senza passare di lì mostrerebbe
l'intero post (C15). La SPEC tiene "lo stesso nome in API e interfaccia" (Technical Notes), quindi M1a non ha
rinominato.
**Dove.** `src/db/posts.ts` (`Post`, `excerptOf`), `src/db/prospects.ts#loadSources`, `src/db/analyses.ts`
(`loadAnalysisSubject` legge il testo integrale di proposito: il prompt lo tronca a 160).
**Proposta.** Nel repo chiamare il valore conservato `text` (alias SQL `text_excerpt AS text`) e derivare
`text_excerpt` solo nei tipi di vista, oppure rinominare la colonna in una migrazione futura; in ogni caso ogni
lettura per una vista passa da `excerptOf`. M4 (2026-10-02): il lettore dei post della generazione
(`src/profile/sources.ts`) legge già la colonna come `text` (alias) e solo con `text_complete = 1`.

### OP-TD-2 — `apollo` resta fra i valori ammessi di `profile_sources.kind` — APERTO · limite accettato · MINOR

**Cosa.** Prima di M4 l'utente ha tolto il record d'impresa di Apollo dalle fonti (PLAN P-29): la generazione scrive solo
`linkedin`, `website`, `posts`. Il CHECK di `profile_sources` e `PROFILE_SOURCE_KINDS` ammettono ancora `apollo`,
perché toglierlo vorrebbe una ricostruzione della tabella sul DB reale (già migrato in T1) e `planSchemaMigration` non
la controlla.
**Dove.** `src/db/schema.ts` (`PROFILE_SOURCE_KINDS`, DDL di `profile_sources`).
**Proposta.** Toglierlo alla prossima migrazione che ricostruisce comunque `profile_sources`; fino ad allora nessuna
riga lo usa e le letture filtrano le tre fonti.

### OP-TD-3 — la sezione Proposta legge il DOM del form per i campi non salvati — APERTO · deviazione · MINOR

**Cosa.** Applicando un campo, `ProposalSection` cerca il controllo con `data-profile-field` nel form de «La mia azienda»
e ne confronta il valore col valore attuale, per il toast dell'edge case *"Avevi modifiche non salvate in quel
campo…"*. È un accoppiamento fra componenti attraverso il DOM.
**Dove.** `web/src/components/settings/ProposalSection.tsx` (`unsavedInForm`), `ProfileForms.tsx` (`data-profile-field`).
**Proposta.** `CompanySection` calcola i campi non salvati (la stessa unione a tre vie con cui segue i valori applicati) e
li passa alla pagina con una callback, che li dà alla sezione Proposta. Da fare se il form cambia forma.
