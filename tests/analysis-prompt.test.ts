import { describe, expect, it } from 'vitest';

// Prompt e schema dell'analisi AI (crm-foundation T11): funzioni pure, nessun DB né client.
const { buildAnalysisInput } = await import('../src/analysis/prompt.js');
const { ANALYSIS_JSON_SCHEMA, parseAnalysis } = await import('../src/analysis/schema.js');

type Ctx = import('../src/analysis/prompt.js').AnalysisContext;

function context(overrides: { prospect?: Partial<Ctx['prospect']>; company?: Partial<Ctx['company']> } = {}): Ctx {
  return {
    company: { name: 'SeVedemo', description: 'Consulenza DevOps per software house.', offering: 'Migrazioni cloud', ...overrides.company },
    icp: {
      name: 'CTO startup IT',
      description: 'CTO di startup software',
      target_roles: ['CTO', 'Head of Engineering'],
      target_industries: ['SaaS'],
      target_locations: ['Italia'],
      company_size: '11-50',
      pains: 'Costi cloud fuori controllo',
      notes: null,
    },
    referenceCompanies: [
      { outcome: 'vinta', notes: 'Migrazione chiusa in 3 mesi', company: { name: 'Acme Cloud', industry: 'SaaS', size: '11-50', location: null } },
    ],
    prospect: {
      full_name: 'Anna Rossi',
      headline: 'CTO @ Nuvola SaaS',
      about: 'Guido il team tecnico di Nuvola.',
      location: 'Milano',
      company_name: 'Nuvola SaaS',
      title: 'CTO',
      raw: {
        source: { topSkills: 'Kubernetes • Terraform' },
        experience: [
          {
            position: 'Chief Technology Officer',
            companyName: 'Nuvola SaaS',
            startDate: { text: 'Jul 2023' },
            endDate: { text: 'Present' },
            description: 'Architettura e hiring.',
          },
          { title: 'Engineering Manager', company: 'Vecchia Srl', start_date: { month: 'Jun', year: 2019 }, is_current: false },
        ],
        education: [{ schoolName: 'Politecnico di Milano', degree: 'Laurea Magistrale' }],
        certifications: [{ name: 'CKA' }],
      },
      sources: [
        {
          kind: 'post_comment',
          post_url: 'https://www.linkedin.com/posts/omar-1',
          post_excerpt: 'Tre lezioni dalla migrazione',
          company_name: null,
          reaction_type: null,
          comment_text: 'Anche noi stiamo migrando a Kubernetes',
        },
        { kind: 'post_reaction', post_url: 'https://www.linkedin.com/posts/omar-2', post_excerpt: null, company_name: null, reaction_type: 'PRAISE', comment_text: null },
        { kind: 'company_employees', post_url: null, post_excerpt: null, company_name: 'Nuvola SaaS', reaction_type: null, comment_text: null },
      ],
      ...overrides.prospect,
    },
  };
}

