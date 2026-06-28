---
domain: lead-engine
type: spec
status: implemented
links:
  - "[[specs/lead-engine/progressive-enrichment/SPEC|progressive-enrichment]]"
ingested: true
last_ingested: 2026-06-28
created: 2026-06-17
updated: 2026-06-17
---

# Influencer Post Respondents — fonte primaria azienda-first

> ⚠️ Scaffold creato da `create-plan` come **epic anchor** del `PLAN.md` affiancato.
> È volutamente in **problem-space** e minimale: approfondiscilo con `create-spec`
> prima dell'implementazione se serve più dettaglio sui requisiti.

## Problema

`data/seeds/influencers.json` (profili LinkedIn influenti nel tech recruiting IT
italiano) deve diventare **la prima fonte** da cui estrarre lead, soprattutto
**aziendali** (decision-maker). Oggi esiste già una strategia che legge quel seed
(`freelance-post-reactors`) ma **non ritorna alcun valore nel "Report strategie"**:
estrae 0 contatti perché chiama actor `harvestapi` per post/reazioni che non
rendono, mentre l'operatore ha validato `apimaestro/linkedin-profile-posts`.

## Cosa serve (il *what*, non il *how*)

1. **Estrarre chi RISPONDE ai post** degli influencer — i **commentatori** (segnale
   d'intento più caldo), non più i soli reactor.
2. **Estrarre le entità taggate** nel testo dei post (`text_annotations`): le
   **persone** come candidati, e le **aziende** espandendole subito ai loro
   decision-maker (CEO/CTO/HR…).
3. Questa fonte è **primaria**: budget dominante, eseguita per prima, con
   **priorità al bucket azienda** in selezione (i freelance restano ammessi ma
   secondari).
4. L'operatore deve poter **testare e ottimizzare**: il "Report strategie" deve
   mostrare la fonte **anche a 0 estratti**, distinguere "ha girato ed è vuota" da
   "errore / mai girata", e attribuire l'esito per **sotto-fonte**
   (commento / persona-taggata / espansione-azienda).

## Criteri di accettazione

- **AC1** — Un run della strategia `influencer-post-respondents` sui 2 influencer
  del seed produce **> 0 candidati commentatori** reali (smoke con apimaestro).
- **AC2** — Le persone e le aziende taggate nei post diventano candidati: le persone
  direttamente, le aziende via people-search dei loro ruoli decisionali.
- **AC3** — Nel run giornaliero la fonte è eseguita **per prima** e riceve la quota
  **maggiore** di `POOL_SIZE`; il budget non consumato (volume basso) **rifluisce**
  alle altre strategie senza ridurre il totale estratto.
- **AC4** — A parità di fit, in bucket **azienda** i candidati di questa fonte sono
  **selezionati prima** degli altri.
- **AC5** — Il "Report strategie" mostra una **riga** per la strategia anche con
  `estratti = 0`, distinguendo: mai-girata / girata-pulita-0 / tutti-duplicati /
  errore; e mostra l'attribuzione per **sotto-fonte**. CLI e UI restano **un'unica
  fonte, due viste**.
- **AC6** — Nessuna regressione: le altre strategie, la selezione 20+20, i gate geo
  e l'import esiti continuano a funzionare.

## Fuori scope (per ora)

- Pesatura **dinamica** guidata dall'evaluation (resta lever manuale — vedi
  [[domains/lead-engine/06-evaluation]]); qui il peso è **statico**.
- Attribuzione per-influencer / per-post; storico per-import.
- Trattare le aziende come lead email a sé (sono espanse a persone).
