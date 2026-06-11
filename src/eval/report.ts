import { reportByStrategy } from '../db/runs.js';

/** Stampa una tabella di confronto tra strategie per scegliere la più redditizia. */
export function printStrategyReport(): void {
  const rows = reportByStrategy();
  if (rows.length === 0) {
    console.log('Nessun dato: esegui prima qualche estrazione (pipeline) e importa gli outcome (eval:import).');
    return;
  }

  const headers = ['strategy', 'estratti', 'selez.', 'inviate', 'reply', 'reply%', 'positive', 'pos%', 'sel%'];
  const table = rows.map((r) => [
    r.strategy,
    String(r.extracted),
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
    '\nLegenda: reply% e positive% sono sulle email inviate (richiede eval:import). sel% = quota di estratti finiti nei 40.',
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
