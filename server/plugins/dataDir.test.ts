import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveInto, pluginDataDir } from './dataDir';

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('pluginDataDir', () => {
  it('is the plugin’s own folder, with what it kept in the data dir before it was a plugin moved in', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-data-'));
    write(path.join(data, 'scorecards', 'a.json'), 'a');
    write(path.join(data, 'scorecards', 'noise', 'n.json'), 'n');
    const dir = pluginDataDir('scorecard', { movedFrom: 'scorecards', dataDir: data });
    expect(dir).toBe(path.join(data, 'plugins', 'scorecard'));
    expect(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(dir, 'noise', 'n.json'), 'utf8')).toBe('n');
    expect(fs.existsSync(path.join(data, 'scorecards'))).toBe(false);
  });

  it('makes nothing for a plugin that kept nothing before, until it writes', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-data-'));
    expect(pluginDataDir('maps', { dataDir: data })).toBe(path.join(data, 'plugins', 'maps'));
    expect(fs.existsSync(path.join(data, 'plugins'))).toBe(false);
  });
});

describe('moveInto', () => {
  it('merges into a folder already written to, keeping its own copy of anything both have', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-move-'));
    write(path.join(root, 'old', 'a.json'), 'old a');
    write(path.join(root, 'old', 'b.json'), 'old b');
    write(path.join(root, 'old', 'noise', 'n.json'), 'old n');
    write(path.join(root, 'new', 'b.json'), 'new b');
    write(path.join(root, 'new', 'noise', 'm.json'), 'new m');
    moveInto(path.join(root, 'old'), path.join(root, 'new'));
    const read = (file: string) => fs.readFileSync(path.join(root, 'new', file), 'utf8');
    expect([read('a.json'), read('b.json'), read('noise/n.json'), read('noise/m.json')]).toEqual(['old a', 'new b', 'old n', 'new m']);
    // what both had stays behind in the old folder, so nothing's lost
    expect(fs.readdirSync(path.join(root, 'old'))).toEqual(['b.json']);
  });
});
