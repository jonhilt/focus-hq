import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Agent, LeadToolContext, PageFrames } from '../../plugin-api/server';
import { EXPLAINER_LIMITS, explainerPage } from './explainer';
import { explainShape, explainTool as tool } from './explainTool';
import type { Sources } from './sources';

// the office's sources, stood in for: one file in the checkout, one thing the lead said, one ledger line
const sources: Sources = {
  file: (_lead, where) => Promise.resolve(where === 'server/ledger.ts' ? { text: 'const a = 1;\nappendFileSync(path, line); // never rewrites\n', cite: 'server/ledger.ts:{line} @abc1234' } : { error: `there's no file ${where} in your checkout.` }),
  said: () => Promise.resolve([{ text: 'Haiku judged as well as Sonnet, at about $0.35 for all 555 turns.', at: '20 Oct, 09:44' }]),
  ledger: (seq) => (seq === 7 ? { text: 'qa-verdict\nfail', cite: 'ledger #7 · qa-verdict' } : undefined),
  pr: (repo, number) => Promise.resolve(number === 572 ? { text: 'Briefings carry receipts\n## QA report: Passed\nI found no bug I could prove.', cite: `${repo}#572 · Briefings carry receipts` } : { error: `couldn't read ${repo}#${number} on GitHub: is the number right?` }),
};
const explainTool = tool(sources);

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
      agent: { id: 'lead1', name: 'Lt. Castellanos' } as Agent,
      checkouts: [{ repo: 'jonhilt/focus', dir: '/nowhere' }],
      show: () => Promise.reject(new Error('explain shows its page with frames')),
      showFrames: (page, frames) => {
        shown.push({ page, frames });
        return Promise.resolve({
          text: `“${page.title}” is on your station's screen.${errors}`,
          frames: frames.at.map((at) => ({ at, image: new TextEncoder().encode(`beat at ${at}`), seen: { flat: page.html.includes('blank') ? 1 : 0.7 } })),
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

  describe('receipts', () => {
    const withRefs = (refs: unknown[], narration = 'It appends each line and never rewrites.') => {
      const base = input('function render(t) {}');
      return { ...base, beats: [{ ...base.beats[0], narration, refs }, base.beats[1]] };
    };

    it('shows each beat’s receipts as chips, and a beat without any as interpretation', async () => {
      const { context, shown } = lead();
      await explainTool.run(context, withRefs([{ kind: 'file', where: 'server/ledger.ts', quote: 'appendFileSync(path, line); // never rewrites' }]));
      const html = shown[0].page.html;
      expect(html).toContain('"receipts":[{"label":"server/ledger.ts:2 @abc1234","quote":"appendFileSync(path, line); // never rewrites"}]');
      expect(html).toContain('"receipts":[]');
      expect(html).toContain("'Interpretation'");
    });

    it('takes the lead’s own words and the ledger as sources too', async () => {
      const { context, shown } = lead();
      const narration = 'Haiku judged as well as Sonnet: thirty five cents for five hundred and fifty five turns.';
      await explainTool.run(context, withRefs([{ kind: 'said', quote: 'Haiku judged as well as Sonnet, at about $0.35 for all 555 turns' }, { kind: 'ledger', where: '7', quote: 'fail' }], narration));
      expect(shown[0].page.html).toContain('"label":"Lt. Castellanos, 20 Oct, 09:44: “Haiku judged as well as Sonnet,…”"');
      expect(shown[0].page.html).toContain('"label":"ledger #7 · qa-verdict"');
    });

    it('takes a pull request, its comments and QA’s report among them, as a source', async () => {
      const { context, shown } = lead();
      await explainTool.run(context, withRefs([{ kind: 'pr', where: '#572', quote: 'I found no bug I could prove' }], 'QA found no bug it could prove.'));
      expect(shown[0].page.html).toContain('"label":"jonhilt/focus#572 · Briefings carry receipts"');
      await expect(explainTool.run(context, withRefs([{ kind: 'pr', where: '#572', quote: 'QA failed it' }]))).rejects.toThrow(/"QA failed it" isn't in jonhilt\/focus#572/);
      await expect(explainTool.run(context, withRefs([{ kind: 'pr', where: '#9', quote: 'x' }]))).rejects.toThrow(/couldn't read jonhilt\/focus#9/);
    });

    it('sends it back, unshown, when a quote isn’t in its source or the caption or narration says what no quote does', async () => {
      const { context, shown } = lead();
      const badQuote = withRefs([{ kind: 'file', where: 'server/ledger.ts', quote: 'rewrites the whole file' }]);
      await expect(explainTool.run(context, badQuote)).rejects.toThrow(/Beat 1: "rewrites the whole file" isn't in server\/ledger\.ts/);
      const unbacked = withRefs([{ kind: 'said', quote: 'Haiku judged as well as Sonnet' }], 'Haiku beat Opus on 600 turns.');
      await expect(explainTool.run(context, unbacked)).rejects.toThrow(/Beat 1 says "600", "Opus", which none of its quotes do/);
      const captioned = withRefs([{ kind: 'said', quote: 'Haiku judged as well as Sonnet' }], 'Haiku judged as well as Sonnet.');
      captioned.beats[0].text = 'Haiku matched Sonnet on 600 turns.';
      await expect(explainTool.run(context, captioned)).rejects.toThrow(/Beat 1 says "600", which none/);
      await expect(explainTool.run(context, withRefs([{ kind: 'ledger', where: '8', quote: 'fail' }]))).rejects.toThrow(/no line 8/);
      await expect(explainTool.run(context, withRefs([{ kind: 'file', where: 'nope.ts', quote: 'x' }]))).rejects.toThrow(/no file nope\.ts/);
      expect(shown).toEqual([]);
    });
  });
});
