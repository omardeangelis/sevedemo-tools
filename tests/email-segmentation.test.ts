import { describe, expect, it } from 'vitest';

async function makeApp() {
  const { createApp } = await import('../src/server/app.js');
  return createApp();
}

type ContactRowLike = {
  id: number;
  email: string | null;
  full_name: string | null;
};

/** Inserisce un contatto minimale e ritorna l'id. */
async function seedContact(over: {
  full_name?: string | null;
  email?: string | null;
  bucket?: string | null;
  status?: string;
  fit_score?: number | null;
  source_strategy?: string | null;
  linkedin_url?: string;
}): Promise<number> {
  const { db, nowIso } = await import('../src/db/index.js');
  const url = over.linkedin_url ?? `https://www.linkedin.com/in/c-${Math.random().toString(36).slice(2)}`;
  const info = db
    .prepare(
      `INSERT INTO contacts
         (linkedin_url, full_name, email, bucket, sector, fit_score, source_strategy, status, first_seen_at, last_evaluated_at)
       VALUES (?, ?, ?, ?, 'tech', ?, ?, ?, ?, ?)`,
    )
    .run(
      url,
      over.full_name ?? 'Mario Rossi',
      over.email === undefined ? null : over.email,
      over.bucket ?? 'freelance',
      over.fit_score === undefined ? 50 : over.fit_score,
      over.source_strategy ?? 'strat-a',
      over.status ?? 'scored',
      nowIso(),
      nowIso(),
    );
  return Number(info.lastInsertRowid);
}

async function clearContacts() {
  const { db } = await import('../src/db/index.js');
  db.prepare('DELETE FROM daily_selection').run();
  db.prepare('DELETE FROM contacts').run();
}

describe('/api/contacts email filter (S1)', () => {
  it('email=with ritorna solo contatti con email non vuota; without solo senza; compone con bucket; q non scavalca', async () => {
    await clearContacts();
    const app = await makeApp();

    // Misti per email e bucket.
    await seedContact({ full_name: 'Con Email FL', email: 'con@mail.it', bucket: 'freelance' });
    await seedContact({ full_name: 'Null Email FL', email: null, bucket: 'freelance' });
    await seedContact({ full_name: 'Empty Email FL', email: '', bucket: 'freelance' });
    await seedContact({ full_name: 'Con Email AZ', email: 'altro@mail.it', bucket: 'azienda' });

    const withRes = await app.request('/api/contacts?email=with');
    expect(withRes.status).toBe(200);
    const withBody = (await withRes.json()) as { items: ContactRowLike[]; total: number };
    expect(withBody.total).toBe(2);
    expect(withBody.items.every((r) => r.email != null && r.email !== '')).toBe(true);

    const withoutRes = await app.request('/api/contacts?email=without');
    const withoutBody = (await withoutRes.json()) as { items: ContactRowLike[]; total: number };
    expect(withoutBody.total).toBe(2);
    expect(withoutBody.items.every((r) => r.email == null || r.email === '')).toBe(true);

    // Composizione con bucket.
    const composed = await app.request('/api/contacts?email=with&bucket=freelance');
    const composedBody = (await composed.json()) as { items: ContactRowLike[]; total: number };
    expect(composedBody.total).toBe(1);
    expect(composedBody.items[0]?.full_name).toBe('Con Email FL');

    // Composizione con q: un q che matcha un frammento di email NON deve far comparire
    // righe con email quando email=without è attivo.
    await clearContacts();
    await seedContact({ full_name: 'Ha mail', email: 'mario@target.it' });
    await seedContact({ full_name: 'target nel nome', email: null });
    const qRes = await app.request('/api/contacts?q=target&email=without');
    const qBody = (await qRes.json()) as { items: ContactRowLike[]; total: number };
    expect(qBody.total).toBe(1);
    expect(qBody.items.every((r) => r.email == null || r.email === '')).toBe(true);
    expect(qBody.items[0]?.full_name).toBe('target nel nome');
  });

  it('email param non valido viene ignorato (ritorna tutti)', async () => {
    await clearContacts();
    const app = await makeApp();
    await seedContact({ email: 'x@y.it' });
    await seedContact({ email: null });

    const res = await app.request('/api/contacts?email=garbage');
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(2);
  });
});

