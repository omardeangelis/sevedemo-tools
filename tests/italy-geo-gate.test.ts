import { describe, it, expect, vi } from 'vitest';
import type { ContactRow } from '../src/db/contacts.js';

// Gate geografico Italia (spec: italy-geo-gate). Funzioni pure in src/pipeline/geo-gate.ts
// + tombstone DB in src/db/contacts.ts. Import dinamici, coerenti col resto della suite.

/** Costruttore di ContactRow finti per i test di partizione pura (nessun DB). */
function row(p: Partial<ContactRow>): ContactRow {
  return {
    id: 0, linkedin_url: '', full_name: null, headline: null, about: null, location: null,
    email: null, phone: null, company: null, role: null, bucket: null, sector: null,
    fit_score: null, short_description: null, score_reason: null, signals: null,
    source_strategy: null, source_post_url: null, email_subject: null, email_body: null,
    status: 'enriched', raw_json: null, first_seen_at: '', last_evaluated_at: null, ...p,
  };
}

describe('classifyLocation — T1', () => {
  it('token-paese Italia → italy (case-insensitive + trim)', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('Milano, Lombardia, Italia')).toBe('italy');
    expect(classifyLocation('Italy')).toBe('italy');
    expect(classifyLocation('ITALIA')).toBe('italy');
    expect(classifyLocation('  italia  ')).toBe('italy');
  });

  it('città/regione italiana (forma IT ed EN) → italy', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    for (const loc of ['Roma', 'Rome', 'Milan', 'Firenze', 'Florence']) {
      expect(classifyLocation(loc)).toBe('italy');
    }
    for (const loc of ['Lombardia', 'Sicily', 'Toscana']) {
      expect(classifyLocation(loc)).toBe('italy');
    }
    expect(classifyLocation('Greater Milan Metropolitan Area')).toBe('italy');
  });

  it('paese estero (anche solo il paese, caso bug reale) → foreign', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('Cyprus')).toBe('foreign');
    expect(classifyLocation('San Francisco, California, United States')).toBe('foreign');
    expect(classifyLocation('Somalia')).toBe('foreign');
  });

  it('varianti/abbreviazioni estere → foreign', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('London, United Kingdom')).toBe('foreign');
    expect(classifyLocation('USA')).toBe('foreign');
    expect(classifyLocation('U.S.')).toBe('foreign');
    expect(classifyLocation('UAE')).toBe('foreign');
  });

  it('word-boundary: "india" non matcha dentro "indiana" → vince il paese estero', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('Indiana, United States')).toBe('foreign');
  });

  it('Svizzera italofona resta foreign (paese estero, step 1)', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('Lugano, Switzerland')).toBe('foreign');
  });

  it('enclavi italofone San Marino e Città del Vaticano → italy (D8)', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('San Marino')).toBe('italy');
    expect(classifyLocation('Repubblica di San Marino')).toBe('italy');
    expect(classifyLocation('Città del Vaticano')).toBe('italy');
    expect(classifyLocation('Vatican City')).toBe('italy');
    expect(classifyLocation('Holy See')).toBe('italy');
  });

  it('collisione: la città californiana "San Marino" resta foreign (paese estero domina)', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('San Marino, California, United States')).toBe('foreign');
  });

  it('nessun paese estero presente → vince la città IT (step 3)', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('Milano, then London')).toBe('italy');
  });

  it('vuoto / nessun token riconosciuto → unknown', async () => {
    const { classifyLocation } = await import('../src/pipeline/geo-gate.js');
    expect(classifyLocation('')).toBe('unknown');
    expect(classifyLocation(null)).toBe('unknown');
    expect(classifyLocation(undefined)).toBe('unknown');
    expect(classifyLocation('Remote')).toBe('unknown');
    expect(classifyLocation('Earth')).toBe('unknown');
  });
});

describe('locationFromRaw — T2', () => {
  it('path primario reale: location.linkedinText', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(
      locationFromRaw({
        location: { linkedinText: 'Cyprus' },
        currentPositions: [{ title: 'Global Talent Acquisition Business Partner' }],
      }),
    ).toBe('Cyprus');
    expect(locationFromRaw({ location: { linkedinText: 'Roma, Lazio, Italia' } })).toBe(
      'Roma, Lazio, Italia',
    );
  });

  it('linkedinText ha precedenza sui fallback', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(
      locationFromRaw({ location: { linkedinText: 'Cyprus' }, geoLocation: 'Italia' }),
    ).toBe('Cyprus');
  });

  it('forme alternative: location stringa, parsed.text, fallback top-level', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(locationFromRaw({ location: 'Milano, Italia' })).toBe('Milano, Italia');
    expect(locationFromRaw({ location: { parsed: { text: 'Roma' } } })).toBe('Roma');
    expect(locationFromRaw({ geoLocation: 'X' })).toBe('X');
    expect(locationFromRaw({ addressWithCountry: 'X' })).toBe('X');
    expect(locationFromRaw({ addressWithoutCountry: 'X' })).toBe('X');
  });

  it('vuoto / assente → undefined', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(locationFromRaw({ location: { linkedinText: '' } })).toBeUndefined();
    expect(locationFromRaw({ location: {} })).toBeUndefined();
    expect(locationFromRaw({ location: null })).toBeUndefined();
    expect(locationFromRaw({})).toBeUndefined();
  });

  it('totale: input non-oggetto → undefined (mai throw)', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(locationFromRaw(null)).toBeUndefined();
    expect(locationFromRaw(undefined)).toBeUndefined();
    expect(locationFromRaw('stringa')).toBeUndefined();
    expect(locationFromRaw(42)).toBeUndefined();
  });

  it('payload dev_fusion (location sotto source) → undefined — comportamento voluto, bloccato', async () => {
    const { locationFromRaw } = await import('../src/pipeline/geo-gate.js');
    expect(locationFromRaw({ experience: [], source: { location: 'Milano' } })).toBeUndefined();
  });
});

