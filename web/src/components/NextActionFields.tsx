import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addDays } from '../lib/dates';

/*
 * Campi della prossima azione (people-first-crm G1, FLOW A.1 ed E.4): Data (obbligatoria se c'è il testo) con
 * "Domani" / "Tra una settimana" (contati da oggi) e "Cosa fare" facoltativo. Una data passata non blocca ma avvisa.
 */

export interface NextActionValue {
  on: string;
  text: string;
}

export interface NextActionFieldsProps {
  value: NextActionValue;
  onChange: (next: NextActionValue) => void;
  /** Oggi dell'utente `YYYY-MM-DD`. */
  today: string;
  /** Errore della data (es. "Scegli la data della prossima azione."). */
  dateError?: string | null;
  disabled?: boolean;
  /** Mostra "Domani" / "Tra una settimana". */
  quickDates?: boolean;
  /** Id del campo data (per il focus sul primo errore). */
  dateId?: string;
}

export function NextActionFields({ value, onChange, today, dateError, disabled, quickDates = true, dateId }: NextActionFieldsProps) {
  const uid = useId();
  const dateInputId = dateId ?? `${uid}-date`;
  const past = value.on !== '' && value.on < today;
  const describedBy = [dateError ? `${uid}-date-error` : null, past ? `${uid}-past` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
      <div className="flex flex-col gap-1">
        <label htmlFor={dateInputId} className="text-xs font-medium text-slate-600">
          Data
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            id={dateInputId}
            type="date"
            value={value.on}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, on: e.target.value })}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={describedBy}
            className="w-auto bg-white"
          />
          {quickDates && (
            <>
              <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={() => onChange({ ...value, on: addDays(today, 1) })}>
                Domani
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={() => onChange({ ...value, on: addDays(today, 7) })}>
                Tra una settimana
              </Button>
            </>
          )}
        </div>
        {dateError && (
          <p id={`${uid}-date-error`} className="text-xs text-red-700">
            {dateError}
          </p>
        )}
        {past && !dateError && (
          <p id={`${uid}-past`} className="text-xs text-amber-800">
            Data passata: comparirà come scaduta.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-text`} className="text-xs font-medium text-slate-600">
          Cosa fare <span className="font-normal text-slate-400">(facoltativo)</span>
        </label>
        <Input
          id={`${uid}-text`}
          value={value.text}
          maxLength={500}
          disabled={disabled}
          placeholder="es. Mandare la proposta"
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="bg-white"
        />
      </div>
    </div>
  );
}
