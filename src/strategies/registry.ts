import { config } from '../config.js';
import type { Strategy } from './types.js';
import { freelancePeopleSearch } from './freelance-people-search.js';
import { decisionmakerPeopleSearch } from './decisionmaker-people-search.js';
import { freelancePostReactors } from './freelance-post-reactors.js';
import { influencerFollowers } from './influencer-followers.js';
import { jobPostersAnnunci } from './job-posters-annunci.js';

const ALL: Strategy[] = [
  freelancePeopleSearch,
  decisionmakerPeopleSearch,
  freelancePostReactors,
  influencerFollowers,
  jobPostersAnnunci,
];

export function listStrategies(): Strategy[] {
  return ALL;
}

export function getStrategy(id: string): Strategy | undefined {
  return ALL.find((s) => s.id === id);
}

/** Una strategia è abilitata se non richiede cookie, oppure se il cookie è disponibile. */
export function isEnabled(s: Strategy): boolean {
  return s.requiresCookie ? Boolean(config.linkedinLiAt) : true;
}

/** Strategie usate dal run giornaliero: tutte le abilitate (no-cookie + cookie se disponibile). */
export function dailyStrategies(): Strategy[] {
  return ALL.filter(isEnabled);
}