describe('/api/selections/:date/candidates email filter (S2)', () => {
  const DATE = '2026-06-13';

  async function addSelection(date: string, contactId: number, bucket: string, rank: number) {
    const { db } = await import('../src/db/index.js');
    db.prepare('INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES (?, ?, ?, ?)').run(
      date,
      bucket,
      contactId,
      rank,
    );
  }

  it('email=with elenca solo candidati con email; without solo senza; esclude i già selezionati', async () => {
    await clearContacts();
    const app = await makeApp();

    // Candidati scored del bucket freelance, misti per email.
    await seedContact({ full_name: 'Cand con email', email: 'cand@mail.it', bucket: 'freelance', status: 'scored', fit_score: 80 });
    await seedContact({ full_name: 'Cand email null', email: null, bucket: 'freelance', status: 'scored', fit_score: 70 });
    await seedContact({ full_name: 'Cand email vuota', email: '', bucket: 'freelance', status: 'scored', fit_score: 60 });
    // Uno già nella selezione del giorno → deve essere escluso a prescindere dal filtro.
    const inSel = await seedContact({ full_name: 'Gia selezionato', email: 'sel@mail.it', bucket: 'freelance', status: 'selected', fit_score: 90 });
    await addSelection(DATE, inSel, 'freelance', 1);

    const withRes = await app.request(`/api/selections/${DATE}/candidates?bucket=freelance&email=with`);
    expect(withRes.status).toBe(200);
    const withBody = (await withRes.json()) as Array<{ email: string | null; full_name: string | null }>;
    expect(withBody).toHaveLength(1);
    expect(withBody[0]?.full_name).toBe('Cand con email');
    expect(withBody.every((r) => r.email != null && r.email !== '')).toBe(true);

    const withoutRes = await app.request(`/api/selections/${DATE}/candidates?bucket=freelance&email=without`);
    const withoutBody = (await withoutRes.json()) as Array<{ email: string | null }>;
    expect(withoutBody).toHaveLength(2);
    expect(withoutBody.every((r) => r.email == null || r.email === '')).toBe(true);

    // Senza filtro: tutti e 3 i non-selezionati.
    const allRes = await app.request(`/api/selections/${DATE}/candidates?bucket=freelance`);
    const allBody = (await allRes.json()) as unknown[];
    expect(allBody).toHaveLength(3);
  });
});

describe('selection export email_ready + email filter (S3)', () => {
  const DATE = '2026-06-14';

  async function seedSelected(over: { full_name: string; email: string | null; bucket: string }, rank: number) {
    const id = await seedContact({
      full_name: over.full_name,
      email: over.email,
      bucket: over.bucket,
      status: 'selected',
      fit_score: 75,
    });
    const { db } = await import('../src/db/index.js');
    db.prepare('INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES (?, ?, ?, ?)').run(
      DATE,
      over.bucket,
      id,
      rank,
    );
    return id;
  }

  it('CSV ha colonna email_ready in coda con celle coerenti; export.csv?email=with omette i senza email', async () => {
    await clearContacts();
    const app = await makeApp();
    await seedSelected({ full_name: 'Ready One', email: 'ready@mail.it', bucket: 'freelance' }, 1);
    await seedSelected({ full_name: 'No Email', email: null, bucket: 'freelance' }, 2);
    await seedSelected({ full_name: 'Empty Email', email: '', bucket: 'azienda' }, 1);

    const csvRes = await app.request(`/api/selections/${DATE}/export.csv`);
    expect(csvRes.status).toBe(200);
    const csv = await csvRes.text();
    const lines = csv.split('\n');
    const header = lines[0]!.split(',');
    expect(header[header.length - 1]).toBe('email_ready');

    // La cella email_ready è l'ultima di ogni riga.
    const dataLines = lines.slice(1).filter((l) => l.length > 0);
    const lastCells = dataLines.map((l) => l.split(',').pop());
    expect(lastCells.filter((v) => v === 'true')).toHaveLength(1);
    expect(lastCells.filter((v) => v === 'false')).toHaveLength(2);

    // Filtro email=with: solo la riga con email valorizzata.
    const filteredRes = await app.request(`/api/selections/${DATE}/export.csv?email=with`);
    const filtered = await filteredRes.text();
    const filteredData = filtered.split('\n').slice(1).filter((l) => l.length > 0);
    expect(filteredData).toHaveLength(1);
    expect(filtered).toContain('Ready One');
    expect(filtered).not.toContain('No Email');
  });

  it('export.json espone email_ready booleano per riga e filtra con email=without', async () => {
    await clearContacts();
    const app = await makeApp();
    await seedSelected({ full_name: 'Ready One', email: 'ready@mail.it', bucket: 'freelance' }, 1);
    await seedSelected({ full_name: 'No Email', email: null, bucket: 'freelance' }, 2);

    const jsonRes = await app.request(`/api/selections/${DATE}/export.json`);
    const payload = (await jsonRes.json()) as Array<{ full_name: string; email_ready: boolean }>;
    expect(payload).toHaveLength(2);
    const byName = new Map(payload.map((r) => [r.full_name, r]));
    expect(byName.get('Ready One')?.email_ready).toBe(true);
    expect(byName.get('No Email')?.email_ready).toBe(false);

    const withoutRes = await app.request(`/api/selections/${DATE}/export.json?email=without`);
    const withoutPayload = (await withoutRes.json()) as Array<{ full_name: string; email_ready: boolean }>;
    expect(withoutPayload).toHaveLength(1);
    expect(withoutPayload[0]?.full_name).toBe('No Email');
    expect(withoutPayload[0]?.email_ready).toBe(false);
  });
});

