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

describe('a repo’s merge method', () => {
  const store = new Store(false);
  const project = store.addProject('Focus');
  project.repos = ['o/a', 'o/b'];

  it('is set for one repo and cleared back to the office-wide setting', () => {
    store.updateProject(project.id, { mergeMethod: { repo: 'o/a', method: 'rebase' } });
    store.updateProject(project.id, { mergeMethod: { repo: 'o/b', method: 'merge' } });
    expect(project.mergeMethods).toEqual({ 'o/a': 'rebase', 'o/b': 'merge' });
    store.updateProject(project.id, { mergeMethod: { repo: 'o/a', method: '' } });
    expect(project.mergeMethods).toEqual({ 'o/b': 'merge' });
  });

  it('can’t be set for a repo the project hasn’t connected', () => {
    expect(() => store.updateProject(project.id, { name: 'Renamed', mergeMethod: { repo: 'o/c', method: 'squash' } })).toThrow('isn’t connected');
    expect(project.name).toBe('Focus');
  });
});
