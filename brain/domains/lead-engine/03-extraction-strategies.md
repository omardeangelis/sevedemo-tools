---
domain: lead-engine
type: concept
links: []
created: 2026-06-12
updated: 2026-06-12
ingested: false
last_ingested: null
---

# 03 — Strategie di estrazione

Una strategia è un **plug-in intercambiabile** che produce candidati grezzi. Non decide il bucket:
quello lo assegna Claude in base al ruolo (doc 04).

## L'interfaccia (`src/strategies/types.ts`)

```ts
interface Strategy {
  id: string;
  description: string;
  requiresCookie: boolean;            // se true: gated su LINKEDIN_LI_AT + cap COOKIE_MAX_PROFILES
  bucketHint: 'freelance' | 'azienda' | 'misto';  // SOLO documentazione
  source(limit: number): Promise<RawCandidate[]>;
}

interface RawCandidate {
  linkedinUrl: string;     // già normalizzato: è la chiave di dedup
  fullName?: string;
  headline?: string;
  sourcePostUrl?: string;  // solo per i reactors: il post di provenienza
  raw: unknown;            // payload originale dell'actor, per audit
}
```

Contratto di `source(limit)`:
- ritorna **al massimo** `limit` candidati, già deduplicati internamente per URL normalizzato;
- può lanciare: il chiamante (`gather` in `pipeline/run.ts`) isola l'errore e prosegue con le altre;
- non scrive su `contacts` (lo fa `persist`), ma può usare la tabella `kv` per stato proprio
  (es. cursori di rotazione).

## Registry e gating (`src/strategies/registry.ts`)

`ALL` elenca le 5 strategie; `isEnabled(s)` = `!requiresCookie || LINKEDIN_LI_AT presente`;
`dailyStrategies()` = tutte le abilitate. Il run giornaliero divide il budget **equamente**:
`perStrategy = ceil(POOL_SIZE / strategie attive)` — non esiste pesatura automatica in base alle
performance (il confronto è manuale, doc 06).

Per aggiungere una strategia: nuovo file che esporta un oggetto `Strategy`, import in `registry.ts`,
aggiunta ad `ALL`. Niente altro da toccare.

## Le 5 strategie

| id | Cookie | Seed | Come trova le persone |
|---|---|---|---|
| `freelance-people-search` | no | `freelance-queries.json` | ricerca per headline freelance/P.IVA (factory people-search) |
| `decisionmaker-people-search` | no | `decisionmaker-queries.json` | ricerca per ruoli di assunzione (stessa factory) |
| `freelance-post-reactors` | no | `influencers.json` | reactors dei post di influencer freelance |
| `influencer-followers` | sì | `influencers.json` | follower di profili influenti ("Followers of") |
| `job-posters-annunci` | sì | `job-search-urls.json` | la persona che pubblica annunci (recruiter/hiring) |

Vincolo di prodotto da ricordare: **chi APPLICA a un annuncio LinkedIn non è estraibile** (lista
candidati privata). Il bucket freelance si ottiene per proxy: headline search + reactors.

I seed in `data/seeds/` sono riletti a ogni run: si modificano senza ricompilare. Il caricamento
(`seeds.ts`) è fail-fast su file mancante/vuoto/non-array.

## People-search: piano page-aligned + rotazione query

`src/strategies/people-search.ts` contiene la factory `makePeopleSearchStrategy` usata dalle prime
due strategie (file da 9 righe: cambia solo `id`, seed e hint). È la parte più sottile del modulo,
nata da un vincolo di pricing: l'actor `harvestapi/linkedin-profile-search` fattura **a pagina di
ricerca** ($0.10 per pagina da 25 profili) — chiedere 10 profili costa quanto chiederne 25.

### 1. Piano di acquisto — `planSearchPages(limit, queryCount)`

Calcola `pagesNeeded = ceil(limit / 25)` e le distribuisce sul **minimo numero di query**
sufficiente, a pagine intere, quasi uniformemente (il resto va alle prime). Esempi:

