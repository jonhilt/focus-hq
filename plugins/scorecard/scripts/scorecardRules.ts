// The pure half of `pnpm run scorecard`: what each number is, how it's counted from source and from the tools' own
// reports, and how two scorecards compare. scripts/scorecard.ts does the I/O: runs the gate, reads the files and the
// ledger, saves and prints.
import path from 'node:path';
import ts from 'typescript';
import { frictionGroups, OPEN_FRICTION_DAYS, reportCard, type LedgerEvent } from '../../../plugin-api/shared';
import { compared, formatValue, measuredAt } from '../scorecard';
import type { Metric, MetricFormat as Format, Scorecard, ScorecardNoise, ScorecardSection as Section } from '../types';

export type { Metric, Scorecard } from '../types';

/** What one source file holds that the standard cares about. */
export interface SourceCounts {
  /** `x as T` and `<T>x`, leaving out `as const`. */
  typeAssertions: number;
  /** `x!` */
  nonNull: number;
  /** `any` written out. */
  explicitAny: number;
  /** `eslint-disable…` comments. */
  lintDisables: number;
  /** `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` comments. */
  tsSuppressions: number;
  /** Calls that run an Effect (`runPromise`, `runSync`, `runFork`, `runCallback`, and their `…Exit`): each an edge into Promise land. */
  effectRuns: number;
  importsEffect: boolean;
  /**
   * Does I/O or concurrency itself: imports a Node module that reaches outside the process (fs, child_process, http…),
   * awaits, or starts a timer, a Promise, an AbortController or a fetch. A file that doesn't only decides.
   */
  doesIo: boolean;
  /** XState machines created (`createMachine`). */
  machines: number;
  importsFastCheck: boolean;
  /** What it imports at runtime from files of its own (`./x`, `../y`): from where, and which names (`*` for all of them). */
  localImports: { from: string; names: string[] }[];
  /** The functions it exports that run fast-check's properties (`fc.assert`, `fc.check`): a helper's property runners. */
  propertyRunners: string[];
}

const RUNS = /^run(Promise|Sync|Fork|Callback)(Exit)?$/;
const IO_MODULES = /^(node:)?(fs|fs\/promises|child_process|http|https|http2|net|dgram|tls|worker_threads|readline)$/;
const IO_CALLS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'fetch']);
const IO_NEWS = new Set(['Promise', 'AbortController']);

const calleeName = (call: ts.CallExpression) => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
};

/** `import type { A }` or `import { type A, type B }`: nothing comes in at runtime. */
const typesOnly = (node: ts.ImportDeclaration) => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return !clause.name && !!named && ts.isNamedImports(named) && named.elements.every((e) => e.isTypeOnly);
};

const FAST_CHECK = new Set(['fast-check', '@fast-check/vitest']);
const PROPERTY_RUNS = new Set(['assert', 'check']);

/** The names an import brings in at runtime: `default`, `*` for a namespace, or each named one that isn't a type. */
function valueNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const named = clause.namedBindings;
  const names = clause.name ? ['default'] : [];
  if (named && ts.isNamespaceImport(named)) return [...names, '*'];
  return [...names, ...(named?.elements ?? []).filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)];
}

/** What fast-check's `assert` and `check` are called in this file: through its default or namespace import, or by name. */
function fastCheckCallees(sf: ts.SourceFile): { owners: Set<string>; direct: Set<string> } {
  const owners = new Set<string>();
  const direct = new Set<string>();
  for (const node of sf.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !FAST_CHECK.has(node.moduleSpecifier.text)) continue;
    const clause = node.importClause;
    if (clause?.name) owners.add(clause.name.text);
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) owners.add(named.name.text);
    else for (const e of named?.elements ?? []) if (PROPERTY_RUNS.has((e.propertyName ?? e.name).text)) direct.add(e.name.text);
  }
  return { owners, direct };
}

const exported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

/** The name an exported function goes out under (`export function f`, `export const f = () =>`), if the node is one. */
function exportedFunction(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && exported(node)) return isDefault(node) ? 'default' : node.name?.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    const statement = node.parent.parent;
    return ts.isVariableStatement(statement) && exported(statement) ? node.name.text : undefined;
  }
  return undefined;
}

