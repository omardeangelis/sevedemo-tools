---
domain: prospect-crm
type: tech-debt
spec: crm-foundation
links:
  - "[[specs/prospect-crm/crm-foundation/PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW]]"
  - "[[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES]]"
  - "[[specs/prospect-crm/crm-foundation/REPORT]]"
created: 2026-09-16
updated: 2026-09-16
---

# Tech debt — crm-foundation

Drift durevole e problemi aperti di [[specs/prospect-crm/crm-foundation/PLAN]], da due fonti:

- **Smoke end-to-end** (T18, `tests/e2e/smoke.md`, agent-browser contro `npm run e2e:server`, 2026-09-16): TD-1…TD-22,
  tutte **MINOR** (attriti, copy, accessibilità, decisioni aperte). Evidenze: screenshot `t18-*.png` della sessione di
  smoke (scratchpad, non versionati); i passi per riprodurle sono in `tests/e2e/smoke.md`.
- **Adversarial review** del 2026-09-16 ([[specs/prospect-crm/crm-foundation/REPORT|REPORT]], working tree non
  committato su `a6f203b`, verdetto **DO NOT SHIP**): TD-23…TD-71 = 5 **BLOCKER**, 11 **MAJOR**, 23 **MINOR** e 10
  gruppi di **NIT**. Tra parentesi l'id del REPORT (B1, M3, m9, …), dove restano evidenze e probe completi. La
  correzione è **rinviata per scelta dell'utente** (2026-09-16): le voci restano qui finché non vengono chiuse.

> [!warning] Prima di usare il CRM su dati reali o di fare push
> Chiudere prima di tutto TD-29 (dati personali reali nel repository pubblico), TD-23 e TD-28 (API raggiungibile
> dalla rete locale e da richieste cross-site) e TD-24 (il server e2e può cancellare `data/crm.db`).

Legenda: **Stato** = APERTO (verificato nello smoke, nel codice o con un probe) · NON RIPRODOTTO (non osservabile
nello smoke, resta aperto per quanto noto) · DECISIONE APERTA. **Tipo** = bug (diverge da FLOW/PLAN/contract) ·
attrito (conforme ma migliorabile) · sicurezza (rete, dati personali, DB reale). **Gravità** (come nel REPORT) =
BLOCKER (da correggere prima dello ship) · MAJOR (rischio significativo) · MINOR (impatto limitato) · NIT (rifinitura).

## Ordine di remediation

Gruppi in ordine di rischio; dentro ogni gruppo prima BLOCKER e MAJOR.

1. **Prima di qualunque push** — TD-29.
2. **Rete e dati reali** — TD-23, TD-28, TD-24 (lo stesso guard chiude TD-41, TD-42, TD-44), TD-43, TD-48, TD-49.
3. **Spesa** — TD-25 (assorbe TD-17), TD-32, TD-33, TD-34, TD-52, TD-53, TD-54, TD-3.
4. **Identità dei prospect** — TD-26, TD-37 (assorbe TD-1), TD-55, TD-56, TD-57.
5. **Robustezza di job e concorrenza** — TD-27, TD-35, TD-36, TD-30, TD-31, TD-45, TD-46, TD-10.
6. **Decisioni di prodotto** (cambiano FLOW o codice) — TD-38, TD-47, TD-6, TD-7, TD-9, TD-15.
7. **Copy, accessibilità e pulizia** — TD-2, TD-4, TD-5, TD-8, TD-11…TD-14, TD-16, TD-18…TD-22, TD-39, TD-40, TD-50,
   TD-51, TD-58…TD-71.

**Come si chiude il giro.** Correzioni in una sessione di implementazione (`implement-spec` su un piano di
remediation) → i quattro gate di `AGENTS.md` verdi → le verifiche indicate nelle voci (dalla Human Review Checklist
del REPORT, sempre su DB di prova e mai su `data/`) → walkthrough UX sull'app → `adversarial-review` in una **sessione
nuova** sul prodotto congelato → `docs-maintenance` dopo lo SHIP → primo uso reale a cap minimi (PLAN §14 W3). Il
verdetto del 2026-09-16 vale solo per il working tree di quel giorno ed è nato nella stessa sessione
dell'implementazione: le sue voci restano valide come elenco dei problemi, non come gate.

## Voci note prima dello smoke

### TD-1 — Identità: reazione solo-id e commento solo-slug con nome o headline diversi — NON RIPRODOTTO · attrito · MINOR

**Cosa.** Il sync aggancia la reazione (id membro `ACoAA…`) e il commento (slug) della stessa persona solo se
`full_name` **e** `headline` coincidono alla lettera (`src/db/identity.ts:69-74`, `nameTwin`). Nome o headline
diversi (spazi, maiuscole, headline aggiornata tra i due eventi) → **due prospect** finché l'arricchimento
(T10, `setProspectIdentity`) non risolve l'id nello slug e li unisce. `ACoAA…` e `ACwAA…` della stessa persona
sono stringhe diverse (confronto letterale in `src/util/fields.ts`).

**Smoke.** Le fixture hanno nome e headline identici: Giulia Marchetti è **un** prospect con reazione +
commento, e dopo il sourcing da `company/ferronova-digitale-e2e` ha 3 fonti ed esce dall'Inbox (passi 11 e 19).
Il caso residuo non è riproducibile dalla UI senza fixture dedicate.

**Come chiudere.** Normalizzare il confronto (trim/case/spazi) o accettare il match per solo nome quando la
fonte è lo stesso post; aggiungere una fixture e2e con headline divergente per renderlo osservabile.

**Escalata dalla review (M10) → TD-37.** Nemmeno l'arricchimento unisce `ACoAA…` e `ACwAA…` della stessa
persona. Attenzione: allargare l'aggancio per solo nome peggiora TD-26 (omonimi uniti).

### TD-2 — Toast persistenti coprono i controlli allineati a destra — APERTO · attrito · MINOR

**Cosa.** Gli esiti dei job sono toast persistenti in basso a destra (384 px) e si **accumulano** (sync +
sourcing + analisi restano finché non li chiudi). Coprono contenuto e controlli della colonna destra.