- `limit=67`, 10 query nel seed → 3 pagine → piano `[1, 1, 1]` (7 query fuori piano)
- `limit=120`, 3 query → 5 pagine → piano `[2, 2, 1]`

### 2. Rotazione — cursore persistente in `kv`

```
cursorKey = "query-cursor:<queriesFile>"        # un cursore PER FILE di seed
cursor    = kvGet(cursorKey) ?? 0               # parse difensivo: corrotto/assente → 0

loop i = 0 .. queries.length - 1:               # TUTTE le query, non solo quelle del piano
  break se out.length >= limit
  q        = queries[(cursor + i) % len]        # partenza dal cursore, wrap modulo
  maxItems = (pages[i] ?? 1) * 25               # oltre il piano: 1 pagina → query di RISERVA
  runActor(profileSearch, input); used++
  dedup per URL normalizzato (Set in-memory)

kvSet(cursorKey, (cursor + used) % len)         # avanza di quante query sono state CHIAMATE
```

Comportamenti che ne derivano:

- **Run successivi pescano query diverse** → profili diversi, meno duplicati già in DB.
- **Le query oltre il piano sono la riserva**: vengono chiamate (1 pagina ciascuna) solo se le
  precedenti hanno reso meno del previsto, perché il loop continua finché manca budget.
- Il cursore avanza anche per le riserve consumate (`used` le conta).
- Se `runActor` lancia, l'eccezione esce **prima** del `kvSet`: in un run fallito il cursore non
  avanza e il run successivo ritenta dalle stesse query.
- I due file di seed hanno **cursori indipendenti**: le due strategie ruotano per conto loro.

### 3. Mapping output — `mapProfileItem`

Lettura tollerante con `field(...)` (URL su 5 chiavi alternative, nome su 3, headline su 4) +
`normalizeLinkedinUrl`. Item senza URL LinkedIn valido → scartato (`null`).

## `freelance-post-reactors` (no cookie)

Per ogni influencer in `influencers.json`: prende i 2 post più recenti
(`harvestapi/linkedin-profile-posts`), poi i reactors di ogni post
(`harvestapi/linkedin-post-reactions`), con `perPost = max(10, ceil(limit / (influencer × 2)))`.
È l'unica strategia che valorizza `sourcePostUrl`: arriva fino alla bozza email ("ho visto la tua
reazione al post di..."). Bucket hint `misto`: un reactor può risultare freelance o recruiter,
decide Claude. Fail-fast se `influencers.json` è vuoto (è un seed **da compilare**).

## Strategie cookie (`influencer-followers`, `job-posters-annunci`)

Entrambe:
- lanciano subito se manca `LINKEDIN_LI_AT` (difesa in profondità: il registry le esclude già);
- applicano `cap = min(limit, COOKIE_MAX_PROFILES)` (default 100/giorno) e dividono il cap
  equamente tra i seed;
- usano actor `curious_coder/*` che richiedono il cookie `li_at` nell'input.

`job-posters-annunci` estrae la **persona** che pubblica l'annuncio (poster/recruiter) dagli
annunci LinkedIn: senza cookie gli actor annunci restituiscono solo l'azienda, non la persona.

⚠️ Usare il cookie significa agire da utente loggato: rischio ban + ToS. Solo account
dedicato/sacrificabile, volumi bassi.

## Lo strato Apify comune

- `src/apify/client.ts → runActor(actorId, input)`: singleton lazy (`requireApify` valida il token
  alla prima chiamata), esecuzione **bloccante** (`actor.call` attende la fine del run sul cloud),
  poi scarica gli item dal dataset di default. Errori ri-lanciati come `Actor "<id>" fallito: ...`.
- `src/apify/actors.ts`: ID degli actor + builder degli input. **Se un actor cambia schema di
  input, si adatta SOLO qui.** La lettura degli output è invece tollerante per design
  (`field(...)` in ogni strategia), quindi spesso regge ai rename senza modifiche.