describe('applyGeoGate — T3', () => {
  it("mode='pre' (conservativo): tiene IT e unknown, scarta solo foreign", async () => {
    const { applyGeoGate } = await import('../src/pipeline/geo-gate.js');
    const rows = [
      row({ id: 1, raw_json: JSON.stringify({ location: { linkedinText: 'Milano' } }) }),
      row({ id: 2, raw_json: JSON.stringify({ location: { linkedinText: 'Cyprus' } }) }),
      row({ id: 3, raw_json: null }),
    ];
    const { kept, rejected } = applyGeoGate(rows, 'pre');
    expect(kept.map((r) => r.id)).toEqual([1, 3]);
    expect(rejected.map((r) => r.id)).toEqual([2]);
  });

  it("mode='post' (strict): tiene solo italy, scarta foreign E unknown", async () => {
    const { applyGeoGate } = await import('../src/pipeline/geo-gate.js');
    const rows = [
      row({ id: 1, location: 'Milano, Lombardia, Italia' }),
      row({ id: 2, location: 'Cyprus' }),
      row({ id: 3, location: null }),
    ];
    const { kept, rejected } = applyGeoGate(rows, 'post');
    expect(kept.map((r) => r.id)).toEqual([1]);
    expect(rejected.map((r) => r.id)).toEqual([2, 3]);
  });

  it('pre: raw_json NULL o JSON non valido → unknown → kept (try/catch, mai throw)', async () => {
    const { applyGeoGate } = await import('../src/pipeline/geo-gate.js');
    const rows = [row({ id: 1, raw_json: '{bad json' }), row({ id: 2, raw_json: null })];
    const { kept, rejected } = applyGeoGate(rows, 'pre');
    expect(kept.map((r) => r.id)).toEqual([1, 2]);
    expect(rejected).toEqual([]);
  });

  it('input vuoto → { kept: [], rejected: [] } in entrambe le modalità', async () => {
    const { applyGeoGate } = await import('../src/pipeline/geo-gate.js');
    expect(applyGeoGate([], 'pre')).toEqual({ kept: [], rejected: [] });
    expect(applyGeoGate([], 'post')).toEqual({ kept: [], rejected: [] });
  });

  it('ordine delle righe preservato', async () => {
    const { applyGeoGate } = await import('../src/pipeline/geo-gate.js');
    const rows = [
      row({ id: 10, raw_json: JSON.stringify({ location: { linkedinText: 'Cyprus' } }) }),
      row({ id: 11, raw_json: JSON.stringify({ location: { linkedinText: 'Roma' } }) }),
      row({ id: 12, raw_json: null }),
    ];
    const { kept } = applyGeoGate(rows, 'pre');
    expect(kept.map((r) => r.id)).toEqual([11, 12]);
  });
});

describe('markRejectedGeo — T4', () => {
  it('tombstone: status=rejected_geo + last_evaluated_at; isFresh diventa true', async () => {
    const { db, nowIso } = await import('../src/db/index.js');
    const { markRejectedGeo, isFresh, getById } = await import('../src/db/contacts.js');
    const info = db
      .prepare(
        `INSERT INTO contacts (linkedin_url, first_seen_at, status, last_evaluated_at)
         VALUES (?, ?, 'enriched', NULL)`,
      )
      .run('https://www.linkedin.com/in/geo-t4-1', nowIso());
    const id = Number(info.lastInsertRowid);

    expect(isFresh(id, 90)).toBe(false); // last_evaluated_at NULL ⇒ verrebbe ri-processato
    markRejectedGeo(id);

    const r = getById(id)!;
    expect(r.status).toBe('rejected_geo');
    expect(r.last_evaluated_at).not.toBeNull();
    // ⇒ in persist il ramo !isFresh(id) è falso ⇒ niente ri-enrichment nei run futuri (OQ#3).
    expect(isFresh(id, 90)).toBe(true);
  });

  it('idempotente su doppia chiamata; id inesistente non lancia', async () => {
    const { db, nowIso } = await import('../src/db/index.js');
    const { markRejectedGeo, getById } = await import('../src/db/contacts.js');
    const info = db
      .prepare(`INSERT INTO contacts (linkedin_url, first_seen_at, status) VALUES (?, ?, 'enriched')`)
      .run('https://www.linkedin.com/in/geo-t4-2', nowIso());
    const id = Number(info.lastInsertRowid);

    markRejectedGeo(id);
    expect(() => markRejectedGeo(id)).not.toThrow();
    expect(getById(id)!.status).toBe('rejected_geo');
    expect(() => markRejectedGeo(999_999)).not.toThrow();
  });
});