/** Counts what `SourceCounts` lists in one file, from its syntax tree and comments, not by matching text. */
export function scanSource(file: string, source: string): SourceCounts {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const counts: SourceCounts = {
    typeAssertions: 0, nonNull: 0, explicitAny: 0, lintDisables: 0, tsSuppressions: 0,
    effectRuns: 0, importsEffect: false, doesIo: false, machines: 0, importsFastCheck: false, localImports: [], propertyRunners: [],
  };
  const fastCheck = fastCheckCallees(sf);
  const runsProperty = (call: ts.CallExpression) => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return fastCheck.direct.has(callee.text);
    return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && fastCheck.owners.has(callee.expression.text) && PROPERTY_RUNS.has(callee.name.text);
  };
  const walk = (node: ts.Node, runner?: string) => {
    runner = exportedFunction(node) ?? runner;
    if (ts.isAsExpression(node)) {
      if (!(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === 'const')) counts.typeAssertions++;
    } else if (ts.isTypeAssertionExpression(node)) counts.typeAssertions++;
    else if (ts.isNonNullExpression(node)) counts.nonNull++;
    else if (node.kind === ts.SyntaxKind.AnyKeyword) counts.explicitAny++;
    else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (RUNS.test(name)) counts.effectRuns++;
      if (name === 'createMachine') counts.machines++;
      if (IO_CALLS.has(name)) counts.doesIo = true;
      if (runner && runsProperty(node) && !counts.propertyRunners.includes(runner)) counts.propertyRunners.push(runner);
    } else if (ts.isAwaitExpression(node)) counts.doesIo = true;
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && IO_NEWS.has(node.expression.text)) counts.doesIo = true;
    else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (from === 'effect' || from.startsWith('effect/')) counts.importsEffect = true;
      if (IO_MODULES.test(from) && !typesOnly(node)) counts.doesIo = true;
      if (FAST_CHECK.has(from)) counts.importsFastCheck = true;
      const names = from.startsWith('.') ? valueNames(node) : [];
      if (names.length) counts.localImports.push({ from, names });
    }
    ts.forEachChild(node, (child) => walk(child, runner));
  };
  walk(sf);
  for (const comment of comments(source)) {
    if (/^\s*(\/\/|\/\*)\s*eslint-disable/.test(comment)) counts.lintDisables++;
    if (/@ts-(ignore|expect-error|nocheck)\b/.test(comment)) counts.tsSuppressions++;
  }
  return counts;
}

/** Every comment in the file, read by TypeScript's own scanner so text in strings and templates doesn't count. */
function comments(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const found: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) found.push(scanner.getTokenText());
    // A template's middle and tail only scan as such when asked, after its `}`.
    if (token === ts.SyntaxKind.CloseBraceToken) scanner.reScanTemplateToken(false);
  }
  return found;
}

/** ESLint's JSON report (`-f json`), summed. */
export function eslintCounts(report: { errorCount: number; warningCount: number }[]): { errors: number; warnings: number } {
  return report.reduce((n, f) => ({ errors: n.errors + f.errorCount, warnings: n.warnings + f.warningCount }), { errors: 0, warnings: 0 });
}

/** How many errors the typecheck printed: tsc's `error TS…` lines and the Effect language service's own count. */
export function typecheckErrors(output: string): number {
  const tsc = output.split('\n').filter((line) => /\berror TS\d+:/.test(line)).length;
  const effect = /(\d+) errors?, \d+ warnings?/.exec(output);
  return tsc + (effect ? Number(effect[1]) : 0);
}

/** Vitest's JSON report (`--reporter=json`), as much of it as the scorecard reads. */
export interface VitestReport {
  numTotalTests: number;
  numFailedTests: number;
  testResults: {
    /** The test file's absolute path. */
    name: string;
    status: string;
    /** Why the file failed before its tests could run (an import that threw), else empty. */
    message: string;
    assertionResults: { ancestorTitles: string[]; title: string; status: string; failureMessages: string[] | null }[];
  }[];
}

