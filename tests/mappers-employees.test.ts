import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fixture con persone e aziende fittizie, costruita sui layout di
// harvestapi/linkedin-company-employees: [0] Full annidato (firstName/lastName,
// location.linkedinText, experience), [1] Short da ricerca (name/position),
// [2] variante piatta (fullName/profileUrl/title/location stringa), [3] membro nascosto senza URL.
const here = path.dirname(fileURLToPath(import.meta.url));
const employees = JSON.parse(
  readFileSync(path.join(here, 'fixtures/harvestapi-company-employees.json'), 'utf8'),
) as any[];

describe('mapEmployees (T7): dipendenti → candidati company_employees', () => {
  it('3 candidati + 1 scartato senza URL', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    const r = mapEmployees(employees);
    expect(r.skipped).toBe(1);
    expect(r.candidates.map((c) => c.linkedinUrl)).toEqual([
      'https://www.linkedin.com/in/luca-inventato-cto',
      // URL in forma id membro ma `publicIdentifier` presente → slug pubblico
      'https://www.linkedin.com/in/sara-demo-eng',
      'https://www.linkedin.com/in/paolo-finto',
    ]);
    expect(r.candidates.map((c) => c.memberUrn)).toEqual([
      'ACoAAFakeEmployee0001LucaInv',
      'ACoAAFakeEmployee0002SaraDemo',
      undefined,
    ]);
    expect(r.candidates.every((c) => c.kind === 'company_employees')).toBe(true);
  });

  it('layout Full annidato: nome composto, ruolo dall\'esperienza corrente, località, about ed esperienze', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    const [luca] = mapEmployees(employees).candidates;
    expect(luca).toMatchObject({
      fullName: 'Luca Inventato',
      headline: 'CTO @ Acme Fittizia | Cloud, dati e team di prodotto',
      title: 'Chief Technology Officer',
      companyName: 'Acme Fittizia',
      location: 'Milano, Lombardia, Italia',
      about: expect.stringContaining('Acme Fittizia'),
      raw: employees[0],
    });
    expect(luca.experience).toHaveLength(2);
  });

  it('layout Short: headline da position, niente about/esperienze (non va marcato arricchito)', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    const sara = mapEmployees(employees).candidates[1];
    expect(sara).toMatchObject({
      fullName: 'Sara Demo',
      headline: 'Head of Engineering presso Acme Fittizia',
      location: 'Torino, Piemonte, Italia',
    });
    expect(sara.about).toBeUndefined();
    expect(sara.experience).toBeUndefined();
  });

  it('layout piatto: fullName/profileUrl/title/companyName/location stringa', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    const paolo = mapEmployees(employees).candidates[2];
    expect(paolo).toMatchObject({
      fullName: 'Paolo Finto',
      headline: 'VP Engineering | Acme Fittizia',
      title: 'VP Engineering',
      companyName: 'Acme Fittizia',
      location: 'Roma, Lazio, Italia',
    });
  });

  it('email della modalità Full+email letta in modo tollerante (email o emails[])', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    const base = { linkedinUrl: 'https://www.linkedin.com/in/anna-prova' };
    const { candidates } = mapEmployees([
      { ...base, email: 'anna@acme-fittizia.example' },
      { ...base, emails: [{ email: 'anna2@acme-fittizia.example', status: 'valid' }] },
      { ...base, emails: ['anna3@acme-fittizia.example'] },
      { ...base, emails: [] },
    ]);
    expect(candidates.map((c) => c.email)).toEqual([
      'anna@acme-fittizia.example',
      'anna2@acme-fittizia.example',
      'anna3@acme-fittizia.example',
      undefined,
    ]);
  });

  it('input vuoto o non valido → nessun candidato, nessun throw', async () => {
    const { mapEmployees } = await import('../src/acquisition/mappers/employees.js');
    expect(mapEmployees([])).toEqual({ candidates: [], skipped: 0 });
    expect(mapEmployees(null as any)).toEqual({ candidates: [], skipped: 0 });
  });
});
