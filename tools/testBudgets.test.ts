import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A test that runs real git, or loads the office's own plugins (each one's whole import graph, transformed), takes a
// second or two alone, but well past vitest's 5 s on a busy machine (several agents' gates at once), where it fails the
// gate on nothing but load. Such a file sets a budget fit for it, as mergeBase.test.ts does.
const ROOT = path.resolve(import.meta.dirname, '..');
const testFiles = ['server', 'shared', 'client/src', 'tools', 'plugins', 'plugin-api'].flatMap((dir) =>
  readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.test.ts') && !f.includes('node_modules'))
    .map((f) => path.join(dir, f)),
);

/** Whether a test file runs git itself or loads plugins, and whether it gives its tests the time that takes. */
const runsGit = (source: string) => /execFileSync\(\s*'git'/.test(source);
const loadsPlugins = (source: string) => /\bloadPlugins\(/.test(source);
const hasBudget = (source: string) => /vi\.setConfig\(\{\s*testTimeout:/.test(source);

// A module imported inside a test is loaded, and transformed, on that test's clock: the fake office's import graph alone
// took most of a test's 5 s on a busy machine. Import at the top of the file, where loading isn't timed against a test.
const TEST_CALLS = new Set(['it', 'test']);
/** The name a call starts from: `it` for `it(…)`, `it.skip(…)` and `it.each([…])(…)`. */
const calleeRoot = (expr: ts.Expression): ts.Expression =>
  ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr) ? calleeRoot(expr.expression) : expr;
const isTestCall = (node: ts.Node) => ts.isCallExpression(node) && TEST_CALLS.has(calleeRoot(node.expression).getText());
/** The modules a file imports with `import()` inside an `it` or `test`. */
function importsInTests(source: string): string[] {
  // Most files have no `import(` at all, and parsing every one takes past 5 s on a busy machine: parse only those that do
  if (!/\bimport\(/.test(source)) return [];
  const found: string[] = [];
  const visit = (node: ts.Node, inTest: boolean) => {
    if (inTest && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push(node.arguments[0]?.getText() ?? '');
    ts.forEachChild(node, (child) => visit(child, inTest || isTestCall(node)));
  };
  visit(ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true), false);
  return found;
}

describe('test budgets', () => {
  it('tells a file that runs git or loads plugins from one that doesn’t, and sees its budget', () => {
    expect(runsGit("const git = (cwd) => execFileSync('git', args, { cwd })")).toBe(true);
    expect(runsGit("execFileSync('node', ['-v'])")).toBe(false);
    expect(loadsPlugins("await loadPlugins(['all'], root)")).toBe(true);
    expect(loadsPlugins("import { loadPlugins } from './load';")).toBe(false);
    expect(hasBudget('vi.setConfig({ testTimeout: 30_000 });')).toBe(true);
    expect(hasBudget('it(\'x\', () => {}, 30_000);')).toBe(false);
  });

  it('gives every test file that runs real git or loads plugins a budget fit for a busy machine', () => {
    const unbudgeted = testFiles.filter((f) => {
      const source = readFileSync(path.join(ROOT, f), 'utf8');
      return (runsGit(source) || loadsPlugins(source)) && !hasBudget(source);
    });
    expect(unbudgeted).toEqual([]);
  });

  it('sees a module imported inside a test, and not one imported at the top or in a mock', () => {
    expect(importsInTests("it('x', async () => { const { office } = await import('./fakeOffice'); });")).toEqual(["'./fakeOffice'"]);
    expect(importsInTests("it.each([1])('x', async () => { await import('./a'); });")).toEqual(["'./a'"]);
    expect(importsInTests("test.skip('x', async () => { await import('./a'); });")).toEqual(["'./a'"]);
    expect(importsInTests("const { office } = await import('./fakeOffice');\nvi.mock('./v', async () => ({ ...(await import('./v')) }));\nit('x', () => {});")).toEqual([]);
  });

  it('imports no module inside a test, where loading it runs on the test’s clock', () => {
    const inTests = testFiles.flatMap((f) => importsInTests(readFileSync(path.join(ROOT, f), 'utf8')).map((m) => `${f}: ${m}`));
    expect(inTests).toEqual([]);
  });
});
