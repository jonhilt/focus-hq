// Where each plugin keeps its files (docs/plugins.md): a folder of its own in the office's data dir, the same one for
// its server part (`host.dataDir()`) and its scripts (`pluginDataDir` from plugin-api/server). A part of the office
// that became a plugin names the folder it kept in the data dir before (`movedFrom`), and what's in it moves in.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

const moved = new Set<string>();

/**
 * Plugin `id`'s own folder in `dataDir` (not made until it's written to). `movedFrom` is a folder in the data dir it
 * kept before it was a plugin: what's in it moves in, once a run, so a step can go once every office has run past it.
 */
export function pluginDataDir(id: string, how: { movedFrom?: string; dataDir?: string } = {}): string {
  const dataDir = how.dataDir ?? config.dataDir;
  const dir = path.join(dataDir, 'plugins', id);
  if (how.movedFrom && !moved.has(dir)) {
    moved.add(dir);
    moveInto(path.join(dataDir, how.movedFrom), dir);
  }
  return dir;
}

/** Moves everything in `from` into `to`, keeping what's in `to` already when both have it, and removes `from` once it's empty. */
export function moveInto(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (!fs.existsSync(target)) fs.renameSync(source, target);
    else if (entry.isDirectory() && fs.statSync(target).isDirectory()) moveInto(source, target);
  }
  if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
}
