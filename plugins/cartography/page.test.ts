import { describe, expect, it } from 'vitest';
import { mapPage } from './page';
import { viewsOf } from './views';
import { MAP } from './views.test';

describe('mapPage', () => {
  it('puts a view\'s question over its drawing and its sentences, escaped', () => {
    const [, front] = viewsOf(MAP);
    const html = mapPage({ ...MAP, commit: 'abcdef123' }, { ...front, question: 'Does <API> reach core?' });
    expect(html).toContain('<h1>Does &lt;API&gt; reach core?</h1>');
    expect(html).toContain('o/r · abcdef1');
    expect(html).toContain('<svg');
    expect(html).toContain('<li>API uses handle, Order from Core (3 imports)</li>');
  });

  it('draws the whole map as its matrix, with the matrix\'s key and no sentences', () => {
    const [whole] = viewsOf(MAP);
    const html = mapPage(MAP, whole);
    expect(html).toContain('Each row imports from the columns');
    expect(html).not.toContain('<ul>');
  });
});
