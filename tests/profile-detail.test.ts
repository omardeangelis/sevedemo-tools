import { describe, expect, it, vi } from 'vitest';

// L'enricher chiama il wrapper locale runActor: lo mockiamo (mai Apify reale).
const { runActorMock } = vi.hoisted(() => ({ runActorMock: vi.fn() }));
vi.mock('../src/apify/client.js', () => ({ runActor: runActorMock }));

// Campione (ridotto) dell'output ANNIDATO di apimaestro/linkedin-profile-detail.
const SAMPLE = {
  basic_info: {
    fullname: 'Filippo Pagano',
    headline: 'Product Designer',
    about: 'Designer freelance. Scrivimi: paganofilippo@gmail.com',
    email: 'paganofilippo@gmail.com',
    current_company: 'Studio X',
    location: { full: 'Milano, Lombardia, Italia' },
    profile_url: 'https://www.linkedin.com/in/filippopagano',
  },
  experience: [{ title: 'Designer' }],
  education: [{ school: 'X' }],
  certifications: [],
};

describe('mapProfileDetailItem', () => {
  it("estrae i campi dall'output annidato basic_info.*", async () => {
    const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
    const { url, enrichment } = mapProfileDetailItem(SAMPLE);

    expect(url).toBe('https://www.linkedin.com/in/filippopagano');
    expect(enrichment.fullName).toBe('Filippo Pagano');
    expect(enrichment.headline).toBe('Product Designer');
    expect(enrichment.email).toBe('paganofilippo@gmail.com');
    expect(enrichment.location).toBe('Milano, Lombardia, Italia');
    expect(enrichment.company).toBe('Studio X');
    expect(enrichment.about).toContain('Designer freelance');
  });

  it('fallback: email estratta da about quando basic_info.email è vuoto', async () => {
    const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
    const item = { basic_info: { ...SAMPLE.basic_info, email: '' } };
    const { enrichment } = mapProfileDetailItem(item);
    expect(enrichment.email).toBe('paganofilippo@gmail.com');
  });

  it('identità: URL canonico (slug da public_identifier anche se profile_url è in forma id membro) e id membro da basic_info.urn', async () => {
    const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
    const URN = 'ACoAAFakeMember0001AbCdEfGhIjKl';
    const { url, enrichment } = mapProfileDetailItem({
      basic_info: { fullname: 'Marco', profile_url: `https://www.linkedin.com/in/${URN}`, public_identifier: 'Marco-Esempio', urn: URN },
      experience: [
        { title: 'Head of Data', is_current: false },
        { title: 'CTO', is_current: true },
      ],
    });
    expect(url).toBe('https://www.linkedin.com/in/marco-esempio');
    expect(enrichment).toMatchObject({ canonicalUrl: url, memberUrn: URN, title: 'CTO' });

    // SAMPLE: nessun urn esplicito, slug dall'URL; nessuna esperienza marcata attuale → prima.
    const sample = mapProfileDetailItem(SAMPLE).enrichment;
    expect(sample).toMatchObject({ canonicalUrl: 'https://www.linkedin.com/in/filippopagano', title: 'Designer' });
    expect(sample.memberUrn).toBeUndefined();
  });

  it('item senza url profilo → url undefined (verrà omesso)', async () => {
    const { mapProfileDetailItem } = await import('../src/enrich/profile-detail.js');
    const { url } = mapProfileDetailItem({ basic_info: { fullname: 'X' } });
    expect(url).toBeUndefined();
  });
});

describe('enrichProfileDetails', () => {
  it("chiave = URL di input anche quando l'actor canonicalizza l'URL in output", async () => {
    const { enrichProfileDetails } = await import('../src/enrich/profile-detail.js');
    runActorMock.mockReset();
    runActorMock
      .mockResolvedValueOnce({ items: [SAMPLE], runId: 'r1', datasetId: 'd1' })
      .mockResolvedValueOnce({
        items: [{ basic_info: { fullname: 'NoUrl' } }],
        runId: 'r2',
        datasetId: 'd2',
      });

    // Input in formato URN (come nei nostri dati): l'actor risolve e ritorna
    // SAMPLE.profile_url = .../filippopagano (canonicalizzato, ≠ input).
    const inputUrn = 'https://www.linkedin.com/in/ACwAAAF1QtYBqYReFfP8UJ1n3B6BRv_GttsdzZI';
    const map = await enrichProfileDetails([inputUrn, 'https://www.linkedin.com/in/nourl']);

    expect(map.size).toBe(1);
    // La chiave DEVE essere l'URL di input, non quello canonicalizzato dall'actor:
    // il chiamante ritrova l'enrichment con la `linkedin_url` salvata (l'URN).
    expect(map.get(inputUrn)?.email).toBe('paganofilippo@gmail.com');
    expect(map.has('https://www.linkedin.com/in/filippopagano')).toBe(false);
    expect(runActorMock).toHaveBeenCalledTimes(2);
  });

  it("errore dell'actor → rigetta con messaggio attribuito `actor:<id>:`", async () => {
    const { enrichProfileDetails } = await import('../src/enrich/profile-detail.js');
    runActorMock.mockReset();
    runActorMock.mockRejectedValueOnce(new Error('Actor "apimaestro/linkedin-profile-detail" fallito: 502 Bad Gateway'));
    await expect(enrichProfileDetails(['https://www.linkedin.com/in/x'])).rejects.toThrow(
      /^actor:apimaestro\/linkedin-profile-detail: 502 Bad Gateway$/,
    );
  });

  it('lista vuota → nessuna chiamata Apify', async () => {
    const { enrichProfileDetails } = await import('../src/enrich/profile-detail.js');
    runActorMock.mockReset();
    const map = await enrichProfileDetails([]);
    expect(map.size).toBe(0);
    expect(runActorMock).not.toHaveBeenCalled();
  });
});
