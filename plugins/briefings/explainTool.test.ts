import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Agent, LeadToolContext, PageFrames } from '../../plugin-api/server';
import { EXPLAINER_LIMITS, explainerPage } from './explainer';
import { explainShape, explainTool } from './explainTool';

const text = (n: number) => 'x'.repeat(n);

describe('the explain tool schema', () => {
  const E = EXPLAINER_LIMITS;
  const explain = z.object(explainShape);
  const beat = { title: 'A beat', text: 'Its caption', seconds: 3 };
  const input = (beats: { title: string; text: string; seconds: number; label?: string }[]) => ({ id: 'x', title: 'X', beats, stage: { html: '', script: 'function render(t) {}' } });

  it('says each limit in its description', () => {
    const beatShape = (explainShape.beats as unknown as z.ZodArray<z.ZodObject<Record<string, z.ZodType>>>).element.shape;
    expect(explainShape.beats.description).toContain(`${E.minBeats} to ${E.maxBeats}`);
    expect(beatShape.title.description).toContain(String(E.beatTitle));
    expect(beatShape.text.description).toContain(String(E.text));
    expect(beatShape.seconds.description).toContain(`${E.minSeconds} to ${E.maxSeconds}`);
    expect(beatShape.label.description).toContain(String(E.label));
  });

  it('takes and refuses the same beats as the office', () => {
    const cases = [
      [beat], [beat, beat], Array.from({ length: E.maxBeats }, () => beat), Array.from({ length: E.maxBeats + 1 }, () => beat),
      [beat, { ...beat, title: text(E.beatTitle) }], [beat, { ...beat, title: text(E.beatTitle + 1) }],
      [beat, { ...beat, text: text(E.text) }], [beat, { ...beat, text: text(E.text + 1) }],
      [beat, { ...beat, label: text(E.label) }], [beat, { ...beat, label: text(E.label + 1) }],
      [beat, { ...beat, seconds: E.minSeconds }], [beat, { ...beat, seconds: E.minSeconds - 0.5 }],
      [beat, { ...beat, seconds: E.maxSeconds }], [beat, { ...beat, seconds: E.maxSeconds + 1 }],
    ];
    for (const beats of cases) expect([beats, explain.safeParse(input(beats)).success]).toEqual([beats, !('error' in explainerPage(input(beats)))]);
  });
});

describe('the explain tool', () => {
  /** A lead whose screen takes the page, and pictures its stage at each moment; a page with "blank" in it draws nothing. */
  function lead(errors = '') {
    const shown: { page: { id: string; html: string }; frames: PageFrames }[] = [];
    const context: LeadToolContext = {
      agent: { id: 'lead1' } as Agent,
      checkouts: [],
      show: () => Promise.reject(new Error('explain shows its page with frames')),
      showFrames: (page, frames) => {
        shown.push({ page, frames });
        return Promise.resolve({
          text: `“${page.title}” is on your station's screen.${errors}`,
          frames: frames.at.map((at) => ({ at, image: new TextEncoder().encode(`beat at ${at}`), seen: { flat: page.html.includes('blank') ? 1 : 0.7, labels: [] } })),
        });
      },
    };
    return { context, shown };
  }
  const input = (script: string, seconds = 3) => ({
    id: 'ledger',
    title: 'The ledger',
    beats: [{ title: 'Append', text: 'One line per event.', seconds }, { title: 'Crash', text: 'Half a line at the end.', seconds: 4 }],
    stage: { html: '<div id="file"></div>', script },
  });

  it('puts the explainer up in the office’s player, and answers with its stage at the middle of each beat', async () => {
    const { context, shown } = lead();
    const reply = await explainTool.run(context, input('function render(t) {}'));
    if (typeof reply === 'string') throw new Error('No pictures came back');
    expect(reply.text).toMatch(/“The ledger” is on your station's screen.*an explainer of 2 beats, 7 seconds in all\. Here's the stage at the middle of each beat.*found nothing\.$/);
    expect(reply.images.map((i) => new TextDecoder().decode(i))).toEqual(['beat at 1.5', 'beat at 5']);
    expect(shown[0].page.html).toContain('<div id="file"></div>');
    expect(shown[0].page.html).toContain('Run briefing');
    expect(shown[0].frames.clip).toEqual({ x: 200, y: 58, width: 1050, height: 500 });
  });

  it('says what the checks found on the stage', async () => {
    const reply = await explainTool.run(lead().context, input('function render(t) { /* blank */ }'));
    expect(typeof reply === 'string' ? reply : reply.text).toMatch(/found: Beat 1 looks empty.* Beat 2 looks empty/);
  });

  it('refuses what the player can’t play', async () => {
    await expect(explainTool.run(lead().context, input('function render(t) {}', 99))).rejects.toThrow();
  });

  it('gives the demo’s scripted lead an explainer of the demo’s repos to put up', () => {
    const demo = explainTool.demo?.({ folders: ['web', 'api'], again: false });
    expect(z.object(explainShape).safeParse(demo).success).toBe(true);
    expect(JSON.stringify(demo)).toContain('web');
  });
});
