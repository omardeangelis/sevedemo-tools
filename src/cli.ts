import { Command } from 'commander';
import { config } from './config.js';
import { runDaily, runStrategy } from './pipeline/run.js';
import { listStrategies, isEnabled } from './strategies/registry.js';
import { getSelection } from './db/runs.js';
import { exportContacts } from './export/csv.js';
import { importOutcomes } from './eval/import.js';
import { printStrategyReport } from './eval/report.js';
import { today } from './db/index.js';

const program = new Command();

program
  .name('sevedemo')
  .description('SeVedemo Lead Engine — estrazione contatti LinkedIn (Apify + Claude)')
  .version('0.1.0');

program
  .command('db:init')
  .description('Inizializza/aggiorna il database SQLite (idempotente).')
  .action(() => {
    // L'import di ./db/index applica già lo schema.
    console.log(`Database pronto: ${config.paths.db}`);
  });

program
  .command('strategies')
  .description('Elenca le strategie disponibili e il loro stato.')
  .action(() => {
    console.log('\nStrategie disponibili:\n');
    for (const s of listStrategies()) {
      const stato = isEnabled(s) ? 'ATTIVA' : 'gated (manca LINKEDIN_LI_AT)';
      const cookie = s.requiresCookie ? 'cookie' : 'no-cookie';
      console.log(`  • ${s.id}`);
      console.log(`      ${s.description}`);
      console.log(`      [${cookie}] bucket atteso: ${s.bucketHint} — ${stato}\n`);
    }
  });

program
  .command('pipeline')
  .description('Esegue la pipeline di estrazione.')
  .option('--daily', 'Run completo giornaliero (mix strategie) → 20 freelance + 20 azienda + bozze email + export')
  .option('--strategy <id>', 'Esegue una singola strategia (accumulo dati di confronto)')
  .option('--limit <n>', 'Numero massimo di candidati da estrarre', (v) => Number.parseInt(v, 10))
  .action(async (opts: { daily?: boolean; strategy?: string; limit?: number }) => {
    try {
      if (opts.strategy) {
        await runStrategy(opts.strategy, opts.limit ?? config.poolSize);
      } else if (opts.daily) {
        await runDaily();
      } else {
        console.error('Specifica --daily oppure --strategy <id>. Vedi `strategies` per gli id.');
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('export')
  .description('Ri-esporta la selezione di un giorno.')
  .option('--date <YYYY-MM-DD>', 'Data della selezione', today())
  .action((opts: { date: string }) => {
    const rows = getSelection(opts.date);
    if (rows.length === 0) {
      console.error(`Nessuna selezione per ${opts.date}.`);
      process.exitCode = 1;
      return;
    }
    const out = exportContacts(rows, `daily-${opts.date}`);
    console.log(`Esportati ${out.count} contatti:\n  ${out.csvPath}\n  ${out.jsonPath}`);
  });

program
  .command('eval:import')
  .description('Importa gli esiti outreach (CSV del tool email) per il confronto strategie.')
  .argument('<file>', 'Percorso del CSV con gli outcome')
  .action((file: string) => {
    const res = importOutcomes(file);
    console.log(`Outcome importati: ${res.matched} abbinati, ${res.unmatched} non abbinati.`);
  });

program
  .command('eval:report')
  .description('Mostra il confronto delle metriche per strategia.')
  .action(() => {
    printStrategyReport();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
