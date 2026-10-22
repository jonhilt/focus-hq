import { describe, expect, it } from 'vitest';
import { flowMermaid, mapMermaid, RECAP_END, RECAP_START, recapMarkdown, recapPage, recapProblems, rollup, type SliceRecap, uncovered, withRecap } from './recap';

const recap = (more: Partial<SliceRecap> = {}): SliceRecap => ({
  primitives: [
    { id: 'cos-verdict', group: 'chief of staff', impact: 'extends', change: 'gains replies', paths: ['focus/plugins/chief-of-staff/shared.ts'] },
    { id: 'comms-card', group: 'inbox', impact: 'composes', change: 'shows them as buttons', paths: ['focus/plugins/chief-of-staff/'] },
  ],
  ...more,
});

describe('a slice’s rollup', () => {
  it('is its riskiest primitive’s impact', () => {
    expect(rollup(recap())).toBe('extends');
    expect(rollup({ primitives: [recap().primitives[1]] })).toBe('composes');
    expect(rollup({ primitives: [...recap().primitives, { id: 'merge-lane', group: 'ops', impact: 'adds', change: 'new', paths: ['x'] }] })).toBe('adds');
  });
});

describe('what a recap covers', () => {
  it('is every changed file under one of its primitives’ paths: a file itself, or a folder', () => {
    expect(uncovered(recap(), ['focus/plugins/chief-of-staff/needCard.ts', 'focus/plugins/chief-of-staff/shared.ts', 'focus/docs/merging.md'])).toEqual(['focus/docs/merging.md']);
  });

  it('takes a folder without its slash, and a path starting ./, but not a file named like a folder’s start', () => {
    const r = { primitives: [{ ...recap().primitives[0], paths: ['./focus/docs', 'focus/shared/qa.ts'] }] };
    expect(uncovered(r, ['focus/docs/merging.md', 'focus/shared/qa.ts', 'focus/shared/qa.test.ts', 'focus/docsy.md'])).toEqual(['focus/shared/qa.test.ts', 'focus/docsy.md']);
  });
});

describe('what Ops refuses a ship’s recap for', () => {
  it('nothing, when it names what the slice touches and covers every file it changes', () => {
    expect(recapProblems(recap(), ['focus/plugins/chief-of-staff/needCard.ts'])).toEqual([]);
  });

  it('a changed file no primitive covers, named so the lead can place it', () => {
    const [problem] = recapProblems(recap(), ['focus/docs/merging.md']);
    expect(problem).toBe('No primitive covers this changed file: add it to one’s paths, or name the primitive it belongs to\n- focus/docs/merging.md');
  });

  it('a primitive named twice, or with no change, no paths or an id that isn’t one', () => {
    const [verdict] = recap().primitives;
    const problems = recapProblems({ primitives: [verdict, { ...verdict, change: ' ', paths: [] }, { ...verdict, id: 'Cos Verdict' }] }, []);
    expect(problems).toEqual(['cos-verdict is named twice', 'Say what the slice does to cos-verdict', 'Say where cos-verdict is (its paths)', '“Cos Verdict” isn’t a primitive’s id: lowercase letters, digits and dashes']);
  });

  it('no primitive at all', () => {
    expect(recapProblems({ primitives: [] }, [])).toEqual(['Name at least one primitive the slice touches']);
  });
});

