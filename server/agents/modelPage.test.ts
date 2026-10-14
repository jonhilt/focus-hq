import { describe, expect, it } from 'vitest';
import type { SystemModel } from '../../shared/types';
import { citedLines, modelPage } from './modelPage';

const model: SystemModel = {
  question: 'How is an item saved?',
  nodes: [
    { id: 'page', label: 'Saved page', kind: 'ui', layer: 'UI', cite: { file: '/r/Page.tsx', line: 3 }, found: true, change: 'changed' },
    { id: 'api', label: 'Save </script> endpoint', kind: 'route', layer: 'API', cite: { file: '/r/Api.ts', line: 1 }, found: false },
    { id: 'old', label: 'Old cache', kind: 'store', layer: 'Data', cite: { file: '/r/Cache.ts', line: 9 }, change: 'removed' },
  ],
  edges: [{ from: 'page', to: 'api', kind: 'calls', backed: true }, { from: 'api', to: 'old', kind: 'writes', change: 'removed' }],
  trace: [{ from: 'page', to: 'api', label: 'POST the item', payload: 'Item { id }' }, { from: 'api', to: 'page', label: 'Saved' }],
  simplified: ['Auth left out'],
};
const files: Record<string, string[]> = { '/r/Page.tsx': ['a', 'b', 'export function SavedPage() {', 'd'], '/r/Api.ts': ['route'] };

describe('citedLines', () => {
  it('carries the lines round each cite it can read, but not a removed part\'s', () => {
    const lines = citedLines(model, (f) => files[f], 1);
    expect(lines.page).toEqual({ cite: { file: '/r/Page.tsx', line: 3 }, from: 2, lines: ['b', 'export function SavedPage() {', 'd'] });
    expect(lines.api.lines).toEqual(['route']);
    expect(lines.old).toBeUndefined();
  });
});

describe('modelPage', () => {
  const page = modelPage(model, 'Saving <items>', citedLines(model, (f) => files[f]));

  it('carries the three views, each step\'s shapes marked for stepping, and each part\'s for picking', () => {
    expect(page.match(/<svg /g)).toHaveLength(3);
    expect(page).toContain('data-steps=" 0 1 "');
    expect(page).toContain('data-part="page"');
    expect(page).toContain('<title>Saving &lt;items&gt;</title>');
  });

  it('marks what the change touched in the drawing, and carries the cited code for each part', () => {
    expect(page).toContain('>CHANGED<');
    expect(page).toContain('>REMOVED<');
    expect(page).toContain('export function SavedPage() {');
  });

  it('keeps its data from closing the script early', () => {
    const script = page.slice(page.indexOf('<script>'), page.indexOf('</script>', page.indexOf('<script>')));
    expect(script).toContain('Save \\u003c/script> endpoint');
  });
});
