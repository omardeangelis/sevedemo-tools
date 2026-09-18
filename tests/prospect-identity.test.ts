import { beforeEach, describe, expect, it } from 'vitest';

// Identità dei prospect (steering crm-foundation 2026-09-16): la stessa persona arriva come slug
// pubblico (`/in/<slug>`, commenti) o come id membro (`ACoAA…`, reazioni). Import dinamici: la
// config (DB_PATH isolato da tests/setup.ts) è letta a import-time.
const { db } = await import('../src/db/index.js');
const { upsertProspect, addSource, getProspect } = await import('../src/db/prospects.js');
const { mergeProspects, setProspectIdentity } = await import('../src/db/identity.js');
const { changeStatus, addNote } = await import('../src/db/activities.js');
const { createList, addMembers } = await import('../src/db/lists.js');
const { createIcp } = await import('../src/db/icps.js');
const { memberIdOf, normalizeLinkedinUrl } = await import('../src/util/fields.js');

const URN = 'ACoAAFakeMember0001AbCdEfGhIjKl';
const URN_URL = `https://www.linkedin.com/in/${URN}`;
const SLUG_URL = 'https://www.linkedin.com/in/marco-esempio';
const PERSON = { fullName: 'Marco Esempio', headline: 'CTO @ Nebulosa Software' };

function reset(): void {
  db.exec('DELETE FROM prospects; DELETE FROM posts; DELETE FROM lists; DELETE FROM companies; DELETE FROM icps;');
}

function row(id: number): any {
  return db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

function count(): number {
  return db.prepare('SELECT COUNT(*) FROM prospects').pluck().get() as number;
}

function post(url: string): number {
  return Number(db.prepare('INSERT INTO posts (post_url) VALUES (?)').run(url).lastInsertRowid);
}

beforeEach(reset);

describe('memberIdOf / normalizeLinkedinUrl', () => {
  it("estrae l'id membro da id nudo, URL /in/, urn:li:fsd_profile e query miniProfileUrn", () => {
    expect(memberIdOf(URN)).toBe(URN);
    expect(memberIdOf(`https://it.linkedin.com/in/${URN}/`)).toBe(URN);
    expect(memberIdOf(`urn:li:fsd_profile:${URN}`)).toBe(URN);
    expect(
      memberIdOf(`https://www.linkedin.com/in/marco-esempio?miniProfileUrn=urn%3Ali%3Afsd_profile%3A${URN}`),
    ).toBe(URN);
  });

  it('slug pubblici, valori vuoti o non stringa → undefined', () => {
    expect(memberIdOf(SLUG_URL)).toBeUndefined();
    expect(memberIdOf('acoaa-marco')).toBeUndefined();
    expect(memberIdOf('')).toBeUndefined();
    expect(memberIdOf(42)).toBeUndefined();
  });

  it('abbassa di caso lo slug pubblico (case-insensitive) ma preserva gli id membro', () => {
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/Marco-Esempio/')).toBe(SLUG_URL);
    expect(normalizeLinkedinUrl(`https://www.linkedin.com/in/${URN}`)).toBe(URN_URL);
  });
});

describe('upsertProspect: seconda chiave member_urn', () => {
  it('URL in forma id membro → member_urn valorizzato', () => {
    const { id } = upsertProspect({ linkedinUrl: URN_URL, ...PERSON });
    expect(row(id)).toMatchObject({ linkedin_url: URN_URL, member_urn: URN });
  });

  it("reazione solo-id poi fonte con slug + id → stesso prospect, l'URL passa allo slug", () => {
    const first = upsertProspect({ linkedinUrl: URN_URL, ...PERSON });
    const second = upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: URN, title: 'CTO' });
    expect(second).toEqual({ id: first.id, created: false, mergedIds: [], apolloIdTaken: false });
    expect(row(first.id)).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN, title: 'CTO' });
    expect(count()).toBe(1);
  });

  it("prospect con slug + id, poi reazione con URL id → ritrovato per id, lo slug resta", () => {
    const first = upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: URN });
    const again = upsertProspect({ linkedinUrl: URN_URL, headline: 'Nuova headline' });
    expect(again.id).toBe(first.id);
    expect(row(first.id)).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN, headline: 'Nuova headline' });
  });

  it('commento (slug) e reazione (id) già separati, poi una fonte con entrambe le chiavi → unione', () => {
    const postA = post('https://www.linkedin.com/posts/demo-activity-1');
    const byComment = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }).id;
    addSource(byComment, { kind: 'post_comment', postId: postA, commentText: 'Ottimo post' });
    const byReaction = upsertProspect({ linkedinUrl: URN_URL, fullName: 'Marco E.', email: 'marco@example.invalid' }).id;
    addSource(byReaction, { kind: 'post_reaction', postId: postA, reactionType: 'LIKE' });
    expect(count()).toBe(2);

    const r = upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: URN });
    expect(r).toEqual({ id: byComment, created: false, mergedIds: [byReaction], apolloIdTaken: false });
    expect(count()).toBe(1);
    const merged = getProspect(byComment)!;
    expect(merged).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN, full_name: 'Marco Esempio', email: 'marco@example.invalid' });
    expect(merged.sources.map((s: any) => s.kind).sort()).toEqual(['post_comment', 'post_reaction']);
  });

  it('chiavi in conflitto (slug già legato a un altro id membro) → nessuna unione', () => {
    const OTHER = 'ACoAAFakeMember0002ZzYyXxWwVvUu';
    const bySlug = upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: OTHER }).id;
    const byUrn = upsertProspect({ linkedinUrl: URN_URL }).id;
    const r = upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: URN });
    expect(r).toEqual({ id: bySlug, created: false, mergedIds: [], apolloIdTaken: false });
    expect(count()).toBe(2);
    expect(row(bySlug).member_urn).toBe(OTHER);
    expect(row(byUrn).member_urn).toBe(URN);
  });
});

