import { makePeopleSearchStrategy } from './people-search.js';

/** No-cookie. Cerca profili che si dichiarano freelance / P.IVA in tech, design, marketing. */
export const freelancePeopleSearch = makePeopleSearchStrategy({
  id: 'freelance-people-search',
  description: 'Ricerca persone con headline freelance/P.IVA (tech, design, marketing).',
  queriesFile: 'freelance-queries.json',
  bucketHint: 'freelance',
});
