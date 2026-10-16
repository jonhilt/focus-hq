import { describe, expect, it } from 'vitest';
import { viewDrawing } from './draw';
import { lifelines, sequenceSvg } from './sequence';
import type { MapView, RepoMap } from './shared';
import { checkCite, checkSteps, pickTrace, scenarioSteps, shortFn, stepSentence } from './steps';
import { MAP } from './views.test';

const scenario: MapView = {
  id: 'order',
  question: 'How is an order saved?',
  answer: 'The API hands it to the core, which saves it.',
  parts: ['api', 'core', 'db'],
  steps: [
    { from: 'api', to: 'core', says: 'hands over the order' },
    { from: 'core', to: 'db', says: 'saves it' },
    { from: 'db', to: 'api', says: 'tells the API directly' },
  ],
};
const recorded: RepoMap = { ...MAP, flows: [{ from: 'api', to: 'core', via: 'ws', names: ['order'], count: 4 }] };

describe('checkSteps', () => {
  it('backs a step with its recorded messages first, then an import either way', () => {
    const [handed, saved, told] = checkSteps(recorded, scenario);
    expect(handed.evidence.map((e) => e.kind)).toEqual(['flow', 'import', 'import']);
    expect(handed.evidence[0].sentence).toBe('Sends order over the WebSocket: 4 events in the recorded run');
    expect(saved.evidence).toEqual([{ kind: 'import', sentence: 'Core imports save from Store (1 import)' }]);
    expect(told.evidence).toEqual([]);
  });

  it('says a step as who reaches whom, and what happens', () => {
    expect(stepSentence(MAP, scenario.steps![0])).toBe('API → Core: hands over the order');
  });
});

describe('a scenario drawn', () => {
  it('stands its parts in the order its steps reach them', () => {
    expect(lifelines(MAP, { ...scenario, parts: ['db', 'core', 'api'] }).map((p) => p.id)).toEqual(['api', 'core', 'db']);
  });

  it('draws a recorded message dashed gold, an import solid, and an unbacked step red', () => {
    const svg = sequenceSvg(recorded, scenario, checkSteps(recorded, scenario));
    expect(svg).toContain('marker-end="url(#cg-seq-flow)"');
    expect(svg).toContain('marker-end="url(#cg-seq)"');
    expect(svg).toContain('marker-end="url(#cg-seq-none)"');
    expect(svg).toContain('3. tells the API directly (nothing in the code backs this step)');
  });

  it('is how any view with steps is shown, each step with its evidence to open', () => {
    const drawn = viewDrawing(recorded, scenario);
    expect(drawn.sentences).toHaveLength(3);
    expect(drawn.details?.[1]).toEqual(['Core imports save from Store (1 import)']);
    expect(drawn.details?.[2][0]).toMatch(/^Nothing in the code backs this step/);
  });
});

describe('a scenario found in a recorded run', () => {
  const traced: RepoMap = {
    ...MAP,
    flows: [{ from: 'core', to: 'db', via: 'ws', names: ['order'], count: 3 }],
    traces: [
      // busier, but cut short where it awaited
      { via: 'ws', name: 'order', count: 9, hops: [{ part: 'core', fn: 'Core.save' }, { part: 'db' }] },
      { via: 'ws', name: 'order', count: 2, hops: [{ part: 'api', fn: 'Api.post' }, { part: 'core', fn: 'Orders.Core.take' }, { part: 'api', fn: 'Api.<anonymous>' }, { part: 'core', fn: 'save' }, { part: 'db' }] },
    ],
  };
  const view: MapView = { id: 'o', question: 'How is an order saved?', parts: ['api', 'core', 'db'], trace: { message: 'order', through: 'api' } };

  it('picks the chain through the most parts, then the busiest', () => {
    expect(pickTrace(traced, view)?.count).toBe(2);
    expect(pickTrace(traced, { ...view, trace: { message: 'nothing' } })).toBeUndefined();
  });

  it('makes a step of each hop: what it called, a callback, and the message to its receiver last', () => {
    expect(scenarioSteps(traced, view)).toEqual([
      { from: 'api', to: 'core', says: 'calls take' },
      { from: 'core', to: 'api', says: 'calls back into it' },
      { from: 'api', to: 'core', says: 'calls save' },
      { from: 'core', to: 'db', says: 'sends "order" over /ws' },
    ]);
    // written steps win
    expect(scenarioSteps(traced, { ...view, steps: [{ from: 'api', to: 'db', says: 'x' }] })).toHaveLength(1);
  });

  it('backs each step with the calls the run saw, and an anonymous one as a callback', () => {
    const [took, back] = checkSteps(traced, view);
    expect(took.evidence[0]).toEqual({ kind: 'call', sentence: 'Calls take: 2 times in the recorded run' });
    // the call a step says comes first, however busy the others
    expect(checkSteps(traced, { ...view, trace: undefined, steps: [{ from: 'api', to: 'core', says: 'calls save' }] })[0].evidence[0].sentence).toBe('Calls save: 2 times in the recorded run');
    expect(back.evidence[0]).toEqual({ kind: 'call', sentence: 'Calls a callback: 2 times in the recorded run' });
    expect(sequenceSvg(traced, view, checkSteps(traced, view))).not.toContain('url(#cg-seq-none)');
  });

  it('says a function by its own name, or not at all for a framework’s', () => {
    expect(shortFn('GoalTools.update')).toBe('update');
    expect(shortFn('PrimitiveImpl.~effect/Effect/args')).toBeUndefined();
    expect(shortFn('Api.<anonymous>')).toBeUndefined();
  });
});

