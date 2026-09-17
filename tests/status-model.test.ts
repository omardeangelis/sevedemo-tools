import { beforeEach, describe, expect, it } from 'vitest';

// Modello stati e timeline (crm-foundation T5, D6/P3/P8). Import dinamici: la config
// (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { PROSPECT_STATUSES, STATUS_LABELS, changeStatus, isProspectStatus, isTerminal } = await import('../src/domain/status.js');
const { addActivity, addTouchpoint, timeline } = await import('../src/db/activities.js');
const { upsertProspect } = await import('../src/db/prospects.js');

let seq = 0;
function prospect(): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/stato-${seq}` }).id;
}

function status(id: number): string {
  return db.prepare('SELECT status FROM prospects WHERE id = ?').pluck().get(id) as string;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM lists; DELETE FROM icps;');
});

describe('stati del prospect', () => {
  it('9 stati con label italiane; terminali = chiuso_vinto, chiuso_perso, scartato', () => {
    expect(PROSPECT_STATUSES).toHaveLength(9);
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...PROSPECT_STATUSES].sort());
    expect(STATUS_LABELS.da_contattare).toBe('Da contattare');
    expect(PROSPECT_STATUSES.filter(isTerminal)).toEqual(['chiuso_vinto', 'chiuso_perso', 'scartato']);
    expect(isProspectStatus('in_conversazione')).toBe(true);
    expect(isProspectStatus('selected')).toBe(false);
  });

  it('cambio libero (anche da terminale a nuovo): aggiorna status_changed_at e logga from/to', () => {
    const id = prospect();
    const won = changeStatus(id, 'chiuso_vinto', { note: 'Firmato' });
    expect(won).toMatchObject({ changed: true, from: 'nuovo', to: 'chiuso_vinto' });
    expect(won?.activity).toMatchObject({ kind: 'status_change', body: 'Firmato', from_status: 'nuovo', to_status: 'chiuso_vinto' });

    const back = changeStatus(id, 'nuovo');
    expect(back).toMatchObject({ changed: true, from: 'chiuso_vinto', to: 'nuovo' });
    expect(db.prepare('SELECT status_changed_at FROM prospects WHERE id = ?').pluck().get(id)).toBe(back?.activity?.occurred_at);

    expect(changeStatus(id, 'nuovo')).toMatchObject({ changed: false, activity: null });
    expect(timeline(id)).toHaveLength(2);
    expect(changeStatus(99999, 'nuovo')).toBeNull();
  });

  it('touchpoint + newStatus sono atomici: se il touchpoint fallisce, lo stato non cambia', () => {
    const id = prospect();
    // Canale fuori enum: il CHECK fa fallire l'insert del touchpoint, scritto dopo stato e status_change.
    const channel = 'fax' as unknown as 'email';
    expect(() => addTouchpoint(id, { channel, direction: 'outbound', newStatus: 'contattato' })).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' }),
    );
    expect(status(id)).toBe('nuovo');
    expect(timeline(id)).toHaveLength(0);
  });

  it('touchpoint con newStatus uguale allo stato attuale → solo il touchpoint', () => {
    const id = prospect();
    const result = addTouchpoint(id, { channel: 'linkedin_dm', direction: 'outbound', newStatus: 'nuovo' });
    expect(result?.statusChange).toMatchObject({ changed: false });
    expect(timeline(id).map((a) => a.kind)).toEqual(['touchpoint']);
    expect(result?.activity.meta).toBeNull();
  });

  it('changeStatus è annidabile in una transazione esterna (rollback complessivo)', () => {
    const id = prospect();
    expect(() =>
      db.transaction(() => {
        changeStatus(id, 'contattato');
        throw new Error('export fallito');
      })(),
    ).toThrow('export fallito');
    expect(status(id)).toBe('nuovo');
    expect(timeline(id)).toHaveLength(0);
  });

  it('addActivity registra eventi di sistema con meta JSON (export/analysis/enrichment)', () => {
    const id = prospect();
    const activity = addActivity({ prospectId: id, kind: 'analysis', meta: { error: 'refusal', icp_id: 3 } });
    expect(activity).toMatchObject({ kind: 'analysis', meta: { error: 'refusal', icp_id: 3 }, deletable: false });
    expect(timeline(id)[0].meta).toEqual({ error: 'refusal', icp_id: 3 });
  });
});
