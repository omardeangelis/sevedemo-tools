import { beforeEach, describe, expect, it } from 'vitest';

// Ricerca globale (people-first-crm T21, SPEC I2–I3, B5 = I2): persone con lo stesso filtro testo di Persone,
// aziende per nome, dominio e pagina LinkedIn. Import dinamici: la config (DB_PATH isolato) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/server/app.js');
const { upsertProspect } = await import('../src/db/prospects.js');
const { createPerson } = await import('../src/db/people.js');
const { createCompany } = await import('../src/db/companies.js');

const app = createApp();

async function search(q?: string) {
  const res = await app.request(q === undefined ? '/api/search' : `/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    people: Array<{ id: number; full_name: string; status: string; title: string | null; company_name: string | null; linked_company_name: string | null }>;
    people_total: number;
    companies: Array<{ id: number; name: string; domain: string | null; linkedin_url: string | null }>;
    companies_total: number;
  };
}

let seq = 0;
function jobsPerson(fullName: string, fields: Partial<Parameters<typeof upsertProspect>[0]> = {}): number {
  seq += 1;
  return upsertProspect({ linkedinUrl: `https://www.linkedin.com/in/cerca-${seq}`, fullName, ...fields }).id;
}
function manual(fullName: string, email: string, context?: string): number {
  const created = createPerson({ fullName, email, meeting: context ? { context, metOn: '2026-09-12' } : undefined });
  if (!created.ok) throw new Error(created.code);
  return created.id;
}

beforeEach(() => {
  db.exec('DELETE FROM prospects; DELETE FROM companies;');
});

describe('GET /api/search (I2, I3)', () => {
  it('"giu": persone per nome e per contesto dell\'incontro, le scartate con lo stato, al più 5 con il totale; aziende anche per dominio', async () => {
    const neri = manual('Giulia Neri', 'giulia@pagamenti.it');
    const verdi = jobsPerson('Giulia Verdi', { title: 'Marketing', companyName: 'Beta' });
    db.prepare(`UPDATE prospects SET status = 'scartato' WHERE id = ?`).run(verdi);
    const luigi = manual('Luigi Rossi', 'luigi@esempio.it', 'Cena da Giuseppe dopo il DevFest');
    for (const name of ['Giuseppe Bianchi', 'Giuseppe Neri', 'Giusi Conti', 'Giusto Riva']) jobsPerson(name);
    jobsPerson('Mario Rossi');
    const giunti = createCompany({ name: 'Giunti Editore', website: 'giunti.it' });
    const byDomain = createCompany({ name: 'Editoria Toscana', website: 'giuntina.example' });
    createCompany({ name: 'Acme', website: 'acme.it' });

    const res = await search('giu');
    expect(res.people_total).toBe(7);
    expect(res.people).toHaveLength(5);
    expect(res.people.map((p) => p.full_name)).not.toContain('Mario Rossi');
    // I nomi che iniziano col testo vengono prima; le scartate dopo, a parità.
    expect(res.people[0].full_name).toMatch(/^Giu/);
    expect(res.companies_total).toBe(2);
    expect(res.companies.map((c) => c.id).sort()).toEqual([giunti.id, byDomain.id].sort());
    expect(res.companies.find((c) => c.id === byDomain.id)).toMatchObject({ domain: 'giuntina.example' });

    const all = await search('giulia');
    expect(all.people.map((p) => p.id).sort()).toEqual([neri, verdi].sort());
    expect(all.people.find((p) => p.id === verdi)).toMatchObject({ status: 'scartato', title: 'Marketing', company_name: 'Beta' });
    expect((await search('devfest')).people.map((p) => p.id)).toEqual([luigi]);
  });

  it('meno di 2 caratteri o nessun testo → liste vuote; % e _ sono letterali; pagina LinkedIn dell\'azienda', async () => {
    jobsPerson('Anna 100% Rossi');
    jobsPerson('Anna_Bianchi');
    jobsPerson('Annabella Verdi');
    const empty = { people: [], people_total: 0, companies: [], companies_total: 0 };
    expect(await search('g')).toEqual(empty);
    expect(await search('  a ')).toEqual(empty);
    expect(await search()).toEqual(empty);

    expect((await search('0%')).people.map((p) => p.full_name)).toEqual(['Anna 100% Rossi']);
    expect((await search('a_b')).people.map((p) => p.full_name)).toEqual(['Anna_Bianchi']);

    const page = createCompany({ linkedin_url: 'https://www.linkedin.com/company/fabbrica-digitale', name: 'Fabbrica Digitale' });
    expect((await search('https://it.linkedin.com/company/fabbrica-digitale/about/')).companies.map((c) => c.id)).toEqual([page.id]);
  });

  it('persona collegata a un\'azienda si trova col nome dell\'azienda collegata (B5 = I2)', async () => {
    const nuvola = createCompany({ name: 'Nuvola Srl', website: 'nuvola.io' });
    const id = jobsPerson('Luca Bassi');
    db.prepare('UPDATE prospects SET company_id = ? WHERE id = ?').run(nuvola.id, id);
    const res = await search('nuvola');
    expect(res.people).toEqual([expect.objectContaining({ id, linked_company_name: 'Nuvola Srl' })]);
    expect(res.companies.map((c) => c.id)).toEqual([nuvola.id]);
  });
});
