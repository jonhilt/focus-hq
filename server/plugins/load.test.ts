import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadPlugins, pluginEntry } from './load';

describe('pluginEntry', () => {
  it('finds a bare name under the office’s plugins/, and a path anywhere', () => {
    expect(pluginEntry('climber', '/focus', '/home/me')).toBe('/focus/plugins/climber/server.ts');
    expect(pluginEntry('../mine/auditor', '/focus', '/home/me/work')).toBe('/home/me/mine/auditor/server.ts');
    expect(pluginEntry('/opt/plugins/auditor', '/focus', '/home/me')).toBe('/opt/plugins/auditor/server.ts');
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
});
