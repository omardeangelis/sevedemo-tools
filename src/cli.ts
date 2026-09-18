import { Command } from 'commander';
import { config } from './config.js';

const program = new Command();

program
  .name('sevedemo')
  .description('SeVedemo — CLI di manutenzione locale')
  .version('0.1.0');

program
  .command('db:init')
  .description('Inizializza/aggiorna il database SQLite (idempotente).')
  .action(async () => {
    // L'import di ./db/index apre il DB e applica lo schema.
    await import('./db/index.js');
    console.log(`Database pronto: ${config.paths.db}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
