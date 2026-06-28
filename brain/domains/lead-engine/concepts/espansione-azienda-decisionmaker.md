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

# Concetto — Espansione-azienda a decision-maker (`company-expansion`)

## Definition

Il meccanismo che trasforma un'**azienda taggata** in un post (`CompanyRef`) nei suoi **decision-maker**
(CEO, CTO, Founder, HR…), invece di trattare l'azienda come lead a sé. Le aziende **non** diventano contatti
email: sono **espanse a persone** (fuori scope trattarle come lead — SPEC). L'espansione (`expandCompanies`,
`src/strategies/company-expansion.ts`) gira **people-search `harvestapi`** — lo stesso actor già validato
dalle strategie people-search — con query `"<ruolo> <nome azienda>"` per ciascun ruolo decisionale, e
produce candidati con [[sotto-fonte-respondents|sotto-fonte]] `company-expansion`. È il path di
[[respondents-azienda-first]] che consuma il **budget residuo** dopo i commentatori.

Una stessa azienda taggata in più post si espande **una sola volta** (dedup per `companyUrn`, fallback nome
normalizzato); i candidati sono deduplicati per URL; ogni azienda ha un **cap** cumulativo sui ruoli. Gli
errori di una singola ricerca sono **isolati** (quella ricerca contribuisce 0, il modulo non fallisce).

## Attributes

| Attributo | Valore |
|-----------|--------|
| Input | `CompanyRef[]` (`{ name, companyUrn? }`) accumulati da `extractPost` (annotation `type === 'company'`) |
| Output | `RawCandidate[]` con `sourceDetail = 'company-expansion'` |
| Actor | `harvestapi/linkedin-profile-search` (`ACTORS.profileSearch`, `profileSearchInput`) — già validato |
| Query | `` `${role} ${company.name}` `` per ogni ruolo in `roles` |
| Ruoli | `config.companyExpansionRoles` (`COMPANY_EXPANSION_ROLES`; default CEO, CTO, Founder, Co-founder, Head of Engineering, HR, Talent) |
| Cap per azienda | `config.companyExpansionPerCompany` (`COMPANY_EXPANSION_PER_COMPANY`, default 3) — cumulativo su tutti i ruoli |
| Location | `opts.location` (default `'Italy'`) |
| Dedup azienda | `companyKey` = `urn:<companyUrn>` se presente, altrimenti `name:<nome lower/trim>` |
| Dedup candidati | per URL normalizzato (`seenUrl`), via `mapProfileItem` (people-search) |
| Aziende senza nome | saltate (`if (!company.name) continue`) |
| Isolamento errori | `try/catch` per singola ricerca → `items = []` |
| Iniettabilità | `opts.search` (firma `PeopleSearch`) per i test; default = `runActor` |

## Related flows

- [[respondents-azienda-first]] — chiama `expand(companyRefs)` col budget residuo (i commentatori prima).

## [Source: SPEC + IMPLEMENTATION-NOTES influencer-post-respondents]

- **AC2 (parte aziende, met):** "le aziende via people-search dei loro ruoli decisionali" — soddisfatta;
  path harvest già validato (T7). La parte "persone taggate" resta gated-off (vedi
  [[sotto-fonte-respondents]]).
- **Fuori scope:** trattare le aziende come lead email a sé — sono espanse a persone.
- **Dedup cross-post:** l'azienda Welyk taggata in 2 post è espansa **una volta** (test T6: `expand`
  chiamata una volta con 2 ref; la dedup interna a `expandCompanies` collassa per `companyKey`).
- **Riuso:** stesso actor e stesso `mapProfileItem` delle people-search ([[03-extraction-strategies]]),
  cambia solo la composizione della query e l'attribuzione `company-expansion`.
