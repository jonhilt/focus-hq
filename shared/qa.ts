import type { FileAccount, PullRequest, QaFile, QaRecording, QaReport, QaReview, QaSpotCheck, Settings } from './types';

// What the server and the board show about QA, and how they key and link it. Pure, so they're unit tested
// (shared/qa.test.ts); the decisions are in qaRules.ts.

export type QaBadgeState = 'none' | 'queued' | 'testing' | 'passed' | 'failed' | 'fixing' | 'triaging' | 'needs-you' | 'stale' | 'error';

export interface QaBadge {
  state: QaBadgeState;
  label: string;
}

/**
 * What a PR card shows about QA. A verdict on an older commit than the PR's head is stale. A fail says who it went back
 * to, that the room's operations officer is looking into why it's stuck, or that Ops gave up on it. A review whose
 * reviewer's session ended without a verdict needs the captain; one stopped or cut off otherwise couldn't finish.
 */
export function qaBadge(review: QaReview | undefined, pr: Pick<PullRequest, 'headSha'>): QaBadge {
  if (!review) return { state: 'none', label: 'not tested' };
  switch (review.status) {
    case 'queued':
      return { state: 'queued', label: 'QA queued' };
    case 'testing':
      return { state: 'testing', label: 'QA testing' };
    case 'error':
      // its reviewer's session was over with no verdict: the captain's to send to QA again
      if (review.noVerdict) return { state: 'needs-you', label: 'QA ended without a verdict' };
      return { state: 'error', label: 'QA couldn’t finish' };
    case 'passed':
    case 'failed': {
      if (review.sha && pr.headSha && !sameCommit(review.sha, pr.headSha)) return { state: 'stale', label: `QA ${review.status} an older commit` };
      if (review.status === 'passed') return { state: 'passed', label: review.report?.advisory ? 'QA passed with advice' : 'QA passed' };
      switch (review.followUp?.kind) {
        case 'fixing':
          return { state: 'fixing', label: `QA failed: back with ${review.followUp.agentName}` };
        case 'triaging':
          return { state: 'triaging', label: `${review.followUp.officer} is looking` };
        case 'needs-you':
          return { state: 'needs-you', label: 'QA failed: needs you' };
        case undefined:
          return { state: 'failed', label: 'QA failed' };
      }
    }
  }
}

/** Short and long SHAs of the same commit match. */
export function sameCommit(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

/**
 * The model a QA officer or goal reviewer works on, stamped on them each time they sit down to a review, so a change to
 * the setting applies from the next review: Focus's QA model, else its `model` setting. Missing = Claude Code's default.
 */
export function qaAgentModel(settings: Pick<Settings, 'model' | 'qaModel'>): string | undefined {
  return settings.qaModel.trim() || settings.model.trim() || undefined;
}

/** The longest QA brief a project keeps, in characters. */
export const QA_BRIEF_MAX = 4000;

/** Key for a pull request across a project's repos. */
export const prKey = (repo: string, number: number) => `${repo}#${number}`;

/** A pull request on GitHub. */
export const pullUrl = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`;

/** A spot-check in its pull request's changed files: at its file and line when Ops knows where (`anchor`). */
export const spotCheckUrl = (prUrl: string, check: Pick<QaSpotCheck, 'anchor'>) => `${prUrl}/files${check.anchor ? `#${check.anchor}` : ''}`;

/** Code a reviewer has to open to have checked it: not tests (running them checks them), docs, lock files or pictures. */
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|java|kt|rb|sql|json|ya?ml|toml)$/;
const NOT_CODE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|packages\.lock\.json)$|\.(test|spec)\.|(^|\/)tests?\/|Tests?\.|(^|\/)(dist|build)\//;
export const mustOpen = (file: string) => CODE_FILE.test(file) && !NOT_CODE.test(file);

/** A tests cell that names none. */
const NO_TESTS = /^\s*(none\b|no\b|n\/a\b|-+\s*$|$)/i;

/** A changed file as QA covered it: whether it was opened (`na` for what needn't be, `unknown` without the evidence), and QA's own account of it. */
export interface FileRow {
  file: string;
  opened: 'yes' | 'no' | 'na' | 'unknown';
  /** Code no test exercises, by QA's account (or left out of it). */
  untested: boolean;
  said?: QaFile;
}

export interface FilesCovered {
  rows: FileRow[];
  /** Whether Ops read which files QA opened. */
  evidence: boolean;
  code: number;
  opened: number;
  untested: number;
  missing: number;
  sentBack: number;
}

/**
 * How QA covered each changed file, for its PR comment and the QA panel: code no test exercises and QA never opened
 * first, since that's where a bug gets through; docs, tests and config last. The changed files come from Ops
 * when it knows them, else from the report. Undefined when there are none.
 */
export function filesCovered(report: QaReport, account: FileAccount | undefined): FilesCovered | undefined {
  const told = report.files ?? [];
  const changed = account?.changed.length ? account.changed : told.map((f) => f.file);
  if (!changed.length) return undefined;
  const opened = account?.opened && new Set(account.opened);
  const rows = changed.map((file): FileRow & { rank: number } => {
    const said = told.find((f) => { const n = f.file.replace(/^\.?\//, ''); return n === file || file.endsWith(`/${n}`) || n.endsWith(`/${file}`); });
    const code = mustOpen(file);
    const open = !code ? 'na' : !opened ? 'unknown' : opened.has(file) ? 'yes' : 'no';
    const untested = code && (!said || NO_TESTS.test(said.tests));
    return { file, opened: open, untested, said, rank: !code ? 4 : (open === 'no' ? 0 : 2) + (untested ? 0 : 1) };
  });
  return {
    rows: [...rows].sort((a, b) => a.rank - b.rank).map(({ rank: _, ...r }) => r),
    evidence: !!opened,
    code: rows.filter((r) => r.opened !== 'na').length,
    opened: rows.filter((r) => r.opened === 'yes').length,
    untested: rows.filter((r) => r.untested).length,
    missing: rows.filter((r) => !r.said).length,
    sentBack: account?.sentBack ?? 0,
  };
}

/** A length of time as a recording's caption says it: `0:48`, `12:05`. */
export function clipClock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How a recording of QA's browser was edited, in a line: how long the session took and how long the clip shows it in. */
export function recordingLine(r: Pick<QaRecording, 'realSeconds' | 'shownSeconds' | 'actions'>): string {
  return `took ${clipClock(r.realSeconds)}, shown in ${clipClock(r.shownSeconds)} · ${r.actions} browser action${r.actions === 1 ? '' : 's'} at real speed, waits fast-forwarded`;
}
