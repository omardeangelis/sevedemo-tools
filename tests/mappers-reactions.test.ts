import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fixture con persone fittizie, costruita sull'output documentato di
// apimaestro/linkedin-post-reactions (3 item: 2 con profile_url, 1 anonimo).
const here = path.dirname(fileURLToPath(import.meta.url));
const reactions = JSON.parse(
  readFileSync(path.join(here, 'fixtures/apimaestro-post-reactions.json'), 'utf8'),
) as any[];

const POST_A = 'https://www.linkedin.com/posts/utente-demo_crm-fittizio-activity-7400000000000000001-AbCd';
const POST_B = 'https://www.linkedin.com/posts/utente-demo_secondo-post-activity-7400000000000000002-EfGh';

describe('mapReactions (T7): reazioni → candidati post_reaction', () => {
  it('mappa 2 candidati normalizzati con reactionType e postUrl da _metadata, scarta chi non ha profile_url', async () => {
    const { mapReactions } = await import('../src/acquisition/mappers/reactions.js');
    const r = mapReactions(reactions);

    expect(r.skipped).toBe(1);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.map((c) => c.linkedinUrl)).toEqual([
      // case dello slug URN preservato
      'https://www.linkedin.com/in/ACoAAFakeReactor0001AbCdEfGh',
      // sottodominio e trailing slash normalizzati
      'https://www.linkedin.com/in/giulia-fittizia-demo',
    ]);
    expect(r.candidates.map((c) => c.reactionType)).toEqual(['LIKE', 'PRAISE']);
    // `reactor.urn` = id membro, seconda chiave d'identità (anche quando l'URL è già lo slug)
    expect(r.candidates.map((c) => c.memberUrn)).toEqual(['ACoAAFakeReactor0001AbCdEfGh', 'ACoAAFakeReactor0002IjKlMnOp']);
    for (const c of r.candidates) {
      expect(c.kind).toBe('post_reaction');
      expect(c.postUrl).toBe(POST_A);
    }
    expect(r.candidates[0]).toMatchObject({
      fullName: 'Marco Esempio',
      headline: 'CTO @ Nebulosa Software | Platform engineering',
      raw: reactions[0],
    });
  });

  it('conta gli item letti per post (scartati inclusi) per decidere la paginazione', async () => {
    const { mapReactions } = await import('../src/acquisition/mappers/reactions.js');
    expect(mapReactions(reactions).itemsByPost).toEqual({ [POST_A]: 2, [POST_B]: 1 });
  });

  it('input non valido o vuoto → nessun candidato, nessun throw', async () => {
    const { mapReactions } = await import('../src/acquisition/mappers/reactions.js');
    expect(mapReactions([])).toEqual({ candidates: [], skipped: 0, itemsByPost: {} });
    expect(mapReactions(undefined as any)).toEqual({ candidates: [], skipped: 0, itemsByPost: {} });
  });

  it('tollera varianti di nome campo (reactionType, reactor.profileUrl, postUrl piatto)', async () => {
    const { mapReactions } = await import('../src/acquisition/mappers/reactions.js');
    const r = mapReactions([
      {
        reactionType: 'empathy',
        reactor: { fullName: 'Paolo Finto', profileUrl: 'linkedin.com/in/paolo-finto?trk=x' },
        postUrl: POST_B,
      },
    ]);
    expect(r.candidates[0]).toMatchObject({
      linkedinUrl: 'https://www.linkedin.com/in/paolo-finto',
      fullName: 'Paolo Finto',
      reactionType: 'EMPATHY',
      postUrl: POST_B,
    });
  });
});
