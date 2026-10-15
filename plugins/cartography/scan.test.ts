import { describe, expect, it } from 'vitest';
import { importsIn } from './scan';

describe('importsIn', () => {
  it('reads what each import and re-export takes, by the name the other file exports', () => {
    const text = `
import Default, { a, b as c } from './one';
import * as all from './two';
import type { T } from '../three';
import './side-effect';
export { d as e } from './four';
export * from './five';
const lazy = () => import('./six');
`;
    expect(importsIn('x.ts', text)).toEqual([
      { spec: './one', names: ['default', 'a', 'b'] },
      { spec: './two', names: ['*'] },
      { spec: '../three', names: ['T'] },
      { spec: './side-effect', names: [] },
      { spec: './four', names: ['d'] },
      { spec: './five', names: ['*'] },
      { spec: './six', names: ['*'] },
    ]);
  });

  it('reads TSX', () => {
    expect(importsIn('x.tsx', `import { h } from './dom';\nexport const X = () => <div/>;`)).toEqual([{ spec: './dom', names: ['h'] }]);
  });
});
