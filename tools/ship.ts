// Builds the ship's decks in Blender (blender/ship.py) into client/public/ship/*.glb, and saves each as a .blend in
// blender/build/ to open and look round. Finds Blender through BLENDER, then the PATH, then where its installers put it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { newestFirst } from './blender';
import { root } from './demoShip';

/** Where Blender's Windows installer puts it: a folder per version (`Blender 5.2`), newest first. */
function windowsInstalls(): string[] {
  const foundation = path.win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Blender Foundation');
  let folders: string[];
  try {
    folders = newestFirst(readdirSync(foundation));
  } catch {
    return [];
  }
  return folders.map((f) => path.win32.join(foundation, f, 'blender.exe'));
}

const candidates = [
  process.env.BLENDER,
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  ...(process.platform === 'win32' ? windowsInstalls() : []),
].filter((c): c is string => !!c);

function findBlender(): string | undefined {
  for (const c of candidates) {
    if (path.isAbsolute(c) && !existsSync(c)) continue;
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch { /* not this one */ }
  }
  return undefined;
}

const blender = findBlender();
if (!blender) {
  console.error(
    [
      'Blender not found.',
      'You only need it to change the ship: the decks are built from blender/*.py into client/public/ship/*.glb, which are',
      'committed, so Focus runs without it.',
      `To build them, install Blender (blender.org), or set BLENDER to its executable. Tried: ${candidates.join(', ')}`,
    ].join('\n'),
  );
  process.exit(1);
}
const glbDir = path.join(root, 'client/public/ship');
const blendDir = path.join(root, 'blender/build');
mkdirSync(glbDir, { recursive: true });
mkdirSync(blendDir, { recursive: true });
try {
  execFileSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', path.join(root, 'blender/ship.py'), '--', glbDir, blendDir], { stdio: 'inherit' });
} catch {
  // Blender has already printed what went wrong
  process.exit(1);
}