describe('the recap in a pull request', () => {
  const r = recap({ invariants: ['A card you owe never leaves unanswered'], map: [{ from: 'cos-verdict', to: 'comms-card', label: 'replies' }], flow: [{ from: 'captain', to: 'comms-card', label: 'presses "Got it"; nothing sent' }] });
  const md = recapMarkdown(r);

  it('is one block between its markers, its rollup in the summary', () => {
    expect(md.startsWith(RECAP_START)).toBe(true);
    expect(md.endsWith(RECAP_END)).toBe(true);
    expect(md).toContain('<summary>System recap: <b>extends existing primitives</b> (medium risk)</summary>');
    expect(md).toContain('**Classification:** extends. 1 composes, 1 extends.');
  });

  it('lists the primitives and invariants, and draws the map and flow in mermaid, a blank line around each fence', () => {
    expect(md).toContain('| `cos-verdict` | chief of staff | extends | gains replies |');
    expect(md).toContain('- A card you owe never leaves unanswered');
    expect(md).toContain('\n\n```mermaid\nflowchart LR\n');
    expect(md).toContain('\n\n```mermaid\nsequenceDiagram\n');
    expect(md).toMatch(/```\n\n<\/details>/);
  });

  it('colours each primitive by its impact on the map, and leaves what else it talks to plain', () => {
    expect(mapMermaid(recap({ map: [{ from: 'captain', to: 'comms-card', label: 'presses' }] }))).toBe([
      'flowchart LR',
      '  n_cos_verdict["cos-verdict"]',
      '  n_comms_card["comms-card"]',
      '  n_captain["captain"]',
      '  n_captain -->|"presses"| n_comms_card',
      '  classDef composes fill:#0f2d1a,stroke:#2ea043,stroke-width:2px,color:#56d364',
      '  classDef extends fill:#3d2f00,stroke:#d29922,stroke-width:2px,color:#f2cc60',
      '  classDef adds fill:#3c1618,stroke:#da3633,stroke-width:2px,color:#ff7b72',
      '  class n_comms_card composes',
      '  class n_cos_verdict extends',
    ].join('\n'));
  });

  it('keeps what breaks mermaid out of its labels', () => {
    expect(flowMermaid(r.flow ?? [])).toBe([
      'sequenceDiagram',
      '  participant n_captain as captain',
      '  participant n_comms_card as comms-card',
      "  n_captain->>n_comms_card: presses 'Got it', nothing sent",
    ].join('\n'));
  });
});

describe('the recap on the station’s screen', () => {
  it('is a page with the table, and the diagrams escaped for mermaid to read back', () => {
    const page = recapPage(recap({ map: [{ from: 'cos-verdict', to: 'comms-card', label: 'a & b' }] }), 'Got it <b>');
    expect(page).toContain('<span class="t">Got it &lt;b&gt;</span>');
    expect(page).toContain('<code>cos-verdict</code>');
    expect(page).toContain('n_cos_verdict --&gt;|&quot;a &amp; b&quot;| n_comms_card');
  });
});

describe('an arrow no import backs', () => {
  const r = recap({ map: [{ from: 'cos-verdict', to: 'comms-card', label: 'replies', backed: false }, { from: 'comms-card', to: 'cos-verdict', label: 'reads', backed: true }] });

  it('is dashed on the map, and the key says how many', () => {
    expect(mapMermaid(r)).toContain('  n_cos_verdict -.->|"replies"| n_comms_card\n  n_comms_card -->|"reads"| n_cos_verdict');
    expect(recapMarkdown(r)).toContain('_Dashed: Ops found no import behind this arrow (a runtime call, or one to check)._');
    expect(recapPage(r, 't')).toContain('<p class="key">Dashed: Ops found no import behind this arrow');
    expect(recapMarkdown(recap())).not.toContain('Dashed');
  });
});

describe('a pull request’s description with the recap in it', () => {
  const block = `${RECAP_START}\nnew\n${RECAP_END}`;

  it('replaces the recap it had, keeping what’s around it', () => {
    expect(withRecap(`Summary\n\n${RECAP_START}\nold\n${RECAP_END}\n\n---\n_Built by Lt. Vale_`, block)).toBe(`Summary\n\n${block}\n\n---\n_Built by Lt. Vale_`);
  });

  it('goes ahead of the signature, or at the end, in one that had none', () => {
    expect(withRecap('Summary\n\n---\n_Built by Lt. Vale_', block)).toBe(`Summary\n\n${block}\n\n---\n_Built by Lt. Vale_`);
    expect(withRecap('Summary\n', block)).toBe(`Summary\n\n${block}`);
  });
});
