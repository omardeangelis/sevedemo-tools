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

# Concetto — Sotto-fonte (`sourceDetail` / `source_detail`)

## Definition

L'**asse di attribuzione fine** di un candidato dentro una strategia: dice **da quale segnale** è arrivato.
Per la fonte primaria [[strategia-influencer-post-respondents]] i valori sono un set bounded:
`commenter` (ha commentato un post), `tagged-person` (persona taggata nel testo) e `company-expansion`
(decision-maker trovato espandendo un'azienda taggata, vedi [[espansione-azienda-decisionmaker]]). Nasce sul
`RawCandidate` (`sourceDetail`), è persistito su `contacts.source_detail` da `persist` (`src/pipeline/run.ts`),
e abilita il **drill-down per sotto-fonte** del [[esito-strategia-onesto|report onesto]] (AC5). I candidati
senza attribuzione rendono `(non attribuito)` nel report.

È **ortogonale** al `bucket` (freelance/azienda, deciso da Claude in scoring) e a `source_strategy` (quale
strategia): una stessa strategia può alimentare più sotto-fonti, e la stessa sotto-fonte può finire in
bucket diversi.

## Attributes

| Sotto-fonte | Mapper | URL / chiave d'identità | Stato |
|-------------|--------|--------------------------|-------|
| `commenter` | `mapComment`/`mapComments` (`post-extract.ts`) | slug `/in/<slug>` reale da `author.profile_url`; `sourcePostUrl` valorizzato (fallback `post_input`) | **attivo** — segnale dominante |
| `company-expansion` | `expandCompanies` (`company-expansion.ts`) | slug reale dalla people-search (`mapProfileItem`) | **attivo** — path harvest validato |
| `tagged-person` | `mapTaggedPerson` (`post-extract.ts`) | URL costruito da `profile_urn` (`/in/<URN>`, **non** uno slug) | **gated-off** (`taggedPersonEnabled=false`) |
| `(non attribuito)` | — | candidati senza `source_detail` (altre strategie) | etichetta di report |

Caratteristiche:

- **Persistenza:** `upsertCandidate({ …, sourceDetail })` → colonna `contacts.source_detail`.
- **Reporting:** `reportBySourceDetail` (`src/db/runs.ts`) raggruppa per `(source_strategy, source_detail)`;
  la CLI lo stampa con `pipeline report --detail` (`src/eval/report.ts`).
- **Precedenza in estrazione:** in [[respondents-azienda-first]] i `commenter` sono raccolti **prima**,
  `company-expansion` usa il **budget residuo**.

## Related flows

- [[respondents-azienda-first]] — dove le tre sotto-fonti sono prodotte e attribuite.
- [[esito-strategia-onesto]] — dove l'attribuzione diventa il drill-down per sotto-fonte del report.

## [Source: SPEC + IMPLEMENTATION-NOTES influencer-post-respondents]

- **AC5:** il report attribuisce l'esito per sotto-fonte (commento / persona-taggata / espansione-azienda),
  distinguendo "ha girato ed è vuota" da "errore / mai girata" a livello di strategia.
- **`tagged-person` gated-off (T5):** la annotation dà solo `profile_urn` (id membro `ACoAA…`), non uno
  slug. `mapTaggedPerson` costruisce `https://www.linkedin.com/in/<profile_urn>`, ma la **risolvibilità**
  dell'URN contro l'enrichment **daily** (`dev_fusion`, non apimaestro) non è provata → emissione gated da
  `config.taggedPersonEnabled` (default off) finché lo smoke T14 non conferma. Vedi
  `tech-debt/lead-engine/influencer-post-respondents.md §1`.
- **Dedup cross-sotto-fonte (noto, §2):** anche a flag attivo, lo stesso umano che **commenta**
  (`/in/<slug>`) ed è **taggato** (`/in/<URN>`) resta su due `linkedin_url` distinti → possibile doppio
  candidato. `normalizeLinkedinUrl` preserva entrambe ma non può unificarle senza un resolve URN→slug.
  Best-effort accettato; rilevante solo quando il punto 1 viene sbloccato.
