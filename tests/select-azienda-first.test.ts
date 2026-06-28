import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

const PRIMARY = config.primaryStrategyId;
let seq = 0;
const newUrl = () => `https://www.linkedin.com/in/t10-${process.pid}-${++seq}`;

async function makeContact(o: {
  source: string;
  bucket: 'freelance' | 'azienda';
  sector: string;
  fit: number;
  lastEval?: string;
}): Promise<number> {
  const { upsertCandidate, updateScore } = await import('../src/db/contacts.js');
  const { db } = await import('../src/db/index.js');
  const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: o.source }).id;
  updateScore(id, {
    role: 'r',
    bucket: o.bucket,
    sector: o.sector,
    fitScore: o.fit,
    shortDescription: 'd',
    reason: 'x',
    signals: {},
  });
  if (o.lastEval) db.prepare('UPDATE contacts SET last_evaluated_at = ? WHERE id = ?').run(o.lastEval, id);
  return id;
}

describe('selectBucket (T10): azienda-first per la fonte primaria', () => {
  it('(a) a parità di fit in bucket azienda, il respondents è selezionato prima', async () => {
    const { selectBucket } = await import('../src/pipeline/select.js');
    const resp = await makeContact({ source: PRIMARY, bucket: 'azienda', sector: 'tech', fit: 100 });
    const other = await makeContact({ source: 'decisionmaker-people-search', bucket: 'azienda', sector: 'design', fit: 100 });

    const picked = selectBucket('azienda', 20, 50).map((c) => c.id);
    const mine = picked.filter((id) => id === resp || id === other);
    expect(mine).toEqual([resp, other]); // il respondents precede l'altro
  });

  it('(b) il boost agisce DENTRO il cap settore (discriminante: batte un non-resp dello stesso settore)', async () => {
    const { selectBucket } = await import('../src/pipeline/select.js');
    // target 3 → perSectorCap = ceil(3*0.6)=2. Settore 'tech' saturabile a 2.
    // 2 respondents tech + 1 NON-resp tech (timestamp PIÙ recente) + 1 non-resp design.
    // Senza boost il non-resp tech (più recente) entrerebbe e un respondents finirebbe overflow.
    // Con boost i 2 respondents tech vincono il cap; il non-resp tech va overflow; il design entra.
    const nTech = await makeContact({ source: 'decisionmaker-people-search', bucket: 'azienda', sector: 'tech', fit: 100, lastEval: '2030-01-09' });
    const r1 = await makeContact({ source: PRIMARY, bucket: 'azienda', sector: 'tech', fit: 100, lastEval: '2030-01-08' });
    const r2 = await makeContact({ source: PRIMARY, bucket: 'azienda', sector: 'tech', fit: 100, lastEval: '2030-01-07' });
    const d1 = await makeContact({ source: 'decisionmaker-people-search', bucket: 'azienda', sector: 'design', fit: 100, lastEval: '2030-01-06' });

    const picked = selectBucket('azienda', 3, 50).map((c) => c.id);
    expect(picked).toContain(r1);
    expect(picked).toContain(r2); // entrambi i respondents tech vincono il cap (solo col boost)
    expect(picked).toContain(d1); // il non-resp di un altro settore entra
    expect(picked).not.toContain(nTech); // il non-resp tech, pur più recente, è overflow
  });

  it('(c) bucket freelance invariato: nessun boost per fonte (ordina per fit/recency)', async () => {
    const { selectBucket } = await import('../src/pipeline/select.js');
    const respOld = await makeContact({ source: PRIMARY, bucket: 'freelance', sector: 'tech', fit: 100, lastEval: '2030-02-01' });
    const otherNew = await makeContact({ source: 'freelance-people-search', bucket: 'freelance', sector: 'tech', fit: 100, lastEval: '2030-02-09' });

    const picked = selectBucket('freelance', 20, 50).map((c) => c.id);
    const mine = picked.filter((id) => id === respOld || id === otherNew);
    // last_evaluated_at DESC → il più recente (non-resp) prima: niente azienda-first nel freelance.
    expect(mine).toEqual([otherNew, respOld]);
  });
});
