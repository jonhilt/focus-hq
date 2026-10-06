import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESTART_MESSAGE } from './updater';

// Runs the office as a child process and starts it again when it exits to pick up an auto update. The office can't
// restart itself in place: a fresh process is the only way to load new server code and dependencies.

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts');
let child: ReturnType<typeof spawn>;

function start(): void {
  // execArgv carries tsx's loader hooks, so the child runs TypeScript the same way this process does.
  // the ipc channel carries the office's restart request
  child = spawn(process.execPath, [...process.execArgv, entry, ...process.argv.slice(2)], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let restartRequested = false;
  child.on('message', (message) => {
    if (message === RESTART_MESSAGE) restartRequested = true;
  });
  child.on('exit', (code, signal) => {
    if (restartRequested) {
      console.log('  ↻ Restarting the office…\n');
      return start();
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

// Ctrl+C reaches the child through the terminal's process group; forwarding covers signals sent to this process alone.
// The office handles a repeated signal as one shutdown.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));

start();
