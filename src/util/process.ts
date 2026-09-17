/**
 * True se esiste un processo con questo pid (segnale 0: nessun effetto sul processo).
 * EPERM = il processo esiste ma appartiene a un altro utente: vivo.
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
