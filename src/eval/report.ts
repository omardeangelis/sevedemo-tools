import { reportByStrategy, reportBySourceDetail } from '../db/runs.js';
import { listStrategies } from '../strategies/registry.js';

/** Stato derivato → etichetta leggibile per la CLI. */
const STATE_LABEL: Record<string, string> = {
  'never-ran': 'mai girata',
  'clean-0': 'pulita-0',
  'all-duplicates': 'tutti-dup',
  errored: 'ERRORE',
  ok: 'ok',
};

/**
 * Stampa il confronto strategie. Unica fonte condivisa con la UI (`reportByStrategy`):
 * mostra anche le strategie a 0/errore (universo dal registry) e lo stato derivato.
 * Con `detail=true` stampa il drill-down per sotto-fonte.
 */
export function printStrategyReport(detail = false): void {
  if (detail) {
    printSourceDetailReport();
    return;
  }
  const rows = reportByStrategy(listStrategies().map((s) => s.id));
  if (rows.length === 0) {
    console.log('Nessun dato: esegui prima qualche estrazione (pipeline) e importa gli outcome (eval:import).');
    return;
  }

  const headers = ['strategy', 'stato', 'estratti', 'sourced', 'nuovi', 'selez.', 'inviate', 'reply', 'reply%', 'positive', 'pos%', 'sel%'];
  const table = rows.map((r) => [
    r.strategy,
    STATE_LABEL[r.state] ?? r.state,
    String(r.extracted),
    String(r.sourced),
    String(r.new),
    String(r.selected),
    String(r.sent),
    String(r.replied),
    pct(r.reply_rate),
    String(r.positive),
    pct(r.positive_rate),
    pct(r.selected_rate),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...table.map((row) => row[i].length)),
  );
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');

  console.log('\n📊 Confronto strategie di estrazione\n');
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of table) console.log(fmt(row));
  console.log(
    '\nLegenda: stato = mai girata / pulita-0 / tutti-dup / ERRORE / ok. sourced = grezzi visti, nuovi = persistiti.' +
      '\nreply% e positive% sono sulle email inviate (richiede eval:import). sel% = quota di estratti finiti nei 40.' +
      '\nUsa --detail per il drill-down per sotto-fonte (commenter / tagged-person / company-expansion).',
  );
}

/** Drill-down per sotto-fonte (commenter / tagged-person / company-expansion / non attribuito). */
function printSourceDetailReport(): void {
  const rows = reportBySourceDetail();
  if (rows.length === 0) {
    console.log('Nessun dato per sotto-fonte: esegui prima qualche estrazione (pipeline).');
    return;
  }
  const headers = ['strategy', 'sotto-fonte', 'estratti', 'selez.', 'inviate', 'reply', 'positive'];
  const table = rows.map((r) => [
    r.strategy,
    r.source_detail,
    String(r.extracted),
    String(r.selected),
    String(r.sent),
    String(r.replied),
    String(r.positive),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log('\n📊 Drill-down per sotto-fonte\n');
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of table) console.log(fmt(row));
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
