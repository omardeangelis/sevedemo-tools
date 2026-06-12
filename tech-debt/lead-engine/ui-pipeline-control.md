# Tech debt — ui-pipeline-control

Drift durevole emerso durante l'implementazione di `brain/specs/lead-engine/ui-pipeline-control/`.

## Spawn del run via `tsx` (dev runtime)

Il job manager (`src/server/jobs.ts`) spawna `node_modules/.bin/tsx src/server/run-daily-job.ts`. In un eventuale deploy buildato (`tsc -p .` → `dist/`) questo comando non funzionerebbe: andrebbe puntato al JS compilato o mantenuto `tsx` come dipendenza di produzione. Scelta accettata in fase di test (decisione del piano); il comando è centralizzato in `jobs.ts` e iniettabile via `StartOptions`.

## La guardia "run in corso" non vede i run lanciati da CLI

Lo stato job vive in `kv` (`ui_job:daily`) ed è scritto solo dal percorso UI (assunzione D4 del piano, chiude SPEC OQ#1). Un `npm run pipeline -- --daily` lanciato da terminale è invisibile alla UI: il 409 dell'erase e il blocco del doppio run non lo coprono. Se in futuro la CLI diventa un canale operativo parallelo, far scrivere lo stesso record kv anche al percorso CLI (o derivare lo stato dalla tabella `runs`).

## Run più corti della finestra di polling idle non generano notifica

La UI osserva lo stato con polling (15s a riposo): un run che inizia e finisce dentro quella finestra non viene mai visto come `running`, quindi nessuna transizione → nessun toast (l'esito resta comunque visibile nella card della dashboard). Irrilevante coi run reali (minuti), può confondere con job finti molto brevi.