/**
 * Each test the run failed, as where it is, why (the error's first line), and the command that runs it again on the
 * same dice (`vitest.setup.ts`), so a red gate says what to look at rather than leaving it to be called flaky. A file
 * that failed before any of its tests ran is one too.
 */
export function failedTests(report: VitestReport, root: string, seed: number): string[] {
  return report.testResults.filter((file) => file.status === 'failed').flatMap((file) => {
    const where = path.relative(root, file.name).split(path.sep).join('/');
    const rerun = `  FOCUS_TEST_SEED=${seed} pnpm test ${where}`;
    const tests = file.assertionResults.filter((t) => t.status === 'failed');
    if (!tests.length) return [`${where}: ${firstLine(file.message)}\n${rerun}`];
    return tests.map((t) => `${[where, ...t.ancestorTitles, t.title].join(' › ')}: ${firstLine(t.failureMessages?.[0] ?? '')}\n${rerun} -t ${shellQuote(regexEscape(t.title))}`);
  });
}

const firstLine = (text: string) => text.split('\n')[0].trim() || 'no message';
// `-t` is a regular expression, and the command goes through a shell
const regexEscape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const metric = (section: Section, key: string, label: string, value: number, better: Metric['better'], format: Format): Metric =>
  ({ section, key, label, value, better, format });

export interface GateStep {
  pass: boolean;
  seconds: number;
}

export interface GateResults {
  typecheck: GateStep & { errors: number };
  lint: GateStep & { errors: number; warnings: number };
  test: GateStep & { tests: number; failed: number };
  build: GateStep;
}

export function gateMetrics(g: GateResults): Metric[] {
  const all = [g.typecheck, g.lint, g.test, g.build];
  return [
    metric('gate', 'gate.pass', 'Gate passes', all.every((s) => s.pass) ? 1 : 0, 'higher', 'pass'),
    metric('gate', 'gate.seconds', 'Gate time', all.reduce((n, s) => n + s.seconds, 0), 'lower', 'seconds'),
    metric('gate', 'typecheck.seconds', 'Typecheck time', g.typecheck.seconds, 'lower', 'seconds'),
    metric('gate', 'typecheck.errors', 'Typecheck errors', g.typecheck.errors, 'lower', 'count'),
    metric('gate', 'lint.seconds', 'Lint time', g.lint.seconds, 'lower', 'seconds'),
    metric('gate', 'lint.errors', 'Lint errors', g.lint.errors, 'lower', 'count'),
    metric('gate', 'lint.warnings', 'Lint warnings', g.lint.warnings, 'lower', 'count'),
    metric('gate', 'test.seconds', 'Test time (with coverage)', g.test.seconds, 'lower', 'seconds'),
    metric('gate', 'test.failed', 'Tests failing', g.test.failed, 'lower', 'count'),
    metric('gate', 'build.seconds', 'Build time', g.build.seconds, 'lower', 'seconds'),
  ];
}

const sum = (files: SourceCounts[], key: keyof SourceCounts) => files.reduce((n, f) => n + Number(f[key]), 0);

/** The fence's numbers over the code outside tests. */
export function fenceMetrics(files: SourceCounts[]): Metric[] {
  return [
    metric('fence', 'fence.typeAssertions', 'Type assertions (as T)', sum(files, 'typeAssertions'), 'lower', 'count'),
    metric('fence', 'fence.nonNull', 'Non-null assertions (x!)', sum(files, 'nonNull'), 'lower', 'count'),
    metric('fence', 'fence.explicitAny', 'Explicit any', sum(files, 'explicitAny'), 'lower', 'count'),
    metric('fence', 'fence.lintDisables', 'eslint-disable comments', sum(files, 'lintDisables'), 'lower', 'count'),
    metric('fence', 'fence.tsSuppressions', '@ts-ignore / expect-error', sum(files, 'tsSuppressions'), 'lower', 'count'),
  ];
}

/**
 * How far the server is along the Effect path. Effect is for the files that do I/O: a file that only decides (pure
 * functions, an XState machine) stays plain and counts neither way. So: the share of the files doing I/O that are on
 * Effect, the ones that do it with Promises instead, and the edges where an Effect is run.
 */
