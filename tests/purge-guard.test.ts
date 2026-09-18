import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guardia del purge del Lead Engine (crm-foundation T2): i moduli legacy non
// devono rientrare nel repo, e `toCsv` vive in `util/csv` senza il parser outcome.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEGACY_PATHS = [
  'src/score',
  'src/pipeline',
  'src/email',
  'src/eval',
  'src/export',
  'src/db/kv.ts',
  'src/server/queries.ts',
];

describe('purge del codice legacy', () => {
  it.each(LEGACY_PATHS)('%s non esiste più', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(false);
  });

  it('util/csv espone toCsv e non più parseCsv', async () => {
    const csv = (await import('../src/util/csv.js')) as Record<string, unknown>;
    expect(typeof csv.toCsv).toBe('function');
    expect(csv.parseCsv).toBeUndefined();
  });

  it('toCsv serializza le colonne indicate con escaping', async () => {
    const { toCsv } = await import('../src/util/csv.js');
    const out = toCsv(
      [
        { name: 'Anna, "la designer"', email: null, note: 'riga1\nriga2' },
        { name: 'Mario', email: 'm@x.it', note: undefined },
      ],
      ['name', 'email', 'note'],
    );
    expect(out).toBe(
      ['name,email,note', '"Anna, ""la designer""",,"riga1\nriga2"', 'Mario,m@x.it,'].join('\n'),
    );
  });
});
