---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-28
links: []
created: 2026-06-28
updated: 2026-06-28
---

# Concetto — Strategia `influencer-post-respondents` (fonte primaria azienda-first)

## Definition

La strategia di estrazione (`src/strategies/influencer-post-respondents.ts`) che legge il seed
`data/seeds/influencers.json` e ne ricava lead a partire da **chi risponde** ai post degli influencer: i
**commentatori** (segnale d'intento più caldo) via apimaestro, più le **persone/aziende taggate** nel testo
dei post, con le aziende **espanse** ai loro decision-maker. Sostituisce la strategia rimossa
`freelance-post-reactors`, che leggeva lo stesso seed ma estraeva i *reactor* via `harvestapi` e rendeva
**0 contatti** nel report. È **no-cookie** e `bucketHint = 'misto'`: il bucket finale (freelance/azienda) lo
decide **Claude** in scoring, non la strategia.

È la **fonte primaria** del run giornaliero (`config.primaryStrategyId`, default `influencer-post-respondents`):
eseguita per prima e con budget dominante in [[gather-primaria-budget-riflusso]], e privilegiata a parità di
fit nel bucket azienda in [[selezione-azienda-first]]. L'orchestrazione del core
([[respondents-azienda-first]]) è iniettabile (`RespondentsDeps`) per essere testata senza Apify.

Ogni candidato porta la sua [[sotto-fonte-respondents]] (`commenter` / `tagged-person` / `company-expansion`),
così il [[esito-strategia-onesto|report onesto]] può attribuire l'esito per sotto-fonte.

## Attributes

| Attributo | Valore |
|-----------|--------|
| `id` | `influencer-post-respondents` |
| `requiresCookie` | **no** (no-cookie; gira sempre, non gated su `LINKEDIN_LI_AT`) |
| `bucketHint` | `misto` (solo documentazione; il bucket lo decide Claude) |
| Seed | `data/seeds/influencers.json` (riletto a ogni run, fail-fast se vuoto → `source` lancia) |
| Sostituisce | `freelance-post-reactors` (rimossa; backfill rename in `src/db/index.ts`) |
| Ruolo nel run | **primaria** — eseguita per prima, budget dominante, azienda-first in selezione |
| Actor post | `apimaestro` profile-posts (`profilePostsApimaestroInput(url, postsPerInfluencer)`, shape `{username, total_posts}`) |
| Actor commenti | `apimaestro` post-comments (`postCommentsInput([activityId], commentsPerPost)`) |
| Actor espansione | `harvestapi` profile-search (`profileSearchInput`, stesso delle people-search) |
| `POSTS_PER_INFLUENCER` | post per influencer (default 5) |
| `COMMENTS_PER_POST` | commenti per post (default 100, range 1–100) |
| `POST_RECENCY_DAYS` | finestra freschezza post (default 90; post senza data → tenuto) |
| `PRIMARY_WEIGHT` | quota POOL riservata alla primaria, cap non forzato (default 0.5) |
| `TAGGED_PERSON_ENABLED` | emissione `tagged-person`, **default `false`** (gated; spike URN aperto) |
| `COMPANY_EXPANSION_ROLES` | ruoli decisionali cercati (default CEO, CTO, Founder, Co-founder, Head of Engineering, HR, Talent) |
| `COMPANY_EXPANSION_PER_COMPANY` | cap candidati per azienda espansa (default 3) |
| Registry | prima voce di `ALL` in `src/strategies/registry.ts`; abilitata (no-cookie) |

## Related flows

- [[respondents-azienda-first]] — il core `collectRespondents`: post → commentatori + taggati + espansione.
- [[gather-primaria-budget-riflusso]] — come riceve quota dominante ed è eseguita per prima, con riflusso.
- [[selezione-azienda-first]] — come è privilegiata a parità di fit nel bucket azienda.

## [Source: SPEC + IMPLEMENTATION-NOTES influencer-post-respondents]

- **Problema risolto:** `freelance-post-reactors` rendeva 0 nel "Report strategie" (chiamava `harvestapi`
  per post/reazioni che non rendevano); l'operatore aveva validato `apimaestro/linkedin-profile-posts` +
  `post-comments`. Questa fonte estrae **i commentatori** (intento più caldo) invece dei soli reactor.
- **T2:** il builder posts apimaestro è `profilePostsApimaestroInput` (non `profilePostsInput`) per non
  collidere col builder harvest omonimo, poi rimosso a T8.
- **T6/T8:** i config knob aggiunti in T6 (servivano a compilare la strategia); T8 ha fatto registry,
  seed-demo, `.env.example`, rimozione builder morti e backfill rename.
- **Pulizia residui:** `grep freelance-post-reactors src scripts` resta solo come literal di backfill in
  `db/index.ts` (rename storico in DB), nessuna strategia viva.

> [!warning] CONTRADICTS [[03-extraction-strategies]]
> La pagina 03 elenca ancora "le 5 strategie" con `freelance-post-reactors` (reactors via `harvestapi`) e
> non cita questa fonte né il concetto di strategia **primaria**. 03 è orientamento: dove diverge, **vince
> questo concetto** e i flow collegati.