export function effectMetrics(server: SourceCounts[]): Metric[] {
  const onEffect = server.filter((f) => f.importsEffect).length;
  const io = server.filter((f) => f.importsEffect || f.doesIo).length;
  return [
    metric('effect', 'effect.ioShare', 'Share of I/O files on Effect', io ? onEffect / io : 0, 'higher', 'percent'),
    metric('effect', 'effect.promiseIo', 'I/O files outside Effect', promiseIo(server).length, 'lower', 'count'),
    metric('effect', 'effect.files', 'Server files on Effect', onEffect, 'none', 'count'),
    metric('effect', 'effect.runs', 'Effect.run* calls (edges)', sum(server, 'effectRuns'), 'lower', 'count'),
    metric('effect', 'effect.runFiles', 'Files that run Effects', server.filter((f) => f.effectRuns > 0).length, 'lower', 'count'),
    metric('effect', 'effect.machines', 'XState machines', sum(server, 'machines'), 'none', 'count'),
  ];
}

/** The files doing I/O without Effect, by name: what's left on the path. */
export const promiseIo = <F extends SourceCounts>(files: F[]): F[] => files.filter((f) => f.doesIo && !f.importsEffect);

/** The file an import from `./x` or `../y` in `file` reaches, among `files` (paths from the root, `/` between folders). */
export function resolveImport(file: string, from: string, files: ReadonlySet<string>): string | undefined {
  const base = path.posix.join(path.posix.dirname(file), from).replace(/\.[cm]?[jt]s$/, '');
  return [`${base}.ts`, `${base}/index.ts`].find((f) => files.has(f));
}

/**
 * The test files that run property tests: those that import fast-check themselves, and those that call a helper of
 * the repo's own whose exported function runs fast-check's properties (`server/agents/invariants.ts`'s checks).
 */
export function propertyTestFiles<F extends SourceCounts & { file: string }>(tests: F[], all: F[]): F[] {
  const runners = new Map(all.filter((f) => f.propertyRunners.length).map((f) => [f.file, f.propertyRunners]));
  const files = new Set(all.map((f) => f.file));
  return tests.filter((t) => t.importsFastCheck || t.localImports.some(({ from, names }) => {
    const found = runners.get(resolveImport(t.file, from, files) ?? '');
    return !!found && names.some((n) => n === '*' || found.includes(n));
  }));
}

export interface CrapResults {
  functions: number;
  over: number;
  total: number;
}

export function testMetrics(tests: { total: number; files: number; propertyFiles: number }, crap: CrapResults | undefined): Metric[] {
  return [
    metric('tests', 'tests.total', 'Tests', tests.total, 'higher', 'count'),
    metric('tests', 'tests.files', 'Test files', tests.files, 'higher', 'count'),
    metric('tests', 'tests.propertyFiles', 'Test files with property tests', tests.propertyFiles, 'higher', 'count'),
    ...(crap ? [
      metric('tests', 'crap.over', 'Functions over CRAP 30 (server, shared, plugins)', crap.over, 'lower', 'count'),
      metric('tests', 'crap.total', 'Total CRAP (server, shared, plugins)', Math.round(crap.total), 'lower', 'count'),
    ] : []),
  ];
}

const DAY = 24 * 60 * 60 * 1000;
/** The window the office's numbers cover, as the report card's and the retro's. */
export const OFFICE_DAYS = 30;
/** The window the open frictions cover: the report card's and the retro's. */
export const FRICTION_DAYS = OPEN_FRICTION_DAYS;

