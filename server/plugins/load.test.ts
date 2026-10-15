import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadPlugins, ownPlugins, pluginEntry, pluginNames } from './load';

describe('pluginEntry', () => {
  it('finds a bare name under the office’s plugins/, and a path anywhere', () => {
    expect(pluginEntry('climber', '/focus', '/home/me')).toBe('/focus/plugins/climber/server.ts');
    expect(pluginEntry('../mine/auditor', '/focus', '/home/me/work')).toBe('/home/me/mine/auditor/server.ts');
    expect(pluginEntry('/opt/plugins/auditor', '/focus', '/home/me')).toBe('/opt/plugins/auditor/server.ts');
  });
});

describe('pluginNames', () => {
  it('reads all as every plugin of the office’s own, where it’s listed, and loads a plugin named twice once', () => {
    expect(pluginNames(['all'], ['auditor', 'climber', 'scorecard'])).toEqual(['auditor', 'climber', 'scorecard']);
    expect(pluginNames(['../mine/auditor', 'all', 'climber'], ['climber', 'scorecard'])).toEqual(['../mine/auditor', 'climber', 'scorecard']);
    expect(pluginNames(['scorecard', 'climber'], [])).toEqual(['scorecard', 'climber']);
    expect(pluginNames([], ['climber'])).toEqual([]);
  });
});

describe('ownPlugins', () => {
  it('lists the folders under plugins/ that have a server.ts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-root-'));
    for (const name of ['b', 'a', 'notes']) fs.mkdirSync(path.join(dir, 'plugins', name), { recursive: true });
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(dir, 'plugins', name, 'server.ts'), '');
    expect(ownPlugins(dir)).toEqual(['a', 'b']);
    expect(ownPlugins(path.join(dir, 'nowhere'))).toEqual([]);
  });
});

describe('loadPlugins', () => {
  it('loads a plugin from a folder outside the office, and leaves out, saying why, one it can’t find or that isn’t one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-plugins-'));
    fs.mkdirSync(path.join(dir, 'auditor'));
    fs.writeFileSync(path.join(dir, 'auditor', 'server.ts'), 'export default { id: "auditor", start: () => ({}) };\n');
    fs.mkdirSync(path.join(dir, 'odd'));
    fs.writeFileSync(path.join(dir, 'odd', 'server.ts'), 'export default { name: "odd" };\n');

    const plugins = await loadPlugins([path.join(dir, 'auditor'), path.join(dir, 'odd'), 'nowhere'], dir);
    expect(plugins.map((p) => p.id)).toEqual(['auditor']);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Plugin .*odd didn't load, so it's left out: .* doesn't default-export a plugin/));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Plugin nowhere: there's no .*nowhere\/server\.ts, so it's left out$/));
    error.mockRestore();
  });

  it('loads the climber from the office’s own plugins/', async () => {
    const plugins = await loadPlugins(['climber'], path.resolve(import.meta.dirname, '../..'));
    expect(plugins.map((p) => p.id)).toEqual(['climber']);
  });

  it('loads every one of the office’s own plugins for all', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const plugins = await loadPlugins(['all'], root);
    expect(plugins.map((p) => p.id)).toEqual(ownPlugins(root));
    expect(plugins.map((p) => p.id)).toEqual(expect.arrayContaining(['climber', 'scorecard']));
  });
});
