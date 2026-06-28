/**
 * Popola il database con dati demo realistici per provare l'interfaccia web.
 * Si rifiuta di girare se il DB contiene già contatti (usa --force per svuotare e riseminare).
 *
 *   npm run seed:demo            → semina il DB di default (data/sevedemo.db)
 *   DB_PATH=data/demo.db npm run seed:demo  → semina un DB separato
 */
import { db, nowIso } from '../src/db/index.js';
import { config } from '../src/config.js';

const force = process.argv.includes('--force');
const { n } = db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number };
if (n > 0 && !force) {
  console.error(`Il DB ${config.paths.db} contiene già ${n} contatti. Usa --force per svuotare e riseminare.`);
  process.exit(1);
}
if (force) {
  db.exec('DELETE FROM outcomes; DELETE FROM daily_selection; DELETE FROM contacts; DELETE FROM runs;');
}

const STRATEGIES = ['freelance-people-search', 'influencer-post-respondents', 'decisionmaker-people-search'];
const SECTORS = ['tech', 'design', 'marketing'] as const;

const FREELANCE = [
  ['Giulia Moretti', 'UX/UI Designer Freelance | P.IVA | Figma & Design System', 'design'],
  ['Marco Bellini', 'Sviluppatore Full Stack Freelance — React, Node.js | Open to work', 'tech'],
  ['Sara Conti', 'Freelance SEO & Content Strategist | Aiuto le PMI a crescere online', 'marketing'],
  ['Luca Ferraro', 'Frontend Developer | Libero professionista | Vue & TypeScript', 'tech'],
  ['Elena Rizzo', 'Brand & Visual Designer freelance | Identità per startup', 'design'],
  ['Davide Greco', 'Consulente Google Ads & Meta | Performance marketing | P.IVA', 'marketing'],
  ['Francesca Villa', 'Product Designer freelance | ex-Satispay | UX research', 'design'],
  ['Andrea Lombardi', 'Backend Engineer freelance | Go, Python, AWS | Disponibile', 'tech'],
  ['Chiara Fontana', 'Copywriter & Content Designer | Libera professionista', 'marketing'],
  ['Matteo Russo', 'Mobile Developer Freelance | Flutter & React Native', 'tech'],
  ['Valentina Serra', 'Graphic Designer freelance | Packaging & editoria', 'design'],
  ['Simone Gallo', 'Data Analyst freelance | P.IVA | Looker, dbt, SQL', 'tech'],
] as const;

const AZIENDA = [
  ['Paola Martini', 'Senior Tech Recruiter @ TalentHub | Hiring developers', 'tech'],
  ['Roberto Colombo', 'Founder & CEO @ DevFactory | Software house — assumiamo!', 'tech'],
  ['Ilaria De Santis', 'Head of People @ FinPay | People & Culture', 'tech'],
  ['Giorgio Mancini', 'Headhunter | Digital & Design profiles | Partner @ KeyPeople', 'design'],
  ['Martina Esposito', 'HR Manager @ AdWave Agency | Cerchiamo marketer', 'marketing'],
  ['Stefano Barbieri', 'CTO & Co-founder @ Cloudly | Scaling engineering team', 'tech'],
  ['Federica Amato', 'Talent Acquisition Specialist @ BrandUp | Creative roles', 'design'],
  ['Alessandro Vitale', 'Founder @ GrowthLab | Performance marketing agency', 'marketing'],
  ['Cristina Pellegrini', 'Recruiter freelance per startup | Tech & Product', 'tech'],
  ['Nicola Sartori', 'Hiring Manager @ DataMind | Data team in crescita', 'tech'],
] as const;

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString();
}
function dateOnly(d: number): string {
  return daysAgo(d).slice(0, 10);
}