describe('a cited step', () => {
  // the API's code is a.ts, the core's c.ts (views.test.ts); the API uses handle and Order of the core's
  const cited = (lines: string[], inherits: string[] = [], at = 2): RepoMap => ({
    ...MAP,
    flows: [{ from: 'api', to: 'core', via: 'ws', names: ['order'], count: 1 }],
    cited: { 'a.ts:2': { file: 'a.ts', line: at, first: 1, lines, inherits }, 'gone.ts:1': { missing: "there's no gone.ts" }, 'd.ts:1': { file: 'd.ts', line: 1, first: 1, lines: ['x'], inherits: [] } },
  });
  const step = { from: 'api', to: 'core', says: 'hands over the order', cite: 'a.ts:2' };

  it('is backed by its line when it names something one part uses of the other, the cited line first', () => {
    expect(checkCite(cited(['const o = new Order();', '  return handle(o);', 'save(o);']), step)).toEqual({ evidence: { kind: 'cite', sentence: 'a.ts:2: return handle(o); (handle, of Core)' } });
    // a name a couple of lines off still counts
    expect(checkCite(cited(['// it', '', 'handle(o)']), step).evidence?.sentence).toBe('a.ts:3: handle(o) (handle, of Core)');
  });

  it('takes a message between them only as a string, not any word that happens to match', () => {
    expect(checkCite(cited(['const order = 1;', 'send(order);']), step).problem).toMatch(/names nothing of Core's within 2 lines: handle, Order, Route, order/);
    expect(checkCite(cited(['x', "send({ type: 'order' });"]), step).evidence?.sentence).toBe("a.ts:2: send({ type: 'order' }); (order, of Core)");
  });

  it('follows a member reached through a class of the other part it extends', () => {
    expect(checkCite(cited(['x', 'this.update(o);'], ['Route']), step).evidence?.sentence).toBe('a.ts:2: this.update(o); (a member of Route, of Core)');
  });

  it('says what is wrong: no such file or line, or a cite in neither part', () => {
    expect(checkCite(cited([]), { ...step, cite: 'gone.ts:1' }).problem).toBe("Its cite, gone.ts:1, doesn't check out: there's no gone.ts.");
    expect(checkCite(cited([]), { ...step, cite: 'd.ts:1' }).problem).toBe("Its cite, d.ts:1, is Store's code, not API's or Core's.");
    expect(checkCite(cited([]), { ...step, cite: undefined })).toEqual({});
  });

  it('takes a cite in the right part as it is when nothing on the map joins the two (a language the map can’t read)', () => {
    const bare = { ...cited(['x', 'go()']), connections: [], flows: [] };
    expect(checkCite(bare, step).evidence?.sentence).toBe("a.ts:2: go() (in API's code; nothing on the map says what it reaches)");
  });

  it('draws a step whose cite fails red, saying why, and opens on it first', () => {
    const map = cited(['nothing here']);
    const view: MapView = { id: 'c', question: 'Q?', parts: ['api', 'core'], steps: [step] };
    expect(sequenceSvg(map, view, checkSteps(map, view))).toContain('marker-end="url(#cg-seq-none)"');
    expect(viewDrawing(map, view).details?.[0][0]).toMatch(/^Its cite, a.ts:2, names nothing/);
  });
});

describe('a cited step drawn', () => {
  it('is lilac when its line checks out and nothing was recorded', () => {
    const map: RepoMap = { ...MAP, cited: { 'a.ts:1': { file: 'a.ts', line: 1, first: 1, lines: ['handle(o)'], inherits: [] } } };
    const view: MapView = { id: 'c', question: 'Q?', parts: ['api', 'core'], steps: [{ from: 'api', to: 'core', says: 'hands it over', cite: 'a.ts:1' }] };
    expect(sequenceSvg(map, view, checkSteps(map, view))).toContain('marker-end="url(#cg-seq-cite)"');
  });
});