describe('upsertProspect {linkByName}: stesso nome e headline tra forme diverse', () => {
  it('reazione solo-id poi commento solo-slug con nome e headline uguali → un solo prospect con lo slug', () => {
    const reaction = upsertProspect({ linkedinUrl: URN_URL, ...PERSON }, { linkByName: true });
    const comment = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }, { linkByName: true });
    expect(comment).toEqual({ id: reaction.id, created: false, mergedIds: [], apolloIdTaken: false });
    expect(row(reaction.id)).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN });
  });

  it('commento solo-slug poi reazione solo-id → un solo prospect, lo slug resta e prende member_urn', () => {
    const comment = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }, { linkByName: true });
    const reaction = upsertProspect({ linkedinUrl: URN_URL, ...PERSON }, { linkByName: true });
    expect(reaction.id).toBe(comment.id);
    expect(row(comment.id)).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN });
  });

  it('senza opzione, senza headline o con più omonimi → nessun aggancio', () => {
    upsertProspect({ linkedinUrl: URN_URL, ...PERSON });
    expect(upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }).created).toBe(true);
    reset();

    upsertProspect({ linkedinUrl: URN_URL, fullName: PERSON.fullName }, { linkByName: true });
    expect(upsertProspect({ linkedinUrl: SLUG_URL, fullName: PERSON.fullName }, { linkByName: true }).created).toBe(true);
    reset();

    upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON });
    upsertProspect({ linkedinUrl: 'https://www.linkedin.com/in/marco-esempio-2', ...PERSON });
    expect(upsertProspect({ linkedinUrl: URN_URL, ...PERSON }, { linkByName: true }).created).toBe(true);
    expect(count()).toBe(3);
  });

  it('non aggancia uno slug già legato a un altro id membro', () => {
    upsertProspect({ linkedinUrl: SLUG_URL, memberUrn: 'ACoAAFakeMember0002ZzYyXxWwVvUu', ...PERSON });
    expect(upsertProspect({ linkedinUrl: URN_URL, ...PERSON }, { linkByName: true }).created).toBe(true);
  });
});

