import { describe, expect, it } from 'vitest';

const P = process.pid;
let seq = 0;
const url = () => `https://www.linkedin.com/in/t12-${P}-${++seq}`;

describe('reportBySourceDetail (T12): drill-down per sotto-fonte', () => {
  it('una riga per (strategy, source_detail) con conteggi corretti', async () => {
    const { reportBySourceDetail } = await import('../src/db/runs.js');
    const { upsertCandidate } = await import('../src/db/contacts.js');
    const s = `t12-${P}`;

    upsertCandidate({ linkedinUrl: url(), sourceStrategy: s, sourceDetail: 'commenter' });
    upsertCandidate({ linkedinUrl: url(), sourceStrategy: s, sourceDetail: 'commenter' });
    upsertCandidate({ linkedinUrl: url(), sourceStrategy: s, sourceDetail: 'company-expansion' });
    upsertCandidate({ linkedinUrl: url(), sourceStrategy: s }); // senza source_detail

    const rows = (await reportBySourceDetail()).filter((r) => r.strategy === s);
    const by = new Map(rows.map((r) => [r.source_detail, r.extracted]));
    expect(by.get('commenter')).toBe(2);
    expect(by.get('company-expansion')).toBe(1);
    expect(by.get('(non attribuito)')).toBe(1); // null → etichetta leggibile
  });
});
