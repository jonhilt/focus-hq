// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

// the browser's plugin API brings every plugin's client part with it: the screen's part needs the lead's name and a
// voice, and the narrator and Ask box stand in for themselves
vi.mock('../../plugin-api/client', async () => ({
  ...(await import('../../plugin-api/shared')),
  office: { agent: () => ({ name: 'Lt. Adeyemi' }) },
  h: (tag: string, props: { class?: string; hidden?: boolean } | null) => Object.assign(document.createElement(tag), { className: props?.class ?? '', hidden: !!props?.hidden }),
}));
const narrators: { updated?: (beat: number) => void; ended: boolean; said: unknown[] }[] = [];
vi.mock('./narrator', () => ({
  Narrator: class {
    beats = { lines: ['One.'] };
    ended = false;
    said: unknown[] = [];
    updated?: (beat: number) => void;
    constructor(_frame: unknown, _voice: unknown, before?: { updated: (beat: number) => void }) {
      this.updated = before?.updated;
      narrators.push(this);
    }
    heard(e: unknown) {
      this.said.push(e);
    }
    end() {
      this.ended = true;
    }
  },
}));
vi.mock('./ask', () => ({
  BriefingAsk: class {
    el = document.createElement('div');
    ended = false;
    constructor(_ui: unknown, _lead: unknown, _artifact: unknown, public narrator: unknown) {}
    end() {
      this.ended = true;
    }
  },
}));

const { default: briefings } = await import('./client');

const view = (over: Record<string, unknown> = {}) => ({ ui: {} as never, leadId: 'lead1', artifact: { id: 'save-journey', title: 'How a save travels', at: 1 }, frame: document.createElement('iframe'), live: true, ...over });

describe('the briefings plugin’s part of the screen', () => {
  it('narrates a page up close, and asks about it while the goal’s open', () => {
    const part = briefings.screen?.(view());
    expect(part?.foot).toBeInstanceOf(HTMLElement);
    expect(part?.head?.hidden).toBe(true);
    // what the player posts goes to its narrator
    const e = new MessageEvent('message', { data: { kit: 'pause' } });
    part?.heard?.(e);
    expect(narrators.at(-1)?.said).toEqual([e]);
    // a closed goal's page plays, but there's no one to ask
    expect(briefings.screen?.(view({ live: false }))?.foot).toBeUndefined();
  });

  it('keeps the Ask box through a new version, with a new narrator that says what changed', () => {
    const first = briefings.screen?.(view());
    const second = briefings.screen?.(view({ before: first }));
    expect(second?.foot).toBe(first?.foot);
    expect(narrators.at(-2)?.ended).toBe(true);
    const updated = narrators.at(-1)?.updated;
    updated?.(2);
    expect(second?.head?.hidden).toBe(false);
    expect(second?.head?.textContent).toBe('Updated · beat 3 changed');
    expect(second?.head?.title).toMatch(/^Lt\. Adeyemi explained it again: it's waiting at the beat that changed/);
    updated?.(-1);
    expect(second?.head?.textContent).toBe('Updated');
    second?.end();
    expect(narrators.at(-1)?.ended).toBe(true);
  });

  it('starts afresh after another plugin’s part', () => {
    const part = briefings.screen?.(view({ before: { end: vi.fn() } }));
    expect(narrators.at(-1)?.updated).toBeUndefined();
    expect(part?.foot).toBeInstanceOf(HTMLElement);
  });
});
