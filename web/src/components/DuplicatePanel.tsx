import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { PersonRef } from '../api/types';
import { fmtDayMonth } from '../lib/dates';

/*
 * Riepiloghi delle persone nei pannelli dei doppioni (people-first-crm C7–C10, E5; FLOW A.4–A.6, F.2):
 * "Marco Riva — Head of Engineering · Beta (commento del 2 set)" con "Apri scheda", e il riepilogo di
 * "Aggiungi l'incontro a <persona>" (C9): cosa riceve la persona esistente e cosa no.
 */

const displayName = (p: PersonRef) => p.full_name ?? 'Senza nome';

/** "commento del 2 set" · "aggiunta a mano del 12 set" (data dell'incontro per la fonte manuale). */
export function firstSourceText(p: PersonRef): string | null {
  const s = p.first_source;
  if (!s) return null;
  return `${s.label} del ${fmtDayMonth(s.met_on ?? s.captured_at)}`;
}

/** Riga di una persona: nome — ruolo · azienda (prima fonte) · Apri scheda. */
export function PersonRefLine({ person }: { person: PersonRef }) {
  const role = [person.title ?? person.headline, person.company_name].filter(Boolean).join(' · ');
  const source = firstSourceText(person);
  return (
    <span>
      <span className="font-medium text-slate-900">{displayName(person)}</span>
      {role && <> — {role}</>}
      {source && <span className="text-slate-500"> ({source})</span>}
      {' · '}
      <Link
        to="/people/$id"
        params={{ id: String(person.id) }}
        target="_blank"
        className="font-medium underline underline-offset-2"
        aria-label={`Apri scheda di ${displayName(person)} (in una nuova scheda)`}
      >
        Apri scheda
      </Link>
    </span>
  );
}

export interface MeetingSummaryInput {
  metOn: string;
  hasContext: boolean;
  listName: string | null;
  nextAction: { on: string; text: string } | null;
}

/**
 * Riepilogo di "Aggiungi l'incontro a <persona>" (C9): fonte "Aggiunta a mano" della data dell'incontro, la nota,
 * la lista; gli altri campi del form non la modificano. Avvisi: prossima azione sostituita, fonte già presente,
 * persona scartata.
 */
export function MeetingSummary({ person, input, extra }: { person: PersonRef; input: MeetingSummaryInput; extra?: ReactNode }) {
  const name = displayName(person);
  const gets = [
    person.manual_met_on === null && `la fonte 'Aggiunta a mano' del ${fmtDayMonth(input.metOn)}`,
    input.hasContext && "la nota 'Come vi siete conosciuti'",
    input.listName && `la lista '${input.listName}'`,
    input.nextAction && 'la prossima azione del form',
  ].filter(Boolean) as string[];
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-slate-600">
      <p>
        {gets.length > 0 ? (
          <>
            Salvando, {name} riceve {joinAnd(gets)}.{' '}
          </>
        ) : (
          <>Salvando, a {name} non si aggiunge nulla oltre all'incontro. </>
        )}
        Gli altri campi del form non cambiano la sua scheda.
      </p>
      {input.nextAction && person.next_action_on && (
        <p className="text-amber-800">
          Ha già una prossima azione ({fmtDayMonth(person.next_action_on)}
          {person.next_action_text ? ` · ${person.next_action_text}` : ''}): verrà sostituita da quella del form.
        </p>
      )}
      {person.manual_met_on && (
        <p>Ha già la fonte 'Aggiunta a mano' ({fmtDayMonth(person.manual_met_on)}): resta quella, il nuovo incontro si registra come nota.</p>
      )}
      {person.status === 'scartato' && (
        <p className="text-amber-800">{name} è tra le persone scartate: la prossima azione non comparirà in Oggi finché non cambi lo stato.</p>
      )}
      {extra}
    </div>
  );
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}
