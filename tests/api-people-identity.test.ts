import { beforeEach, describe, expect, it } from 'vitest';

// Modifiche d'identità e Unisci (people-first-crm T7: E3–E8). Import dinamici: la config (DB_PATH isolato)
// è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect, addSource } = await import('../src/db/prospects.js');
const { createPerson } = await import('../src/db/people.js');
const { changeStatus } = await import('../src/db/activities.js');

const app = createApp();

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function manualPerson(fields: Parameters<typeof createPerson>[0]): number {
  const r = createPerson({ meeting: { context: 'DevFest Milano', metOn: '2026-09-12' }, ...fields });
  if (!r.ok) throw new Error(`creazione fallita: ${JSON.stringify(r)}`);
  return r.id;
}

const URL_X = 'https://www.linkedin.com/in/giulia-neri-123';
const URN_B = 'ACoAAFakeGiulia0001AbCdEfGhIj';

/** B: arrivata dai job con LinkedIn X, id membro, una reazione e un cambio di stato. */
function jobPerson(): number {
  const b = upsertProspect({ linkedinUrl: URL_X, memberUrn: URN_B, fullName: 'Giulia Neri', headline: 'CFO · Pagamenti Srl', location: 'Milano' }).id;
  const post = Number(db.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-1')`).run().lastInsertRowid);
  addSource(b, { kind: 'post_reaction', postId: post, reactionType: 'LIKE' });
  changeStatus(b, 'nuovo');
  return b;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
});