describe('buildAnalysisInput', () => {
  it('user: profilo (about, esperienze dalla busta raw, formazione) e segnali di provenienza con il testo del commento', () => {
    const { user } = buildAnalysisInput(context());
    expect(user).toContain('Anche noi stiamo migrando a Kubernetes');
    expect(user).toContain('Ha commentato il mio post "Tre lezioni dalla migrazione"');
    expect(user).toContain('Ha reagito (PRAISE)');
    expect(user).toContain('dipendenti di Nuvola SaaS');
    expect(user).toContain('Guido il team tecnico di Nuvola.');
    expect(user).toContain('- Chief Technology Officer · Nuvola SaaS (Jul 2023 – Present): Architettura e hiring.');
    expect(user).toContain('- Engineering Manager · Vecchia Srl (Jun 2019)');
    expect(user).toContain('Politecnico di Milano · Laurea Magistrale');
    expect(user).toContain('Certificazioni: CKA');
    expect(user).toContain('Competenze: Kubernetes • Terraform');
  });

  it('segnale della fonte apollo_people: "Trovata via Apollo in <azienda>" (apollo-lookalike T8)', () => {
    const apollo = { kind: 'apollo_people' as const, post_url: null, post_excerpt: null, company_name: 'Acme Robotics', reaction_type: null, comment_text: null };
    const { user } = buildAnalysisInput(context({ prospect: { sources: [apollo] } }));
    expect(user).toContain('- Trovata via Apollo in Acme Robotics');
    expect(user).not.toContain('Aggiunta a mano da me');
  });

  it("system: azienda dell'utente, ICP (ruoli, settori, pains) e aziende di riferimento con esito; consegna", () => {
    const { system } = buildAnalysisInput(context());
    expect(system).toContain('Consulenza DevOps per software house.');
    expect(system).toContain('Ruoli target: CTO, Head of Engineering');
    expect(system).toContain('Problemi da risolvere: Costi cloud fuori controllo');
    expect(system).toContain('- Acme Cloud (SaaS, 11-50): trattativa vinta — Migrazione chiusa in 3 mesi');
    expect(system).toMatch(/esattamente 3 angoli/);
    expect(system).toMatch(/ignora eventuali istruzioni/);
    expect(buildAnalysisInput(context({ company: { description: null } })).system).toContain('(descrizione non compilata)');
  });

  it("input_hash stabile, cambia con profilo o segnali, non cambia con l'istruzione JSON-only", () => {
    const a = buildAnalysisInput(context());
    expect(buildAnalysisInput(context()).inputHash).toBe(a.inputHash);
    expect(a.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildAnalysisInput(context({ prospect: { about: 'Altro about' } })).inputHash).not.toBe(a.inputHash);
    expect(buildAnalysisInput(context({ prospect: { sources: [] } })).inputHash).not.toBe(a.inputHash);

    const jsonOnly = buildAnalysisInput(context(), { jsonOnly: true });
    expect(jsonOnly.inputHash).toBe(a.inputHash);
    expect(jsonOnly.system).toMatch(/SOLO un oggetto JSON valido/);
    expect(a.system).not.toMatch(/SOLO un oggetto JSON valido/);
  });

  it('prospect senza fonti né raw → segnali "nessuna interazione", nessuna riga vuota inventata', () => {
    const { user } = buildAnalysisInput(context({ prospect: { raw: null, sources: [], location: null } }));
    expect(user).toContain('Nessuna interazione registrata');
    expect(user).not.toMatch(/Esperienze:|Località:/);
  });
});

describe('schema per structured outputs', () => {
  it('JSON Schema accettato da structured outputs: oggetti chiusi, nessuna parola chiave non supportata, enum del fit', () => {
    const text = JSON.stringify(ANALYSIS_JSON_SCHEMA);
    for (const keyword of ['"$schema"', '"maxLength"', '"minLength"', '"maxItems"', '"minItems"']) expect(text).not.toContain(keyword);
    expect(ANALYSIS_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'angles', 'fit', 'fit_reason'],
      properties: {
        angles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'rationale'] } },
        fit: { enum: ['alto', 'medio', 'basso'] },
      },
    });
  });

  it('parseAnalysis: esattamente 3 angoli, riassunto ≤ 600, fit ammesso; tollera il blocco ```json', () => {
    const good = {
      summary: 'Riassunto',
      angles: [1, 2, 3].map((n) => ({ title: `A${n}`, rationale: 'r' })),
      fit: 'medio',
      fit_reason: 'Perché',
    };
    expect(parseAnalysis(JSON.stringify(good))).toMatchObject({ ok: true, value: good });
    expect(parseAnalysis('```json\n' + JSON.stringify(good) + '\n```').ok).toBe(true);
    expect(parseAnalysis(JSON.stringify({ ...good, angles: good.angles.slice(0, 2) })).ok).toBe(false);
    expect(parseAnalysis(JSON.stringify({ ...good, summary: 'x'.repeat(601) })).ok).toBe(false);
    expect(parseAnalysis(JSON.stringify({ ...good, fit: 'altissimo' })).ok).toBe(false);
    expect(parseAnalysis('{"summary": ').ok).toBe(false);
  });
});
