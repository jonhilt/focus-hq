import { describe, expect, it } from 'vitest';
import { esc, fit, layerColours, matrixExample, matrixOrder, matrixSvg, namesLabel, placeView, viewSentences, viewSvg, wrap } from './draw';
import { viewsOf } from './views';
import { MAP } from './views.test';

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
  it('groups the parts by layer, and reads its busiest cell out as an example', () => {
    expect(matrixOrder(MAP).map((p) => p.id)).toEqual(['api', 'core', 'db']);
    expect(matrixExample(MAP)).toBe('Row 1, column 2: 3 means API imports from Core 3 times (handle, Order).');
    expect(matrixExample({ ...MAP, connections: [] })).toBeUndefined();
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