describe('mergeProspects', () => {
  it('sposta fonti, membership, attività; stato dal cambio più recente; created_at minimo', () => {
    const icp = createIcp({ name: 'ICP' });
    const list = createList({ icpId: icp.id, name: 'Lista' })!;
    const postA = post('https://www.linkedin.com/posts/demo-activity-1');

    const keep = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }).id;
    const drop = upsertProspect({ linkedinUrl: URN_URL, phone: '+39 000' }).id;
    db.prepare("UPDATE prospects SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(drop);
    addSource(keep, { kind: 'post_comment', postId: postA });
    addSource(drop, { kind: 'post_reaction', postId: postA, reactionType: 'LIKE' });
    addMembers(list.id, [keep, drop]);
    addNote(drop, { body: 'Nota sul duplicato' });
    changeStatus(drop, 'contattato');

    mergeProspects(keep, drop);

    expect(row(drop)).toBeUndefined();
    const merged = getProspect(keep)!;
    expect(merged).toMatchObject({
      linkedin_url: SLUG_URL,
      member_urn: URN,
      phone: '+39 000',
      status: 'contattato',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(merged.sources).toHaveLength(2);
    expect(merged.memberships.map((m: any) => m.list_id)).toEqual([list.id]);
    expect(merged.timeline.map((a: any) => a.kind).sort()).toEqual(['note', 'status_change']);
  });
});

describe('id persona Apollo (apollo-lookalike T5, SPEC F6): chiave secondaria, mai identità', () => {
  const APOLLO_URL = 'https://www.linkedin.com/in/giulia-apollo';

  it('scritto se libero; già di un altro prospect → apolloIdTaken e non scritto; mai sovrascritto', () => {
    const owner = upsertProspect({ linkedinUrl: SLUG_URL, apolloPersonId: 'apollo-1' });
    expect(owner).toEqual({ id: owner.id, created: true, mergedIds: [], apolloIdTaken: false });
    expect(row(owner.id).apollo_person_id).toBe('apollo-1');

    // Stesso id Apollo su un altro URL: prospect nuovo (l'id non unisce), senza id Apollo.
    const other = upsertProspect({ linkedinUrl: APOLLO_URL, apolloPersonId: 'apollo-1', title: 'CTO' });
    expect(other).toMatchObject({ created: true, apolloIdTaken: true });
    expect(other.id).not.toBe(owner.id);
    expect(row(other.id)).toMatchObject({ apollo_person_id: null, title: 'CTO' });
    expect(count()).toBe(2);

    // Rilancio sullo stesso prospect: nessun conflitto; un id diverso non sovrascrive (nemmeno con refresh).
    expect(upsertProspect({ linkedinUrl: SLUG_URL, apolloPersonId: 'apollo-1' }).apolloIdTaken).toBe(false);
    expect(upsertProspect({ linkedinUrl: SLUG_URL, apolloPersonId: 'apollo-2' }, { refresh: true }).apolloIdTaken).toBe(false);
    expect(row(owner.id).apollo_person_id).toBe('apollo-1');

    // Id vuoto o assente: nessun effetto.
    expect(upsertProspect({ linkedinUrl: APOLLO_URL, apolloPersonId: '  ' }).apolloIdTaken).toBe(false);
    expect(row(other.id).apollo_person_id).toBeNull();
  });

  it('mergeProspects: l\'id Apollo dell\'assorbito passa al superstite senza violare l\'unicità; vince il match più recente', () => {
    const keep = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }).id;
    const drop = upsertProspect({ linkedinUrl: URN_URL, apolloPersonId: 'apollo-9' }).id;
    db.prepare('UPDATE prospects SET apollo_matched_at = ? WHERE id = ?').run('2026-09-01T00:00:00.000Z', keep);
    db.prepare('UPDATE prospects SET apollo_matched_at = ? WHERE id = ?').run('2026-09-10T00:00:00.000Z', drop);

    mergeProspects(keep, drop);

    expect(row(drop)).toBeUndefined();
    expect(row(keep)).toMatchObject({ apollo_person_id: 'apollo-9', apollo_matched_at: '2026-09-10T00:00:00.000Z' });
    expect(getProspect(keep)).toMatchObject({ apollo_person_id: 'apollo-9', apollo_matched_at: '2026-09-10T00:00:00.000Z' });
    // L'id ora è del superstite: un altro prospect non lo può prendere.
    expect(upsertProspect({ linkedinUrl: APOLLO_URL, apolloPersonId: 'apollo-9' }).apolloIdTaken).toBe(true);
  });

  it('mergeProspects: il superstite con un proprio id Apollo lo tiene', () => {
    const keep = upsertProspect({ linkedinUrl: SLUG_URL, apolloPersonId: 'apollo-keep' }).id;
    const drop = upsertProspect({ linkedinUrl: URN_URL, apolloPersonId: 'apollo-drop' }).id;
    mergeProspects(keep, drop);
    expect(row(keep).apollo_person_id).toBe('apollo-keep');
    expect(upsertProspect({ linkedinUrl: APOLLO_URL, apolloPersonId: 'apollo-drop' }).apolloIdTaken).toBe(false);
  });
});

describe('setProspectIdentity (enrichment: URL canonico dal provider)', () => {
  it("il prospect arricchito resta, assorbe quello che aveva già lo slug e ne prende l'URL", () => {
    const enriched = upsertProspect({ linkedinUrl: URN_URL }).id;
    const other = upsertProspect({ linkedinUrl: SLUG_URL, ...PERSON }).id;

    const r = setProspectIdentity(enriched, { linkedinUrl: 'https://it.linkedin.com/in/Marco-Esempio/' });
    expect(r).toEqual({ id: enriched, mergedIds: [other] });
    expect(row(other)).toBeUndefined();
    expect(row(enriched)).toMatchObject({ linkedin_url: SLUG_URL, member_urn: URN, full_name: 'Marco Esempio' });
  });

  it('slug cambiato dalla persona → URL aggiornato, nessuna unione', () => {
    const id = upsertProspect({ linkedinUrl: SLUG_URL }).id;
    expect(setProspectIdentity(id, { linkedinUrl: 'https://www.linkedin.com/in/marco-esempio-cto', memberUrn: URN })).toEqual({
      id,
      mergedIds: [],
    });
    expect(row(id)).toMatchObject({ linkedin_url: 'https://www.linkedin.com/in/marco-esempio-cto', member_urn: URN });
  });
});
