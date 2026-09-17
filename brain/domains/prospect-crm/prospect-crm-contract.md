---
domain: prospect-crm
type: contract
links:
  - "[[domains/prospect-crm/prospect-crm|prospect-crm]]"
  - "[[specs/prospect-crm/crm-foundation/PLAN|crm-foundation PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
created: 2026-09-16
updated: 2026-09-16
ingested: false
last_ingested: null
---

# Prospect CRM — Domain Contract

Confini del dominio `prospect-crm`: cosa possiede, cosa **non** possiede, e gli invarianti che valgono
trasversalmente a tutte le sue capability.

> [!note] Contract di progetto
> Derivato dal PLAN [[specs/prospect-crm/crm-foundation/PLAN|crm-foundation]] (§3 forma della soluzione,
> §4 ledger, §5 assunzioni e vincoli, §6 modello dati) mentre il dominio è **in costruzione**. Diventa
> verità *as-built* quando `docs-maintenance` ingerisce `crm-foundation`; fino ad allora, in caso di
> divergenza vince il PLAN.

## Owns

È **un solo dominio**: acquisizione, contatto, enrichment, analisi ed export sono **capability** dello
stesso CRM, su un unico SQLite (`data/crm.db`).

- **Kernel dati** — le 13 tabelle di `data/crm.db`: `settings`, `icps`, `companies`,
  `icp_reference_companies`, `lists`, `prospects`, `list_members`, `sources`, `posts`, `activities`,
  `analyses`, `jobs`, `exports` (PLAN §6), con i loro vincoli (`CHECK` sugli enum, indici unici parziali).
- **Configurazione dell'utente** — profilo LinkedIn "collegato" (= URL pubblico in `settings`),
  descrizione e offerta della propria azienda, **ICP** (ruoli, settori, località, dimensione, pain) e
  **aziende di riferimento** con esito (`vinta` / `in_trattativa` / `persa` / `riferimento`).
