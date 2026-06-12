import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolamento DB: deve girare prima che qualunque test importi src/config.ts.
// La config è letta a import-time: per questo i test importano i moduli che
// toccano il DB con `await import()` dinamico, mai con import statici hoisted.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sevedemo-test-${process.pid}-`));
process.env.DB_PATH = path.join(dir, 'test.db');
