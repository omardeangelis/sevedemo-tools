import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface SearchQuery {
  query: string;
  location?: string;
}

function readJson<T>(file: string, fallback: T): T {
  const p = path.join(config.paths.seeds, file);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Impossibile leggere il seed "${file}" (${p}): ${msg}`);
  }
}

export function loadQueries(file: string): SearchQuery[] {
  const data = readJson<SearchQuery[]>(file, []);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Il seed "${file}" è vuoto o non è un array.`);
  }
  return data;
}

export function loadInfluencers(): string[] {
  const data = readJson<string[]>('influencers.json', []);
  return (Array.isArray(data) ? data : []).filter((u) => typeof u === 'string' && u.trim().length > 0);
}

export function loadJobSearchUrls(): string[] {
  const data = readJson<string[]>('job-search-urls.json', []);
  return (Array.isArray(data) ? data : []).filter((u) => typeof u === 'string' && u.trim().length > 0);
}