describe('runGeoGatePre / runGeoGatePost — T5', () => {
  async function deps() {
    const { db, nowIso } = await import('../src/db/index.js');
    const gate = await import('../src/pipeline/geo-gate.js');
    const { getById, getByIds } = await import('../src/db/contacts.js');
    const seedRaw = (url: string, raw: string | null): number =>
      Number(
        db
          .prepare(
            `INSERT INTO contacts (linkedin_url, first_seen_at, status, raw_json)
             VALUES (?, ?, 'enriched', ?)`,
          )
          .run(url, nowIso(), raw).lastInsertRowid,
      );
    const seedLoc = (url: string, loc: string | null): number =>
      Number(
        db
          .prepare(
            `INSERT INTO contacts (linkedin_url, first_seen_at, status, location)
             VALUES (?, ?, 'enriched', ?)`,
          )
          .run(url, nowIso(), loc).lastInsertRowid,
      );
    return { gate, getById, getByIds, seedRaw, seedLoc };
  }

  it('pre: ritorna solo i kept; i rejected sono rejected_geo nel DB', async () => {
    const { gate, getById, getByIds, seedRaw } = await deps();
    const it = seedRaw('https://www.linkedin.com/in/geo-t5-pre-it', JSON.stringify({ location: { linkedinText: 'Milano' } }));
    const fr = seedRaw('https://www.linkedin.com/in/geo-t5-pre-fr', JSON.stringify({ location: { linkedinText: 'Cyprus' } }));
    const unk = seedRaw('https://www.linkedin.com/in/geo-t5-pre-unk', null);

    const kept = gate.runGeoGatePre(getByIds([it, fr, unk]));
    expect(kept.map((r) => r.id).sort((a, b) => a - b)).toEqual([it, unk].sort((a, b) => a - b));
    expect(getById(fr)!.status).toBe('rejected_geo');
    expect(getById(it)!.status).toBe('enriched'); // kept: intatto
    expect(getById(unk)!.status).toBe('enriched'); // unknown prosegue nel pre
  });

  it('post: strict — tiene solo italy; foreign e unknown tombstonati', async () => {
    const { gate, getById, getByIds, seedLoc } = await deps();
    const it = seedLoc('https://www.linkedin.com/in/geo-t5-post-it', 'Milano, Italia');
    const fr = seedLoc('https://www.linkedin.com/in/geo-t5-post-fr', 'Cyprus');
    const unk = seedLoc('https://www.linkedin.com/in/geo-t5-post-unk', null);

    const kept = gate.runGeoGatePost(getByIds([it, fr, unk]));
    expect(kept.map((r) => r.id)).toEqual([it]);
    expect(getById(fr)!.status).toBe('rejected_geo');
    expect(getById(unk)!.status).toBe('rejected_geo');
  });

  it('tutti esteri → [] e tutti tombstonati', async () => {
    const { gate, getById, getByIds, seedLoc } = await deps();
    const a = seedLoc('https://www.linkedin.com/in/geo-t5-all-1', 'Cyprus');
    const b = seedLoc('https://www.linkedin.com/in/geo-t5-all-2', 'London, United Kingdom');

    const kept = gate.runGeoGatePost(getByIds([a, b]));
    expect(kept).toEqual([]);
    expect(getById(a)!.status).toBe('rejected_geo');
    expect(getById(b)!.status).toBe('rejected_geo');
  });

  it('input vuoto → [] e nessuna scrittura DB', async () => {
    const { gate } = await deps();
    const contacts = await import('../src/db/contacts.js');
    const spy = vi.spyOn(contacts, 'markRejectedGeo');
    expect(gate.runGeoGatePre([])).toEqual([]);
    expect(gate.runGeoGatePost([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fail-open: se markRejectedGeo lancia, ritorna rows intatte + warning', async () => {
    const { gate } = await deps();
    const contacts = await import('../src/db/contacts.js');
    const spy = vi.spyOn(contacts, 'markRejectedGeo').mockImplementation(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const rows = [row({ id: 1, raw_json: JSON.stringify({ location: { linkedinText: 'Cyprus' } }) })];
    const out = gate.runGeoGatePre(rows);

    expect(out).toBe(rows); // best-effort: nessuna riga persa
    expect(warn).toHaveBeenCalled();

    spy.mockRestore();
    warn.mockRestore();
  });
});