const insContact = db.prepare(
  `INSERT INTO contacts
     (linkedin_url, full_name, headline, about, location, email, phone, company, role, bucket, sector,
      fit_score, short_description, score_reason, signals, source_strategy, source_post_url,
      email_subject, email_body, status, first_seen_at, last_evaluated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

interface Seeded {
  id: number;
  bucket: string;
  fit: number;
}
const seeded: Seeded[] = [];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, '-');
}

function seedBucket(rows: ReadonlyArray<readonly [string, string, string]>, bucket: 'freelance' | 'azienda') {
  rows.forEach(([name, headline, sector], i) => {
    const fit = 88 - i * 3 - (bucket === 'azienda' ? 1 : 0);
    const strategy = bucket === 'freelance' ? STRATEGIES[i % 2] : STRATEGIES[2];
    const role = bucket === 'freelance' ? 'Freelance' : headline.split('@')[0].trim();
    const company = bucket === 'azienda' ? (headline.split('@')[1] ?? 'n/d').split('|')[0].trim() : null;
    const hasEmail = i % 3 !== 2;
    const subjectF = 'Trova i prossimi clienti su SeVedemo';
    const subjectA = 'Pubblica le tue offerte su SeVedemo';
    const info = insContact.run(
      `https://www.linkedin.com/in/${slugify(name)}/`,
      name,
      headline,
      `Mi occupo di ${sector} da diversi anni. ${bucket === 'freelance' ? 'Lavoro come libero professionista con clienti in tutta Italia.' : 'Sto facendo crescere il team della mia azienda.'}`,
      ['Milano', 'Roma', 'Torino', 'Bologna', 'Firenze'][i % 5] + ', Italia',
      hasEmail ? `${slugify(name).replace(/-+$/, '').replace(/-/g, '.')}@example.com` : null,
      i % 4 === 0 ? `+39 33${i} 123 45${String(10 + i)}` : null,
      company,
      role,
      bucket,
      sector,
      fit,
      bucket === 'freelance'
        ? `${sector === 'tech' ? 'Sviluppatore' : sector === 'design' ? 'Designer' : 'Marketer'} freelance con P.IVA, profilo attivo.`
        : `Decision maker (${role}) che assume profili ${sector}.`,
      bucket === 'freelance'
        ? 'Headline esplicita su freelance/P.IVA, settore in target, segnali di disponibilità.'
        : 'Ruolo con potere di assunzione, azienda in crescita, settore in target.',
      JSON.stringify({ piva: bucket === 'freelance', hiring: bucket === 'azienda', open_to_work: i % 4 === 0 }),
      strategy,
      strategy === 'influencer-post-respondents' ? 'https://www.linkedin.com/posts/influencer-demo_post' : null,
      bucket === 'freelance' ? subjectF : subjectA,
      `Ciao ${name.split(' ')[0]},\n\nho visto il tuo profilo e ${
        bucket === 'freelance'
          ? 'penso che SeVedemo possa aiutarti a trovare nuovi progetti: è una piattaforma pensata per freelance italiani.'
          : 'penso che SeVedemo possa aiutarti a trovare i profili che cerchi: pubblicare un’offerta richiede due minuti.'
      }\n\nTi va di dare un’occhiata?\n\nUn saluto,\nOmar`,
      'scored',
      daysAgo(3 + (i % 5)),
      daysAgo(1 + (i % 3)),
    );
    seeded.push({ id: Number(info.lastInsertRowid), bucket, fit });
  });
}

seedBucket(FREELANCE, 'freelance');
seedBucket(AZIENDA, 'azienda');

// Qualche contatto grezzo non ancora scored, per popolare i filtri di stato.
for (let i = 0; i < 6; i++) {
  db.prepare(
    `INSERT INTO contacts (linkedin_url, full_name, headline, source_strategy, status, first_seen_at)
     VALUES (?, ?, ?, ?, 'new', ?)`,
  ).run(
    `https://www.linkedin.com/in/profilo-grezzo-${i}/`,
    `Profilo Grezzo ${i + 1}`,
    'Professional | LinkedIn member',
    STRATEGIES[i % STRATEGIES.length],
    daysAgo(1),
  );
}

// Run log su 3 giornate.
const insRun = db.prepare(
  `INSERT INTO runs (run_date, strategy, actor_run_id, items_in, items_new, cost_estimate, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
for (const d of [4, 2, 1]) {
  STRATEGIES.forEach((s, i) => {
    insRun.run(dateOnly(d), s, `demo-run-${d}-${i}`, 60 + i * 8, 14 - d - i * 2, 0.45 + i * 0.12, daysAgo(d));
  });
}

// Selezioni: ieri e 3 giorni fa (top fit per bucket).
const insSel = db.prepare('INSERT INTO daily_selection (date, bucket, contact_id, rank) VALUES (?, ?, ?, ?)');
function seedSelection(date: string, perBucket: number, skip = 0) {
  for (const bucket of ['freelance', 'azienda']) {
    const top = seeded
      .filter((s) => s.bucket === bucket)
      .sort((a, b) => b.fit - a.fit)
      .slice(skip, skip + perBucket);
    top.forEach((s, i) => insSel.run(date, bucket, s.id, i + 1));
  }
}
seedSelection(dateOnly(3), 6, 4);
seedSelection(dateOnly(1), 8, 0);
db.prepare(
  `UPDATE contacts SET status = 'exported' WHERE id IN (SELECT contact_id FROM daily_selection WHERE date = ?)`,
).run(dateOnly(3));
db.prepare(
  `UPDATE contacts SET status = 'selected' WHERE id IN (SELECT contact_id FROM daily_selection WHERE date = ?)`,
).run(dateOnly(1));

// Outcome per il report strategie (solo per la selezione più vecchia, già "inviata").
const oldSel = db
  .prepare('SELECT contact_id FROM daily_selection WHERE date = ?')
  .all(dateOnly(3)) as Array<{ contact_id: number }>;
const insOutcome = db.prepare(
  `INSERT INTO outcomes (contact_id, strategy, sent_at, opened, replied, positive_reply, converted)
   VALUES (?, (SELECT source_strategy FROM contacts WHERE id = ?), ?, ?, ?, ?, ?)`,
);
oldSel.forEach(({ contact_id }, i) => {
  const opened = i % 2 === 0 ? 1 : 0;
  const replied = i % 3 === 0 ? 1 : 0;
  const positive = i % 4 === 0 ? 1 : 0;
  insOutcome.run(contact_id, contact_id, daysAgo(2), opened, replied, positive, i === 0 ? 1 : 0);
});

const counts = db.prepare('SELECT COUNT(*) AS c FROM contacts').get() as { c: number };
console.log(`✅ Seed demo completato su ${config.paths.db}`);
console.log(`   contatti: ${counts.c} — selezioni: ${dateOnly(3)}, ${dateOnly(1)} — run su 3 giornate.`);
console.log(`   nowIso di riferimento: ${nowIso()}`);
