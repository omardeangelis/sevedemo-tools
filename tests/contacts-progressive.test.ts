import { describe, expect, it } from 'vitest';

async function contacts() {
  return import('../src/db/contacts.js');
}

let seq = 0;
function newUrl(): string {
  seq += 1;
  return `https://www.linkedin.com/in/test-${process.pid}-${seq}`;
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

describe('updateScore: status = stadio del dato', () => {
  it("bucket='scarta' → discarded; bucket valido → scored", async () => {
    const { upsertCandidate, updateScore, getById } = await contacts();
    const a = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    const b = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;

    updateScore(a, score('scarta'));
    updateScore(b, score('freelance'));

    expect(getById(a)!.status).toBe('discarded');
    expect(getById(b)!.status).toBe('scored');
  });
});

describe('applyProgressiveEnrichment: refresh status-preserving + stamp tentativo', () => {
  it('preserva lo status, recupera email mancante, timbra sempre attempt+actor', async () => {
    const { upsertCandidate, updateScore, applyProgressiveEnrichment, getById } = await contacts();
    const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(id, score('freelance')); // status = scored

    applyProgressiveEnrichment(
      id,
      { email: 'found@x.it', about: 'bio' },
      'apimaestro/linkedin-profile-detail',
    );

    const row = getById(id)!;
    expect(row.status).toBe('scored'); // NON regredito a 'enriched'
    expect(row.email).toBe('found@x.it');
    expect(row.about).toBe('bio');
    expect(row.last_enrichment_attempt_at).toBeTruthy();
    expect(row.last_enrichment_actor).toBe('apimaestro/linkedin-profile-detail');
  });

  it('miss: email vuota non sovrascrive quella esistente, ma il tentativo è timbrato', async () => {
    const { upsertCandidate, updateScore, applyProgressiveEnrichment, getById } = await contacts();
    const id = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    updateScore(id, score('freelance'));
    applyProgressiveEnrichment(id, { email: 'keep@x.it' }, 'actor-1');

    applyProgressiveEnrichment(id, { email: '', headline: 'nuova headline' }, 'actor-2');

    const row = getById(id)!;
    expect(row.email).toBe('keep@x.it'); // '' non azzera
    expect(row.headline).toBe('nuova headline'); // refresh degli altri campi
    expect(row.last_enrichment_actor).toBe('actor-2'); // ri-timbrato anche sul miss
  });
});

describe('isEnrichmentFresh', () => {
  it('false se mai tentato, true entro la finestra dopo un tentativo', async () => {
    const { upsertCandidate, applyProgressiveEnrichment, isEnrichmentFresh } = await contacts();
    const never = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    expect(isEnrichmentFresh(never, 7)).toBe(false);

    const tried = upsertCandidate({ linkedinUrl: newUrl(), sourceStrategy: 's' }).id;
    applyProgressiveEnrichment(tried, {}, 'actor');
    expect(isEnrichmentFresh(tried, 7)).toBe(true);
    expect(isEnrichmentFresh(tried, 0)).toBe(false); // finestra zero → stale
  });
});