**Smoke.** In Impostazioni l'errore del sync copre il bottone "Riprova job #6" in "Ultimi job" e la colonna
Stato de "I miei post" (`t18-27-sync-failed-banner.png`); nella Lista coprono paginazione ed "Export
precedenti" (`t18-21-analysis-outcome.png`); nel dettaglio prospect il suggerimento sotto "Rianalizza"
(`t18-32-prospect-two-lists.png`). Aggirabile chiudendo il toast.

**Come chiudere.** Limitare lo stack (es. max 2, i più vecchi collassati), spostarlo o riservare spazio in
fondo alle pagine; il banner in sidebar già conserva l'esito.

### TD-3 — "Avvia" di Arricchisci/Analizza abilitato con 0 target — APERTO · attrito · MINOR

**Cosa.** La preview con 0 da arricchire/analizzare mostra solo un warning ("Nessun profilo da arricchire con
queste opzioni." / "Nessun prospect da analizzare con queste opzioni.") ma nessun blocker: "Avvia" resta
abilitato.

**Smoke.** Lista con 5 arricchiti e analizzati → Arricchisci… e Analizza… con Avvia abilitato
(`t18-41-enrich-zero-targets.png`, `t18-42-analyze-zero-targets.png`); il clic avvia davvero un processo figlio
(job #12, "Analisi completata: 0 analizzati · 5 già analizzati…", badge "Nessun risultato",
`t18-43-analyze-zero-outcome.png`). Nessun costo, ma occupa lo slot "un solo job alla volta".

**Come chiudere.** Blocker server `nothing_to_do` nella preview (o disabilitazione lato `JobPreviewDialog` con
conteggio target 0).

### TD-4 — Focus su `body` dopo le azioni della BulkBar — APERTO · bug (FLOW Accessibilità) · MINOR

**Cosa.** Dopo "Aggiungi a lista" (dialog chiuso), "Scarta" e "Ripristina" le righe selezionate spariscono e il
focus cade su `body`: chi usa la tastiera riparte dall'inizio della pagina.

**Smoke.** `document.activeElement.tagName === "BODY"` dopo ciascuna delle tre azioni in Inbox (passo 14, U10).

**Come chiudere.** Riportare il focus sul contatore/primo controllo della tabella o sull'intestazione della pagina.

### TD-5 — Vite dev non genera le classi Tailwind dei file creati dopo l'avvio — NON RIPRODOTTO · attrito (solo dev) · MINOR

**Cosa.** Con `npm --prefix web run dev` avviato, una route/componente nuovo resta senza stili finché non si
riavvia Vite (segnalato da T14/T15/T16). La build è corretta.

**Smoke.** Non osservabile: lo smoke usa `web/dist` servito dal server e2e.

**Come chiudere.** Verificare la configurazione `@tailwindcss/vite` / `@source` dei file sorgente; in
alternativa documentare "riavvia Vite dopo aver creato un file" nel README.

### TD-6 — Analisi: nessun fallback sul refusal; `max_tokens` 16 000 — DECISIONE APERTA · MINOR

**Cosa.** `stop_reason: 'refusal'` → 502 `refusal`, attività `analysis` con `meta.error`, riga "rifiutata";
nessun tentativo alternativo lato server (richiederebbe il client beta e cambierebbe la semantica
502/`rifiutata`). `ANALYSIS_MAX_TOKENS = 16_000` (`src/analysis/analyze.ts:31`) invece dei 4000 del PLAN T11:
con Opus 5 il ragionamento conta nel limite.

**Smoke.** Il percorso refusal funziona come da FLOW: riga "rifiutata" con tooltip (U7,
`t18-37-fit-tooltip-refusal.png`), `ErrorBox` nel dettaglio senza angoli e "Analisi AI non riuscita" in
timeline (U9, `t18-40-single-refusal.png`).

**Come chiudere.** Decidere se introdurre un fallback (e come mostrarlo) dopo i primi refusal reali;
aggiornare il PLAN/contract con il valore di `max_tokens` e il suo impatto sul costo stimato.

### TD-7 — ICP con liste mai eliminabile; liste non eliminabili — APERTO · attrito · MINOR

**Cosa.** `lists.icp_id` è RESTRICT e non esiste un delete delle liste: un ICP che ha avuto anche una sola lista
(anche archiviata) non si può più eliminare. Il copy FLOW "archiviale prima" non vale.

**Smoke.** "Elimina ICP" disabilitato con "Impossibile eliminare l'ICP: ha 1 lista (contano anche le
archiviate)." (`t18-16-icp-reference-company.png`); in `/lists` solo "Archivia la lista …"
(`t18-47-lists-no-delete.png`).

**Come chiudere.** Delete di liste vuote (o archiviate) e/o "sposta liste su un altro ICP"; oppure archiviazione
degli ICP.

### TD-8 — SyncDialog al primo sync ripete "stima non disponibile" — APERTO · bug (copy) · MINOR

**Cosa.** Al primo sync il dialog dice tre volte la stessa cosa: "Stima: non disponibile al primo sync.",
"Costo stimato: stima non disponibile" e il warning "Prima sincronizzazione: stima non disponibile. …", che
espone anche il nome tecnico del parametro: "…"Aggiorna solo l'elenco dei post" (postsOnly) rende la stima
reale." (`src/jobs/sync-interactions.ts:178`, idem riga 210).

**Smoke.** `t18-06-sync-preview.png`.

**Come chiudere.** Una sola riga di stima (quella del warning FLOW B.2) e togliere "(postsOnly)" dal testo utente.

### TD-9 — Nessun "Riprova questo post"; "Riprova con altri filtri" solo nello storico azienda — APERTO · attrito (OQ-7) · MINOR

