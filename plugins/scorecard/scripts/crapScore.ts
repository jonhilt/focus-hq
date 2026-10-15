// The pure half of `pnpm run crap`: each function's cyclomatic complexity from its source, its share of statements the
// tests ran from istanbul's coverage, and its CRAP score from the two (Savoia & Evans: complexity² × (1 − coverage)³ +
// complexity). scripts/crap.ts does the I/O: runs the tests, reads the files, prints the report.
import ts from 'typescript';

/** A function's place in its file (lines from 1, columns from 0, as istanbul counts them) and its complexity. */
export interface Fn {
  file: string;
  name: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  complexity: number;
}

export interface Scored extends Fn {
  /** Share of the function's own statements (not its nested functions') that the tests ran, 0 to 1. */
  coverage: number;
  crap: number;
}

/** One file's coverage, from istanbul's coverage-final.json: where each statement and function starts, and whether it ran. */
export interface FileCoverage {
  statements: { line: number; column: number; covered: boolean }[];
  functions: { line: number; covered: boolean }[];
}

/** The demo's fakes and scripts stand in for GitHub and Claude Code: nothing ships through them. */
export const isDemo = (file: string) => /(^|\/)demo([A-Z.]|\.ts$)/.test(file);

/** The usual line: above it, a function is too complex for how little of it is tested. */
export const CRAP_LINE = 30;

export const crapScore = (complexity: number, coverage: number) => complexity ** 2 * (1 - coverage) ** 3 + complexity;

const BRANCHES = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
]);
const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether a node adds a path, counted as ESLint's `complexity` rule counts them. */
function branches(node: ts.Node): boolean {
  if (BRANCHES.has(node.kind)) return true;
  if (ts.isBinaryExpression(node)) return LOGICAL.has(node.operatorToken.kind);
  if (ts.isParameter(node)) return !!node.initializer;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) return !!node.questionDotToken;
  return false;
}

type FunctionNode = ts.FunctionLikeDeclaration & { body: ts.Node };

const isFunction = (node: ts.Node): node is FunctionNode =>
  (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
  && !!node.body;

/** What to call a function in the report: its own name, the name it's assigned to, or what it's a callback to. */
function nameOf(node: FunctionNode, sf: ts.SourceFile): string {
  const owner = node.parent && ts.isClassLike(node.parent) && node.parent.name ? `${node.parent.name.text}.` : '';
  if (ts.isConstructorDeclaration(node)) return `${owner}constructor`;
  if (node.name) return owner + node.name.getText(sf);
  const p = node.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText(sf);
  if (ts.isCallExpression(p)) return `(callback to ${p.expression.getText(sf).replace(/\s+/g, '').slice(0, 40)})`;
  return '(anonymous)';
}

/** Every function in a TypeScript file with its cyclomatic complexity: 1, plus one per branch in its own body. */
export function functionsIn(file: string, source: string): Fn[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fns: Fn[] = [];
  const walk = (node: ts.Node, current: Fn | undefined) => {
    if (isFunction(node)) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const end = sf.getLineAndCharacterOfPosition(node.end);
      current = { file, name: nameOf(node, sf), line: start.line + 1, column: start.character, endLine: end.line + 1, endColumn: end.character, complexity: 1 };
      fns.push(current);
    } else if (current && branches(node)) {
      current.complexity++;
    }
    ts.forEachChild(node, (child) => walk(child, current));
  };
  walk(sf, undefined);
  return fns;
}

const before = (aLine: number, aCol: number, bLine: number, bCol: number) => aLine < bLine || (aLine === bLine && aCol < bCol);
const contains = (fn: Fn, line: number, column: number) =>
  !before(line, column, fn.line, fn.column) && before(line, column, fn.endLine, fn.endColumn);

/**
 * Scores one file's functions. Each statement counts towards the innermost function it's in, so a function's coverage
 * is its own, not its callbacks'. A function with no statements of its own (`x => x * 2`) counts as covered if it ran.
 * A file the tests never loaded has no coverage at all.
 */
export function score(fns: Fn[], coverage: FileCoverage | undefined): Scored[] {
  const own = fns.map(() => ({ total: 0, covered: 0 }));
  for (const s of coverage?.statements ?? []) {
    let inner = -1;
    fns.forEach((fn, i) => {
      if (contains(fn, s.line, s.column) && (inner < 0 || !before(fn.line, fn.column, fns[inner].line, fns[inner].column))) inner = i;
    });
    if (inner < 0) continue;
    own[inner].total++;
    if (s.covered) own[inner].covered++;
  }
  return fns.map((fn, i) => {
    const { total, covered } = own[i];
    const ran = coverage?.functions.some((f) => f.line === fn.line && f.covered) ?? false;
    const share = total ? covered / total : ran ? 1 : 0;
    return { ...fn, coverage: share, crap: crapScore(fn.complexity, share) };
  });
}

