import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readModel } from './model';

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
});
