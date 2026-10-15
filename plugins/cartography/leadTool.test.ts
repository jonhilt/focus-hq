// The map tool against the office's own checkout, as a lead's would be: listing the views, showing one, and a view
// that isn't there.
import { describe, expect, it } from 'vitest';
import { config } from '../../server/config';
import type { Agent } from '../../shared/types';
import type { LeadToolContext } from '../../server/plugins/contract';
import { mapTool } from './leadTool';

function lead(): { context: LeadToolContext; shown: { id: string; title: string; html: string }[] } {
  const shown: { id: string; title: string; html: string }[] = [];
  const context: LeadToolContext = {
    agent: { id: 'lead_p_1' } as Agent,
    checkouts: [{ repo: 'jonhilt/focus', dir: config.root }],
    show: (page) => {
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
    expect(said).toContain('view "show-to-screen": 7 parts');
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
