import { describe, expect, it } from 'vitest';
import { changeSentences, changesSvg, esc, fit, layerColours, matrixOrder, matrixSvg, namesLabel, placeView, tiesDrawing, viewDrawing, viewLines, viewSentences, viewSvg, wrap } from './draw';
import { findings } from './findings';
import { VIEW_KEY, viewsOf } from './views';
import { MAP } from './views.test';
import type { RepoMap } from './shared';

const front = viewsOf(MAP)[1];

describe('labels', () => {
  it('names what a connection takes, a few at a time, and a whole module in words', () => {
    expect(namesLabel({ names: ['a', 'b', 'c', 'd', 'e'] })).toBe('a, b, c +2');
    expect(namesLabel({ names: ['*'] })).toBe('all of it');
  });

  it('cuts text to fit, and escapes it for SVG', () => {
    expect(fit('short', 14, 200)).toBe('short');
    expect(fit('a much longer label than fits', 14, 80)).toMatch(/…$/);
    expect(esc('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });
});

describe('viewSentences', () => {
  it('says each connection in the view as what one part uses from another', () => {
    expect(viewSentences(MAP, front)).toEqual(['API uses handle, Order from Core (3 imports)', 'Core uses Route from API (1 import)']);
  });
});

describe('placeView', () => {
  it('stands each layer in a column of its own, in the model’s order', () => {
    const { placed, cols, rows } = placeView(MAP, front);
    expect(cols).toBe(2);
    expect(rows).toBe(1);
    expect(placed.get('api')?.col).toBe(0);
    expect(placed.get('core')?.col).toBe(1);
    expect(placed.has('db')).toBe(false);
  });
});

describe('viewSvg', () => {
  it('draws the view’s parts with what they do, and a numbered line each way for parts that use each other', () => {
    const svg = viewSvg(MAP, front);
    expect(svg).toContain('>API<');
    expect(svg).toContain('Answers requests');
    expect(svg).not.toContain('>Store<');
    expect(svg.match(/marker-end=/g)).toHaveLength(2);
    expect(svg).toContain('<title>API uses handle, Order from Core (3 imports)</title>');
    expect(svg).toMatch(/font-weight="700" fill="#fff">1</);
    expect(svg).toMatch(/font-weight="700" fill="#fff">2</);
  });
});

describe('wrap', () => {
  it('breaks between words into at most two lines, cutting the last to fit', () => {
    expect(wrap('short text', 15, 200)).toEqual(['short text']);
    const lines = wrap('one two three four five six seven eight nine ten eleven twelve', 15, 120);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
  });
});

describe('matrix', () => {
  it('groups the parts by layer', () => {
    expect(matrixOrder(MAP).map((p) => p.id)).toEqual(['api', 'core', 'db']);
  });

  it('numbers each finding on its cells, outlines them only as it is pointed at, and lists them beside the grid', () => {
    const svg = matrixSvg(MAP, findings(MAP));
    expect(svg).toContain('WHERE TO LOOK');
    expect(svg).toContain('<g data-look="1" opacity="0">');
    expect(svg).toContain('data-finding="1"');
    expect(svg).toContain('data-cell="api core"');
    // with none, the grid alone
    expect(matrixSvg(MAP)).not.toContain('WHERE TO LOOK');
    // a hologram draws it as an image, which XML has to read: every attribute has a value
    const tags = svg.match(/<[a-z][^>]*>/g) ?? [];
    expect(tags.filter((t) => /\s[\w:-]+(?=[\s/>])(?!=)/.test(t.replace(/="[^"]*"/g, '=""')))).toEqual([]);
  });

  it('shades a cell per connection, orange for two parts that import each other', () => {
    const svg = matrixSvg(MAP);
    expect(svg.match(/rgba\(255,140,60/g)).toHaveLength(2);
    expect(svg.match(/rgba\(120,190,255/g)).toHaveLength(1);
    expect(svg).toContain('Core imports Store 1×: save');
  });

  it('gives each layer its own colour, in the order the model names them', () => {
    expect([...layerColours(MAP.model?.parts ?? []).keys()]).toEqual(['Server', 'Domain', 'Data']);
  });
});

describe('flows in a view', () => {
  const withFlows = { ...MAP, flows: [
    { from: 'core', to: 'api', via: 'ws' as const, names: ['agent', 'board'], count: 40 },
    { from: 'api', to: 'core', via: 'http' as const, names: ['POST /api/goals'], count: 1 },
    { from: 'db', to: 'api', via: 'ws' as const, names: ['toast'], count: 2 },
  ] };

  it('says them after the imports, numbered on: what goes over the WebSocket, and what’s asked for', () => {
    expect(viewSentences(withFlows, front).slice(2)).toEqual([
      'Core sends agent, board to API over the WebSocket (40 events in the recorded run)',
      'API calls POST /api/goals on Core (1 request in the recorded run)',
    ]);
  });

  it('draws them dashed in gold, a line each beside the imports between the same two parts', () => {
    const svg = viewSvg(withFlows, front);
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(2);
    expect(svg.match(/marker-end="url\(#cg-flow\)"/g)).toHaveLength(2);
    expect(svg.match(/marker-end="url\(#cg-arrow\)"/g)).toHaveLength(2);
    expect(viewLines(withFlows, front).map((l) => l.kind)).toEqual(['import', 'import', 'flow', 'flow']);
  });
});

describe('how a map changes', () => {
  const changing = {
    ...MAP,
    flows: [{ from: 'db', to: 'api', via: 'ws' as const, names: ['toast'], count: 2 }],
    history: {
      days: 90,
      commits: 20,
      parts: [{ id: 'core', commits: 12, lines: 300 }, { id: 'api', commits: 8, lines: 90 }, { id: 'db', commits: 1, lines: 1 }],
      coupling: [
        { a: 'api', b: 'core', together: 6, either: 14, imports: true },
        { a: 'api', b: 'db', together: 5, either: 9, imports: false },
        { a: 'core', b: 'db', together: 5, either: 13, imports: false },
      ],
    },
  };

  it('draws a bar per part that changed, the busiest first, saying its commits and lines', () => {
    const svg = changesSvg(changing);
    expect(svg.match(/<rect /g)).toHaveLength(3);
    expect(svg.indexOf('12 commits · 300 lines')).toBeLessThan(svg.indexOf('8 commits · 90 lines'));
    expect(svg).toContain('1 commit · 1 line');
  });

  it('says what changes together, and what ties them: an import, the wire, or nothing on the map', () => {
    expect(changeSentences(changing)).toEqual([
      'API and Core changed together in 6 of the 14 commits that changed either (43%)',
      'API and Store changed together in 5 of the 9 commits that changed either (56%), with no import between them: they talk over the wire (the recorded run\'s flows)',
      'Core and Store changed together in 5 of the 13 commits that changed either (38%), with no import between them: what ties them isn\'t on the map',
    ]);
  });

  it('is a view of its own, drawn and read like the others', () => {
    const views = viewsOf(changing);
    expect(views.map((v) => v.id)).toEqual(['whole', 'changes', 'front']);
    const { svg, key, sentences } = viewDrawing(changing, views[1]);
    expect(svg).toContain('12 commits');
    expect(key).toContain('The last 90 days: 20 commits.');
    expect(sentences).toHaveLength(3);
    expect(viewDrawing(changing, views[0]).sentences).toEqual([]);
    expect(viewDrawing(changing, views[2]).key).toBe(VIEW_KEY);
  });
});

describe('tiesDrawing', () => {
  const web: RepoMap = { ...MAP, repo: 'o/web', model: { ...MAP.model!, parts: [{ id: 'checkout', label: 'Checkout', layer: 'UI', kind: 'ui', paths: ['c/'] }] } };
  const api: RepoMap = { ...MAP, repo: 'o/api' };

  it('draws a column per repo with the parts its ties join, each tie numbered and said', () => {
    const drawn = tiesDrawing([web, api], [{ a: { repo: 'o/api', part: 'core' }, b: { repo: 'o/web', part: 'checkout' }, together: 4, either: 6 }]);
    expect(drawn?.view.parts).toEqual(['o/web#checkout', 'o/api#core']);
    expect(drawn?.sentences).toEqual(['Core (o/api) and Checkout (o/web) changed together in 4 of the 6 change sets that touched either']);
    expect(drawn?.svg).toContain('>O/WEB<');
    expect(drawn?.svg).toContain('stroke-dasharray="3 7"');
  });

  it('draws the routes one repo calls on another first, a spec no part implements standing in for one', () => {
    const drawn = tiesDrawing([web, api], [], [
      { from: { repo: 'o/web', part: 'checkout' }, to: { repo: 'o/api', part: 'core' }, routes: ['/orders', '/orders/{id}'] },
      { from: { repo: 'o/web', part: 'checkout' }, to: { repo: 'o/api', part: 'api/openapi.yml' }, routes: ['/carts'] },
    ]);
    expect(drawn?.sentences).toEqual(['Checkout (o/web) calls /orders, /orders/{id} on Core (o/api)', 'Checkout (o/web) calls /carts on openapi.yml (o/api)']);
    expect(drawn?.view.parts).toEqual(['o/web#checkout', 'o/api#core', 'o/api#api/openapi.yml']);
    expect(drawn?.svg).toContain('marker-end="url(#cg-flow)"');
  });

  it('is nothing when nothing ties them', () => {
    expect(tiesDrawing([web, api], [])).toBeUndefined();
  });
});
