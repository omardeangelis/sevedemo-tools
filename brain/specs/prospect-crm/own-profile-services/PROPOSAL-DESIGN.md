---
domain: prospect-crm
type: design-brief
links:
  - "[[specs/prospect-crm/own-profile-services/FLOW|FLOW]]"
  - "[[specs/prospect-crm/own-profile-services/UX-REVIEW|UX-REVIEW]]"
  - "[[chore/motion-stack|motion-stack]]"
created: 2026-10-03
updated: 2026-10-03
---

# Design brief: revisione della proposta (`#proposta`) e card «Genera profilo e servizi» (`#genera`)

> Il **flusso e i testi** sono del [[specs/prospect-crm/own-profile-services/FLOW|FLOW]] (sezioni "Revisione
> 2026-10-03") e non si ridiscutono qui. Questo brief decide la **forma**: gerarchia, anatomia di ogni stato,
> classi Tailwind esatte, componenti shadcn, e il **motion budget**. Dove la forma sposta l'ordine di un blocco
> rispetto al FLOW lo dice in §5, e la scelta passa all'orchestratore (§6).
>
> Base: `ProposalSection.tsx`, `GenerateCard.tsx`, `ui.tsx` (`Card`), `ui/button.tsx`, `ui/badge.tsx`, `parts.tsx`
> (`textareaCls`, `Origin`), `AnalysisCard.tsx` (form in riga di "Il mio fit", `SparklesIcon` per l'AI),
> `ServicesCard.tsx` (dialog dei servizi, toggle "Dettagli"), `styles.css`; screenshot del round UX 2026-10-03
> (`15-…`, `16-…`, `10-…`, `18-…`, `19-…`, `04-…`) e quello dell'utente sulla proposta reale.
> Stack: [[chore/motion-stack|motion-stack]] (React 19, Tailwind 4 + `tw-animate-css`, shadcn `radix-nova` su
> `radix-ui` 1.6, nessuna libreria di motion).
>
> **Personalità assunta** (nessun `brain/chore/motion.md`): strumento professionale, usato ogni giorno, nitido e
> veloce. Questo flusso è **occasionale** (poche volte al mese) ma decisivo: si spende un po' di cura in più sulla
> chiarezza, quasi niente sul movimento.

---

## 1. Direzione visiva

Cosa non va oggi (screenshot): sette bottoni neri uguali; ogni riga è una scala di etichette impilate ("Ora" /
"vuoto" / "Proposta") che raddoppia l'altezza; le righe applicate perdono il testo; la testata è un muro di frasi e
le azioni sono disposte a caso; il conflitto pesa quanto il resto.

Cinque principi, nell'ordine in cui decidono i conflitti tra loro:

1. **La proposta è l'unica cosa "da fare" della pagina.** Accento sky (bordo `sky-200`, anello `sky-100`, già
   così) finché è aperta; chiusa, torna una card come le altre (`slate-200`). Il colore dice lo stato della
   sezione, non decora.
2. **Un solo peso forte.** Un solo bottone pieno nella sezione: l'azione di massa. Tutti i verbi di riga sono
   `outline` `sm`, uguali tra loro e sempre nello stesso ordine; le azioni sulle righe decise sono `ghost`.
3. **Lo stato passa per tre canali, mai solo uno:** la **parola** (sempre, dentro il nome accessibile), il
   **colore** del badge, l'**icona** dello slot (✓ ✎ ✕, sempre `aria-hidden`). L'icona che premi diventa il
   marcatore della riga decisa: Applica ✓ → "✓ applicato".
4. **Il confronto si legge in colonna.** Le etichette ("Ora", "Proposta", i campi di un servizio) stanno in una
   colonna fissa a sinistra (`6rem`); i testi partono tutti dalla stessa x e sono larghi al massimo `68ch` (oggi un
   paragrafo corre per ~120 caratteri). Una **riga verticale** di 2px a sinistra di ogni testo dice **di chi è**:
   `slate-200` = il valore di oggi · `amber-300` = scritto da te (solo nei conflitti) · `sky-400` = la proposta.
5. **Deciso = arretra.** Una voce da decidere è bianca, a contrasto pieno, con i testi interi. Una voce decisa è
   una riga compatta su `bg-slate-50/70`, testo `slate-600`, una frase che dice la conseguenza e **Annulla** a
   destra. Scorrendo, bianco = da fare, grigio = fatto.

### 1.1 Colori di stato

Riusa la mappa già nell'app (candidate per ICP: `proposta` sky · `accettata` emerald · `scartata` slate) e il
callout ambra già usato da E14 e da H5.

| Stato | Dove | Classi |
| --- | --- | --- |
| Nuovo | Badge | `<Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">` |
| Modificato | Badge | `<Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">` |
| In conflitto | Badge | `<Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">` |
| Nota E14 sulla riga ("compilato da prima del 2 ott: …") | testo dopo il badge | `text-xs font-normal text-amber-800` |
| applicato · applicato con le tue modifiche · aggiunto · aggiornato | parola di stato + icona | parola `font-medium text-emerald-700`; icona `text-emerald-600` |
| rifiutato · hai tenuto il tuo testo / servizio | parola di stato + icona | parola `font-medium text-slate-600`; icona `text-slate-400` |
| Avanzamento | barra | traccia `bg-slate-100`, riempimento `bg-sky-500` |
| "2 in conflitto" nella striscia | testo | `text-amber-800` |

Il **conflitto pesa di più senza urlare**: sta in cima (FLOW), ha il badge ambra e il suo "Ora" ha la riga ambra
(è testo tuo). Niente rosso (il rosso è degli errori), niente sfondo colorato sulla riga intera, nessuna icona di
pericolo.

### 1.2 Tipografia e spaziatura

| Elemento | Classi |
| --- | --- |
| Titolo della sezione (`h2`) | `text-base font-semibold text-slate-900` (un gradino sopra i titoli delle card, `text-sm`: è la decisione in sospeso della pagina) |
| Provenienza, frase del modello | `text-sm text-slate-600` / `text-xs text-slate-500` |
| Intestazione di gruppo (`h3`) | nome `text-xs font-semibold tracking-wide text-slate-500 uppercase`; conteggi in `span` `font-normal tracking-normal normal-case` (oggi i conteggi in maiuscolo urlano) |
| Nome della voce (`h4`) | `text-sm font-semibold text-slate-900` |
| Fonti della voce | `text-xs text-slate-500` |
| Etichette della colonna ("Ora", "Proposta", "Descrizione"…) | `text-xs/5 font-medium text-slate-500` ("Proposta" e "Si aggiunge" `text-sky-700`) — `text-xs/5` allinea la prima riga con il testo `text-sm/5` accanto |
| Testi confrontati | `text-sm whitespace-pre-line` (`slate-600` Ora · `slate-700` Ora in conflitto · `slate-900` Proposta) |
| Padding | testata e lista `px-4` (come `Card`); riga da decidere `px-4 py-4`; riga decisa `px-4 py-3`; gruppi distanziati `gap-6` |

### 1.3 Icone (`lucide-react`, tutte `aria-hidden="true"`)

| Icona | Uso |
| --- | --- |
| `SparklesIcon` `size-4 text-sky-600` | accanto al titolo della proposta aperta (stesso segno dell'AI di `AnalysisCard`) |
| `CircleCheckIcon` `size-4 text-emerald-600` | accanto al titolo del riepilogo (proposta chiusa) |
| `CheckIcon` · `PencilIcon` · `XIcon` | slot 1 · 2 · 3 della barra dei verbi, e marcatore della riga decisa |
| `Undo2Icon` | **Annulla** sulle righe decise |
| `ChevronDownIcon` / `ChevronUpIcon` | **Mostra** / **Nascondi** degli invariati, **Esito per fonte** |
| `ArrowDownIcon` `size-3.5` | link nella stessa pagina verso il basso (**Rivedi la proposta** dalla card, **Vedi il profilo aggiornato**) |

Nei bottoni l'icona porta `data-icon="inline-start"` (o `inline-end` per il chevron): il `Button` di `radix-nova`
corregge già il padding con `has-data-[icon=…]`.

---

## 2. Anatomia per stato

### 2.1 Sezione aperta: testata e striscia di avanzamento

```
┌─ section#proposta  (bordo sky) ──────────────────────────────────────────────────────────────┐
│ ✦ Proposta del 4 ott, 09:40                                                         ← h2      │
│ Da 3 fonti su 3 · 1 voce lasciata fuori perché senza fonte.                                   │
│ Decidi voce per voce: Applica, Modifica o Rifiuta. Ogni decisione si annulla dalla sua riga;  │
│ la proposta si chiude quando non resta niente da decidere.                                    │
│ ┌ ambra ───────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Nome e Di cosa si occupa sono compilati da prima del 20 set: «Applica tutte le 11 voci»    │ │
│ │ li sostituisce. Il testo attuale è nella loro riga.                                        │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
├─ striscia (sticky) ──────────────────────────────────────────────────────────────────────────┤
│ Decise 4 di 6 · ne restano 2, 2 in conflitto  ▰▰▰▰▱▱      [Applica le 4 voci senza conflitto] │
│                                                            [Rifiuta le 6 voci da decidere…]   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                          I 2 conflitti restano fuori: decidili uno per uno.  │
│ CAMPI DEL PROFILO · 3 da decidere · 3 invariati                                               │
│ ┌────────────────────────────────────────────────────────────────────────────────────────┐   │
```

(a 1280 px i due bottoni stanno sulla stessa riga dell'avanzamento; sotto i ~900 px vanno a capo, a destra.)

- **`section`** `id="proposta" aria-labelledby` →
  `scroll-mt-6 rounded-xl border border-sky-200 bg-white shadow-sm ring-1 ring-sky-100 transition-[border-color,box-shadow] duration-200 ease-[ease]`.
  Struttura: **tre figli diretti** — blocco testata, striscia, lista. La striscia deve essere figlia diretta della
  `section`, altrimenti `sticky` si ferma alla fine del suo contenitore.
- **Blocco testata** `flex flex-col gap-1.5 px-4 pt-4 pb-3`:
  - riga del titolo `flex items-center gap-2`: `SparklesIcon` + `h2` `tabIndex={-1}`
    `scroll-mt-6 rounded-sm text-base font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2`;
  - provenienza `p.text-sm.text-slate-600`;
  - frase del modello `p.text-xs.text-slate-500`;
  - riga E14 (solo se c'è) `p.mt-1.rounded-lg.bg-amber-50.px-3.py-2.text-sm.text-amber-900.ring-1.ring-amber-200.ring-inset`
    con `id` (entra nell'`aria-describedby` del bottone primario); al suo posto, su un profilo vuoto, la frase
    *"Non hai scritto nulla a mano…"* in `p.text-sm.text-slate-600` (rassicura, non avvisa: niente riquadro).
- **Striscia** `sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-slate-100 bg-white/95 px-4 py-2.5 supports-backdrop-filter:backdrop-blur-sm`:
  - avanzamento `div.flex.items-center.gap-3`:
    `p.text-sm.text-slate-700` → `span.font-semibold.text-slate-900.tabular-nums` *"Decise 4 di 6"* + *" · ne restano
    2, "* + `span.text-amber-800` *"2 in conflitto"* (testo normale, non live: FLOW);
    barra `div aria-hidden="true"` `h-1.5 w-24 overflow-hidden rounded-full bg-slate-100` con dentro
    `div` `h-full w-full rounded-full bg-sky-500 transition-transform duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none`
    e `style={{ transform: \`translateX(${(decided / total - 1) * 100}%)\` }}` (traslazione, non `scaleX`: la punta
    arrotondata non si deforma);
  - azioni `div.ml-auto.flex.flex-wrap.items-center.gap-2`, ordine DOM = ordine visivo (FLOW):
    `<Button>` (default, `size="default"`) **Applica tutte le 11 voci / le 10 voci rimaste / le 4 voci senza conflitto**,
    `aria-describedby` = id dell'hint (+ id della riga E14 se c'è);
    `<Button variant="outline">` **Rifiuta le 11 voci da decidere…**. Nessuna icona: le etichette sono già lunghe e
    precise.
  - Con **una sola** voce da decidere la striscia ha solo *"Resta 1 voce da decidere"* + barra, nessun bottone (FLOW C.2).
  - Bulk disabilitato (restano solo conflitti): `aria-disabled="true"` (mai `disabled`), click ignorato nel
    handler, il motivo nell'hint.
- **Hint delle azioni** (non sticky) `p` con `id`, `px-4 pt-2 text-xs text-slate-600 sm:text-right` — una frase per
  volta: *"I 2 conflitti restano fuori: decidili uno per uno."* · il motivo del disabilitato · *"1 voce in modifica
  resta fuori."* (accodata). Errore dell'azione di massa subito sotto: `p role="alert" px-4 pt-1 text-sm text-red-700 sm:text-right`.

Perché la striscia è sticky: il segnale di successo 6 del FLOW vuole l'avanzamento **"in ogni momento"**. Con 11
voci con i paragrafi la lista occupa 3–4 schermate e, alla quarta voce, testata e conto non si vedono più. La
striscia resta in alto solo finché si scorre dentro la sezione (vincolo naturale di `sticky`) e non ha effetti
legati allo scroll. **Trappola:** quando il focus va su un titolo di voce, la striscia lo coprirebbe → `scroll-mt-20`
su ogni `h4` (§2.3).

### 2.2 Gruppi

```
CAMPI DEL PROFILO · 2 da decidere · 1 deciso · 3 invariati
┌─────────────────────────────────────────────────────────────────────────────┐
│ voci da decidere (In conflitto → Nuovo → Modificato)            bg-white    │
├─────────────────────────────────────────────────────────────────────────────┤
│ voci decise, ognuna al suo posto durante la visita              bg-slate-50 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Invariati (3): Nome, Di cosa si occupa, Prove e risultati          Mostra ⌄ │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Lista** `div.flex.flex-col.gap-6.px-4.pt-3.pb-4`; ogni gruppo `section aria-labelledby` `flex flex-col gap-2`.
- `h3` `flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase`
  → *"Campi del profilo"* + `span.font-normal.tracking-normal.normal-case` *"· 2 da decidere · 1 deciso · 3 invariati"*.
- `ul` `overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-100`.
- Ogni `li` porta lo sfondo per stato, `transition-colors duration-150 ease-[ease]`: `bg-white` da decidere,
  `bg-slate-50/70` decisa.

### 2.3 Riga di un campo da decidere

```
Nuovo (campo oggi vuoto)
│ Tono di voce  [Nuovo]                                              da: sito, i miei post │
│                                                                                           │
│ Proposta  ┃ Diretto e concreto, in prima persona, con i numeri dei risultati.            │
│                                                                                           │
│ [✓ Applica] [✎ Modifica] [✕ Rifiuta]                                                     │

Modificato (con la nota E14 quando il valore di oggi non ha provenienza)
│ Cosa offri  [Modificato]  compilato da prima del 2 ott: l'azione di massa lo sostituisce   da: sito │
│ Ora       ┃ Assessment tecnico di due settimane, poi un team dedicato…        (riga slate)        │
│ Proposta  ┃ MVP in sei settimane a prezzo fisso, affiancamento del primo CTO… (riga sky)          │
│ [✓ Applica] [✎ Modifica] [✕ Rifiuta]                                                             │

In conflitto
│ Posizionamento  [In conflitto]  con ciò che hai scritto a mano · scritto da te il 28 set          │
│                                                                    da: sito, profilo LinkedIn     │
│ Ora       ┃ Il CTO a tempo che le startup non possono ancora assumere.        (riga AMBRA)        │
│ Proposta  ┃ La product engineer che porta in produzione il primo prodotto…    (riga sky)          │
│ [✓ Sostituisci il tuo testo] [✎ Modifica] [✕ Tieni il tuo testo]   Fuori dalle azioni di massa.   │
```

- `li data-decide` → `article aria-labelledby` `flex flex-col gap-3 px-4 py-4`.
- **Intestazione** `div.flex.flex-wrap.items-start.justify-between.gap-x-4.gap-y-1`:
  - `h4` `tabIndex={-1}`
    `flex flex-wrap items-center gap-x-2 gap-y-1 scroll-mt-20 rounded-sm text-sm font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2`,
    contiene: il nome · il `Badge` di stato · l'eventuale coda di stato in `span.text-xs.font-normal`
    (`text-slate-600` per il conflitto, `text-amber-800` per E14). Così lo stato è **dentro il nome accessibile**
    con le parole del FLOW, e l'anello di focus abbraccia il testo (oggi è un rettangolo largo quanto la riga);
  - fonti `p.pt-0.5.text-xs.text-slate-500` *"da: sito, i miei post"*.
- **Confronto** `dl` `grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2`:
  - `dt` `text-xs/5 font-medium text-slate-500` *"Ora"*; `dd`
    `max-w-[68ch] border-l-2 border-slate-200 pl-3 text-sm/5 whitespace-pre-line text-slate-600`
    (conflitto: `border-amber-300 text-slate-700`);
  - `dt` `text-xs/5 font-medium text-sky-700` *"Proposta"*; `dd`
    `max-w-[68ch] border-l-2 border-sky-400 pl-3 text-sm/5 whitespace-pre-line text-slate-900`.
  - Campo oggi vuoto: solo la coppia *"Proposta"* (mai *"Ora: vuoto"*, finding 20).
- **Barra dei verbi** §2.4. Errore della riga sotto: `p role="alert" text-sm text-red-700`.
- Riga in **attesa** (dopo il clic, prima della risposta): `aria-busy` sul bottone premuto e `aria-disabled` sui
  tre (FLOW), ma **niente opacità per i primi 300 ms** — `className={cn(!slow && 'aria-disabled:opacity-100')}` —
  e solo dopo 300 ms (`slow`, un timeout) l'icona del bottone premuto diventa lo `Spinner` di `ui.tsx`
  (`size-3.5 border-current border-t-transparent`). In locale la risposta arriva in decine di ms: un'opacità o uno
  spinner che lampeggiano per due frame sono rumore.

### 2.4 Barra dei tre verbi

`div.flex.flex-wrap.items-center.gap-1.5`, tre `<Button variant="outline" size="sm">`, allineati a sinistra sotto
i testi (si legge, poi si decide; e la colonna dei bottoni cade alla stessa x in ogni riga). Nessun primario.

| Slot | Icona | Campo · Nuovo/Modificato | Campo · In conflitto | Servizio · Nuovo | Servizio · Modificato | Servizio · In conflitto |
| --- | --- | --- | --- | --- | --- | --- |
| 1 — prendi la proposta | `CheckIcon` | Applica | Sostituisci il tuo testo | Aggiungi il servizio | Aggiorna il servizio | Sostituisci con la proposta |
| 2 — rielabora | `PencilIcon` | Modifica | Modifica | Modifica… | Modifica… | Modifica… |
| 3 — no alla proposta | `XIcon` | Rifiuta | Tieni il tuo testo | Rifiuta | Rifiuta | Tieni il tuo servizio |

L'icona dice il significato dello slot **rispetto alla proposta** (✕ su "Tieni il tuo testo" = "no alla
proposta", non "via il tuo testo"); l'etichetta dice la conseguenza. Nome accessibile completo (FLOW): *"Rifiuta
Tono di voce"*, *"Tieni il tuo testo per Posizionamento"*… Dopo i bottoni, sulla stessa riga,
`p.ml-1.text-xs.text-slate-500`: *"Fuori dalle azioni di massa."* (conflitti) o *"Si aggiunge in fondo a «I miei
servizi»: l'ordine lo decidi tu."* (servizio nuovo).

Niente `ButtonGroup`: tre bottoni attaccati si leggono come un controllo segmentato (scegli uno stato), qui sono
tre azioni indipendenti.

### 2.5 Modifica in riga (solo campi)

```
│ Cosa offri  [Modificato]                                                          da: sito │
│ Ora       ┃ Assessment tecnico di due settimane, poi un team dedicato…                     │
│             Il tuo testo per «Cosa offri»                                                  │
│             ┌──────────────────────────────────────────────────────────────┐               │
│             │ MVP in sei settimane a prezzo fisso, affiancamento del primo  │  ← focus,    │
│             │ CTO, revisione architetturale prima del round.|               │    cursore   │
│             └──────────────────────────────────────────────────────────────┘    in fondo   │
│             Si salva come scritto da te: la prossima generazione lo mostrerà come          │
│             conflitto invece di sovrascriverlo.                                            │
│             [✓ Applica il tuo testo] [Annulla]                                             │
```

- Il blocco *Proposta* è sostituito **nella colonna dei testi** (stessa x del testo che c'era: continuità senza
  movimento) da `div.col-start-2.flex.flex-col.gap-1.5`:
  - `label` (`htmlFor`) `text-xs font-medium text-slate-700` *"Il tuo testo per «Cosa offri»"*;
  - `textarea` = `textareaCls` +
    `max-w-[68ch] bg-white field-sizing-content min-h-20 max-h-80 resize-y aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`;
    `rows` di ripiego dove `field-sizing` non c'è (Firefox):
    `Math.min(12, Math.max(3, Math.ceil(text.length / 90) + text.split('\n').length - 1))`;
    all'apertura `focus()` e cursore in fondo (`setSelectionRange(len, len)`): si ritocca, non si riscrive;
  - hint `p` (`aria-describedby`) `text-xs text-slate-500`;
  - errore `p role="alert"` `text-sm text-red-700` (+ `aria-invalid` sulla casella);
  - azioni `div.flex.gap-1.5`: `<Button size="sm">` (default) con `CheckIcon` **Applica il tuo testo** ·
    `<Button size="sm" variant="outline">` **Annulla**. Il submit pieno è la convenzione dei form in riga dell'app
    ("Salva fit" in `AnalysisCard`); è l'unica eccezione al "nessuna azione di riga primaria" e vale solo a casella
    aperta (§6, D3).
- La barra dei tre verbi sparisce mentre la casella è aperta; Esc non chiude (FLOW).
- **Servizi**: **Modifica…** apre il dialog dei servizi già esistente (`ServiceDialog`), con titolo e bottone del
  FLOW; nessuna forma nuova.

### 2.6 Riga decisa

```
│ ✓ Tono di voce — applicato                                                      [↶ Annulla] │
│   Diretto e concreto, in prima persona, con i numeri dei risultati.                         │
│ ✓ Cosa offri — applicato · prima: «Assessment tecnico di due settimane, poi un team…»       │
│   Mostra tutto                                                                  [↶ Annulla] │
│ ✎ Cosa offri — applicato con le tue modifiche · prima: «…»                       [↶ Annulla] │
│ ✕ Nome — rifiutato: resta «Officina Codice»                                     [↶ Annulla] │
│ ✕ Posizionamento — hai tenuto il tuo testo                                      [↶ Annulla] │
│ ✓ Sviluppo a progetto — aggiornato: descrizione, a chi serve                    [↶ Annulla] │
```

- `li` (sfondo `bg-slate-50/70`, §2.2) → `article aria-labelledby` `flex items-start gap-3 px-4 py-3`:
  - icona `mt-0.5 size-4 shrink-0` (colore da §1.1): ✓ applicato/aggiunto/aggiornato, ✎ con le tue modifiche, ✕
    rifiutato/tenuto;
  - testo `div.min-w-0.flex-1.flex.flex-col.gap-0.5`:
    - frase del FLOW in `div` `line-clamp-2 text-sm/5 text-slate-600` (senza clamp quando è aperta), che contiene
      `h4` `tabIndex={-1}` `inline scroll-mt-20 rounded-sm font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-ring/50`
      = *"Cosa offri — "* + `span` parola di stato (colore §1.1), poi il resto della frase (*" · prima: «…»"*,
      *": resta «…»"*) come testo normale, **selezionabile** (niente tooltip, FLOW);
    - solo per *"— applicato"* senza "prima" (campo che era vuoto): il testo applicato in
      `p.line-clamp-1.text-sm/5.text-slate-500`;
    - **Mostra tutto** / **Riduci** `button` `aria-expanded` `w-fit text-xs font-medium text-slate-500 underline-offset-2 hover:underline`,
      presente **solo** se un clamp taglia davvero (misura `scrollHeight > clientHeight` dopo il render): toglie i
      clamp, nessuna animazione;
  - **Annulla** `<Button variant="ghost" size="sm" className="shrink-0 text-slate-600">` con `Undo2Icon`, nome
    accessibile *"Annulla la decisione su Nome"*. Errore di Annulla sotto il testo, `role="alert"`
    `text-sm text-red-700`, con il link del FLOW.
- Le stesse parole del FLOW (*"Cosa offri — applicato · prima: «…»"*): la forma le tiene su una riga finché ci
  stanno e le taglia a due righe quando il testo citato è un paragrafo.
- Nota: dopo un'azione di massa il toast (in basso a destra, `w-96`) copre per 8 s l'**Annulla** delle righe
  nell'ultimo centinaio di pixel dello schermo; le decisioni singole non hanno toast. Accettato.

### 2.7 Invariati

```
│ Invariati (3): Nome, Di cosa si occupa, Prove e risultati                         Mostra ⌄ │
│   Nome · uguale al tuo: «Officina Codice»                                       (aperto)   │
│   Di cosa si occupa · uguale al tuo: «Sviluppo software su misura…»                        │
```

- Ultimo `li` del gruppo, radice di `Collapsible` (`asChild`):
  `flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-4 py-2.5 text-sm`:
  - `p.min-w-0.flex-1.text-slate-500` *"Invariati (3): "* + `span.text-slate-700` con i nomi;
  - `CollapsibleTrigger asChild` → `<Button variant="ghost" size="sm">` **Mostra** / **Nascondi** + chevron
    (`data-icon="inline-end"`), nome accessibile *"Mostra i 3 invariati dei campi del profilo"*;
  - `CollapsibleContent asChild` → `ul.basis-full.flex.flex-col.gap-1.5.pt-1.pb-0.5`, ogni voce
    `li.text-sm.text-slate-600` → `span.font-medium.text-slate-700` *"Nome"* + *" · uguale al tuo: «…»"* (un testo
    solo). Nessuna azione.
- Gruppo con soli invariati: l'`ul` contiene solo questa riga. Mai un riquadro vuoto.

### 2.8 Servizi

```
Nuovo
│ Assessment architetturale in 2 settimane  [Nuovo]                        da: sito, i miei post │
│ Descrizione  ┃ Due settimane dentro il codice e l'infrastruttura…                              │
│ A chi serve  ┃ PMI con un gestionale datato…                         (una sola riga sky        │
│ Problema     ┃ Non sapere quanto costa migrare.                       continua: gap-y-0)       │
│ Prove        ┃ 14 assessment in quattro anni.                                                  │
│ [✓ Aggiungi il servizio] [✎ Modifica…] [✕ Rifiuta]  Si aggiunge in fondo a «I miei servizi»: … │

Modificato
│ Sviluppo a progetto  [Modificato]                                                  da: sito │
│ Cambiano descrizione e a chi serve · invariati: nome, problema, prove.                      │
│ Descrizione                                                                                 │
│ Ora       ┃ …                                                                               │
│ Proposta  ┃ …                                                                               │
│ A chi serve                                                                                 │
│ Si aggiunge ┃ …                                          (campo oggi vuoto: finding 20)     │
│ I campi che la proposta non nomina restano come sono.                                       │
│ [✓ Aggiorna il servizio] [✎ Modifica…] [✕ Rifiuta]                                          │

In conflitto
│ Fractional CTO  [In conflitto]  scritto da te il 28 set                            da: sito │
│ Riempie 3 campi vuoti · cambia «A chi serve», scritto da te.                                │
│ (campi come sopra: "Si aggiunge" per i vuoti; per «A chi serve» Ora con riga AMBRA)         │
│ [✓ Sostituisci con la proposta] [✎ Modifica…] [✕ Tieni il tuo servizio]  Fuori dalle azioni… │
```

- Stessa shell della §2.3. Sintesi (*"Cambiano…"*, *"Riempie…"*) in `p.text-sm.text-slate-700` subito sotto
  l'intestazione; *"Corrisponde al tuo servizio «…»…"* (B10) in `p.text-xs.text-slate-600`.
- **Nuovo**: `dl` `grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3` (gap verticale **zero**), `dt`
  `py-1 text-xs/5 font-medium text-slate-500`, `dd` `max-w-[68ch] border-l-2 border-sky-400 py-1 pl-3 text-sm/5 text-slate-900`:
  la riga sky diventa una sola, il servizio si legge come un blocco proposto.
- **Modificato / In conflitto**: `dl.flex.flex-col.gap-3`, per ogni campo che cambia un `div` con
  `dt` `mb-1.5 text-xs font-semibold text-slate-700` (il nome del campo; niente maiuscolo, che resta dei gruppi) e `dd` = il
  confronto della §2.3 (stessa griglia `6rem`). Campo oggi vuoto: la sola coppia `dt` *"Si aggiunge"*
  (`text-sky-700`) + `dd` con riga sky. In conflitto l'"Ora" ha la riga `amber-300`. Coda
  `p.text-xs.text-slate-500` *"I campi che la proposta non nomina restano come sono."*
- Riga decisa: come la §2.6 (*"— aggiunto in fondo a «I miei servizi»"*, *"— hai tenuto il tuo servizio com'è"*…).

### 2.9 Riepilogo di chiusura

```
┌─ section#proposta  (bordo torna slate) ───────────────────────────────────────────────┐
│ ◉ Proposta del 4 ott, 09:40 · chiusa                                       ← h2, focus │
│ Hai deciso tutte le 6 voci: 5 applicate · 1 rifiutata. 4 erano già uguali al tuo       │
│ profilo.                                                                               │
│ Vedi il profilo aggiornato ↓                                                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ CAMPI DEL PROFILO · 3 decisi · 3 invariati                                             │
│ ✕ Posizionamento — hai tenuto il tuo testo                                [↶ Annulla]  │
│ …                                                                                      │
```

- La `section` passa a `border-slate-200 ring-transparent` (stesso `ring-1`, cambia solo il colore: la
  transizione della §2.1 lo accompagna). Torna una card come le altre: niente più da fare qui.
- Blocco testata `flex flex-col gap-1.5 border-b border-slate-100 px-4 pt-4 pb-4`:
  `CircleCheckIcon` + lo **stesso** `h2` (stesso elemento, testo nuovo: *"Proposta del 4 ott, 09:40"* +
  `span.font-normal.text-slate-500` *" · chiusa"*); sotto, un `div` (quello che entra, §4) con
  `p.text-sm.text-slate-700` (frase del FLOW) e il link **Vedi il profilo aggiornato**
  `inline-flex w-fit items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-2`
  + `ArrowDownIcon`.
- Striscia, hint, riga E14 e frase del modello spariscono. Le righe decise restano con **Annulla** (FLOW); un
  Annulla riapre: torna la striscia (senza animazione), il bordo torna sky.

### 2.10 Dialog «Rifiuta le N voci da decidere…»

Il `Dialog` esistente, con i testi del FLOW: `DialogContent` `showCloseButton={false}` `className="sm:max-w-md"`
(il testo è di quattro frasi), focus su **Annulla** (`outline`), conferma `variant="destructive"` **Rifiuta le 6
voci** (stesso peso di "Elimina servizio": è un no a qualcosa che è costato). Errore `role="alert"` nel dialog.
Animazione: quella del primitivo (`duration-100`, fade + `zoom-in-95`), invariata.

### 2.11 Card «Genera profilo e servizi» — solo ciò che fa trovare la proposta

Oggi la proposta comincia a ~700 px (`04-A-done-toast-banner.png`). Con una proposta **aperta**:

```
┌ Genera profilo e servizi ─────────────────────────────────────────────────────────────┐
│ Ultima generazione: 4 ott, 09:40 · fonti lette: profilo LinkedIn, sito, i miei post    │
│ ┌ sky ───────────────────────────────────────────────────────────────────────────────┐ │
│ │ ✦ Proposta in attesa: 4 voci da decidere.                     Rivedi la proposta ↓ │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│ Il CRM legge le tue superfici pubbliche — … Niente viene scritto finché non applichi tu.│
│ Pronte 3 fonti su 3: profilo LinkedIn · sito · i miei post.                             │
│ [Genera di nuovo…]   ← outline mentre c'è una proposta aperta                          │
│ ─────────────────────────────────────────────────────────────────────────────────────── │
│ Proposta pronta: 6 voci da decidere, 2 in conflitto · fonti lette 3 su 3 · …            │
│ Fonti: profilo LinkedIn letta · sito non letto · i miei post letti   [Esito per fonte ⌄]│
│ Elaborazione: claude-… · Vedi il run                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- Callout **subito sotto la riga di stato**:
  `div.flex.flex-wrap.items-center.justify-between.gap-x-3.gap-y-1.rounded-lg.bg-sky-50.px-3.py-2.text-sm.text-sky-900.ring-1.ring-sky-200.ring-inset`
  → `p.flex.items-center.gap-2` (`SparklesIcon size-4 text-sky-600` + *"Proposta in attesa: 4 voci da decidere."*)
  + link `a href="#proposta"` `inline-flex items-center gap-1 font-medium underline underline-offset-2` **Rivedi la
  proposta** + `ArrowDownIcon size-3.5` (focus sul titolo della sezione, §4.4).
- **Genera di nuovo…** diventa `variant="outline"` finché una proposta è aperta: il pieno della pagina è la decisione
  da prendere, non una nuova spesa che la sostituirebbe. Senza proposta aperta resta `default`.
- Tabella per fonte chiusa in una riga (FLOW E.1):
  `div.flex.flex-wrap.items-center.justify-between.gap-2` → `p.text-sm.text-slate-600` *"Fonti: …"* +
  `CollapsibleTrigger` `<Button variant="ghost" size="sm">` **Esito per fonte** + chevron; `CollapsibleContent` =
  la tabella di oggi, invariata.
- Stima: titolo card ~45 + stato ~24 + callout ~44 + descrizione ~44 + fonti ~22 + bottone ~32 + esito chiuso ~70 +
  padding ≈ 330 px: con l'intestazione della pagina la proposta parte intorno ai 560 px a 1280 × 900, nella prima
  schermata.

---

## 3. Componenti shadcn

| Componente | Decisione | Uso e motivo |
| --- | --- | --- |
| **`collapsible`** | **Installare** — `npx shadcn@latest add collapsible` da `web/` | Tre disclosure di questo flusso: **Invariati** (uno per gruppo) e **Esito per fonte** nella card. Dà `aria-expanded`/`aria-controls`/`data-state` collegati e il contenuto smontato da chiuso, invece del collegamento a mano (`aria-controls={open ? id : undefined}` di `ServicesCard`). Nessuna dipendenza npm nuova: `radix-ui` 1.6 contiene già Collapsible. Nessuna classe di animazione (§4). |
| `badge` | già installato: usarlo | Stato Nuovo / Modificato / In conflitto, `variant="outline"` + colori §1.1 |
| `button`, `dialog` | già installati | Verbi, azioni di massa, Annulla, conferma del rifiuto in blocco |
| `textarea` | **No** | `textareaCls` (`settings/parts.tsx`) è già lo stile del Textarea shadcn, usato da servizi e profilo: un secondo componente vorrebbe dire due textarea diverse nella stessa pagina. Se lo si vuole, installarlo **e** migrare `textareaCls` nello stesso cambio. |
| `progress` | No | La barra è decorativa e `aria-hidden` (FLOW); Radix Progress espone `role="progressbar"` e l'indicatore shadcn anima con `transition-all`. Due `div` bastano. |
| `alert` | No | I callout ambra (E14, H5) e sky (proposta in attesa) usano già le classi dell'app. |
| `tooltip` | No | Il FLOW vuole fonti e *"prima: …"* in testo, non al passaggio del mouse. |
| `button-group` | No | Bottoni attaccati si leggono come controllo segmentato; qui sono tre azioni (§2.4). |
| `separator`, `card`, `item` | No | Bordi e `divide-y` bastano; `Card` esiste in `ui.tsx`; `item` sarebbe un layout parallelo alla riga. |
| `alert-dialog` | No | Le conferme dell'app usano `Dialog` (Elimina servizio): resta coerente. |
| `kbd` | No | Nessuna scorciatoia in questo flusso, e non ne vanno aggiunte. |

---

## 4. Motion brief

### 4.1 Recon

- Nessun token di motion nel progetto; i primitivi shadcn usano `duration-100` + keyframe `tw-animate-css` (dialog)
  e il `Button` ha `transition-all` + `active:translate-y-px` (`ui/button.tsx:8`). Nessun `motion-safe`/`motion-reduce`
  né `@starting-style` in `web/src` oggi. Nessuna libreria di motion: route = CSS transition + **WAAPI**
  (`Element.animate`), come da Translation table (righe 1, 2, 4, 7, 8).
- Trigger: clic (o Invio/Spazio) sui verbi, su Annulla, sulle azioni di massa, sui disclosure; arrivo di dati
  (ricalcolo, proposta non più corrente).
- Trappola del profilo: in `agent-browser` le pagine sono `visibilityState=hidden` e animazioni e transizioni
  avanzano solo a uno screenshot. Ogni animazione WAAPI e lo scroll morbido **non partono se la pagina non è
  visibile** (§4.4): l'e2e vede subito lo stato finale.

### 4.2 Il gate, voce per voce

Frequenza del flusso: **occasionale** (6–15 decisioni per proposta, poche proposte al mese). Il gate ammette
l'animazione standard; la personalità (strumento quotidiano, nitido) la vuole corta e funzionale. Nessuna
scorciatoia da tastiera è introdotta; Invio/Spazio su un bottone vale come un clic.

| # | Candidato | Scopo | Verdetto |
| --- | --- | --- | --- |
| M1 | Una voce da decidere → decisa (azione su **una** riga) | Evitare il salto: la riga si chiude **dove sta** (FLOW) e quella sotto sale sotto il cursore; senza movimento si teletrasporta | **Anima** (§4.3) |
| M2 | **Annulla** → la voce torna da decidere | Stesso: la riga si riapre al suo posto | **Anima**, stessi valori di M1 |
| M3 | Azione di massa (N righe insieme) | Le righe cambiano anche fuori schermo; toast, live region e focus sul primo conflitto fanno già il lavoro. Dodici altezze animate insieme + lo scroll anchoring = movimento confuso | **Taglia**: cambio istantaneo |
| M4 | Apertura di **Modifica** (testo → casella) | Nessuno: lo stesso testo diventa modificabile nello stesso punto, il focus e il cursore sono il segnale; un'animazione ritarderebbe solo la scrittura | **Taglia** |
| M5 | **Annulla** della modifica · **Mostra tutto** di una riga decisa | Nessuno | **Taglia** |
| M6 | Barra di avanzamento | Feedback periferico: la barra avanza mentre guardi la riga | **Anima** (§4.3) |
| M7 | Numeri del contatore ("Decise 4 di 6") | Nessuno: il conto si legge, non si guarda | **Taglia**; `tabular-nums` perché non balli la larghezza |
| M8 | Riepilogo di chiusura | Stato: la testata cambia significato una volta per proposta (momento raro) | **Anima**, sobrio (§4.3); nessun disegno della spunta, nessun rimbalzo |
| M9 | Bordo della sezione sky → slate (e ritorno) | Stato della sezione | **Anima** colore (§4.3) |
| M10 | **Mostra/Nascondi** invariati · **Esito per fonte** (contenuto e chevron) | Pochi testi corti sotto il bottone; un'altezza animata a keyframe (`animate-collapsible-*`) non è interrompibile e sposta il layout | **Taglia**: istantaneo, chevron compreso (un'entità sola) |
| M11 | Comparsa della sezione Proposta a fine job | Toast e banner lo dicono già; un `@starting-style` scatterebbe anche a ogni caricamento della pagina con una proposta aperta | **Taglia** |
| M12 | Link nella stessa pagina e spostamenti di focus lontani (**Rivedi la proposta** dalla card o dal banner sulla stessa pagina, **Vedi il profilo aggiornato**, titolo del riepilogo, primo conflitto dopo l'azione di massa) | Continuità spaziale: si vede che si scende/sale nella stessa pagina | **Anima**: scroll morbido nativo, solo con `no-preference` e pagina visibile (§4.4) |
| M13 | Focus sulla voce successiva dopo una decisione | Di solito è subito sotto | **Taglia**: `focus({preventScroll:true})` + `scrollIntoView({block:'nearest'})` istantaneo |
| M14 | Attesa di un'azione | Feedback solo se l'attesa si sente | Spinner **dopo 300 ms**, senza dissolvenza (§2.3); prima, niente |
| M15 | Errori sotto la riga / nel dialog | Nessuno | **Taglia**: compaiono, nessuno shake |
| M16 | Bottoni (hover, pressione) | Già nel primitivo `Button` | **Invariati**: nessun cambio locale |
| M17 | Dialog del rifiuto in blocco | Già nel primitivo | **Invariato** (`duration-100`) |
| M18 | Striscia sticky | — | Nessun effetto legato allo scroll (ombra "quando è attaccata" ecc.) |
| M19 | Toast | Fuori scope | Invariati |

### 4.3 Brief delle cose che animano

```markdown
## Motion brief — M1/M2: la riga che si chiude o si riapre al suo posto

**Verdict:** animate
**Trigger:** Applica · Rifiuta · Tieni · Sostituisci · Applica il tuo testo · salvataggio di Modifica… di un servizio (M1);
  Annulla su una riga decisa (M2). Solo se l'azione riguarda UNA riga. Mai per azioni di massa, ricalcoli dal server,
  "voce cambiata", "proposta non più corrente", apertura/chiusura di Modifica.
**Frequency:** occasionale → animazione standard ammessa
**Purpose:** la riga cambia forma dove sta; chi sta sotto sale (o scende) invece di saltare

**Enter (M2, si riapre):** height da quella compatta a quella intera; contenuto nuovo opacity 0 → 1
**Exit (M1, si chiude):** height da quella intera a quella compatta; contenuto nuovo opacity 0 → 1. Il contenuto
  vecchio non esce: è sostituito subito, e lo spazio vuoto sotto la riga compatta si chiude con l'altezza.
**Origin:** bordo alto della riga (l'altezza cresce/cala verso il basso); nessuna traslazione
**Easing:** altezza `cubic-bezier(0.25, 1, 0.5, 1)` (--ease-drawer-height) · contenuto `cubic-bezier(0.23, 1, 0.32, 1)` (--ease-out-quint)
**Duration:** altezza adattiva = clamp(|Δh| / 500 s, 150 ms, 270 ms); in chiusura × 0,8 (120–216 ms) — un'uscita è più
  corta di un'entrata. Contenuto 150 ms. Sfondo del li (bianco ↔ slate-50/70) 150 ms `ease` (CSS, §2.2). Tutto < 300 ms.
**Interrupt:** WAAPI riparte dall'altezza **attuale**: se una animazione è in corso si legge `getBoundingClientRect().height`
  (valore animato), poi `cancel()`, si misura l'altezza nuova e si anima da lì. Annulla a metà chiusura non salta.
**Reduced motion:** niente altezza animata (cambio istantaneo); resta la dissolvenza del contenuto, 150 ms `ease`; resta lo sfondo
**Stack:** WAAPI da un `useLayoutEffect` della riga, chiave = stato della riga (`pending` | `decided`), flag `animate` impostato
  dal gestore dell'azione singola. Proprietà animata non composita (height): ammessa perché è un elemento solo, desktop,
  < 300 ms, e la scala (scaleY) deformerebbe il testo.

**Assumed:** valori dal catalogo (nessuna risposta dell'utente sul "come deve sentirsi")
**Open risk:** che si senta un ritardo prima di poter cliccare la riga successiva. Feel-check §4.5; se fallisce, fallback:
  solo la dissolvenza del contenuto, altezza istantanea (§6, D2).
```

```markdown
## Motion brief — M6: barra di avanzamento

**Verdict:** animate
**Trigger:** ogni cambio del conteggio delle decise (anche dopo l'azione di massa: è un elemento solo, nello schermo)
**Frequency:** una per decisione → standard
**Purpose:** feedback periferico che il conto è avanzato (il dato vero è nel testo)
**Enter/Exit:** `transform: translateX((r − 1) × 100%)` dal valore precedente al nuovo; nessuna animazione al primo render
**Origin:** sinistra (la traslazione tiene la punta arrotondata intatta)
**Easing:** `cubic-bezier(0.23, 1, 0.32, 1)` · **Duration:** 250 ms
**Interrupt:** transizione CSS, riparte dal valore corrente
**Reduced motion:** `motion-reduce:transition-none` (la barra salta al valore; il testo dice già tutto)
**Stack:** CSS transition — `transition-transform duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none`
**Assumed:** valori dal catalogo · **Open risk:** nessuno (decorativa, `aria-hidden`)
```

```markdown
## Motion brief — M8/M9: la proposta si chiude (riepilogo) e la sezione cambia colore

**Verdict:** animate
**Trigger:** l'ultima decisione (singola, di massa o il rifiuto in blocco confermato). Mai al caricamento: dopo un
  ricarico una proposta chiusa non c'è più.
**Frequency:** una volta per proposta → raro; budget di "momento" disponibile, speso al minimo
**Purpose:** la testata cambia significato (da "cosa resta" a "cosa hai deciso")
**Enter (M8):** il `div` sotto il titolo (frase + link) opacity 0 → 1 e translateY(4px) → 0. Il titolo e l'icona cambiano
  senza animazione (stesso `h2`, riceve il focus).
**Exit:** nessuna (striscia, hint ed E14 spariscono nello stesso istante); Annulla dopo la chiusura riporta la striscia
  senza animazione
**Origin:** dal basso di 4px (il blocco "si posa"), nessuna scala
**Easing:** `cubic-bezier(0.23, 1, 0.32, 1)` · **Duration:** 220 ms
**M9:** bordo e anello della `section` `transition-[border-color,box-shadow] duration-200 ease-[ease]` (sky ↔ slate)
**Interrupt:** se Annulla arriva durante l'entrata, il blocco si smonta e l'animazione muore con lui
**Reduced motion:** solo opacity 0 → 1, 200 ms `ease`; il colore del bordo resta (è significato)
**Stack:** WAAPI al montaggio del blocco del riepilogo (montato solo da un'azione), con la stessa guardia di M1;
  M9 è una transizione CSS
**Assumed:** valori dal catalogo · **Open risk:** il focus va al titolo in cima mentre l'ultima riga era in fondo: lo
  scroll morbido (M12) lo accompagna
```

```markdown
## Motion brief — M12: spostamenti nella stessa pagina

**Verdict:** animate (nativo)
**Trigger:** Rivedi la proposta (callout della card; banner quando la route è già /settings/profile), Vedi il profilo
  aggiornato, focus sul titolo del riepilogo, focus sul primo conflitto dopo l'azione di massa
**Frequency:** raro
**Purpose:** si vede che si resta nella stessa pagina e in che direzione si va
**Stack:** `target.focus({ preventScroll: true })` e poi `target.scrollIntoView({ block: 'start', behavior })` con
  `behavior = 'smooth'` solo se la pagina è visibile **e** `prefers-reduced-motion: no-preference`, altrimenti `'auto'`.
  Il bersaglio ha `scroll-mt-6` (titoli di sezione/card) o `scroll-mt-20` (titoli di voce, sotto la striscia sticky).
  Arrivando da un'altra pagina: salto istantaneo (caricamento).
**Reduced motion:** salto istantaneo
```

### 4.4 Implementazione (una forma sola per tutte)

Un modulo piccolo, niente sistema di motion: `web/src/lib/motion.ts` (nuovo) con

- `EASE_OUT_QUINT = 'cubic-bezier(0.23, 1, 0.32, 1)'` e `EASE_HEIGHT = 'cubic-bezier(0.25, 1, 0.5, 1)'`;
- `canAnimate()` = `document.visibilityState === 'visible'` (la guardia per `agent-browser`);
- `reducedMotion()` = `matchMedia('(prefers-reduced-motion: reduce)').matches`, letto **al momento** dell'azione;
- `revealAndFocus(el)` = M12;
- `animateRowChange(li, content, fromHeight)` = M1/M2:

```ts
// nel useLayoutEffect della riga, quando cambia lo stato e il flag `animate` è acceso
const running = li.getAnimations().length > 0;
const from = running ? li.getBoundingClientRect().height : prevHeight.current; // altezza vista adesso
li.getAnimations().forEach((a) => a.cancel());
const to = li.getBoundingClientRect().height;
if (canAnimate() && Math.abs(to - from) > 1) {
  if (!reducedMotion()) {
    const base = Math.min(Math.max(Math.abs(to - from) / 500, 0.15), 0.27) * 1000;
    li.style.overflow = 'hidden';
    li.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: to < from ? Math.round(base * 0.8) : Math.round(base),
      easing: EASE_HEIGHT,
    }).finished.then(() => { li.style.overflow = ''; }, () => { li.style.overflow = ''; });
  }
  content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: reducedMotion() ? 'ease' : EASE_OUT_QUINT });
}
prevHeight.current = to; // l'altezza d'arrivo, non quella animata del primo frame

// in un secondo useLayoutEffect senza dipendenze (ogni commit: apertura di Modifica, Mostra tutto, errori…):
// if (li.getAnimations().length === 0) prevHeight.current = li.getBoundingClientRect().height;
```

La chiave dello stato della riga è `pending` | `decided`: la casella di **Modifica** è un sotto-stato di `pending`
(aprirla non anima, M4), mentre **Applica il tuo testo** porta a `decided` e anima come M1.

- Focus dopo una decisione singola: `next.focus({ preventScroll: true })`, poi — a fine animazione, o subito se non
  anima — `next.scrollIntoView({ block: 'nearest' })` istantaneo.
- Nessuna animazione nasce al montaggio di righe decise (dopo un ricarico tutte le decise compaiono ferme): per
  questo M1 e M8 sono WAAPI comandate dall'azione, non `@starting-style`.
- Se questi valori diventano la base di altre schermate, i valori e la scelta di WAAPI vanno in `brain/chore/motion.md`.
- Fuori scope, da sapere: il `Button` condiviso usa `transition-all` (in revisione sarebbe un rilievo). Qui non si
  tocca il primitivo.

### 4.5 Feel-check (in un browser vero, non in `agent-browser`)

1. Chrome DevTools → Animations al 25 %: Rifiuta su una riga corta (*Nome*, Δh ~70 px → ~120 ms in chiusura) e su un
   paragrafo (*Posizionamento*, Δh ~250 px → ~216 ms). Il testo nuovo non deve rifluire durante l'altezza, la riga
   sotto deve salire senza scatti, nessun lampo del contenuto vecchio.
2. Velocità piena, 1280 × 900: decidere tre righe di fila. Se si sente un'attesa prima del clic successivo, applicare
   il fallback D2.
3. Annulla entro 200 ms da un Rifiuta: la riga si riapre dall'altezza a cui era, senza salto.
4. DevTools → Rendering → *prefers-reduced-motion: reduce*: nessuna altezza animata, nessuna traslazione del
   riepilogo, barra a scatti, scroll istantaneo; restano dissolvenze e colori.
5. Ultima decisione in fondo alla lista: lo scroll morbido porta al riepilogo, il focus è sul titolo, la striscia
   non copre nessun titolo di voce quando il focus ci va (`scroll-mt-20`).
6. Occhi freschi il giorno dopo.

---

## 5. Deviazioni dichiarate dal FLOW (forma, non flusso né testi)

1. **Ordine della testata.** FLOW A.5: titolo · provenienza · avanzamento · riga E14 · azioni · frase del modello.
   Qui: titolo · provenienza · **frase del modello** · riga E14 · **[avanzamento + azioni]** · hint delle azioni. La
   frase del modello fa da introduzione, la riga E14 resta **prima** del bottone che avverte, e l'avanzamento sta con
   le azioni nella striscia sticky. Contenuti e testi invariati.
2. **Striscia sticky** (avanzamento + azioni di massa) mentre si scorre la sezione.
3. **"Applica il tuo testo" pieno** dentro la Modifica aperta (convenzione dei form in riga dell'app); i tre verbi
   restano tutti `outline`.
4. **"Genera di nuovo…" `outline`** finché c'è una proposta aperta (il FLOW non ne fissa il peso).
5. **Riga decisa tagliata a due righe** quando il testo citato è un paragrafo, con **Mostra tutto**; le parole sono
   quelle del FLOW.

## 6. Decisioni aperte per l'orchestratore

Ognuna ha una raccomandazione; il brief è scritto secondo la raccomandazione.

- **D1 — Striscia sticky (§2.1, deviazioni 1–2).** (a) Sì: avanzamento e azioni di massa sempre visibili mentre si
  decide. (b) No: tutto resta nella testata, nell'ordine del FLOW. **Raccomandazione: (a)**, perché il segnale 6 chiede
  l'avanzamento "in ogni momento" e una proposta lunga occupa 3–4 schermate.
- **D2 — L'altezza della riga si anima (M1/M2)?** (a) Sì, 120–270 ms adattivi più la dissolvenza (§4.3). (b) Solo la
  dissolvenza del contenuto, con l'altezza istantanea: costa meno codice e si sente più secco. **Raccomandazione: (a)**,
  con (b) come ripiego se il feel-check 2 fallisce.
- **D3 — "Applica il tuo testo" pieno (deviazione 3).** (a) Sì, come "Salva fit". (b) `outline` come gli altri verbi.
  **Raccomandazione: (a).**
- **D4 — "Genera di nuovo…" outline con una proposta aperta (deviazione 4).** **Raccomandazione: sì.**
- **D5 — Icone degli slot (✓ ✎ ✕), compresa ✕ su "Tieni il tuo testo / servizio".** (a) Sì: l'icona è il significato
  dello slot rispetto alla proposta e ritorna come marcatore della riga decisa. (b) Nessuna icona sui verbi, solo
  l'ordine fisso. **Raccomandazione: (a).**
