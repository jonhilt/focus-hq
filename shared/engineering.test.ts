import { describe, expect, it } from 'vitest';
import { optionLabel, optionText, recommendation } from './engineering';
import type { EngineeringReport } from './types';

const option = { title: 'A module of its own', approach: 'A new module owns it.', touches: ['src/a.ts', 'src/b.ts'], tradeoffs: ['Clear home'], risks: [], size: 'one agent' as const };

describe('optionText', () => {
  it('reads as Markdown paragraphs: title and size, approach, then each list, skipping empty ones', () => {
    expect(optionText(option)).toBe('**A module of its own** (one agent)\n\nA new module owns it.\n\nTouches:\n- src/a.ts\n- src/b.ts\n\nTrade-offs:\n- Clear home');
  });
});

describe('recommendation', () => {
  it('names the recommended option by letter and says why', () => {
    const report: EngineeringReport = { options: [{ ...option, title: 'Extend it' }, option], recommended: 1, why: 'it keeps things small.' };
    expect(recommendation(report)).toBe('2 options on the screen. I’d go with Option B, A module of its own: it keeps things small.');
    expect(optionLabel(2)).toBe('Option C');
  });
});