**Cosa.** Un post in errore mostra messaggio attribuito e "Il prossimo sync lo riprende." senza azione per post
(OQ-7 aperta). Il sourcing a zero offre "Riprova con altri filtri" solo in "Ricerche di persone" del dettaglio
azienda: il toast del `JobBanner` ha solo "chiudi" (FLOW D.3 lo mette nell'esito).

**Smoke.** `__fixture: PARTIAL` + `force` → riga "Errore" senza retry (U11, `t18-45-post-partial-no-retry.png`);
`company/acme-empty` → toast neutro senza azioni, bottone nello storico (U12, `t18-46-sourcing-zero-toast.png`).

**Come chiudere.** Decidere OQ-7; per il sourcing, azione nel toast che porta a `/companies/<id>` con il dialog
precompilato dai params del job.

## Voci nuove trovate dallo smoke

### TD-10 — Il banner non scopre un job avviato fuori dalla pagina — APERTO · bug (FLOW Edge "Due tab") · MINOR

**Cosa.** `useCurrentJob` fa polling solo se il job in cache è `running`
(`web/src/lib/jobs.ts:43`, `refetchInterval`); con l'ultimo job terminato la pagina non interroga più
`/api/jobs/current`. Un job avviato da un'altra scheda, da curl o da script resta invisibile (niente banner "in
corso", niente toast d'esito) finché non si ricarica, si naviga o la finestra riprende il focus
(`refetchOnWindowFocus` attenua il caso "due schede" in un browser reale). Il server resta coerente: il
secondo avvio riceve il blocco/409.

**Smoke.** Job #8 (`__fixture: FAIL_ONCE` via `fetch`) `failed`, ma per oltre 40 s il banner mostrava ancora il
job #7; ultima richiesta a `/api/jobs/current` 40 s prima. Durante il job bulk #2 avviato via API il banner
della pagina già aperta era vuoto. La ricetta di `tests/e2e/README.md` ("il banner lo trova col polling") è
quindi imprecisa: serve `ab reload`.

**Come chiudere.** Polling lento (es. 15–30 s) anche a job terminato, oppure refetch al cambio di route; aggiornare
la ricetta del README e2e.

### TD-11 — Titolo del toast al maschile per "Analisi" — APERTO · bug (copy) · MINOR

**Cosa.** `JobBanner.tsx:204,216` compone `${label} completato` / `${label} non riuscito`: "Analisi completato",
"Attenzione: Analisi completato", "Analisi non riuscito".

**Smoke.** Passo 21 e U7 (`t18-21-analysis-outcome.png`, `t18-36-inbox-analysis-states.png`).

**Come chiudere.** Titolo per kind (es. "Analisi completata") o forma neutra ("Completato: Analisi", come il banner).

### TD-12 — Concordanza singolare/plurale nei conteggi — APERTO · bug (copy) · MINOR

**Cosa.** "1 letti" nella colonna Commenti de "I miei post" (`web/src/routes/settings.tsx:445`) e "#11 · 1
selezionati" in "Ultimi job" (`settings.tsx:624`).

**Smoke.** U1/U11 (tabella post), "Ultimi job" dopo U8.

**Come chiudere.** Un `plural(n, uno, molti)` come quelli già locali in `ExportDialog.tsx` e `icps.$id.tsx` (meglio condiviso).

### TD-13 — L'azienda creata da URL prende lo slug come nome — APERTO · attrito · MINOR

**Cosa.** `from-url` senza nome usa lo slug (`src/db/companies.ts:62-66`, "modificabile"), e il form "Aggiungi
da URL" dell'ICP non chiede il nome. Lo slug compare ovunque: titolo "Cerca persone in
ferronova-digitale-e2e", summary dei job, colonna Azienda dei dipendenti estratti; i prospect arricchiti della
stessa azienda mostrano invece "Ferronova Digitale Srl". Stessa azienda, due nomi nella stessa tabella.

**Smoke.** Passi 16–21 (`t18-17-sourcing-preview.png`, `t18-21-analysis-outcome.png`).

**Come chiudere.** Slug "in parole" come default, campo nome nel form, o
aggiornare il nome dell'azienda dal primo dato arricchito/sourcing se ancora uguale allo slug.

### TD-14 — "Arricchisci e analizza" abilitato senza token — APERTO · attrito · MINOR

**Cosa.** Nel dettaglio prospect il bottone di analisi singola resta abilitato con `ANTHROPIC_API_KEY` /
`APIFY_TOKEN` assenti; l'errore arriva solo dopo il clic (400 `config`, nessun costo): "Analisi non avviata:
ANTHROPIC_API_KEY mancante nel .env — … APIFY_TOKEN mancante nel .env: impossibile arricchire il profilo prima
dell'analisi.". I job invece mostrano il blocco in preview.

**Smoke.** U13 (`t18-50-single-analyze-no-key.png`).

**Come chiudere.** Disabilitare con hint usando `settings.readiness` (già in cache), coerente con i blocchi delle preview.

### TD-15 — Cambiare il profilo non separa i post del profilo precedente — APERTO · attrito · MINOR

**Cosa.** I `posts` non sono legati al profilo: dopo aver salvato un altro URL la preview del sync conta i post del
profilo precedente come "già sincronizzati (saltati)" e "I miei post" continua a mostrarli.

**Smoke.** Profilo `omar-smoke` → `omar-fail`: "Post già sincronizzati: 2 (saltati) · Da sincronizzare: 0" (U2).

**Come chiudere.** Legare i post al profilo (colonna o filtro per autore) oppure avvisare al cambio profilo.
Caso raro per un single-user.

### TD-16 — In Inbox con più ICP gli stati di errore del fit non dicono l'ICP — APERTO · bug (FLOW H.2) · MINOR

**Cosa.** Il fit riuscito è etichettato con l'ICP ("basso · Responsabili IT logistica"), ma "errore",
"rifiutata" e "non arricchibile" no, neanche nel tooltip. Con 2 ICP non si capisce per quale ICP è fallita
l'analisi (FLOW: "Fit sempre etichettato con l'ICP in Inbox").

**Smoke.** U7/U8 (`t18-36-inbox-analysis-states.png`, `t18-39-inbox-fit-basso.png`).

**Come chiudere.** Stessa etichetta "· <ICP>" per gli stati di riga quando esistono più ICP.

### TD-17 — "Riprova" resta sui job falliti già ripresi con successo — APERTO · attrito · MINOR

**Cosa.** "Ultimi job" offre "Riprova" su ogni `failed`, anche quando un retry con gli stessi params è già
riuscito (job #8 `failed` → #9 `succeeded`): nessun "già ripreso da #9". Un clic in più rilancia un job (per il
sync il costo è contenuto dalla regola anti-spesa, per sourcing/analisi no).

**Smoke.** U4, sezione "Ultimi job" di `/settings`.

**Come chiudere.** Nascondere/annotare il retry quando esiste un job successivo con params identici `succeeded`.

**Escalata dalla review (B3) → TD-25.** Il problema è più ampio: "Riprova" salta blocchi e preview.

### TD-18 — "già presenti (fonte aggiunta)" anche quando nessuna fonte è aggiunta — APERTO · bug (copy) · MINOR

**Cosa.** `src/jobs/sync-interactions.ts:539` scrive "N già presenti (fonte aggiunta)" per ogni prospect già
noto, anche su un `force` che rilegge fonti identiche (indice unico: nessuna riga nuova).

**Smoke.** U11: "0 nuovi prospect in Inbox · 6 già presenti (fonte aggiunta)".

**Come chiudere.** Contare separatamente le fonti realmente inserite.

### TD-19 — Warning "Descrizione azienda vuota" senza link "Compila" — APERTO · bug (FLOW E.3) · MINOR

**Cosa.** La preview dell'analisi mostra "Descrizione della tua azienda vuota: angoli meno mirati." senza
l'azione "[Compila]" prevista dal FLOW (link a `/settings`).

**Smoke.** U8 (`t18-38-analyze-preview-empty-description.png`).

**Come chiudere.** Link a `/settings` nel warning (i warning oggi sono solo testo del server).

### TD-20 — Dialog "Aggiungi a lista" del dettaglio prospect — APERTO · attrito · MINOR

**Cosa.** (a) Preseleziona la lista in cui il prospect **è già** (via `preferredIcpId` = ICP dell'ultima analisi,
lista unica di quell'ICP): "Aggiungi" produrrebbe solo "già presente". (b) Il bottone di chiusura ha la label
screen reader inglese "Close" (`DialogContent` di default in `web/src/routes/prospects.$id.tsx:305`; gli altri
dialog usano `showCloseButton={false}`).

**Smoke.** U5 (`t18-31-prospect-addtolist-dialog.png`).

**Come chiudere.** Escludere o marcare le liste di appartenenza nel `ListPicker`; `showCloseButton={false}` o
label italiana "Chiudi".

### TD-21 — Il job "solo elenco post" risulta "Nessun risultato" — APERTO · bug (copy) · MINOR

**Cosa.** `isZeroOutcome` per `sync_interactions` guarda solo i prospect (`web/src/lib/jobs.ts:181-182`): il job
`postsOnly` che ha letto 2 post nuovi compare in "Ultimi job" con badge "Nessun risultato".

**Smoke.** Passo 7, riga "#1 · solo elenco post" in "Ultimi job".

**Come chiudere.** Per `postsOnly` considerare `posts`/`posts_new`.

### TD-22 — Suggerimento "Senza pains né descrizione…" sempre visibile (NIT) — APERTO · attrito · MINOR

**Cosa.** Nel form ICP il testo "Senza pains né descrizione il fit dell'analisi AI è poco affidabile." è
statico (`web/src/routes/icps.$id.tsx:358`), anche con pains e descrizione compilati.

**Smoke.** Passo 4 (`t18-04-icp-created.png`).

**Come chiudere.** Mostrarlo solo se entrambi i campi sono vuoti.

## Voci dall'adversarial-review: BLOCKER e MAJOR

### TD-23 (B1) — L'API ascolta su tutte le interfacce di rete — APERTO · sicurezza · BLOCKER

**Cosa.** `serve()` senza `hostname` (`src/server/index.ts:22-28`, `scripts/e2e-server.ts:84`): `@hono/node-server`
ascolta su `*:<porta>`. Dalla rete locale si leggono tutti i prospect, si scaricano i CSV e si avviano job a
pagamento. Contraddice `README.md:113` e il contract ("esposizione remota fuori scope").

**Evidenza.** `lsof` → `TCP *:8870 (LISTEN)`; dall'IP di LAN `GET /api/prospects` restituisce i dati personali e
`GET /api/exports/1.csv` risponde 200.

**Come chiudere.** `hostname: process.env.HOST ?? '127.0.0.1'` in entrambi i `serve()`; proxy Vite di default su
`http://127.0.0.1:8787`. Verifica: `lsof -iTCP:8787 -sTCP:LISTEN -n -P` mostra solo `127.0.0.1` e
`http://<ip-del-mac>:8787/api/health` da un altro dispositivo fallisce. Fino ad allora non avviare il CRM su reti
non fidate.

### TD-24 (B2) — Il guard del server e2e può cancellare `data/crm.db` — APERTO · sicurezza · BLOCKER

**Cosa.** Il guard su `data/` (`scripts/e2e-server.ts:23-31`, check inutile a `:52`) confronta stringhe
case-sensitive dopo `fs.realpathSync`, che conserva il case digitato, su APFS case-insensitive. `DATA/crm.db`,
`Data/crm.db`, `link/../DATA/crm.db` e l'alias `/System/Volumes/Data…/data/crm.db` passano, e `rmSync` (riga 31)
cancella `data/crm.db`, `-wal` e `-shm` all'avvio.

**Evidenza.** Probe sulla copia invariata dello script con file esca: tre file cancellati in ogni variante.

**Come chiudere.** Guard importabile che confronta `dev:ino` dell'antenato esistente più vicino con `root/data`,
usato prima di `rmSync` e in `assertE2eDatabase` (`src/jobs/fake-deps.ts:462-463`), con test vitest per maiuscole,
symlink, sottocartella inesistente e alias; chiude anche TD-41, TD-42 e TD-44. Verifica **solo con file esca** fuori
da `data/` (copia dello script in una cartella temporanea con una sua `data/`): lo script rifiuta di partire e le
esche sopravvivono. Mai provarlo contro la `data/` del repository.

### TD-25 (B3) — "Riprova" avvia job a pagamento senza blocchi né preview — PARZIALMENTE CHIUSO 2026-09-17 da apollo-lookalike T6 (retry → 400 `blocked` con i blocker di configurazione del kind; resta aperto: "Riprova" non ripassa dalla preview/costo e un'analisi di lista ripianifica gli id all'esecuzione) · bug · BLOCKER

**Cosa.** `POST /api/jobs/:id/retry` (`src/server/jobs.ts:200-207`, `src/server/routes/jobs.ts:27-34`, usato da
`web/src/components/JobBanner.tsx:78` e `web/src/routes/settings.tsx:508`) riavvia qualunque kind senza i blocchi di
configurazione e senza anteprima. Un'analisi di lista ripianifica i target a runtime, quindi il costo può essere
molto diverso da quello visto. Escala TD-17.

**Evidenza.** Senza `ANTHROPIC_API_KEY` l'avvio diretto dà 400 `blocked`, il retry 202. Preview 2 target / $0,06 →
retry 40 target / $1,20. Il retry senza chiave ha pagato 3 profile-detail prima di fallire
(`src/jobs/analyze.ts:274-299`, chiave verificata solo a `:368-371`).

**Come chiudere.** Blocchi di configurazione del kind anche nel retry (400 `blocked`); "Riprova" passa dalla preview
del kind, oppure gli id risolti si congelano nei `params` al lancio; `analyzeMany` fallisce subito se manca la
chiave. Verifica con `npm run e2e:server` ed `E2E_NO_ANTHROPIC=1`: un'analisi fallita con "Riprova" dà 400 `blocked`
o apre la preview, mai parte.

### TD-26 (B4) — L'aggancio per nome può unire due omonimi — APERTO · bug · BLOCKER

**Cosa.** L'aggancio per nome + headline (`nameTwin`, `src/db/identity.ts:69-80,99,112-117,202-206`,
`src/db/prospects.ts:122`) salva come `member_urn` l'id membro di un **omonimo**. L'arricchimento non lo corregge
(riempie solo se vuoto, `src/jobs/enrich.ts:216-219`); arricchendo la persona vera, `setProspectIdentity` trova la
riga sbagliata per `member_urn` e la **unisce**, portandosi stato, touchpoint e liste. Un job cambia così stato e
liste di una persona reale, senza undo.

**Evidenza.** Probe A1–A4 con due "Marco Rossi · CEO"; fuzz con omonimi: 32/400 e 35/400 esecuzioni con due persone
mescolate (0/800 senza omonimi).

**Come chiudere.** Non salvare `member_urn` da un aggancio per nome (collegare solo la fonte) o registrarne la
provenienza; in arricchimento l'id restituito dal provider per quel prospect è autorevole: sostituisce un id
discordante, mai merge su un id contraddetto. Test con due omonimi con la stessa headline: dopo sync e arricchimento
restano **due** prospect con stati e liste propri.

### TD-27 (B5) — Un campo inatteso fa fallire l'intero job di arricchimento — APERTO · bug · BLOCKER

**Cosa.** `enrichOne` protegge solo la chiamata al provider (`src/jobs/enrich.ts:182,264-286,376-400`);
`applyEnrichment` non è isolato e `matchCompanyId` esegue `e.company?.trim()` su un campo letto senza type guard
(`src/enrich/profile-detail.ts:82`). Un `current_company` non stringa lancia `TypeError`, rigetta `Promise.all` e il
job diventa `failed` con un `process:` generico, senza conteggi, mentre altri profili sono già scritti.

**Evidenza.** Probe riprodotto; nessun test copre la fase di applicazione.

**Come chiudere.** try/catch attorno ad `applyEnrichment` con conteggio in `counts.errors`; `typeof === 'string'`
nel mapper. Test: un profilo con un campo inatteso produce un solo errore conteggiato e il job termina `succeeded`
con il riepilogo.

### TD-28 (M1) — Nessuna difesa da richieste cross-site e DNS rebinding — APERTO · sicurezza · MAJOR

**Cosa.** Nessun controllo di Host/Origin (`src/server/app.ts:25-28`) e `readJson` accetta qualunque Content-Type
(`src/server/http.ts:24`, `src/server/routes/sync.ts:45-46`). Una pagina web aperta nel browser può cambiare stati,
esportare e avviare job a pagamento; con un `Host` falsificato legge i dati personali. Vale anche dopo il bind su
loopback di TD-23.

**Evidenza.** POST `text/plain` con Origin `https://evil.example` → bulk status 200 (`updated:3`), export
`markContacted` 201, sync con body vuoto 202; `Host: evil.example` → 200 con dati personali.

**Come chiudere.** Middleware iniziale: 403 se Host non è `localhost`/`127.0.0.1:<porta>`; per i non-GET richiedere
`application/json` e Origin assente o locale (es. `hono/csrf` con allow-list). Verifica su un DB di prova:
`curl -i -X POST -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data '{"prospectIds":[1],"status":"contattato"}' http://127.0.0.1:8787/api/prospects/bulk/status`
→ 403.

### TD-29 (M2) — Dati personali reali nel repository pubblico — APERTO · sicurezza · MAJOR

**Cosa.** Il repository GitHub è **pubblico** e test e fixture contengono dati di persone reali (nome, gmail, slug
LinkedIn, URN, foto `media.licdn.com`, testo dei post): `tests/profile-detail.test.ts:10-16`,
`tests/fixtures/apimaestro-profile-posts.json`, `tests/post-extract.test.ts:70`, `tests/apimaestro-actors.test.ts:16`,
`PLAN.md:46`. Preesistenti a `a6f203b`, ma toccati da questo cambiamento.

**Come chiudere.** Nessun push finché non è chiusa. Sostituire con dati fittizi; decidere se riscrivere la storia git
per i file già pubblicati; annotare qui l'eventuale residuo.

### TD-30 (M3) — `SQLITE_BUSY` quando server e job scrivono insieme — APERTO · bug · MAJOR

**Cosa.** `busy_timeout` (`src/db/index.ts:11-13`) non copre le transazioni deferred read-then-write, cioè tutte
(`src/db/prospects.ts:107,166`, `src/db/activities.ts:119`, `src/db/analyses.ts:123`,
`src/jobs/sync-interactions.ts:372`, `src/jobs/enrich.ts:201`, `src/db/identity.ts:146,190`): `SQLITE_BUSY` /
`SQLITE_BUSY_SNAPSHOT` immediati tra server e processo figlio. Effetti: 500 sulle azioni dell'utente durante un job,
analisi pagata persa (`src/analysis/analyze.ts:223`), job analyze/enrich falliti per intero, pagina di sync ripagata.
Il commento di `db/index.ts` dice il contrario.

**Evidenza.** Scrittore concorrente contro `changeStatus`: 95/963 errori; contro `saveAnalysis`: 191 errori; scenario
realistico 0–1 errori su ~190 per run.

**Come chiudere.** `db.transaction(fn).immediate()` per le transazioni di scrittura + catch per item negli handler;
correggere il commento. Verifica: con un job lungo in corso (`E2E_FAKE_DELAY_MS=20000`) cambi di stato ripetuti senza
nessun 500.

### TD-31 (M4) — Un pid riusato blocca tutti i job senza via d'uscita — APERTO · bug · MAJOR

**Cosa.** La guardia "pid vivo" (`src/server/jobs.ts:70-78,86-92`) si fida di qualunque pid vivo, anche `EPERM`. Una
riga `running` rimasta dopo un crash del server, con il pid riusato da un altro processo, blocca **tutti** gli avvii
e i retry (409) senza alcun recupero dall'app.

**Evidenza.** Probe con pid 1 → resta `running`, retry 409; su questo Mac il contatore dei pid ha già fatto il giro.

**Come chiudere.** Verificare l'identità del processo (`ps` con `job-entry.ts <id>`, o `lstart` ≥ `started_at`), far
registrare a `job-entry` il proprio `process.pid`/heartbeat (chiude anche TD-46), azione in app "segna come
interrotto". Verifica simulando una riga `running` con un pid vivo estraneo.

### TD-32 (M5) — "Arricchisci e analizza" ripaga i profili senza dati — APERTO · bug · MAJOR

**Cosa.** `enrichOneInline` ignora la freschezza (`src/analysis/analyze.ts:189-196`, `src/jobs/enrich.ts:288-300`,
`web/src/components/AnalysisCard.tsx:85,94-97`): ogni clic su un profilo già noto come "senza dati" richiama
profile-detail a pagamento.

**Evidenza.** 3 clic → 3 chiamate di arricchimento, ognuna 409 `not_enrichable`; la preview di arricchimento per lo
stesso prospect dice `skipped_fresh 1`.

**Come chiudere.** 409 `not_enrichable` senza chiamare il provider se tentato entro `FRESHNESS_DAYS`; il
ri-arricchimento a pagamento solo da `EnrichDialog` con `retryFailed`.

### TD-33 (M6) — La stima del sync ignora i post nuovi — APERTO · bug · MAJOR

**Cosa.** Dopo il primo sync la stima somma solo i post già noti e ignora quelli pubblicati nel frattempo, senza
warning (`src/jobs/sync-interactions.ts:185-198,205-207`, `web/src/components/SyncDialog.tsx:39,64`).

**Evidenza.** Stima $0,56, spesa reale ≈ $6,58 (12×).

**Come chiudere.** Warning + limite superiore (`(postsPerSync − noti) × cap`), oppure stima `null` con l'azione
"Aggiorna solo l'elenco dei post" quando possono esserci post nuovi.

### TD-34 (M7) — Un sync interrotto ripaga le interazioni già salvate — APERTO · bug · MAJOR

**Cosa.** I post sono marcati sincronizzati solo a fine job (`src/jobs/sync-interactions.ts:452-461`): un processo
interrotto o un fallimento parziale fanno riscaricare reazioni e commenti già salvati, contro FLOW ("il retry non
paga due volte i post ok").

**Evidenza.** Probe B: 100 reazioni riscaricate; probe A: reazioni del post 2 riscaricate.

**Come chiudere.** Marcare ogni post subito dopo aver salvato reazioni e commenti (o tracciare separatamente i due
progressi). Verifica: un sync interrotto non riscarica i post già completati.

### TD-35 (M8) — Il sourcing non isola i singoli candidati — APERTO · bug · MAJOR

**Cosa.** Un errore DB su una persona interrompe l'intero sourcing (`src/jobs/source-company.ts:180-208`), contro
PLAN §5 "best-effort per item". Dichiarato nel log di T9 ma mai registrato qui.

**Come chiudere.** try/catch per candidato con conteggio `errors`; test come TD-27.

### TD-36 (M9) — Nome e headline di reazioni e commenti senza type guard — APERTO · bug · MAJOR

**Cosa.** `fullName`/`headline` in `src/acquisition/mappers/reactions.ts:46-47` e
`src/acquisition/mappers/posts.ts:112-113` non passano da `str()` (a differenza di `employees.ts`) e `clean()`
(`src/db/prospects.ts:55-59`) lascia passare i non-stringa: un cambio di schema dell'actor può far fallire il bind in
SQLite, e il sync isola solo a livello di post.

**Come chiudere.** `str()` nei due mapper e/o `clean()` che scarta i non-stringa; test con campi non stringa.

### TD-37 (M10) — `ACoAA…` e `ACwAA…` della stessa persona non si uniscono mai — APERTO · bug · MAJOR

**Cosa.** `compatible()` (`src/db/identity.ts:60-62,93-95,198`) confronta gli id come stringhe e blocca il merge
anche sullo slug canonico dopo l'arricchimento. Rompe l'edge case FLOW "reazione + dipendente: un prospect" e la
mitigazione dichiarata in TD-1. Le note legacy riportano 134 profili reali `ACwAA` da harvestapi in modalità Short
(quella di default). Escala TD-1.

**Evidenza.** Sourcing `giulia-test` + `ACwAA…` e reazione `ACoAA…` → arricchimento con lo stesso slug →
`mergedIds: []`. Manca un'evidenza reale: un item harvestapi Short e l'`urn` di profile-detail.

**Come chiudere.** Id con prefisso di tipo diverso = non confrontabili (non in conflitto); in arricchimento vince lo
slug canonico del provider. Raccogliere l'evidenza reale richiede un run minimo a pagamento (harvestapi Short con
`maxItems` 3 e un solo profile-detail): va autorizzato esplicitamente.

### TD-38 (M11) — La home richiede anche un prospect per portare all'Inbox — DECISIONE APERTA · bug · MAJOR

**Cosa.** Il redirect `/` → `/inbox` (`web/src/routes/index.tsx:26`) richiede profilo + ICP + almeno un prospect,
mentre FLOW (entry point ed edge case "DB vuoto ma profilo/ICP presenti") chiede solo profilo + ICP: l'Inbox vuota
con "Sincronizza ora" non si raggiunge dalla home. Deviazione dichiarata nel log di T13, mai registrata qui.

**Come chiudere.** Decidere: allineare la condizione al FLOW, oppure registrare la scelta e aggiornare il FLOW.

## Voci dall'adversarial-review: MINOR e NIT

Tutte APERTO. Evidenze e probe nel [[specs/prospect-crm/crm-foundation/REPORT|REPORT]] alla stessa sigla.

### MINOR

| TD | Rif. | Dove | Problema | Come chiudere |
|----|------|------|----------|---------------|
| TD-39 | m1 | `src/db/schema.ts:106,221`, `src/db/index.ts:14` | Nessun versioning dello schema: un `crm.db` senza `member_urn` fa fallire `applySchema` all'import (server, figlio, `db:init`); `ensureColumn` mai usato. Teorico finché non esiste `data/crm.db`. | `PRAGMA user_version` + `ensureColumn` prima dell'indice. |
| TD-40 | m2 | `src/config.ts:79`, `src/server/jobs.ts:106` | `DB_PATH=` vuoto → DB in memoria (dati persi, `db:init` dice ok); `DB_PATH` relativo risolto con cwd diversi tra server e figlio; nessun rifiuto di `data/sevedemo.db`. | `path.resolve(ROOT, env \|\| default)`; rifiutare `sevedemo*.db`. |
| TD-41 | m3 | `scripts/e2e-server.ts:23,32` | Symlink + sottocartella inesistente (`/tmp/link/sub/crm.db` → `data/`) supera il guard e crea `data/sub/`. | Coperto dal guard di TD-24. |
| TD-42 | m4 | `src/jobs/fake-deps.ts:462-463` | Il guard di riserva di reset/seed è uno `startsWith` di stringhe (case, relativo e symlink passano). | Riusare il guard di TD-24. |
| TD-43 | m5 | `src/jobs/deps.ts:11`, `src/config.ts:1` | `E2E_FAKE_JOBS=1` nel `.env` reale o nella shell attiva le deps fake nel server di prodotto su `data/crm.db` (profili sintetici e analisi di fixture scritti su prospect veri). | Rifiutare le deps fake con DB dentro `data/`, o attivarle solo da `scripts/e2e-server.ts`. |
| TD-44 | m6 | `scripts/e2e-server.ts` | Il guard del percorso all'avvio è codice top-level senza test. | Estrarlo e testarlo (TD-24). |
| TD-45 | m7 | `src/apify/client.ts:24` | `.call(input)` senza `{ log: null }`: dopo un restart del server il figlio muore di `EPIPE` (run Apify perso, "Riprova" ripaga); con un errore di rete all'avvio del run una rejection non gestita stampa `Authorization: Bearer <token>` nel terminale (non salvato). | `call(input, { log: null })`; handler `unhandledRejection` che logga solo il messaggio. |
| TD-46 | m8 | `src/server/jobs.ts`, `src/db/jobs.ts:75-86` | Il pid salvato è il launcher `tsx`: un nipote orfano può finire dopo che il job è `failed` e ribaltarlo a `succeeded`. | `job-entry` salva `process.pid` all'avvio (con TD-31). |
| TD-47 | m9 | `src/server/routes/prospects.ts:138-149`, `src/db/lists.ts:157-175`, FLOW Error paths | Le azioni in blocco sono transazioni atomiche: il percorso FLOW "10 riusciti · 2 errori + Riprova i falliti" non è implementabile (un errore annulla tutto e la UI conserva l'intera selezione). | Isolamento per item con risultati per id, oppure decisione registrata e FLOW aggiornato. |
| TD-48 | m10 | `src/exports/list-export.ts:313-319` | "Scarica di nuovo" re-invia prospect nel frattempo scartati o rimossi; l'export dell'intera lista include gli scartati; nessuna API per cancellare un prospect (richieste GDPR solo via SQL). | Escludere gli scartati al ri-download o avvisare; decidere sulla cancellazione. |
| TD-49 | m11 | `src/server/app.ts:30,50` | `/api/health` espone il percorso assoluto del DB; `onError` restituisce `err.message` grezzo sui 500. | Togliere `db` dalla risposta (o solo in dev); messaggio generico sui 500. |
| TD-50 | m12 | `src/analysis/prompt.ts:122,132-134,180` | I delimitatori `<profilo>`/`<segnali>` sono falsificabili dal testo del profilo o dei commenti. Mitigato (testo non fidato solo nel turno utente, output strutturato, nessun tool), ma fit e angoli alimentano filtro e CSV. Nessun test. | Escape dei tag o boundary casuale/JSON; istruzione finale nel system prompt; test con `</profilo>` forgiato. |
| TD-51 | m13 | `src/server/routes/prospects.ts:35`, `lists.ts:16`, `exports.ts:28`, `analyze.ts:22`, `enrich.ts:18`, `companies.ts:106` | `z.coerce.number()` sugli id nei body JSON: accetta booleani, array ed esadecimali (`["0x1", true, [2]]` → `added 2`). | `z.number().int().positive()` nei body; coercizione solo per query e path. |
| TD-52 | m14 | `src/jobs/analyze.ts:186-192` | Con prezzo profile-detail `null` e `to_enrich > 0` la preview di analisi dà comunque un `est_cost_usd` numerico (solo analisi) invece di `null`. | `null` con warning, o stime separate. |
| TD-53 | m15 | `src/jobs/source-company.ts:64`, `src/apify/actors.ts:87` | `EMPLOYEES_PER_COMPANY` da env non limitato: `0` → `maxItems:0` = fino a 2500 persone via API (la UI lo blocca). | Clamp/validazione 1–2500. |
| TD-54 | m16 | `src/enrich/profile-detail.ts:124-125`, `src/jobs/enrich.ts:165-176` | Item senza URL canonico leggibile scartati come "nessun dato" (con un cambio di schema tutti non arricchibili e ripagati al retry); il timeout inline di 120 s abbandona un run forse fatturato. | Chiave sull'URL di input anche senza canonico + warning di esito sospetto. |
| TD-55 | m17 | `src/db/identity.ts:153`, `src/exports/list-export.ts:307-319` | Il merge non riscrive `exports.prospect_ids`: dopo un merge il ri-download perde il prospect (1 riga → 0). | Sostituire `dropId` con `keepId` (dedup) nella transazione di merge. |
| TD-56 | m18 | `src/util/fields.ts:28-48`, `src/db/identity.ts:29` | La chiave d'identità accetta qualunque path linkedin.com: `/company/acme/` crea un prospect, `/in/x/details/experience` un secondo. | `normalizeProfileUrl` che rifiuta i path diversi da `/in/`. |
| TD-57 | m19 | `src/db/identity.ts:153-171` | Il merge scarta in silenzio i valori in conflitto del duplicato (email inserita a mano, `reaction_type` della fonte). | COALESCE sulle fonti in conflitto prima del delete + nota con i valori scartati. |
| TD-58 | m20 | `web/src/components/ProspectTable.tsx:113` | Tooltip delle fonti con `reaction_type` in inglese (LIKE, PRAISE) in Inbox e Lista; il dettaglio prospect ha già la mappa italiana (`prospects.$id.tsx:456-463`). | Helper di label condiviso. |
| TD-59 | m21 | `web/src/components/JobBanner.tsx:153-163`, `web/src/routes/settings.tsx:639-663` | Manca il link a `/settings#profilo` nell'esito "profilo mancante" (FLOW Error paths). | Link nell'esito `config:` del profilo. |
| TD-60 | m22 | `web/src/components/filters/emailOptions.ts:1-9`, `web/src/components/filters/FilterBar.tsx:22` | Commenti legacy che citano route cancellate (`contacts.index.tsx`, `selections.$date.tsx`) e il termine "Bucket". | Aggiornare i commenti. |
| TD-61 | m23 | `tests/e2e/smoke.md`, questo file | Gli screenshot dello smoke (`t18-*.png`) non sono versionati: le prove FE non sono verificabili dal solo repository. | Versionare un sottoinsieme di evidenze o accettare il limite. |

### NIT

| TD | Rif. | Dove | Problema |
|----|------|------|----------|
| TD-62 | v2 | `src/db/schema.ts:158-159`, `tests/schema.test.ts` | Fonti `manual` con `post_id`/`company_id` sfuggono a `ux_sources_manual`; mancano test FK (SET NULL/RESTRICT/CASCADE) e di riapertura del file. |
| TD-63 | v7 | `src/analysis/schema.ts:43-68` | Le keyword JSON schema rimosse sono verificate solo da unit test, non contro l'endpoint reale (fallirebbe in modo rumoroso). |
| TD-64 | v8 | `src/server/http.ts:37-41`; `web/src/routes/settings.tsx:430`, `prospects.$id.tsx:495`; `src/db/companies.ts:42,113-116`; `src/util/csv.ts`; `src/util/fields.ts:35` | `idParam` accetta `1e0`/`0x1`; `post_url` e `website` senza allow-list di schema (solo React 19 blocca `javascript:`); LIKE non escapato nella ricerca aziende; CSV con spazio prima di `=`; host `evillinkedin.com` accettato (riscritto a www.linkedin.com). |
| TD-65 | v9 | `.gitignore:3` | Ignorato solo `.env`, non `.env.*`. |
| TD-66 | v10 | `.gitignore`; letterali di test | `data/` coperto solo dai pattern `*.db`; domini di test verosimili (`acme.it`, `johnsmith`). |
| TD-67 | v12 | `src/server/routes/lists.ts:71-76`, `prospects.ts:135-151`, `icps.ts:91-98` | Risposte più ricche di `{ok:true}` per add/remove/bulk; PUT upsert dei riferimenti sempre 200 (coerenti col client). |
| TD-68 | v1 | `src/jobs/sync-interactions.ts:358-368`; `src/util/fields.ts` | `prospects_new` conta anche righe che hanno assorbito un duplicato; slug NFC e NFD diversi. |
| TD-69 | v4 | `src/jobs/fake-deps.ts:483` | Il reset e2e riusa gli id dei job (finestra ≤ 500 ms). |
| TD-70 | v5 | `web/src/components/AnalysisCard.tsx:97`; `tests/source-company.test.ts:9,260,278`; `src/server/routes/enrich.ts:20`, `analyze.ts:24` | "Rianalizza" sempre `force:true`; POST di avvio nei test senza override di spawn; `MAX_IDS` 1000 lato server contro il cap 500 di P9. |
| TD-71 | v16 | `brain/index.md:35`, `brain/specs/prospect-crm/prospect-crm-specs.md:23` | `crm-foundation` ancora "In progress" (finalizzazione in sospeso). |
