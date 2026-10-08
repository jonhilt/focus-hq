import fs from 'node:fs';

/**
 * Takes a lock file holding this process's id, or says which live process holds it. A lock left by a process that's
 * gone is taken over; this process's own goes when it exits.
 */
export function takeLock(path: string): number | undefined {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(path, String(process.pid), { flag: 'wx' });
      process.once('exit', () => fs.rmSync(path, { force: true }));
      return undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(path, 'utf8'));
      if (pid && pid !== process.pid && alive(pid)) return pid;
      fs.rmSync(path, { force: true });
    }
  }
  return undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
