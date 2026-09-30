# Smoke end-to-end profilo e servizi — M1a (own-profile-services T7)

Smoke funzionale con `agent-browser` della tappa **M1a** (invalidazione) del
[PLAN](../../brain/specs/prospect-crm/own-profile-services/PLAN.md): i due casi opposti di F7/F13, i due conteggi e il
blocco di F8, il badge che sparisce al rilascio e **ricompare** col testo nuovo (la metà di FLOW F.6 che appartiene
a questa tappa), C7/C9/C15 sui post. Server, seed e trigger: [README](README.md) (scenario own-profile-services del
seed). Nessuna chiamata ad Apify, Anthropic, Apollo o Cloudflare. Per ogni riga: **OK / attrito / bug**.

Ultima esecuzione: **2026-09-29** (T7). Esito: **17 righe OK**, nessun BLOCKER, nessun bug. Nessun segreto nei log
dei run (0 occorrenze dei token finti in log e dettagli di 20 run).

## Precondizioni e comandi

```bash
UI_PORT=8841 E2E_FAKE_DELAY_MS=200 npm run e2e:server
API_URL=http://localhost:8841 npm --prefix web run dev -- --port 5241 --strictPort
curl -s -X POST localhost:8841/api/e2e/seed        # own_profile: {truncated_post_id, complete_post_id, stale_id, analyzed_ids}

ab() { agent-browser --session op-t7 "$@"; }
ab open http://localhost:5241/ && ab set viewport 1280 1000
```

**Reset del badge (S5).** Il server e2e azzera il DB all'avvio e non passa dal backfill: la prova usa l'**entry reale**
`src/server/index.ts` su una copia scratch del DB e2e resa "pre-rilascio" (tutte le `subject_hash` a `NULL`, l'input
di Luca Bernardi diverso da oggi), con job e token finti:

```bash
DB_PATH=$TMPDIR/crm-smoke-reset/crm.db UI_PORT=8842 E2E_FAKE_JOBS=1 APIFY_TOKEN=e2e-finto ANTHROPIC_API_KEY=e2e-finto \
  APOLLO_API_KEY=e2e-finto DOTENV_CONFIG_PATH=/dev/null npx tsx src/server/index.ts   # serve anche web/dist
```

Processi fermati per PID (server: `npm` → `tsx` → `node`; Vite: `npm` → `vite`), sessioni chiuse con `ab close`.
Evidenze: `t7/NN-*.png` nella cartella scratch della sessione (non versionate).

### Gotcha di automazione (non bug del prodotto)

- Bottoni fuori viewport (Salva azienda, Arricchisci, Analizza… della barra dei selezionati): `ab click` risponde
  `✓ Done` senza cliccare. Sempre `ab scrollintoview @ref` prima.
- Un toast dell'esito copre la barra "Azioni sui selezionati": chiuderlo (`button[aria-label="Chiudi notifica"]`).
- In zsh le variabili non si spezzano in parole: `kill $PIDS` con più PID in una stringa fallisce; un PID per volta.

## Righe

| # | Riga (FLOW / criterio) | Passi | Esito |
|---|---|---|---|
| S1 | F13 — la persona cambiata dopo l'analisi (seed) | Scheda di Elena Sartori | **OK**: badge *da aggiornare* + *"Questa persona è cambiata dopo l'analisi."*; **Rianalizza** secondario (outline) |
| S2 | F7 — seed, nessun cambio | Schede di Luca Bernardi e Marco Ferri | **OK**: nessun badge, nessuna riga |
| S3 | F7 — modifica della mia azienda | Impostazioni → La mia azienda: *Di cosa si occupa* e *Cosa offri* cambiati, **Salva azienda** (*"Azienda salvata"*) | **OK**: Luca e Marco senza badge; Elena ancora col suo |
| S4 | F7, P-6 — ICP modificato e rinominato | ICP → nome *"CTO di PMI manifatturiere (Nord)"*, **Salva ICP** | **OK**: Luca e Marco senza badge; Elena invariata |
| S5 | F.6 — il reset al rilascio | Entry reale su copia pre-rilascio (vedi sopra) | **OK**: console *"Impronta della persona calcolata per 3 analisi dai dati di oggi…"*; Elena e Luca (col criterio vecchio "da aggiornare") **senza** badge |
| S6 | F.6, F13 — il badge ricompare | Scheda di Luca → **Arricchisci** → **Avvia arricchimento** (*"Arricchimento: 1 arricchito"*) | **OK**: badge + *"Questa persona è cambiata dopo l'analisi."*, **Rianalizza** secondario |
| S7 | F8 — selezione di tre già analizzate, casella spenta | Persone → Luca, Marco, Elena → **Analizza…** → ICP | **OK**: *"3 selezionati · 0 da analizzare"*, *"3 persone hanno già un'analisi per questo ICP: restano fuori."*, $0,00; **Avvia analisi** disabilitato con *"Nessuna persona da analizzare: tutte e 3 hanno già un'analisi per questo ICP. Per rifarle spunta «Includi chi è già analizzato»."* |
| S8 | F8 — casella **"Includi chi è già analizzato"** | Spunta nella stessa anteprima | **OK**: *"Da rifare: 3 · Input identico, saltate comunque: 0."*, stima ≈ $0,09, **Avvia** attivo. Dopo S3 nessuna analisi ha più l'input identico (rischio dichiarato in PLAN §12: la descrizione della casella non promette niente) |
| S9 | G-12 — zero da rifare | Giulia Marchetti e Paolo Ranieri analizzati con un job, poi selezionati + casella | **OK**: *"Da rifare: 0 · Input identico, saltate comunque: 2."*, **Avvia** disabilitato con *"Nessuna delle 2 ha dati diversi da quando è stata analizzata: non ci sarebbe nulla da rifare."* |
| S10 | F8, P-9 — precedenza casella > lista filtrata | T4: Lista 1 → **Analizza…** (prop `onlyMissing`) + casella | **OK**: *"Da rifare: 2"*: i parametri inviati hanno `onlyMissing: false` |
| S11 | C6 — post misti nel seed | DB e2e dopo il seed | **OK**: post 1 estratto troncato (301, `text_complete = 0`), post 2 integrale (252, `1`) |
| S12 | C7, C9 — il testo integrale arriva solo da un sync chiesto dall'utente | I miei post → **Sincronizza interazioni** → *Risincronizza tutto* → **Avvia sync** | **OK**: post 1 conservato intero (363, `1`); nessun sync partito da sé prima |
| S13 | C15 — I miei post (corpo e testo al passaggio del mouse) | I miei post dopo S12 | **OK**: corpo su 2 righe, `title` 301 e 252 caratteri (come prima del rilascio) |
| S14 | C15 — etichetta del post in Persone | Persone → **Altri filtri** → *Post* | **OK**: *"Migrare al cloud senza fermare la produzione: 5 …"* (48 + …) |
| S15 | C15 — fonti di righe e scheda | `GET /api/prospects` e scheda di Giulia Neri (reazione al post 1) | **OK**: righe ≤ 121, scheda 301 (estratto di prima) |
| S16 | C15 — anteprima di unione | `GET /api/prospects/21/merge-preview?otherId=20` (le due Giulia Neri) | **OK**: *"Reazione a 'Migrare al cloud senza fermare…'"* (30 caratteri) |
| S17 | G8 — testi nuovi in italiano; nessun segreto nei log | Tutti i testi introdotti da M1a; log e dettagli dei run delle due istanze | **OK** |
