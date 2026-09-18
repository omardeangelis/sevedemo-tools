import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import {
  ENRICH_PROVIDERS,
  type ApolloEnrichPreviewCounts,
  type EnrichPreview,
  type EnrichProvider,
  type Job,
  type JobPreview,
} from '../api/types';
import { countText, fmtCount } from '../lib/format';
import { useJobPreview, useJobStart } from '../lib/jobs';
import { JobPreviewDialog } from './JobPreviewDialog';

/*
 * Barra delle azioni bulk (crm-foundation T15, FLOW C.2–C.3, E.1) e dialog dei job bulk che apre:
 * "Arricchisci…" (`EnrichDialog`, con il radio Provider Apify/Apollo e i pezzi condivisi col dettaglio prospect).
 * L'analisi vive in `IcpPickerDialog.tsx` (serve la scelta dell'ICP).
 */

export interface BulkBarProps {
  /** Numero di prospect selezionati (anche fuori dalla pagina visibile). */
  count: number;
  /** "Deseleziona": azzera la selezione. */
  onClear: () => void;
  /** Azioni (bottoni) sulla selezione. */
  children: ReactNode;
  /** Riga informativa sotto le azioni (es. cap dei 500 raggiunto). */
  notice?: ReactNode;
  /** Nome accessibile della regione (default "Azioni sui selezionati"). */
  label?: string;
}

/**
 * Barra delle azioni sulla selezione, fissa in basso finché c'è almeno un selezionato. Va montata
 * **sempre**: il contatore "N selezionati" è una live region che esiste anche a selezione vuota, così
 * lo screen reader annuncia ogni cambio (FLOW "Accessibilità").
 *
 * @example
 * <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
 *   <Button onClick={openAddToList}>Aggiungi a lista</Button>
 * </BulkBar>
 */
export function BulkBar({ count, onClear, children, notice, label = 'Azioni sui selezionati' }: BulkBarProps) {
  const active = count > 0;
  return (
    <div
      role="region"
      aria-label={label}
      className={
        active
          ? 'sticky bottom-4 z-30 mt-4 flex flex-col gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 shadow-lg'
          : 'sr-only'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-live="polite" className="text-sm font-semibold text-slate-900 tabular-nums">
          {active ? `${count.toLocaleString('it-IT')} ${count === 1 ? 'selezionato' : 'selezionati'}` : ''}
        </p>
        {active && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Deseleziona
            </Button>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-2">{children}</div>
          </>
        )}
      </div>
      {active && notice && <p className="text-xs text-slate-600">{notice}</p>}
    </div>
  );
}

/**
 * Props per `DialogContent` di Radix che restituiscono il focus al bottone che ha aperto il dialog
 * (senza `DialogTrigger` Radix lo manderebbe a `body`; FLOW "Accessibilità": restore focus).
 */
export function useDialogFocusReturn() {
  const target = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const el = target.current;
      if (el?.isConnected && el !== document.body) {
        event.preventDefault();
        el.focus();
      }
    },
  };
}

/** Parti di un riepilogo separate da " · " (le vuote si saltano). */
export function joinParts(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');
}

/** Ambito di un job bulk: selezione di prospect o intera lista. */
export type BulkJobScope = { prospectIds: number[] } | { listId: number };

export interface EnrichDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: BulkJobScope;
  /** Sottotitolo (es. "Lista filtrata: …"). */
  description?: ReactNode;
  onStarted?: (job: Job) => void;
}

/**
 * "Arricchisci…" (FLOW E.2, C.3; apollo-lookalike FLOW D): `JobPreviewDialog` alimentato da
 * `GET /api/enrich/preview` con il radio **Provider** in cima (default Apify) e "Riprova anche quelli
 * senza risultato" (`retryFailed`, con Apollo sul tentativo Apollo). Selezione → `POST /api/enrich`,
 * lista → `POST /api/lists/:id/enrich` (Apify: solo i mancanti; Apollo: solo chi non ha un'email).
 * L'esito arriva dal `JobBanner`.
 */
