import { describe, expect, it, vi } from 'vitest';

// Confini esterni mockati: enrichProfileDetails (Apify) e l'SDK Anthropic (bozze).
const { enrichMock, createMock } = vi.hoisted(() => ({ enrichMock: vi.fn(), createMock: vi.fn() }));
vi.mock('../src/enrich/profile-detail.js', () => ({ enrichProfileDetails: enrichMock }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

let seq = 0;
function newUrl(): string {
  seq += 1;
  return `https://www.linkedin.com/in/enrichsel-${process.pid}-${seq}`;
}
const score = (bucket: string) => ({
  role: 'r',
  bucket,
  sector: 'tech',
  fitScore: 80,
  shortDescription: 'd',
  reason: 'x',
  signals: {},
});
const draftReply = {
  content: [{ type: 'tool_use', input: { subject: 'Oggetto', body: 'Corpo' } }],
};

async function mods() {
  const contacts = await import('../src/db/contacts.js');
  const runs = await import('../src/db/runs.js');
  const { enrichSelectionEmails } = await import('../src/pipeline/enrich-selection.js');
  return { ...contacts, ...runs, enrichSelectionEmails };
}

describe('enrichSelectionEmails', () => {
  it('recupera email → bozza; miss → tentato senza bozza; entrambi timbrati; status preservato', async () => {
    const { upsertCandidate, updateScore, saveSelection, getById, enrichSelectionEmails } =
      await mods();
    const a = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const c = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(a, score('freelance'));
    updateScore(c, score('freelance'));
    const urlA = getById(a)!.linkedin_url;

    saveSelection(
      '2099-05-01',
      [
        { bucket: 'freelance', contactId: a, rank: 1 },
        { bucket: 'freelance', contactId: c, rank: 2 },
      ],
      '2099-05-01-1',
    );

    enrichMock.mockReset();
    enrichMock.mockResolvedValue(new Map([[urlA, { email: 'a@x.it' }]])); // c assente → miss
    createMock.mockReset();
    createMock.mockResolvedValue(draftReply);

    const summary = await enrichSelectionEmails({ date: '2099-05-01' });

    expect(summary).toEqual({
      eligible: 2,
      attempted: 2,
      emailsRecovered: 1,
      draftsGenerated: 1,
      skippedFresh: 0,
    });

    const rowA = getById(a)!;
    expect(rowA.email).toBe('a@x.it');
    expect(rowA.email_subject).toBe('Oggetto');
    expect(rowA.status).toBe('scored'); // status preservato

    const rowC = getById(c)!;
    expect(rowC.email).toBeNull();
    expect(rowC.last_enrichment_attempt_at).toBeTruthy(); // tentativo timbrato anche sul miss
    expect(rowC.status).toBe('scored');

    expect(createMock).toHaveBeenCalledTimes(1); // bozza solo per chi ha recuperato l'email
  });

  it('contatto fresh → skippedFresh, non ritentato (nessuna spesa Apify)', async () => {
    const {
      upsertCandidate,
      updateScore,
      applyProgressiveEnrichment,
      saveSelection,
      enrichSelectionEmails,
    } = await mods();
    const f = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(f, score('freelance'));
    applyProgressiveEnrichment(f, {}, 'prev-actor'); // timbra ora → fresco
    saveSelection('2099-05-02', [{ bucket: 'freelance', contactId: f, rank: 1 }], '2099-05-02-1');

    enrichMock.mockReset();
    const summary = await enrichSelectionEmails({ date: '2099-05-02' });

    expect(summary.eligible).toBe(1);
    expect(summary.skippedFresh).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it('solo le selezioni in_review sono bersaglio (exported escluse)', async () => {
    const { upsertCandidate, updateScore, saveSelection, getById, enrichSelectionEmails } =
      await mods();
    const { db } = await import('../src/db/index.js');
    const e = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(e, score('freelance'));
    saveSelection('2099-05-03', [{ bucket: 'freelance', contactId: e, rank: 1 }], '2099-05-03-1');
    db.prepare("UPDATE daily_selection SET state = 'exported' WHERE date = '2099-05-03'").run();

    enrichMock.mockReset();
    const summary = await enrichSelectionEmails({ date: '2099-05-03' });

    expect(summary.eligible).toBe(0);
    expect(summary.attempted).toBe(0);
    expect(enrichMock).not.toHaveBeenCalled();
    expect(getById(e)!.last_enrichment_attempt_at).toBeNull(); // intoccato
  });
});
