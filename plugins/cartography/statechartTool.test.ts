// The statechart tool against Focus's own checkout, as a lead's would be: a chart drawn with its cites checked, and
// one that isn't a tree refused with every problem.
import { describe, expect, it } from 'vitest';
import { type Agent, type LeadToolContext } from '../../plugin-api/server';
import { FOCUS_DIR } from '../../plugin-api/testing';
import { exampleChart } from './statechartExample';
import { statechartTool } from './statechartTool';

function lead(): { context: LeadToolContext; shown: { id: string; title: string; html: string }[] } {
  const shown: { id: string; title: string; html: string }[] = [];
  const context: LeadToolContext = {
    agent: { id: 'lead_p_1' } as Agent,
    checkouts: [{ repo: 'jonhilt/focus', dir: FOCUS_DIR }],
    show: (page) => {
      shown.push(page);
      return Promise.resolve(`“${page.title}” is on your station's screen.`);
    },
    showFrames: () => Promise.reject(new Error('The statechart tool takes no frames')),
  };
  return { context, shown };
}

describe('the statechart tool', () => {
  it('puts the chart on the screen, saying which cites didn\'t check out', async () => {
    const { context, shown } = lead();
    const said = await statechartTool.run(context, { id: 'turn-ends', ...exampleChart(FOCUS_DIR) });
    expect(said).toContain("is on your station's screen. 16 nodes.");
    expect(said).toContain('- Trigger "Send the words": plugins/chief-of-staff/chief.ts has only');
    expect(said).not.toContain('Turn ends → read');
    expect(shown).toHaveLength(1);
    expect(shown[0].id).toBe('turn-ends');
    expect(shown[0].html).toContain('<code>plugins/chief-of-staff/chief.ts:37</code>');
  });

  it('refuses a chart that isn\'t a tree, listing every problem', async () => {
    const { context, shown } = lead();
    const c = exampleChart(FOCUS_DIR);
    const looped = { id: 'x', ...c, edges: [...c.edges, { from: 'qa-parked', to: 'ready' }, { from: 'early', to: 'nowhere' }] };
    await expect(statechartTool.run(context, looped)).rejects.toThrow(/wasn't drawn[\s\S]*names "nowhere"[\s\S]*2 arrows go into "ready"/);
    expect(shown).toEqual([]);
  });
});