export function EnrichDialog({ open, onOpenChange, scope, description, onStarted }: EnrichDialogProps) {
  const [provider, setProvider] = useState<EnrichProvider>('apify');
  const [retryFailed, setRetryFailed] = useState(false);
  useEffect(() => {
    if (open) {
      setProvider('apify');
      setRetryFailed(false);
    }
  }, [open]);

  const isList = 'listId' in scope;
  const apollo = provider === 'apollo';
  const apifyPreview = useJobPreview('enrich', { ...scope, retryFailed }, { enabled: open && !apollo });
  const apolloPreview = useJobPreview('enrich', { ...scope, provider: 'apollo', retryFailed }, { enabled: open && apollo });
  const apifyUnitPrice = useLastApifyUnitPrice(apifyPreview.data, apolloPreview.data);
  const start = useJobStart(
    () =>
      'listId' in scope
        ? api.enrich.startList(scope.listId, apollo ? { provider: 'apollo', retryFailed } : { onlyMissing: true, retryFailed })
        : api.enrich.startSelection(scope.prospectIds, apollo ? { provider: 'apollo', retryFailed } : { retryFailed }),
    {
      onStarted: (job) => {
        onOpenChange(false);
        onStarted?.(job);
      },
    },
  );

  return (
    <JobPreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Arricchisci profili"
      description={description ?? "Scegli il provider: cosa si legge e quanto costa cambiano. Controlla l'anteprima prima di avviare."}
      preview={apollo ? apolloPreview : apifyPreview}
      summary={(data: JobPreview) =>
        apollo ? (
          <ApolloEnrichSummary data={data} scopeLabel={isList ? 'nella lista' : undefined} />
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {joinParts([
              `${fmtCount(data.counts.selected)} ${isList ? 'nella lista' : data.counts.selected === 1 ? 'selezionato' : 'selezionati'}`,
              `${fmtCount(data.counts.targets)} da arricchire`,
              (data.counts.skipped_enriched ?? 0) > 0 && `${fmtCount(data.counts.skipped_enriched)} già arricchiti (saltati)`,
              (data.counts.skipped_fresh ?? 0) > 0 && `${fmtCount(data.counts.skipped_fresh)} tentati di recente senza risultato (saltati)`,
              (data.counts.not_found ?? 0) > 0 && `${fmtCount(data.counts.not_found)} non più presenti`,
            ])}
          </p>
        )
      }
      startLabel="Avvia arricchimento"
      starting={start.isPending}
      onStart={() => start.mutate()}
    >
      <EnrichProviderField
        value={provider}
        onChange={(next) => {
          setProvider(next);
          // Il "Riprova" vale sul tentativo del provider scelto: al cambio non si ripaga nulla per inerzia.
          setRetryFailed(false);
        }}
        apifyUnitPrice={apifyUnitPrice}
        disabled={start.isPending}
      />
      <RetryFailedField provider={provider} checked={retryFailed} onCheckedChange={setRetryFailed} />
    </JobPreviewDialog>
  );
}

// ---------------------------------------------------------------------------
// Provider dell'arricchimento (apollo-lookalike T14, FLOW D.1–D.2): pezzi condivisi con il dettaglio prospect
// ---------------------------------------------------------------------------

const unitUsd = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Prezzo Apify per persona (`unit_prices.apify` della preview, `PRICE_PROFILE_DETAIL_USD`) dalla prima delle preview
 * già lette (Apify o Apollo: il prezzo è lo stesso). È di configurazione, quindi resta l'ultimo letto mentre la
 * preview si ricalcola (cambio di provider o di spunta) e la riga di prezzo non sparisce. `undefined` = non ancora
 * letto, `null` = prezzo non configurato.
 */
export function useLastApifyUnitPrice(...previews: Array<EnrichPreview | undefined>): number | null | undefined {
  const last = useRef<number | null | undefined>(undefined);
  const read = previews.find((preview) => preview !== undefined);
  if (read) last.current = read.unit_prices.apify;
  return last.current;
}

const PROVIDER_TITLES: Record<EnrichProvider, string> = {
  apify: 'Apify — profilo completo',
  apollo: 'Apollo — solo email di lavoro',
};

function providerDetail(provider: EnrichProvider, apifyUnitPrice: number | null | undefined): string {
  if (provider === 'apollo') {
    return "email di lavoro, titolo e azienda · 1 credito a persona · niente about né esperienze: l'analisi AI richiederà comunque Apify";
  }
  const price =
    apifyUnitPrice === null
      ? 'costo a persona non disponibile (PRICE_PROFILE_DETAIL_USD)'
      : apifyUnitPrice === undefined
        ? null
        : `≈\u00a0$${unitUsd.format(apifyUnitPrice)} a persona`;
  return joinParts(['about, esperienze, formazione ed email dal profilo LinkedIn', price]);
}