describe('/api/contacts/export.csv|.json filtered export (S4)', () => {
  it('export.csv ritorna tutti i contatti filtrati con colonna email_ready, ignora la paginazione', async () => {
    await clearContacts();
    const app = await makeApp();
    // 30 contatti con email + 5 senza, per superare un'eventuale pageSize.
    for (let i = 0; i < 30; i++) {
      await seedContact({ full_name: `Con ${i}`, email: `c${i}@mail.it`, bucket: 'freelance', status: 'scored' });
    }
    for (let i = 0; i < 5; i++) {
      await seedContact({ full_name: `Senza ${i}`, email: null, bucket: 'freelance', status: 'scored' });
    }

    const res = await app.request('/api/contacts/export.csv?pageSize=10&page=2');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="contacts-export.csv"');
    const csv = await res.text();
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines[0]!.split(',').pop()).toBe('email_ready');
    // 1 header + 35 righe: la paginazione è ignorata.
    expect(lines).toHaveLength(36);

    // email=with filtra agli email-ready.
    const withRes = await app.request('/api/contacts/export.csv?email=with');
    const withLines = (await withRes.text()).split('\n').filter((l) => l.length > 0);
    expect(withLines).toHaveLength(31); // header + 30

    // Composizione status+bucket.
    const composed = await app.request('/api/contacts/export.csv?status=scored&bucket=freelance');
    const composedLines = (await composed.text()).split('\n').filter((l) => l.length > 0);
    expect(composedLines).toHaveLength(36);
  });

  it('export.json espone email_ready per riga e filtra con email=without', async () => {
    await clearContacts();
    const app = await makeApp();
    await seedContact({ full_name: 'Has', email: 'has@mail.it' });
    await seedContact({ full_name: 'Hasnt', email: null });

    const res = await app.request('/api/contacts/export.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="contacts-export.json"');
    const payload = (await res.json()) as Array<{ full_name: string; email_ready: boolean }>;
    expect(payload).toHaveLength(2);
    const byName = new Map(payload.map((r) => [r.full_name, r]));
    expect(byName.get('Has')?.email_ready).toBe(true);
    expect(byName.get('Hasnt')?.email_ready).toBe(false);

    const withoutRes = await app.request('/api/contacts/export.json?email=without');
    const withoutPayload = (await withoutRes.json()) as Array<{ full_name: string }>;
    expect(withoutPayload).toHaveLength(1);
    expect(withoutPayload[0]?.full_name).toBe('Hasnt');
  });
});
