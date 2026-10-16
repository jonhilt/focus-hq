import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readModel, readRecording } from './model';

const yaml = (text: string) => readModel(parse(text));

describe('readModel', () => {
  it('reads parts, views and ignores, with a part’s kind service unless it says', () => {
    const model = yaml(`
parts:
  api: { label: API, layer: Server, kind: route, paths: [server/routes.ts] }
  core: { label: Core, layer: Server, paths: [./server/] }
views:
  requests: { question: How does a request reach the core?, parts: [api, core] }
ignore: [scripts/]
`);
    expect(model).toEqual({
      parts: [
        { id: 'api', label: 'API', layer: 'Server', kind: 'route', paths: ['server/routes.ts'] },
        { id: 'core', label: 'Core', layer: 'Server', kind: 'service', paths: ['server/'] },
      ],
      views: [{ id: 'requests', question: 'How does a request reach the core?', parts: ['api', 'core'] }],
      ignore: ['scripts/'],
    });
  });

  it('says what’s wrong, in words', () => {
    expect(() => yaml('views: {}')).toThrow('The model needs some parts');
    expect(() => yaml('parts: { Api: { label: A, layer: L, paths: [a] } }')).toThrow('Part "Api" needs an id');
    expect(() => yaml('parts: { api: { label: A, layer: L } }')).toThrow('Part api needs the paths of its code');
    expect(() => yaml('parts: { api: { label: A, layer: L, kind: thing, paths: [a] } }')).toThrow("Part api's kind is one of");
    expect(() => yaml('parts: { api: { layer: L, paths: [a] } }')).toThrow("Part api's label needs some text");
    expect(() => yaml('parts: { api: { label: A, layer: L, paths: [a] } }\nviews: { v: { question: Q?, parts: [api, db] } }')).toThrow("View v shows parts the model doesn't have: db");
    expect(() => yaml('parts: [a, b]')).toThrow('Its parts is a mapping');
  });

  it('reads a scenario: its answer and steps, its parts the ones its steps reach unless it names them', () => {
    const model = yaml(`
parts:
  api: { label: API, layer: Server, paths: [a.ts] }
  core: { label: Core, layer: Server, paths: [c.ts] }
views:
  order:
    question: How is an order saved?
    answer: The API hands it to the core.
    steps:
      - { from: api, to: core, says: hands it over }
      - { from: core, to: core, says: checks it }
`);
    expect(model.views[0]).toEqual({
      id: 'order',
      question: 'How is an order saved?',
      parts: ['api', 'core'],
      answer: 'The API hands it to the core.',
      steps: [{ from: 'api', to: 'core', says: 'hands it over' }, { from: 'core', to: 'core', says: 'checks it' }],
    });
    const parts = 'parts: { api: { label: A, layer: L, paths: [a] } }\n';
    expect(() => yaml(`${parts}views: { v: { question: Q?, steps: [{ from: api, to: db, says: x }] } }`)).toThrow("View v shows parts the model doesn't have: db");
    expect(() => yaml(`${parts}views: { v: { question: Q?, steps: [{ from: api, to: api }] } }`)).toThrow("View v's step 1's says needs some text");
    expect(() => yaml(`${parts}views: { v: { question: Q? } }`)).toThrow('View v needs the parts it shows, or its steps');
  });

  it('reads a view whose steps come from a recorded run: the message, and a part it goes through', () => {
    const parts = 'parts: { api: { label: A, layer: L, paths: [a] } }\n';
    expect(yaml(`${parts}views: { v: { question: Q?, parts: [api], trace: { message: agent, through: api } } }`).views[0].trace).toEqual({ message: 'agent', through: 'api' });
    expect(() => yaml(`${parts}views: { v: { question: Q?, parts: [api], trace: { through: api } } }`)).toThrow("View v's trace's message needs some text");
    expect(() => yaml(`${parts}views: { v: { question: Q?, parts: [api], trace: { message: x, through: db } } }`)).toThrow("goes through a part the model doesn't have: db");
  });
});

describe('readRecording', () => {
  it('reads a recorded run’s flows', () => {
    const raw = { run: 'a demo run', commit: 'abc', flows: [{ via: 'ws', name: 'agent', from: 'a.ts', to: 'b.ts', count: 3 }] };
    expect(readRecording(raw)).toEqual(raw);
    expect(readRecording({ flows: [] })).toEqual({ run: 'a recorded run', flows: [] });
    // its call chains, leaving out one that doesn't read rather than the run
    const chain = [{ file: 'a.ts', fn: 'go' }];
    expect(readRecording({ flows: [], traces: [{ via: 'ws', name: 'agent', count: 2, chain }, { via: 'ws', name: 'x', chain: [] }] }).traces).toEqual([{ via: 'ws', name: 'agent', count: 2, chain }]);
  });

  it('says what’s wrong, in words', () => {
    expect(() => readRecording({})).toThrow('The recording needs its flows');
    expect(() => readRecording({ flows: [{ via: 'smoke', name: 'x', from: 'a', to: 'b', count: 1 }] })).toThrow('Flow 1 goes by http or ws');
    expect(() => readRecording({ flows: [{ via: 'ws', name: 'x', from: 'a', to: 'b', count: 0 }] })).toThrow('Flow 1 needs a count');
    expect(() => readRecording({ flows: [{ via: 'ws', name: 'x', to: 'b', count: 1 }] })).toThrow("Flow 1's from needs some text");
  });
});
