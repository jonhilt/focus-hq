import { describe, expect, it } from 'vitest';
import { showsBrowser } from './browserView';
import type { BrowserFrame } from './types';

const frame = (f: Partial<BrowserFrame> = {}): BrowserFrame => ({ url: 'http://localhost:5173', at: Date.now(), ...f });

describe('showsBrowser', () => {
  it('shows the browser when the agent has a frame', () => {
    expect(showsBrowser(frame())).toBe(true);
  });

  it('shows the terminal only when the agent has no frame', () => {
    expect(showsBrowser(undefined)).toBe(false);
  });

  it('keeps showing an old frame after the agent has finished testing', () => {
    expect(showsBrowser(frame({ at: Date.now() - 60 * 60_000 }))).toBe(true);
  });

  it('shows a demo mock page like a screenshot', () => {
    expect(showsBrowser(frame({ mock: { heading: 'Shop', accent: '#f00', step: 1 } }))).toBe(true);
  });
});
