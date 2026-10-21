// What makes a state chart drawable (a strict top-down tree, short text, branches that ask), and its flow as mermaid.
import { describe, expect, it } from 'vitest';
import { type ChartEdge, type ChartNode, chartProblems, flowchart, mermaidEscape, mermaidText, type Statechart, wrap } from './statechart';
import { exampleChart } from './statechartExample';

const chart = (nodes: ChartNode[], edges: ChartEdge[]): Statechart => ({ title: 'T', source: 'S', nodes, edges });
const box = (id: string, kind: ChartNode['kind'] = 'works'): ChartNode => ({ id, text: `Box ${id}`, kind });
const errors = (c: Statechart) => chartProblems(c).errors;

describe('wrapping', () => {
  it('breaks at spaces within the width, a long word keeping a line to itself', () => {
    expect(wrap('The verdict waits on the card; the chief of staff re-reads it', 28)).toEqual(['The verdict waits on the', 'card; the chief of staff', 're-reads it']);
    expect(wrap('a supercalifragilisticexpialidocious word', 10)).toEqual(['a', 'supercalifragilisticexpialidocious', 'word']);
  });

  it('drops breaks the lead made itself', () => {
    expect(wrap('two<br/>lines\nand <BR> more', 40)).toEqual(['two lines and more']);
  });
});

describe('escaping for mermaid', () => {
  it('leaves nothing that could close a string or a shape, or reach the page as markup', () => {
    const nasty = 'say "hi" #1 <b>&</b> [x] {y} (z) a|b `c`; done';
    const out = mermaidEscape(nasty);
    expect(out).not.toMatch(/["<>&`|[\]{}()]/);
    expect(out).toBe('say #quot;hi#quot; #35;1 #lt;b#gt;#amp;#lt;/b#gt; #91;x#93; #123;y#125; #40;z#41; a#124;b #96;c#96;#59; done');
  });

  it('wraps first and joins the lines with mermaid\'s break', () => {
    expect(mermaidText('card or interrupt, or no verdict in 60 s', 22)).toBe('card or interrupt, or<br/>no verdict in 60 s');
  });
});

describe('a chart that is drawn', () => {
  it('is the captain\'s example: no errors and no warnings', () => {
    expect(chartProblems(exampleChart('/x'))).toEqual({ errors: [], warnings: [] });
  });
});

describe('a chart that is refused', () => {
  it('lists every problem at once', () => {
    const c = chart([box('a'), box('b'), box('c'), box('a')], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'nowhere' }]);
    const said = errors(c);
    expect(said).toContain('Two nodes have the id "a": give each its own.');
    expect(said).toContain('The edge c → nowhere names "nowhere", which isn\'t a node.');
    expect(said.find((e) => e.startsWith('2 arrows go into "c" (from a, b)'))).toMatch(/Repeat a short end node/);
  });

  it('has more than one root, or none', () => {
    expect(errors(chart([box('a'), box('b')], []))).toEqual(['There are 2 roots (a, b): there must be one, where the story starts.']);
    expect(errors(chart([box('a'), box('b')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]))[0]).toMatch(/no root/);
  });

  it('loops back below its root', () => {
    const c = chart([box('a'), box('b'), box('c')], [{ from: 'a', to: 'b' }, { from: 'c', to: 'c' }]);
    expect(errors(c)).toEqual(["c can't be reached from the root: an arrow loops back. Draw no arrows back up; repeat a short end node instead."]);
  });

  it('has a branch with one answer, or no question', () => {
    const c = chart([box('a'), { id: 'q', kind: 'branch' }, box('b')], [{ from: 'a', to: 'q' }, { from: 'q', to: 'b' }]);
    expect(errors(c)).toEqual(['Branch "q" has 1 arrow out of it: a branch needs at least two answers.', 'The arrow into branch "q" (from a) needs a label: the branch\'s question, like "what does the client do?".']);
    expect(errors(chart([{ id: 'q', kind: 'branch' }, box('a'), box('b')], [{ from: 'q', to: 'a' }, { from: 'q', to: 'b' }]))).toEqual(['Branch "q" is the root: start with a box saying where things stand.']);
  });

  it('has text missing or too long', () => {
    const long = 'x '.repeat(50);
    const c = chart([{ id: 'a', kind: 'works' }, { id: 'b', text: long, kind: 'works' }], [{ from: 'a', to: 'b', label: long }]);
    expect(errors(c)).toEqual(['Node "a" has no text.', 'Node "b" is 99 characters: keep it to 90.', 'The label on a → b is 99 characters: keep it to 50.']);
  });

  it('names its properties and risks other than P1… and R1…, or twice', () => {
    const c: Statechart = {
      ...chart([box('a')], []),
      properties: { safety: [{ id: 'P1', text: 't', status: 'holds' }], liveness: [{ id: 'P1', text: 't', status: 'holds' }, { id: 'L2', text: 't', status: 'holds' }] },
      risks: [{ id: 'risk1', severity: 'hi', title: 't', path: 'p', where: [] }],
    };
    expect(errors(c)).toEqual(['Property "L2" should be named P1, P2 and so on.', 'Risk "risk1" should be named R1, R2 and so on.', 'Two properties are P1.']);
  });

  it('has no nodes', () => {
    expect(errors(chart([], []))).toEqual(['The chart has no nodes.']);
  });
});

describe('a bug with no fix under it', () => {
  it('is drawn, with a warning', () => {
    const c = chart([box('a'), box('b', 'bug'), box('c', 'bug'), box('d', 'fix')], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd', label: 'with the fix' }]);
    expect(chartProblems(c)).toEqual({ errors: [], warnings: ['Bug "b" has no fix under it: draw the fix (an edge labelled "with the fix" to a fix node), or call it a risk until there\'s one.'] });
  });
});

describe('the flow as mermaid', () => {
  it('starts at a dot above the root, and draws each node in its class, branches as empty diamonds', () => {
    const c = chart([box('end'), { id: 'q', kind: 'branch' }, box('b', 'bug'), box('f', 'fix'), box('ok')], [
      { from: 'end', to: 'q', label: 'what "now"?' },
      { from: 'q', to: 'b', label: 'it breaks' },
      { from: 'b', to: 'f', label: 'with the fix' },
      { from: 'q', to: 'ok' },
    ]);
    expect(flowchart(c).split('\n').slice(0, 11)).toEqual([
      'flowchart TD',
      '  s0((" ")):::start',
      '  n0["Box end"]',
      '  n1{" "}',
      '  n2["Box b"]:::bug',
      '  n3["Box f"]:::fix',
      '  n4["Box ok"]',
      '  s0 --> n0',
      '  n0 -->|"what #quot;now#quot;?"| n1',
      '  n1 -->|"it breaks"| n2',
      '  n1 --> n4',
    ]);
    expect(flowchart(c)).toContain('classDef start fill:#222,stroke:#222');
  });
});
