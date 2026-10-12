// The pure half of `pnpm run scorecard`: what each number is, how it's counted from source and from the tools' own
// reports, and how two scorecards compare. scripts/scorecard.ts does the I/O: runs the gate, reads the files and the
// ledger, saves and prints.
import ts from 'typescript';
import { frictionGroups, reportCard, type LedgerEvent } from '../shared/ledger';

export type Section = 'gate' | 'fence' | 'effect' | 'tests' | 'office';
export type Format = 'pass' | 'count' | 'seconds' | 'percent' | 'usd' | 'ratio';

/** One measured number: which way is better, so a comparison can say whether it climbed. */
export interface Metric {
  section: Section;
  key: string;
  label: string;
  value: number;
  better: 'lower' | 'higher' | 'none';
  format: Format;
}

export interface Scorecard {
  v: 1;
  at: number;
  commit: string;
  branch: string;
  /** Uncommitted changes were measured too: the numbers aren't the commit's alone. */
  dirty: boolean;
  metrics: Metric[];
  /** The office's open frictions (no retro decision yet), the most widespread first. */
  frictions: { key: string; sessions: number }[];
  /** What couldn't be measured, and why. */
  notes: string[];
}

export const SECTIONS: Record<Section, string> = {
  gate: 'Gate',
  fence: 'Fence (code outside tests)',
  effect: 'Effect (server)',
  tests: 'Tests',
  office: 'Office (ledger)',
};

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
  /** XState machines created (`createMachine`). */
  machines: number;
  importsFastCheck: boolean;
}

const RUNS = /^run(Promise|Sync|Fork|Callback)(Exit)?$/;

const calleeName = (call: ts.CallExpression) => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
};

/** Counts what `SourceCounts` lists in one file, from its syntax tree and comments, not by matching text. */
export function scanSource(file: string, source: string): SourceCounts {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const counts: SourceCounts = {
    typeAssertions: 0, nonNull: 0, explicitAny: 0, lintDisables: 0, tsSuppressions: 0,
    effectRuns: 0, importsEffect: false, machines: 0, importsFastCheck: false,
  };
  const walk = (node: ts.Node) => {
    if (ts.isAsExpression(node)) {
      if (!(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === 'const')) counts.typeAssertions++;
    } else if (ts.isTypeAssertionExpression(node)) counts.typeAssertions++;
    else if (ts.isNonNullExpression(node)) counts.nonNull++;
    else if (node.kind === ts.SyntaxKind.AnyKeyword) counts.explicitAny++;
    else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (RUNS.test(name)) counts.effectRuns++;
      if (name === 'createMachine') counts.machines++;
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (from === 'effect' || from.startsWith('effect/')) counts.importsEffect = true;
      if (from === 'fast-check' || from === '@fast-check/vitest') counts.importsFastCheck = true;
    }
    ts.forEachChild(node, walk);
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

/** How far the server is along the Effect path: its files on Effect, and the edges where an Effect is run. */
export function effectMetrics(server: SourceCounts[]): Metric[] {
  const onEffect = server.filter((f) => f.importsEffect).length;
  return [
    metric('effect', 'effect.files', 'Server files on Effect', onEffect, 'higher', 'count'),
    metric('effect', 'effect.share', 'Share of server files on Effect', server.length ? onEffect / server.length : 0, 'higher', 'percent'),
    metric('effect', 'effect.runs', 'Effect.run* calls (edges)', sum(server, 'effectRuns'), 'lower', 'count'),
    metric('effect', 'effect.runFiles', 'Files that run Effects', server.filter((f) => f.effectRuns > 0).length, 'lower', 'count'),
    metric('effect', 'effect.machines', 'XState machines', sum(server, 'machines'), 'none', 'count'),
  ];
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
      metric('tests', 'crap.over', 'Functions over CRAP 30 (server, shared)', crap.over, 'lower', 'count'),
      metric('tests', 'crap.total', 'Total CRAP (server, shared)', Math.round(crap.total), 'lower', 'count'),
    ] : []),
  ];
}

const DAY = 24 * 60 * 60 * 1000;
/** The window the office's numbers cover, as the report card's and the retro's. */
export const OFFICE_DAYS = 30;
export const FRICTION_DAYS = 14;

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

export function formatValue(value: number, format: Format): string {
  switch (format) {
    case 'pass': return value ? 'yes' : 'NO';
    case 'seconds': return `${value.toFixed(1)}s`;
    case 'percent': return `${Math.round(value * 100)}%`;
    case 'usd': return `$${value.toFixed(2)}`;
    case 'ratio': return value.toFixed(1);
    case 'count': return String(value);
  }
}

/** Whether moving from `before` to `after` is a climb, a slip, or neither. Seconds wobble, so time counts only past 10%. */
export function direction(m: Metric, before: number): 'better' | 'worse' | 'same' {
  const delta = m.value - before;
  const noise = m.format === 'seconds' ? Math.abs(before) * 0.1 : 1e-9;
  if (Math.abs(delta) <= noise || m.better === 'none') return 'same';
  return (delta < 0) === (m.better === 'lower') ? 'better' : 'worse';
}

const MARK = { better: '▲', worse: '▼', same: ' ' } as const;

function deltaText(m: Metric, before: number): string {
  if (m.value === before) return '';
  const delta = m.value - before;
  const shown = m.format === 'pass' ? formatValue(before, 'pass') : `${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta), m.format)}`;
  return `${MARK[direction(m, before)]} ${m.format === 'pass' ? `was ${shown}` : shown}`;
}

/** The scorecard as text, a section at a time, each number with its change since `previous` when there is one. */
export function render(card: Scorecard, previous?: Scorecard): string {
  const was = new Map(previous?.metrics.map((m) => [m.key, m.value]));
  const width = Math.max(...card.metrics.map((m) => m.label.length));
  const head = `Scorecard · ${card.commit.slice(0, 8)} on ${card.branch}${card.dirty ? ' (with uncommitted changes)' : ''} · ${new Date(card.at).toISOString().slice(0, 16).replace('T', ' ')}`;
  const against = previous
    ? `Changes since ${previous.commit.slice(0, 8)} on ${previous.branch}, ${new Date(previous.at).toISOString().slice(0, 16).replace('T', ' ')} (▲ better, ▼ worse)`
    : 'No earlier scorecard to compare with';
  const lines = [head, against];
  for (const [section, title] of Object.entries(SECTIONS)) {
    const rows = card.metrics.filter((m) => m.section === section);
    if (!rows.length) continue;
    lines.push('', title);
    for (const m of rows) {
      const before = was.get(m.key);
      lines.push(`  ${m.label.padEnd(width)}  ${formatValue(m.value, m.format).padStart(7)}  ${before === undefined ? '' : deltaText(m, before)}`.trimEnd());
    }
    if (section === 'office' && card.frictions.length) {
      lines.push('  Most widespread open frictions:');
      for (const f of card.frictions) lines.push(`    ${String(f.sessions).padStart(3)} sessions  ${f.key}`);
    }
  }
  if (card.notes.length) lines.push('', ...card.notes.map((n) => `Note: ${n}`));
  return lines.join('\n');
}
