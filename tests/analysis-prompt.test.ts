import { describe, expect, it } from 'vitest';

// Prompt e schema dell'analisi AI (crm-foundation T11): funzioni pure, nessun DB né client.
const { createHash } = await import('node:crypto');
const { buildAnalysisInput } = await import('../src/analysis/prompt.js');
const { ANALYSIS_JSON_SCHEMA, analysisJsonSchema, parseAnalysis } = await import('../src/analysis/schema.js');

type Ctx = import('../src/analysis/prompt.js').AnalysisContext;

function context(
  overrides: { prospect?: Partial<Ctx['prospect']>; company?: Partial<Ctx['company']>; services?: Ctx['services'] } = {},
): Ctx {
  return {
    company: {
      name: 'SeVedemo',
      description: 'Consulenza DevOps per software house.',
      offering: 'Migrazioni cloud',
      positioning: null,
      proof_points: null,
      tone_of_voice: null,
      ...overrides.company,
    },
    services: overrides.services ?? [],
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

  it('F6: il testo del prompt resta quello di prima di own-profile-services (stessa impronta dell\'input intero)', () => {
    // Calcolata con il codice di people-first-crm (1c2ea85) sullo stesso contesto: se cambia, ogni analisi
    // salvata perde "input identico" e l'analisi in blocco ripagherebbe l'archivio.
    expect(buildAnalysisInput(context()).inputHash).toBe('2a0fa5baecb0e573960dc01c11150bb6f551a1f51e5667ae757254f8448cb4a9');
  });

  it('F6 (T13): campi nuovi vuoti e zero servizi ⇒ system, user, impronte e formato della risposta identici a prima', () => {
    // Istantanea presa con il codice di M1b (069eab9) prima di T13, sullo stesso contesto.
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const a = buildAnalysisInput(context({ company: { positioning: null, proof_points: '  ', tone_of_voice: '' } }));
    expect(sha(a.system)).toBe('c3bfa9ffced9436c10fdcb67b5f1a4bdac849534e1d66f29ae332fc42fc17424');
    expect(sha(a.user)).toBe('8ca247fa44f4a061e06b4f4f25d424c98e1c5f17748bd0e59216baa196580ce5');
    expect(a.inputHash).toBe('2a0fa5baecb0e573960dc01c11150bb6f551a1f51e5667ae757254f8448cb4a9');
    expect(a.subjectHash).toBe('bd19f669ffba9be2dc99e977dfbbe01e418d78f74ec5a043415de08274ca63a9');
    // F2: senza servizi al modello non si chiede nulla in più, nemmeno nel formato.
    expect(a.asksService).toBe(false);
    expect(sha(JSON.stringify(analysisJsonSchema(a.asksService)))).toBe('6d2b2feda1538555c1227ea795ea880389e96fc74a025834f3c538d132ba121a');
    const jsonOnly = buildAnalysisInput(context(), { jsonOnly: true });
    expect(sha(jsonOnly.system)).toBe('417c7043a24c1420d8899c22abc7494f968957e15a6ea6589be0bc1b3cd056c0');
  });

  it('F1, F2: con tre servizi il system li elenca nell\'ordine dell\'utente e chiede il servizio più affine', () => {
    const services = [
      { name: 'Fractional CTO', audience: 'PMI senza CTO', problem: 'Decisioni tecniche senza guida' },
      { name: 'Assessment architetturale', audience: null, problem: 'Gestionale vecchio da migrare' },
      { name: 'Migrazione al cloud', audience: 'Software\n  house', problem: null },
    ];
    const a = buildAnalysisInput(context({ services }));
    expect(a.asksService).toBe(true);
    const list = [
      '- Fractional CTO — a chi serve: PMI senza CTO; problema che risolve: Decisioni tecniche senza guida',
      '- Assessment architetturale — problema che risolve: Gestionale vecchio da migrare',
      '- Migrazione al cloud — a chi serve: Software house',
    ].join('\n');
    expect(a.system).toContain(`I suoi servizi, nell'ordine scelto dall'utente:\n${list}`);
    expect(a.system).toMatch(/- best_service: /);
    expect(a.system).toMatch(/- best_service_reason: /);
    // I servizi sono contesto dell'utente: la persona non cambia (F7).
    expect(a.subjectHash).toBe(buildAnalysisInput(context()).subjectHash);
    expect(a.inputHash).not.toBe(buildAnalysisInput(context()).inputHash);

    const schema = analysisJsonSchema(true);
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['summary', 'angles', 'fit', 'fit_reason', 'best_service', 'best_service_reason'],
      properties: { best_service: { type: 'string' }, best_service_reason: { type: 'string' } },
    });
    // JSON-only: lo schema nell'istruzione è quello con il servizio.
    expect(buildAnalysisInput(context({ services }), { jsonOnly: true }).system).toContain('"best_service_reason"');
  });

  it('F1: posizionamento, prove e tono entrano nel blocco dell\'azienda; senza servizi lo schema non cambia', () => {
    const a = buildAnalysisInput(
      context({ company: { positioning: 'Il CTO a tempo per le PMI.', proof_points: '12 migrazioni senza fermi.', tone_of_voice: 'Diretto.' } }),
    );
    expect(a.system).toContain('Offerta: Migrazioni cloud\nPosizionamento: Il CTO a tempo per le PMI.\nProve e risultati: 12 migrazioni senza fermi.\nTono di voce: Diretto.\n</azienda_utente>');
    expect(a.asksService).toBe(false);
    expect(a.system).not.toContain('best_service');
    expect(a.subjectHash).toBe(buildAnalysisInput(context()).subjectHash);
  });

  it('subjectHash (F11): solo profilo e segnali della persona; azienda, ICP, riferimenti e nome dell\'ICP non lo muovono', () => {
    const a = buildAnalysisInput(context());
    expect(a.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.subjectHash).not.toBe(a.inputHash);
    const same = (ctx: Ctx) => {
      const b = buildAnalysisInput(ctx);
      expect(b.inputHash).not.toBe(a.inputHash);
      expect(b.subjectHash).toBe(a.subjectHash);
    };
    same(context({ company: { description: 'Altro mestiere' } }));
    same(context({ company: { offering: 'Altra offerta', name: 'Altra azienda' } }));
    same({ ...context(), icp: { ...context().icp, pains: 'Altri problemi' } });
    same({ ...context(), referenceCompanies: [] });
    // P-6: la frase finale nomina l'ICP; rinominarlo non segna la persona.
    same({ ...context(), icp: { ...context().icp, name: 'ICP rinominato' } });

    expect(buildAnalysisInput(context({ prospect: { about: 'Altro about' } })).subjectHash).not.toBe(a.subjectHash);
    expect(buildAnalysisInput(context({ prospect: { headline: 'CEO @ Nuvola' } })).subjectHash).not.toBe(a.subjectHash);
    expect(buildAnalysisInput(context({ prospect: { sources: [] } })).subjectHash).not.toBe(a.subjectHash);
    expect(buildAnalysisInput(context(), { jsonOnly: true }).subjectHash).toBe(a.subjectHash);
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

  it('schema con il servizio: accettato da structured outputs, e il parse lo esige solo quando è chiesto', () => {
    const schema = analysisJsonSchema(true);
    const text = JSON.stringify(schema);
    for (const keyword of ['"$schema"', '"maxLength"', '"minLength"', '"maxItems"', '"minItems"']) expect(text).not.toContain(keyword);
    expect(analysisJsonSchema(false)).toEqual(ANALYSIS_JSON_SCHEMA);

    const base = { summary: 'Riassunto', angles: [1, 2, 3].map((n) => ({ title: `A${n}`, rationale: 'r' })), fit: 'medio', fit_reason: 'Perché' };
    const withService = { ...base, best_service: 'Fractional CTO', best_service_reason: 'Non ha un CTO.' };
    expect(parseAnalysis(JSON.stringify(withService), { withService: true })).toMatchObject({ ok: true, value: withService });
    expect(parseAnalysis(JSON.stringify(base), { withService: true }).ok).toBe(false);
    // Senza servizi la risposta di oggi resta valida e un campo in più non passa per buono.
    expect(parseAnalysis(JSON.stringify(base))).toMatchObject({ ok: true, value: base });
    expect(parseAnalysis(JSON.stringify(withService)).ok).toBe(true);
    expect(parseAnalysis(JSON.stringify(withService))).not.toHaveProperty('value.best_service');
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
