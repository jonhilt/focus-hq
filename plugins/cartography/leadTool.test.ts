// The map tool against the office's own checkout, as a lead's would be: listing the views, showing one, and a view
// that isn't there.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type Agent, ARTIFACT_LIMITS, type LeadToolContext } from '../../plugin-api/server';
import { OFFICE_DIR } from '../../plugin-api/testing';
import { mapTool } from './leadTool';

// mapping runs real git (ls-files, rev-parse), which takes longer than vitest's 5 s on a busy machine
vi.setConfig({ testTimeout: 30_000 });

/** A lead with `checkouts`, whose screen refuses a title over the show tool's limit, as the office's does. */
function lead(checkouts = [{ repo: 'jonhilt/focus', dir: OFFICE_DIR }]): { context: LeadToolContext; shown: { id: string; title: string; html: string }[] } {
  const shown: { id: string; title: string; html: string }[] = [];
  const context: LeadToolContext = {
    agent: { id: 'lead_p_1' } as Agent,
    checkouts,
    show: (page) => {
      if (page.title.length > ARTIFACT_LIMITS.title) return Promise.reject(new Error(`The title is ${page.title.length} characters`));
      shown.push(page);
      return Promise.resolve(`“${page.title}” is on your station's screen.`);
    },
  };
  return { context, shown };
}

describe('the map tool', () => {
  it('lists the views there are, with no view asked for', async () => {
    const { context, shown } = lead();
    const said = await mapTool.run(context, {});
    expect(said).toContain("jonhilt/focus's views:");
    expect(said).toContain('- whole: every part, as a dependency matrix');
    expect(said).toContain("- show-to-screen: How does a lead's show reach the station's screen?");
    expect(shown).toEqual([]);
  });

  it('puts a view on the station\'s screen, drawn from the lead\'s checkout', async () => {
    const { context, shown } = lead();
    const said = await mapTool.run(context, { view: 'show-to-screen' });
    expect(said).toContain("is on your station's screen");
    expect(said).toContain('view "show-to-screen": 6 parts. 5 steps, each backed by the code.');
    expect(shown).toHaveLength(1);
    expect(shown[0].id).toBe('map-show-to-screen');
    expect(shown[0].html).toContain('<svg');
    expect(shown[0].html).toContain('Mirror of the office');
  });

  it('says there\'s no such view, with the ones there are', async () => {
    const { context } = lead();
    await expect(mapTool.run(context, { view: 'nowhere' })).rejects.toThrow(/There's no view "nowhere"[\s\S]*show-to-screen/);
    await expect(mapTool.run(context, { view: 'whole', repo: 'someone/else' })).rejects.toThrow("someone/else isn't one of your checkouts");
  });
});

describe('a view whose question is longer than a screen\'s title', () => {
  it('is shown, its title cut short and the page heading with all of it', async () => {
    const question = 'How does a request from the browser travel through the router, the core and the store, and back again?';
    const dir = mkdtempSync(path.join(os.tmpdir(), 'focus-map-tool-'));
    mkdirSync(path.join(dir, '.focus'));
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(dir, '.focus', 'cartography.yaml'), `parts:\n  a: { label: A, layer: Core, paths: [src/] }\nviews:\n  long:\n    question: "${question}"\n    parts: [a]\n`);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const { context, shown } = lead([{ repo: 'o/long', dir }]);
    expect(question.length).toBeGreaterThan(ARTIFACT_LIMITS.title);
    await mapTool.run(context, { view: 'long' });
    expect(shown).toHaveLength(1);
    expect(shown[0].title.length).toBeLessThanOrEqual(ARTIFACT_LIMITS.title);
    expect(shown[0].title).toMatch(/^How does a request from the browser.*…$/);
    expect(shown[0].html).toContain(`<h1>${question}</h1>`);
  });
});