describe('LinkedIn su una persona manuale già trovata da un job → Unisci (E5, E6, E7, E8)', () => {
  it('PATCH A con X → 409 linkedin_taken mergeable; merge con la patch → resta A con X e l\'id membro di B; GET B → 404', async () => {
    const a = manualPerson({ fullName: 'Giulia Neri', email: 'giulia@pagamenti.it', status: 'qualificato' });
    const b = jobPerson();

    const conflict = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'linkedin.com/in/Giulia-Neri-123/' });
    expect(conflict.status).toBe(409);
    const body = await json(conflict);
    expect(body).toMatchObject({ code: 'linkedin_taken', mergeable: true, prospect: { id: b, full_name: 'Giulia Neri' } });
    expect((await json(await send('GET', `/api/prospects/${a}`))).linkedin_url).toBeNull();

    db.prepare(`UPDATE posts SET text_excerpt = 'Abbiamo migrato il monolite a Kubernetes in tre mesi'`).run();
    const icp = Number(db.prepare(`INSERT INTO icps (name) VALUES ('CTO startup IT')`).run().lastInsertRowid);
    db.prepare(
      `INSERT INTO analyses (prospect_id, icp_id, model, summary, angles, fit, input_hash) VALUES (?, ?, 'm', 's', '[]', 'medio', 'h')`,
    ).run(b, icp);

    const patch = { linkedin_url: 'linkedin.com/in/Giulia-Neri-123/' };
    const preview = await json(await send('GET', `/api/prospects/${a}/merge-preview?otherId=${b}&patch=${encodeURIComponent(JSON.stringify(patch))}`));
    // FLOW F.3: "1 fonte (Reazione a 'Abbiamo migrato…') · … · 1 analisi (CTO startup IT, fit medio)".
    expect(preview.moving_labels.sources).toEqual([expect.stringMatching(/^Reazione a 'Abbiamo migrato .*…'$/)]);
    expect(preview.moving_labels.analyses).toEqual(['CTO startup IT, fit medio']);
    expect(preview).toMatchObject({
      mergeable: true,
      moving: { sources: 1, lists: 0, activities: 0, analyses: 1 },
      linkedin: { url: URL_X, member_urn: URN_B, from: 'patch', member_urn_from: 'other' },
    });
    expect(preview.filled).toEqual(expect.arrayContaining(['headline', 'location']));
    expect(preview.conflicts).toContainEqual({ field: 'status', keep: 'qualificato', lose: 'nuovo' });

    const merged = await send('POST', `/api/prospects/${a}/merge`, { otherId: b, patch });
    expect(merged.status).toBe(200);
    const kept = await json(merged);
    expect(kept).toMatchObject({
      id: a,
      linkedin_url: URL_X,
      member_urn: URN_B,
      status: 'qualificato',
      email: 'giulia@pagamenti.it',
      headline: 'CFO · Pagamenti Srl',
    });
    expect(kept.sources.map((s: any) => s.kind).sort()).toEqual(['manual', 'post_reaction']);
    const statusChanges = kept.timeline.filter((t: any) => t.kind === 'status_change');
    expect(statusChanges).toHaveLength(1); // quello di A (stato iniziale Qualificato): l'unione non ne aggiunge
    expect((await send('GET', `/api/prospects/${b}`)).status).toBe(404);
  });

  it('due profili LinkedIn distinti (id membro diversi): nessuna unione, con il motivo', async () => {
    const a = manualPerson({ fullName: 'Mario Rossi', email: 'mario@x.it' });
    db.prepare(`UPDATE prospects SET member_urn = 'ACoAAFakeMario0001AbCdEfGhIjKl' WHERE id = ?`).run(a);
    const b = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mrossi', memberUrn: 'ACoAAFakeMario0002AbCdEfGhIjKl', fullName: 'Mario Rossi' }).id;

    const res = await json(await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'https://www.linkedin.com/in/mrossi' }));
    expect(res).toMatchObject({ code: 'linkedin_taken', mergeable: false });
    expect(res.reason).toMatch(/Mario Rossi ha un altro profilo LinkedIn \(linkedin\.com\/in\/mrossi\): sono due persone distinte/);
    const merge = await send('POST', `/api/prospects/${a}/merge`, { otherId: b, patch: { linkedin_url: 'https://www.linkedin.com/in/mrossi' } });
    expect(merge.status).toBe(409);
    expect(await json(merge)).toMatchObject({ code: 'not_mergeable' });

    // Stessa regola sull'email di altre persone: niente "Unisci", col motivo.
    db.prepare(`UPDATE prospects SET email = 'm@rossi.it' WHERE id = ?`).run(b);
    const email = await json(await send('PATCH', `/api/prospects/${a}`, { email: 'm@rossi.it' }));
    expect(email).toMatchObject({ code: 'email_taken', prospects: [{ id: b, mergeable: false }] });
    expect(email.prospects[0].reason).toMatch(/sono due persone distinte/);
  });

  it('unione nata dall\'email: la persona tenuta senza LinkedIn prende URL e id membro dell\'altra; i valori salvati restano', async () => {
    const a = manualPerson({ fullName: 'Giulia', phone: '+39 02' });
    const b = jobPerson();
    db.prepare(`UPDATE prospects SET email = 'giulia@pagamenti.it' WHERE id = ?`).run(b);

    const conflict = await json(await send('PATCH', `/api/prospects/${a}`, { email: 'Giulia@Pagamenti.it' }));
    expect(conflict).toMatchObject({ code: 'email_taken', prospects: [{ id: b, mergeable: true, reason: null }] });

    const patch = { email: 'Giulia@Pagamenti.it', full_name: 'Giulia N.' };
    const preview = await json(await send('GET', `/api/prospects/${a}/merge-preview?otherId=${b}&patch=${encodeURIComponent(JSON.stringify(patch))}`));
    expect(preview.linkedin).toMatchObject({ url: URL_X, member_urn: URN_B, from: 'other', member_urn_from: 'other' });
    expect(preview.conflicts).toContainEqual({ field: 'full_name', keep: 'Giulia N.', lose: 'Giulia Neri' });
    expect(preview.conflicts).toContainEqual({ field: 'email', keep: 'Giulia@Pagamenti.it', lose: 'giulia@pagamenti.it' });

    const kept = await json(await send('POST', `/api/prospects/${a}/merge`, { otherId: b, patch }));
    expect(kept).toMatchObject({ id: a, linkedin_url: URL_X, member_urn: URN_B, full_name: 'Giulia N.', email: 'Giulia@Pagamenti.it', phone: '+39 02' });
    expect(kept.manual_fields).toHaveProperty('email');
  });

  it('altra persona sparita → 404 other_not_found; persona inesistente → 404', async () => {
    const a = manualPerson({ fullName: 'A', email: 'a@x.it' });
    const res = await send('POST', `/api/prospects/${a}/merge`, { otherId: 999_999 });
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ code: 'other_not_found' });
    expect((await send('GET', `/api/prospects/${a}/merge-preview?otherId=999999`)).status).toBe(404);
    expect((await send('POST', '/api/prospects/999999/merge', { otherId: a })).status).toBe(404);
  });
});

