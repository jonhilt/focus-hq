// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

// the browser's plugin API brings every plugin's client part with it: the narrator needs only its voices
vi.mock('../../plugin-api/client', async () => ({
  ...(await import('../../plugin-api/shared')),
  kokoroReady: () => Promise.resolve(false),
  speak: vi.fn(),
  bestBrowserVoice: () => null,
}));

const { fromPlayer, Narrator } = await import('./narrator');
const { explainerVoice } = await import('./voice');

const voice = { kokoro: 'bm_george', lang: 'en-GB', pitch: 1 } as const;

/** A narrator on a player's frame, and what it tells the player. */
function narrated(before?: ConstructorParameters<typeof Narrator>[2]) {
  const told: unknown[] = [];
  const player = { postMessage: (m: unknown) => void told.push(m) };
  const frame = document.createElement('iframe');
  Object.defineProperty(frame, 'contentWindow', { value: player });
  const narrator = new Narrator(frame, voice, before);
  const hear = (data: unknown, source: unknown = player) => narrator.heard(new MessageEvent('message', { data, source: source as Window }));
  return { narrator, told, hear };
}

describe('what the player says', () => {
  it('reads each of its messages, cut to size', () => {
    expect(fromPlayer({ kit: 'lines', lines: ['One.', 2], titles: ['A'] })).toEqual({ kit: 'lines', lines: ['One.', '2'], titles: ['A'] });
    expect(fromPlayer({ kit: 'lines', lines: Array.from({ length: 10 }, () => 'x') })).toMatchObject({ lines: Array.from({ length: 8 }, () => 'x'), titles: undefined });
    expect(fromPlayer({ kit: 'voice', on: true })).toEqual({ kit: 'voice', on: true });
    expect(fromPlayer({ kit: 'voice', on: 'yes' })).toEqual({ kit: 'voice', on: false });
    expect(fromPlayer({ kit: 'say', beat: 2 })).toEqual({ kit: 'say', beat: 2 });
    for (const kit of ['pause', 'resume', 'hush'] as const) expect(fromPlayer({ kit })).toEqual({ kit });
  });

  it('ignores anything else a page posts', () => {
    for (const data of [null, 'lines', [], { kit: 'lines', lines: 'x' }, { kit: 'say' }, { kit: 'beat', beat: 1 }, { kit: 'other' }]) expect(fromPlayer(data)).toBeUndefined();
  });
});

describe('the narrator', () => {
  afterEach(() => localStorage.clear());

  it('hears only its own player', () => {
    const { narrator, told, hear } = narrated();
    hear({ kit: 'lines', lines: ['One.'] }, {});
    expect(narrator.beats).toBeUndefined();
    expect(told).toEqual([]);
  });

  it('tells the player whether the voice is on once it has its lines', () => {
    const { narrator, told, hear } = narrated();
    hear({ kit: 'lines', lines: ['One.', 'Two.'], titles: ['A', 'B'] });
    expect(told).toEqual([{ kit: 'voice', on: false }]);
    expect(narrator.beats).toEqual({ lines: ['One.', 'Two.'], titles: ['A', 'B'] });
  });

  it('remembers the voice switched on or off from the player', () => {
    const { told, hear } = narrated();
    hear({ kit: 'voice', on: true });
    expect(explainerVoice.on).toBe(true);
    hear({ kit: 'voice', on: false });
    expect(explainerVoice.on).toBe(false);
    expect(told).toEqual([{ kit: 'voice', on: true }, { kit: 'voice', on: false }]);
  });

  it('says a beat with no line straight away, so the player moves on', () => {
    const { told, hear } = narrated();
    hear({ kit: 'lines', lines: ['One.'] });
    hear({ kit: 'say', beat: 3 });
    expect(told).toContainEqual({ kit: 'said', beat: 3 });
    // nothing being said: pausing, resuming and hushing it are nothing to do
    for (const kit of ['pause', 'resume', 'hush']) hear({ kit });
  });

  it('shows a new version at the first beat that changed, and says so', () => {
    const updated = vi.fn();
    const { told, hear } = narrated({ beats: { lines: ['One.', 'Two.'], titles: ['A', 'B'] }, updated });
    hear({ kit: 'lines', lines: ['One.', 'Two, again.'], titles: ['A', 'B'] });
    expect(told).toContainEqual({ kit: 'show', beat: 1 });
    expect(updated).toHaveBeenCalledWith(1);
  });

  it('stops for good when it ends', () => {
    const { narrator, told } = narrated();
    narrator.end();
    expect(told).toEqual([]);
  });
});
