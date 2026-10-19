import { describe, expect, it, vi } from 'vitest';

// the browser's plugin API brings every plugin's client part with it, and the panel stands in for itself
vi.mock('../../plugin-api/client', () => ({}));
const opened: unknown[] = [];
vi.mock('./panel', () => ({ openCaptainsLogPanel: (ui: unknown) => opened.push(ui) }));
vi.mock('./captains-log.css', () => ({}));

const { default: captainsLog } = await import('./client');

describe('the captain’s log in the browser', () => {
  it('opens on J anywhere aboard, but not over a panel, and lists the key', () => {
    let isOpen = false;
    const ui = {
      panels: {
        get isOpen() {
          return isOpen;
        },
      },
    };
    const parts = captainsLog.start?.({ ui } as never);
    const key = (code: string) => parts?.keydown?.({ code } as KeyboardEvent);
    expect(key('KeyK')).toBe(false);
    expect(key('KeyJ')).toBe(true);
    expect(opened).toEqual([ui]);
    isOpen = true;
    expect(key('KeyJ')).toBe(false);
    expect(opened).toHaveLength(1);
    expect(captainsLog.legend).toEqual([{ key: 'J', label: 'log' }]);
  });
});