- **Acquisizione** — **Sync interazioni** (i miei post → reazioni + commenti → prospect in **Inbox** con
  la provenienza in `sources`) e **Sourcing da azienda** (URL company → dipendenti filtrati per i ruoli
  dell'ICP → membri della lista scelta).
- **Organizzazione** — liste per ICP in relazione **many-to-many** con i prospect; Inbox derivata
  (prospect senza lista e non scartati); triage e azioni bulk su selezione.
- **Gestione del contatto** — lo **stato** del prospect (9 stati) e la **timeline unica** `activities`
  (`status_change`, `touchpoint`, `note`, `export`, `analysis`, `enrichment`) con touchpoint multipli e
  messaggi manuali.
- **Enrichment on-demand** — la *capability* (about, esperienze, email) su singolo prospect, selezione o
  lista; non gli internals del provider.
- **Analisi AI on-demand** — riassunto, 3 angoli di apertura motivati e **fit ICP leggero**
  (`alto`/`medio`/`basso` + frase), con structured outputs e modello configurabile (`ANALYSIS_MODEL`).
- **Export CSV per lista** — con filtri o selezione, come **vista** dello stato corrente, con attività
  `export` registrata sulla timeline.
- **Job asincroni** — tabella `jobs`, controller generico (processo figlio + wrapper che scrive l'esito),
  **preview uniforme**, retry con gli stessi `params` e il **registry dei job kind**
  (`sync_interactions` · `source_company` · `enrich` · `analyze`): mappa `kind → handler` in
  `src/jobs/handlers.ts`. Un nuovo kind = handler + preview nel proprio file + estensione del `CHECK` su
  `jobs.kind`.
- **Web UI locale** — Onboarding · Inbox · Liste · Lista · Prospect · ICP · Aziende · Impostazioni (Hono
  + React). Percorsi e testi UI: [[specs/prospect-crm/crm-foundation/FLOW|FLOW.md]].

## Does Not Own

- **Lookalike di aziende** — seam futuro **`CompanyLookalikeProvider`** (es. Apollo). Oggi le aziende si
  inseriscono a mano; il seam è **solo documentato qui**: nessuna interfaccia né file vuoto nel codice
  finché la capability non si costruisce.
- **Invio email e lifecycle esterno dell'outreach** — seam futuro **`OutreachProvider`** (es. Brevo). Il
  dominio si **ferma all'export CSV** e al touchpoint registrato; anche questo seam è **solo documentato**,
  senza file vuoti.
- **Gli internals dei provider** — actor Apify (`apimaestro/*` per post, commenti, reazioni e
  profile-detail; `harvestapi/linkedin-company-employees`) e Claude API. Il dominio possiede le shape che
  ne ricava, non gli schemi dei provider: stanno dietro l'adapter `src/apify/actors.ts` e un client
  Claude iniettabile.
- **Login, cookie e sessioni LinkedIn** — nessuna autenticazione verso LinkedIn, nessun `LINKEDIN_LI_AT`.
- **Scheduling** — nessun cron/daemon: i job partono solo dalla UI, per scelta dell'utente.
- **Auth, multi-utente, esposizione remota** — fuori scope per design (locale, single-user).
- **Automatismi di assegnazione e di stato** — né l'AI né i job spostano un prospect in una lista (salvo
  la lista scelta esplicitamente al lancio del sourcing) o ne cambiano lo stato: decide sempre l'utente.
- **Import del DB legacy** — `data/sevedemo.db` resta su disco e non viene letto; nulla del Lead Engine
  (bucket, scoring, selezione giornaliera, bozze email, evaluation, geo-gate) appartiene al dominio.
- **Progresso parziale dei job** ("12/22") — non previsto in v1.
- **Conformità legale dell'outreach** — il dominio conserva la provenienza dei dati, ma base giuridica e
  opt-out (GDPR/ToS) restano responsabilità dell'utente e del tool di invio. Non è consulenza legale.

## Invariants

Valgono per tutte le capability; un cambiamento che li viola va discusso, non fatto di soppiatto:

- **Identità = `linkedin_url` normalizzato** (`normalizeLinkedinUrl`, `src/util/fields.ts`): `UNIQUE` su
  `prospects` e `companies` (URL company normalizzato a `https://www.linkedin.com/company/<slug>`). Un
  prospect è **unico** a prescindere da quante liste o fonti lo contengono. Seconda chiave dei prospect:
  `member_urn` (id membro `ACoAA…`, unico se presente); `linkedin_url` preferisce lo slug pubblico (minuscolo),
  e due prospect che una fonte rivela essere la stessa persona si uniscono senza perdere fonti, liste,
  attività o analisi (`src/db/identity.ts`).
- **SQLite è l'unica fonte di verità** (`data/crm.db`); gli export sono sempre **viste**, mai fonte. I
  derivati restano derivati, mai colonne: Inbox, "arricchito" (`enriched_at`), "analizzato per l'ICP",
  analisi `stale` (`input_hash` diverso dall'input corrente).
- **Status sul prospect + timeline** — uno **stato globale** per prospect
  (`nuovo → qualificato → da_contattare → contattato → risposto → in_conversazione → chiuso_vinto | chiuso_perso | scartato`),
  valido in ogni lista in cui compare; il cambio è **sempre manuale** e **ogni cambio logga** un'attività
  `status_change`. Tutta la storia del contatto vive nella timeline unica `activities`.
- **Provenienza multipla e idempotente** — `sources` registra ogni fonte di un prospect (reazione,
  commento, azienda, manuale) con unicità su `(prospect, kind, post)` / `(prospect, kind, company)`: un
  re-sync o un re-sourcing **non duplica** né gonfia i conteggi.
- **Adattamento provider in un solo punto** — gli input degli actor si toccano solo in
  `src/apify/actors.ts`; la lettura dell'output è tollerante (`field(...)`), i mapper sono puri.
- **Best-effort con isolamento per item** — un post, un'azienda o un profilo che fallisce non ferma il
  job; fail-fast solo sulla configurazione, che però emerge prima come `blocker` in preview.
- **No cookie** — il profilo "collegato" è un URL pubblico letto con actor **no-cookie**.
- **Un solo job alla volta** — guard su `jobs.state = 'running'` con pid vivo (secondo avvio → `409`);
  pid morto → `failed` con errore leggibile. Vale anche per il retry.
- **Preview prima di ogni spesa** — ogni job kind espone la stessa preview
  `{counts, est_cost_usd, warnings, blockers}`; `blockers` non vuoti = il job **non parte**; una stima non
  calcolabile è `null` e la UI dice "stima non disponibile", mai un numero inventato.
- **Non pagare due volte lo stesso dato** — ri-sync dei post regolato da cooldown e recenza
  (`SYNC_COOLDOWN_DAYS`, `POST_RECENCY_DAYS`, salvo `force`), enrichment con freshness (`FRESHNESS_DAYS`),
  sourcing `Full` che marca il prospect già arricchito.
- **Esito onesto** — il risultato di un job distingue 0 risultati (neutro), warning ed errore
  **attribuito** (`actor:` / `config:` / `process:`).
- **L'AI serve solo all'analisi** — l'analisi richiede un prospect arricchito e produce riassunto, angoli
  e fit; non assegna liste né stati.
- **Dati personali tracciati** — i prospect EU sono dati personali: la provenienza resta sempre in
  `sources` e l'outreach deve prevedere l'opt-out.