/** istanbul's coverage-final.json entry for one file, cut down to what `score` needs. */
export function fromIstanbul(entry: {
  statementMap: Record<string, { start: { line: number; column: number } }>;
  s: Record<string, number>;
  fnMap: Record<string, { loc: { start: { line: number } } }>;
  f: Record<string, number>;
}): FileCoverage {
  return {
    statements: Object.entries(entry.statementMap).map(([id, m]) => ({ line: m.start.line, column: m.start.column, covered: entry.s[id] > 0 })),
    functions: Object.entries(entry.fnMap).map(([id, m]) => ({ line: m.loc.start.line, covered: entry.f[id] > 0 })),
  };
}

/** The lines each file's diff adds or changes (`git diff --unified=0`), as inclusive ranges on the new side. */
export function changedLines(diff: string): Map<string, [number, number][]> {
  const ranges = new Map<string, [number, number][]>();
  let file: string | undefined;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(line);
    if (header) {
      file = header[1];
      if (file && !ranges.has(file)) ranges.set(file, []);
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) ranges.get(file)?.push([start, start + count - 1]);
    }
  }
  return ranges;
}

/** Whether a diff added or changed any line of the function. */
export const touched = (fn: Fn, ranges: Map<string, [number, number][]>) =>
  (ranges.get(fn.file) ?? []).some(([a, b]) => a <= fn.endLine && b >= fn.line);

export const BUCKETS: [number, number][] = [[0, 5], [5, 10], [10, 30], [30, 100], [100, Infinity]];

/** How many functions score in each of `BUCKETS` (low end excluded, high end included). */
export const distribution = (rows: Scored[]) => BUCKETS.map(([lo, hi]) => rows.filter((r) => r.crap > lo && r.crap <= hi).length);

const pad = (text: string | number, width: number) => String(text).padStart(width);

/** A table of functions, riskiest first: score, complexity, coverage, where. */
export function table(rows: Scored[]): string {
  const lines = [`${pad('score', 7)}  ${pad('comp', 4)}  ${pad('cov', 4)}  function`];
  for (const r of [...rows].sort((a, b) => b.crap - a.crap)) {
    lines.push(`${pad(Math.round(r.crap), 7)}  ${pad(r.complexity, 4)}  ${pad(`${Math.round(r.coverage * 100)}%`, 4)}  ${r.file}:${r.line} ${r.name}`);
  }
  return lines.join('\n');
}

/** The whole-scope summary: how many functions, how many over the line, the spread, and the riskiest `top`. */
export function summary(rows: Scored[], top: number): string {
  const over = rows.filter((r) => r.crap > CRAP_LINE).length;
  const total = rows.reduce((sum, r) => sum + r.crap, 0);
  const pct = rows.length ? ((100 * over) / rows.length).toFixed(1) : '0';
  const spread = distribution(rows).map((n, i) => {
    const [lo, hi] = BUCKETS[i];
    return `${hi === Infinity ? `>${lo}` : lo ? `${lo}–${hi}` : `≤${hi}`}: ${n}`;
  });
  const riskiest = [...rows].sort((a, b) => b.crap - a.crap).slice(0, top);
  return [
    `${rows.length} functions, ${over} over ${CRAP_LINE} (${pct}%), total CRAP ${Math.round(total)}`,
    `by score  ${spread.join('  ')}`,
    '',
    `Riskiest ${riskiest.length}:`,
    table(riskiest),
  ].join('\n');
}

/** What a branch's diff touched: how many functions, their total CRAP, and every one of them over the line. */
export function changedSummary(rows: Scored[], ranges: Map<string, [number, number][]>, base: string): string {
  const hit = rows.filter((r) => touched(r, ranges));
  const over = hit.filter((r) => r.crap > CRAP_LINE);
  const total = hit.reduce((sum, r) => sum + r.crap, 0);
  const head = `Touched since ${base}: ${hit.length} functions, total CRAP ${Math.round(total)}, ${over.length} over ${CRAP_LINE}`;
  return over.length ? `${head}\n${table(over)}` : head;
}
