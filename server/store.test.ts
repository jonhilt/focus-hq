import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// paths come from the environment when config.ts loads, so the data folder is set before the store is imported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-store-'));
process.env.FOCUS_DATA_DIR = dir;
const { Store, stateLocked } = await import('./store');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Store on disk', () => {
  it('won’t open a data folder another live office holds', () => {
    fs.writeFileSync(path.join(dir, 'state.json.lock'), String(process.ppid));
    expect(() => new Store(true).load()).toThrow(stateLocked(process.ppid, dir));
    fs.rmSync(path.join(dir, 'state.json.lock'));
  });

  it('takes over a lock left by an office that’s gone, and flushes a waiting save at once', () => {
    fs.writeFileSync(path.join(dir, 'state.json.lock'), '999999');
    const store = new Store(true);
    store.load();
    expect(fs.readFileSync(path.join(dir, 'state.json.lock'), 'utf8')).toBe(String(process.pid));
    store.addProject('Focus');
    store.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as { projects: { name: string }[] };
    expect(saved.projects.map((p) => p.name)).toEqual(['Focus']);
  });
});
