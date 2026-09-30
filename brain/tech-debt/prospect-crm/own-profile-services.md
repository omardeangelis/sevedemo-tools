---
domain: prospect-crm
type: tech-debt
spec: own-profile-services
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/PLAN]]"
  - "[[specs/prospect-crm/own-profile-services/IMPLEMENTATION-NOTES]]"
created: 2026-09-29
updated: 2026-09-29
---

# Tech debt — own-profile-services

Deriva durevole emersa durante l'implementazione di [[specs/prospect-crm/own-profile-services/PLAN]] (run
`implement-spec` del 2026-09-29, tappa M1a). Legenda: **Stato** APERTO · **Tipo** limite accettato / deviazione /
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
lettura per una vista passa da `excerptOf`. Da valutare quando M4 aggiunge il lettore dei post per la generazione.
