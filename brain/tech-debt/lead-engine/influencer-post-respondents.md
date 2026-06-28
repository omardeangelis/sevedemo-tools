---
domain: lead-engine
type: tech-debt
spec: influencer-post-respondents
links:
  - "[[specs/lead-engine/influencer-post-respondents/SPEC]]"
  - "[[specs/lead-engine/influencer-post-respondents/PLAN]]"
created: 2026-06-17
updated: 2026-06-17
---

# Tech debt — influencer-post-respondents

Drift durevole emerso durante l'implementazione. Da informare lavori futuri sulla
stessa spec.

## 1. Risolvibilità URN dei `tagged-person` sull'enrichment daily (RH) — APERTO

**Cosa.** I candidati `tagged-person` arrivano dalle `text_annotations` con
`profile_urn` (id membro `ACoAA…`), non con uno slug `/in/<slug>`. Il mapper
(`mapTaggedPerson`) costruisce `https://www.linkedin.com/in/<profile_urn>`.

**Il problema.** L'enrichment del **run giornaliero** usa
`dev_fusion/linkedin-profile-scraper` (`src/enrich/profile.ts:14`), **non**
`apimaestro/linkedin-profile-detail`. La prova storica R1 (`src/apify/actors.ts:52-58`,
"username accetta il formato URN") vale **solo per apimaestro** (enrichment
*progressivo* on-demand). Per `dev_fusion` la risolvibilità dell'URN-as-URL **non è
provata**. Se `dev_fusion` non risolve l'URN: i `tagged-person` estratti
consumerebbero budget pool + uno slot di enrichment ($) senza mai arricchirsi.

**Mitigazione adottata.** L'emissione dei `tagged-person` nel pipeline è gated da
`config.taggedPersonEnabled` (**default `false`**). Il mapper esiste ed è testato; i
commentatori e l'espansione-azienda (segnali dominanti) NON sono toccati e funzionano
a pieno.

**Come chiudere.** In T14 (smoke reale, autorizzato dall'operatore): prendere un URN
reale da una annotation e (a) confermare se `dev_fusion` lo arricchisce; se sì →
`taggedPersonEnabled=true`. Se no → valutare (b) far passare i `tagged-person` per il
path apimaestro/profile-detail (già usato dal progressivo), oppure (c) lasciarli
disabilitati e trattare le persone taggate solo come segnale, non come lead.

**Impatto su AC2.** La parte "persone taggate diventano candidati" resta **bloccata**
finché lo spike non passa; la parte "aziende taggate espanse a decision-maker" è
**soddisfatta** (T7, path harvest già validato).

## 1b. Reclaim budget: chiamata extra su supply == ask (NIT, accettato)

La fase 3 "reclaim" in `gather` (`src/pipeline/run.ts`) usa l'euristica `sourced ≥ asked`
per decidere chi ri-chiamare. Se la supply di una strategia è ESATTAMENTE pari al
richiesto (nessun surplus reale), sul path di under-fill parte una chiamata `source()`
extra che rende 0 (innocua, mai sul path comune a pool pieno). Tightening opzionale: flag
"exhausted" dopo una ri-chiamata a zero-nuovi. Non bloccante (gate adversarial-review: NIT).

## 2. Dedup cross-sotto-fonte commenter (slug) vs tagged-person (URN) — NOTO

Anche a flag attivo, lo stesso umano che **commenta** (`/in/<slug>`) ed è **taggato**
(`/in/<URN>`) resta su due chiavi `linkedin_url` distinte → possibile doppio candidato
+ doppio enrichment. `normalizeLinkedinUrl` preserva entrambe ma non può unificarle
(servirebbe un giro di resolve URN→slug). Best-effort accettato dal plan (RH);
rilevante solo se/quando il punto 1 viene sbloccato.

## 3. NIT/MINOR cosmetici accettati dal gate adversarial-review

Non bloccanti, lasciati come tightening futuri:
- **Backfill non transazionale** (`src/db/index.ts`): i due UPDATE di rename non sono in
  un `database.transaction()`. Ognuno è atomico e idempotente; un crash in mezzo si
  auto-completa al boot successivo. Belt-and-suspenders opzionale.
- **Stato report su tie `created_at`** (`src/db/runs.ts`): se due run della STESSA strategia
  hanno `created_at` identico ma `run_error` discordante, lo stato è non-deterministico.
  Impossibile in pratica (una riga per strategia per invocazione, timestamp distinti).
  Fix opzionale: `ORDER BY created_at DESC, id DESC LIMIT 1` per strategia.
- **`primaryWeight=0`** (`src/config.ts`/`gather`): il floor `Math.max(1,…)` fa sì che la
  primaria sia comunque chiesta ≥1 (primo claim garantito). Documentato; `weight=0` è anomalo.
- **`normalizeLinkedinUrl` sottodomini** (`src/util/fields.ts`): accetta `*.linkedin.com`.
  Non raggiungibile dal path commenti (legge solo `author.profile_url`). Tightenabile a
  `www.linkedin.com`/`linkedin.com`.