describe('modifica del profilo LinkedIn (E3) e dell\'email (E5)', () => {
  it('si aggiunge libero, si corregge finché ci sono solo fonti manuali, poi è bloccato', async () => {
    const a = manualPerson({ fullName: 'Luca', email: 'luca@x.it' });
    const added = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'https://www.linkedin.com/in/luca-b/' });
    expect(added.status).toBe(200);
    expect((await json(added)).linkedin_url).toBe('https://www.linkedin.com/in/luca-b');

    const fixed = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'https://www.linkedin.com/in/luca-bassi' });
    expect((await json(fixed)).linkedin_url).toBe('https://www.linkedin.com/in/luca-bassi');

    const post = Number(db.prepare(`INSERT INTO posts (post_url) VALUES ('https://www.linkedin.com/posts/p-9')`).run().lastInsertRowid);
    addSource(a, { kind: 'post_comment', postId: post, commentText: 'x' });
    const locked = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'https://www.linkedin.com/in/altro' });
    expect(locked.status).toBe(409);
    expect(await json(locked)).toMatchObject({ code: 'linkedin_locked' });
    // Stesso valore (anche in forma diversa): nessun cambio, nessun errore.
    expect((await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'linkedin.com/in/Luca-Bassi' })).status).toBe(200);
  });

  it('svuotarlo → 400 linkedin_required; URL non di una persona → 400 invalid_linkedin; email malformata → 400', async () => {
    const a = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/x' }).id;
    const cleared = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: '' });
    expect(cleared.status).toBe(400);
    expect(await json(cleared)).toMatchObject({ code: 'linkedin_required', error: 'Il profilo LinkedIn non si può rimuovere.' });
    const bad = await send('PATCH', `/api/prospects/${a}`, { linkedin_url: 'https://www.linkedin.com/company/acme' });
    expect(await json(bad)).toMatchObject({ code: 'invalid_linkedin' });
    const email = await send('PATCH', `/api/prospects/${a}`, { email: 'non valida' });
    expect(email.status).toBe(400);
    expect(await json(email)).toMatchObject({ code: 'invalid_email', error: 'Email non valida (es. nome@azienda.it).' });
  });

  it('email di altre persone: 409 email_taken, poi "Salva comunque"; stessa email (maiuscole) di sé stessi: nessun conflitto', async () => {
    const mario = upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/mario', fullName: 'Mario Rossi', email: 'info@beta.it' }).id;
    const a = manualPerson({ fullName: 'Anna', email: 'anna@beta.it' });
    const res = await send('PATCH', `/api/prospects/${a}`, { email: 'INFO@beta.it' });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'email_taken', prospects: [{ id: mario, full_name: 'Mario Rossi' }] });

    const forced = await send('PATCH', `/api/prospects/${a}`, { email: 'INFO@beta.it', confirm_email_duplicate: true });
    expect(forced.status).toBe(200);
    expect((await send('PATCH', `/api/prospects/${mario}`, { email: 'Info@Beta.it' })).status).toBe(200);
  });
});
