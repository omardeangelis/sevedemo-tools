import { makePeopleSearchStrategy } from './people-search.js';

/** No-cookie. Cerca decision maker / recruiter / talent / founder in tech, design, marketing. */
export const decisionmakerPeopleSearch = makePeopleSearchStrategy({
  id: 'decisionmaker-people-search',
  description: 'Ricerca persone con ruoli di assunzione (recruiter, headhunter, talent, HR, founder).',
  queriesFile: 'decisionmaker-queries.json',
  bucketHint: 'azienda',
});