/**
 * Radio "Provider" in cima al dialog (FLOW D.1, "Accessibilità": `role="radiogroup"` etichettato
 * "Provider", la riga di prezzo fa parte della label).
 */
export function EnrichProviderField(props: {
  value: EnrichProvider;
  onChange: (provider: EnrichProvider) => void;
  apifyUnitPrice: number | null | undefined;
  disabled?: boolean;
}) {
  const uid = useId();
  return (
    <div className="flex flex-col gap-1">
      <p id={`${uid}-label`} className="text-sm font-medium text-slate-900">
        Provider
      </p>
      <div role="radiogroup" aria-labelledby={`${uid}-label`} className="flex flex-col gap-1">
        {ENRICH_PROVIDERS.map((p) => (
          <label
            key={p}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm ring-1 ring-inset',
              props.value === p ? 'bg-slate-50 ring-slate-300' : 'ring-transparent hover:bg-slate-50',
            )}
          >
            <input
              type="radio"
              name={`${uid}-provider`}
              value={p}
              checked={props.value === p}
              disabled={props.disabled}
              onChange={() => props.onChange(p)}
              className="mt-0.5 size-4 accent-slate-900"
            />
            <span>
              <span className="font-medium text-slate-900">{PROVIDER_TITLES[p]}</span>
              <span className="block text-slate-600">{providerDetail(p, props.apifyUnitPrice)}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Spunta "Riprova anche quelli senza risultato" (`retryFailed`) con la spiegazione del provider scelto. */
export function RetryFailedField(props: { provider: EnrichProvider; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox checked={props.checked} onCheckedChange={(v) => props.onCheckedChange(v === true)} className="mt-0.5" />
      <span>
        <span className="font-medium text-slate-900">Riprova anche quelli senza risultato</span>
        <span className="block text-slate-500">
          {props.provider === 'apollo'
            ? 'Include chi è stato cercato su Apollo di recente senza email disponibile: costa di nuovo 1 credito a persona.'
            : 'Include i profili già tentati di recente che non hanno restituito dati: costa di nuovo.'}
        </span>
      </span>
    </label>
  );
}

/**
 * Riepilogo della preview Apollo (FLOW D.2, SPEC G2/G3/C5): "24 selezionati · 15 da cercare · 6 con email già
 * presente (saltati) · 3 tentati di recente senza risultato (saltati) · Crediti stimati: 15"; i crediti restano
 * sempre visibili (anche a 0) e, senza `APOLLO_CREDIT_USD`, si dice cosa impostare per il costo.
 */
export function ApolloEnrichSummary({ data, scopeLabel }: { data: JobPreview; scopeLabel?: string }) {
  const c = data.counts as Partial<ApolloEnrichPreviewCounts>;
  const credits = c.est_credits ?? c.targets ?? 0;
  const selected = c.selected ?? 0;
  return (
    <div className="flex flex-col gap-1">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="credits-line">
        {joinParts([
          `${fmtCount(selected)} ${scopeLabel ?? (selected === 1 ? 'selezionato' : 'selezionati')}`,
          `${fmtCount(c.targets)} da cercare`,
          (c.skipped_with_email ?? 0) > 0 && `${fmtCount(c.skipped_with_email)} con email già presente (${c.skipped_with_email === 1 ? 'saltato' : 'saltati'})`,
          (c.skipped_fresh ?? 0) > 0 &&
            countText(c.skipped_fresh, 'tentato di recente senza risultato (saltato)', 'tentati di recente senza risultato (saltati)'),
          (c.not_found ?? 0) > 0 && countText(c.not_found, 'non più presente', 'non più presenti'),
        ])}
        {' · '}
        <span className="font-medium text-slate-900">Crediti stimati: {fmtCount(credits)}</span>
      </p>
      {data.est_cost_usd === null && (
        <p className="text-xs text-slate-500">
          Stima non disponibile — imposta APOLLO_CREDIT_USD nel .env per vedere il costo; i crediti restano {fmtCount(credits)}.
        </p>
      )}
    </div>
  );
}