/** The ledger's report card as metrics, and the open frictions of the last `FRICTION_DAYS`. */
export function officeMetrics(events: LedgerEvent[], now: number): { metrics: Metric[]; frictions: Scorecard['frictions'] } {
  const card = reportCard(events, now, OFFICE_DAYS);
  const sessions = events.filter((e) => e.kind === 'session-digest' && e.at > now - FRICTION_DAYS * DAY).length;
  const groups = frictionGroups(events, now, FRICTION_DAYS);
  const metrics = [
    metric('office', 'office.merged', `PRs merged (${OFFICE_DAYS} days)`, card.merged, 'none', 'count'),
    metric('office', 'office.firstTime', 'QA passed first time', card.merged ? card.mergedFirstTime / card.merged : 0, 'higher', 'percent'),
    metric('office', 'office.roundsPerMerge', 'Failed QA rounds per merge', card.roundsPerMerge, 'lower', 'ratio'),
    metric('office', 'office.mergedUnpassed', 'Merged without a QA pass', card.mergedUnpassed, 'lower', 'count'),
    metric('office', 'office.conflictsForAgent', 'Conflicts that needed an agent', card.conflictsForAgent, 'lower', 'count'),
    metric('office', 'office.checksSentBack', 'Checks sent back', card.checksSentBack, 'lower', 'count'),
    metric('office', 'office.costPerMerge', 'Cost per merge', card.costPerMerge, 'lower', 'usd'),
    metric('office', 'office.wastedPerMerge', 'Wasted tool calls per merge', card.wastedPerMerge, 'lower', 'ratio'),
    metric('office', 'office.fixesStopped', 'Retro fixes that stopped their friction', card.fixes.filter((f) => f.status === 'stopped').length, 'higher', 'count'),
    metric('office', 'office.patterns', `Open friction patterns (3+ of ${sessions} sessions, ${FRICTION_DAYS} days)`, groups.filter((g) => g.sessions >= 3).length, 'lower', 'count'),
  ];
  return { metrics, frictions: groups.slice(0, 5).map((g) => ({ key: g.key, sessions: g.sessions })) };
}

/**
 * The scorecard as text, a section at a time, each number with its change since `previous` when there is one: marked
 * ▲ or ▼ only when it moved further than `noise` says it wobbles.
 */
export function render(card: Scorecard, previous?: Scorecard, noise?: ScorecardNoise): string {
  const width = Math.max(...card.metrics.map((m) => m.label.length));
  const when = (c: { at: number }) => new Date(c.at).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `Scorecard · ${measuredAt(card)} · ${when(card)}`,
    previous ? `Changes since ${measuredAt(previous)}, ${when(previous)} (▲ better, ▼ worse)` : 'No earlier scorecard to compare with',
    noise ? `A change counts past the noise floor from ${noise.runs} runs on ${noise.commit.slice(0, 8)}, ${when(noise)}` : 'No noise floor yet (pnpm run scorecard --repeat 5): a time counts past 10%',
  ];
  for (const { section, title, rows } of compared(previous ? [previous, card] : [card], noise)) {
    lines.push('', title);
    for (const { metric: m, delta } of rows) lines.push(`  ${m.label.padEnd(width)}  ${formatValue(m.value, m.format).padStart(7)}  ${delta}`.trimEnd());
    if (section === 'office' && card.frictions.length) {
      lines.push('  Most widespread open frictions:');
      for (const f of card.frictions) lines.push(`    ${String(f.sessions).padStart(3)} sessions  ${f.key}`);
    }
  }
  if (card.notes.length) lines.push('', ...card.notes.map((n) => `Note: ${n}`));
  return lines.join('\n');
}

/** A noise floor as text: each number that wobbled, by how much, and how many held still. */
export function renderNoise(noise: ScorecardNoise, card: Scorecard): string {
  const width = Math.max(...card.metrics.map((m) => m.label.length));
  const lines = [`Noise floor · ${noise.runs} runs on ${noise.commit.slice(0, 8)} · each number's lowest to highest`, ''];
  const still: string[] = [];
  for (const m of card.metrics) {
    const s = noise.spread[m.key];
    if (!s) continue;
    if (s.max === s.min) still.push(m.label);
    else lines.push(`  ${m.label.padEnd(width)}  ${formatValue(s.min, m.format).padStart(7)} to ${formatValue(s.max, m.format).padEnd(7)}  ±${formatValue((s.max - s.min) / 2, m.format)}`);
  }
  if (lines.length === 2) lines.push('  Nothing wobbled.');
  lines.push('', `Held still (${still.length}): ${still.join(', ')}`);
  return lines.join('\n');
}
