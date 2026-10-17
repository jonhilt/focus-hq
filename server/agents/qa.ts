import { createHash } from 'node:crypto';
import type { Agent, FailedCheck, FileAccount, QaReport, QaReview, QaScreenshot, QaSpotCheck, Settings } from '../../shared/types';
import { filesCovered, mustOpen, spotCheckUrl } from '../../shared/qa';
import { fieldsOf, isRecord } from '../../shared/records';
import type { IssueDetail, PullRequestDetail } from '../github/provider';
import { truncate } from '../util';
import { blocks, transcriptLines } from './transcript';
import { SCRATCH_RULE } from './scratch';
import { WAIT_RULE } from './wait';

// The QA officer's instructions, their report's schema, and the PR comment the office posts. Pure, so they're unit
// tested (qa.test.ts).

/** How many of the screenshots QA takes on purpose go on the pull request: the last ones. */
export const MAX_SCREENSHOTS = 8;

/**
 * The model a QA officer or goal reviewer works on, stamped on them each time they sit down to a review, so a change to
 * the setting applies from the next review: the office's QA model, else its `model` setting. Missing = Claude Code's default.
 */
export function qaAgentModel(settings: Pick<Settings, 'model' | 'qaModel'>): string | undefined {
  return settings.qaModel.trim() || settings.model.trim() || undefined;
}

/** How many places in the diff QA picks for the captain to spot-check, at most. */
export const SPOT_CHECKS = 3;

/** JSON schema for the QA officer's structured report (the Agent SDK's outputFormat). */
export const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'files'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'], description: 'pass only if the change works and meets the acceptance criteria' },
    summary: { type: 'string', description: 'Two to four sentences for the pull request comment.' },
    checks: {
      type: 'array',
      description: 'Each acceptance criterion, review point or scenario you checked, acceptance criteria first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'What you did and what you saw.' },
        },
      },
    },
    commands: {
      type: 'array',
      description: 'Test suites, linters, builds and other commands you ran.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'e.g. "42 passed, 0 failed"' } },
      },
    },
    fixInstructions: { type: 'string', description: 'When the verdict is fail: precise, actionable instructions for the developer.' },
    screenshots: {
      type: 'array',
      description: 'One short caption per mcp__browser__screenshot call you made, in the order you took them. Empty if you took none.',
      items: { type: 'string' },
    },
    files: {
      type: 'array',
      description: 'Every file the pull request changes, each accounted for: none left out, however many there are.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'tests', 'checked'],
        properties: {
          file: { type: 'string', description: 'The file\'s path in the repo, as the diff names it.' },
          tests: { type: 'string', description: 'The tests that exercise its changes, or "none".' },
          checked: { type: 'string', description: 'What you did with it: read every changed line (and what you found), ran it, or why it needed no reading (generated, a lock file).' },
        },
      },
    },
    spotChecks: {
      type: 'array',
      maxItems: SPOT_CHECKS,
      description: `The ${SPOT_CHECKS} or fewer places in the diff most worth a human's eyes, riskiest first: the captain spot-checks these rather than reading every line.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'why'],
        properties: {
          file: { type: 'string', description: 'The file\'s path in the repo.' },
          line: { type: 'integer', description: 'The line in the new version of the file where it starts.' },
          why: { type: 'string', description: 'Why it deserves a look, in a sentence: what could go wrong there.' },
        },
      },
    },
  },
};

/**
 * The report from a finished QA session: the SDK's structured output, else the last JSON object in the final message
 * (fenced or not). Null if there's no usable verdict.
 */
export function parseQaReport(structured: unknown, text = ''): QaReport | null {
  let raw: unknown = structured;
  if (!raw || typeof raw !== 'object') {
    raw = null;
    const fenced = [...text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
    for (const json of [...fenced, text.match(/\{[\s\S]*\}/)?.[0]].filter((j): j is string => !!j)) {
      try {
        raw = JSON.parse(json);
        break;
      } catch {
        // try the next candidate
      }
    }
  }
  const r = raw;
  if (!isRecord(r)) return null;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
  const fix = typeof r.fixInstructions === 'string' && r.fixInstructions.trim() ? r.fixInstructions.trim() : undefined;
  const files = list(r.files)
    .map((f) => ({ file: String(f.file ?? '').trim(), tests: String(f.tests ?? '').trim(), checked: String(f.checked ?? '').trim() }))
    .filter((f) => f.file);
  const spotChecks = list(r.spotChecks)
    .map((c) => ({ file: String(c.file ?? '').trim(), line: Number.isInteger(c.line) && Number(c.line) > 0 ? Number(c.line) : undefined, why: String(c.why ?? '').trim() }))
    .filter((c) => c.file && c.why)
    .slice(0, SPOT_CHECKS)
    .map(({ line, ...c }) => ({ ...c, ...(line && { line }), anchor: diffAnchor(c.file, line) }));
  return {
    verdict: r.verdict,
    summary: String(r.summary ?? '').trim(),
    checks: list(r.checks).map((c) => ({
      name: String(c.name ?? '').trim(),
      result: c.result === 'fail' ? 'fail' : c.result === 'skip' ? 'skip' : 'pass',
      details: String(c.details ?? '').trim(),
    })),
    commands: list(r.commands).map((c) => ({ command: String(c.command ?? '').trim(), result: String(c.result ?? '').trim() })),
    fixInstructions: r.verdict === 'fail' ? fix : undefined,
    captions: Array.isArray(r.screenshots) ? r.screenshots.map((c) => String(c ?? '').trim()) : [],
    ...(spotChecks.length && { spotChecks }),
    ...(files.length && { files }),
  };
}

/** How many changed files QA's prompt names, at most: a pull request bigger than that is named in part. */
export const NAMED_FILES = 200;

/** The files a pull request changes that QA's report doesn't account for. */
export function unaccounted(report: QaReport, changed: string[]): string[] {
  const named = (report.files ?? []).map((f) => f.file.replace(/^\.?\//, ''));
  return changed.filter((c) => !named.some((n) => n === c || c.endsWith(`/${n}`) || n.endsWith(`/${c}`)));
}

/** What QA said it only skimmed, glanced at or didn't read, in its own words. */
const UNREAD = /\b(skim(med|ming)?|glanced?|not (read|reviewed|opened)|didn['’]t (read|review|open)|did not (read|review|open)|unread|unreviewed)\b/i;

/** The changed files QA's report says it only skimmed or didn't read: its own account, taken at its word. */
export const skimmed = (report: QaReport): string[] => (report.files ?? []).filter((f) => UNREAD.test(f.checked)).map((f) => f.file);

/** A tool call from QA's session: the tool and what it was given. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Each tool call in a Claude Code transcript (JSONL), in order. */
export function toolCalls(jsonl: string): ToolCall[] {
  return [...transcriptLines(jsonl)].flatMap((line) =>
    line.type === 'assistant' ? blocks(line).flatMap((b) => (b.type === 'tool_use' && b.name ? [{ name: b.name, input: fieldsOf(b.input) }] : [])) : [],
  );
}


/** A command that shows only part of what it reads, or only where a pattern matches: it doesn't count as opening a file. */
const PARTIAL = /\|\s*(head|tail|grep|rg|wc)\b|^\s*(grep|rg|ls|wc|stat|git\s+(log|blame|show\s+--stat))\b|--stat\b|--name-only\b|--name-status\b/;

/**
 * The changed files QA's session actually opened, from its tool calls: one it read, or a command that printed it whole
 * (`git diff … -- file`, `cat`, `sed -n`, …). A whole diff of the pull request, not cut short, opens every file.
 */
export function openedFiles(calls: ToolCall[], changed: string[]): Set<string> {
  const opened = new Set<string>();
  for (const { name, input } of calls) {
    const path = typeof input.file_path === 'string' ? input.file_path : '';
    const command = typeof input.command === 'string' ? input.command : '';
    if (name === 'Read') for (const f of changed) if (path === f || path.endsWith(`/${f}`)) opened.add(f);
    if (!command || PARTIAL.test(command)) continue;
    const named = changed.filter((f) => command.includes(f));
    if (named.length) named.forEach((f) => opened.add(f));
    else if (/\bgit\s+diff\b[^|;&]*\.\.\./.test(command) && !/\s--\s/.test(command)) changed.forEach((f) => opened.add(f));
  }
  return opened;
}

/** The changed files to send QA back to: left out of its report, said to be only skimmed, or never opened at all. */
export interface Revisit {
  missing: string[];
  unread: string[];
  unopened: string[];
}

/**
 * The changed files a report should go back to QA for: those it leaves out, those it says it only skimmed, and the code
 * files its session never opened (`opened`, when the office could read its tool calls). Nothing once QA has been sent
 * back already this review, or when the office doesn't know the changed files.
 */
export function filesToRevisit(report: QaReport, files: { changed: string[]; askedAgain: boolean } | undefined, opened?: Set<string>): Revisit | undefined {
  if (!files || files.askedAgain) return undefined;
  const missing = unaccounted(report, files.changed);
  const unread = skimmed(report);
  const unopened = opened ? files.changed.filter((f) => mustOpen(f) && !opened.has(f) && !missing.includes(f) && !unread.some((u) => u === f || f.endsWith(`/${u}`))) : [];
  return missing.length || unread.length || unopened.length ? { missing, unread, unopened } : undefined;
}

/** What QA hears when its report leaves files out, says it only skimmed some, or its session never opened some: go back to them, then report again in full. Asked once a review. */
export function filesPrompt({ missing, unread, unopened }: Revisit): string {
  const list = (files: string[]) => [...files.slice(0, NAMED_FILES).map((f) => `- ${f}`), ...(files.length > NAMED_FILES ? [`- …and ${files.length - NAMED_FILES} more (\`git diff --name-only\` lists them)`] : [])];
  const these = (n: number) => (n === 1 ? 'this file' : `these ${n} files`);
  const sections = [
    missing.length ? [`Your report leaves out ${missing.length} of the files this pull request changes:`, ...list(missing)] : [],
    unread.length ? [`Your report says you only skimmed, or didn't read, ${these(unread.length)}:`, ...list(unread)] : [],
    unopened.length ? [`Your session never opened ${these(unopened.length)}, whatever your report says about ${unopened.length === 1 ? 'it' : 'them'}:`, ...list(unopened)] : [],
  ].filter((s) => s.length);
  return [
    ...sections.flatMap((s, i) => (i ? ['', ...s] : s)),
    '',
    "Review each properly: what tests exercise its changes, and for one no test does, read its diff whole, every changed line, asking what would make it wrong. Then give your whole report again, every file in it, with the verdict it now deserves.",
  ].join('\n');
}

/**
 * The caption for each screenshot kept, given QA's captions for all `taken` of them and that only the last `kept`
 * survive. A screenshot QA didn't caption is just numbered.
 */
export function keptCaptions(captions: string[], taken: number, kept: number): string[] {
  const first = taken - kept;
  return Array.from({ length: kept }, (_, i) => captions[first + i] || `Screenshot ${first + i + 1}`);
}

/** Where a screenshot goes on the QA evidence branch: one folder per review round, so re-tests never collide. */
export function evidencePath(pr: number, sha: string | undefined, at: number, index: number, ext: string): string {
  return `pr-${pr}/${sha ? `${sha.slice(0, 7)}-` : ''}${at}/${index + 1}.${ext}`;
}

/**
 * Where a file (and a line in it, on the new side) is in a pull request's changed files on GitHub: its anchor there is
 * `diff-` and the SHA-256 of its path from the repo's root, then `R` and the line.
 */
export function diffAnchor(file: string, line?: number): string {
  const path = file.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  return `diff-${createHash('sha256').update(path).digest('hex')}${line ? `R${line}` : ''}`;
}

const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;
/** A table cell: no pipes or line breaks to break the row. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') || ' ';

/** Above this many files the table starts folded away, behind its headline. */
const OPEN_ROWS = 12;
const OPENED = { yes: '✅', no: '❌', na: '–', unknown: '' } as const;

/**
 * The per-file account as a section of the comment (`filesCovered`): a headline (code files opened by evidence, files
 * with no test, files left out of the report and sent back to), then each changed file with whether it was opened, its
 * tests and what QA checked, gaps first. Nothing when neither the report nor the office knows the files.
 */
export function filesSection(report: QaReport, account: FileAccount | undefined): string[] {
  const c = filesCovered(report, account);
  if (!c) return [];
  const head = [
    c.evidence ? `**${c.opened} of ${c.code}** changed code files opened by QA (from its tool calls)` : `**${c.rows.length}** changed files`,
    `**${c.untested}** code files with no test`,
    ...(c.missing ? [`**${c.missing}** left out of QA's report`] : []),
    ...(c.sentBack ? [`sent back once for ${c.sentBack} file${c.sentBack === 1 ? '' : 's'}`] : []),
  ].join(' · ');
  return [
    '', '### 📂 Files reviewed', '', head, '',
    `<details${c.rows.length <= OPEN_ROWS ? ' open' : ''}><summary>Each file</summary>`, '',
    c.evidence ? '| File | Opened | Tests | What QA checked |' : '| File | Tests | What QA checked |',
    c.evidence ? '|---|---|---|---|' : '|---|---|---|',
    ...c.rows.map((r) => {
      const tests = r.said ? `${r.untested ? '⚠️ ' : ''}${cell(truncate(r.said.tests, 160))}` : '⚠️ not in the report';
      const checked = r.said ? cell(truncate(r.said.checked, 240)) : ' ';
      return `| \`${cell(r.file)}\` |${c.evidence ? ` ${OPENED[r.opened]} |` : ''} ${tests} | ${checked} |`;
    }),
    '', '</details>',
  ];
}

/**
 * A verdict's own mark, hidden at the end of its comment: after a restart the office looks for it among the pull
 * request's comments before posting the verdict again, since the comment may have gone up just as it went down. One
 * verdict's, not the pull request's: a re-review posts another verdict on the same one.
 */
export const verdictMark = (id: string) => `\n\n<!-- focus-qa-verdict ${id} -->`;

/** Whether the verdict `body` (with its mark) is already among a pull request's `comments`. Never for a body without one. */
export function postedAlready(comments: readonly string[], body: string): boolean {
  const mark = /<!-- focus-qa-verdict \S+ -->/.exec(body)?.[0];
  return !!mark && comments.some((c) => c.includes(mark));
}

/** The QA report as a pull request comment, with the screenshots that made it to GitHub and, when known, how it covered each changed file. */
export function qaComment(report: QaReport, by: { officer: string; sha?: string; pr?: string }, screenshots: QaScreenshot[], attribution: boolean, account?: FileAccount): string {
  const pass = report.verdict === 'pass';
  const commit = by.sha ? `commit \`${by.sha.slice(0, 7)}\`` : '';
  const tested = attribution ? [`**Tested by** ${by.officer} (Focus QA officer)`, commit].filter(Boolean).join(' · ') : commit && `**Tested at** ${commit}`;
  const lines = [`## 🔍 QA report: ${pass ? '✅ Passed' : '❌ Failed'}`, ...(tested ? [tested] : []), '', report.summary || (pass ? 'Everything checked out.' : 'Problems found, see below.')];
  if (report.checks.length) {
    lines.push('', '| | Check | Details |', '|---|---|---|', ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`));
  }
  if (report.commands.length) {
    lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
  }
  if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
  // each links to its file and line in the pull request's changed files, when we know the pull request's address
  const spot = (c: QaSpotCheck) => {
    const where = `\`${c.file}${c.line ? `:${c.line}` : ''}\``;
    return by.pr ? `[${where}](${spotCheckUrl(by.pr, c)})` : where;
  };
  if (report.spotChecks?.length) lines.push('', '### 🔦 Worth a human look', '', ...report.spotChecks.map((c) => `- ${spot(c)}: ${c.why}`));
  lines.push(...filesSection(report, account));
  lines.push('', '### 📸 Screenshots');
  if (!screenshots.length) lines.push('', 'No screenshots were taken during this review.');
  screenshots.forEach((s, i) => {
    const caption = s.caption.replace(/\r?\n/g, ' ');
    lines.push('', `**${i + 1}. ${caption}**`, '', s.url ? `![${caption.replace(/[[\]]/g, '')}](${s.url})` : '_The image couldn\'t be uploaded._');
  });
  if (attribution) lines.push('', `<sub>Posted by the Focus office. QA reviews and tests; the manager decides what merges.</sub>`);
  return lines.join('\n');
}

/** Another pull request of the same slice, checked out beside the one under test at `../<folder>` (`error` if that failed). */
export interface QaSibling {
  repo: string;
  number: number;
  folder: string;
  sha?: string;
  error?: string;
}

/** What QA hears about the slice's other PRs, checked out beside the one under test, and how to test them together. */
export function siblingsSection(siblings: QaSibling[]): string {
  if (!siblings.length) return '';
  const list = siblings.map((s) =>
    s.error ? `- ${s.repo}#${s.number}: couldn't be checked out (${s.error})` : `- \`../${s.folder}\`: ${s.repo}#${s.number}${s.sha ? `, head ${s.sha.slice(0, 7)}` : ''}, detached`);
  return `
This pull request is one of a slice that changes several repos together. The slice's other pull requests are checked out beside your directory, at their heads, where the lead had them:
${list.join('\n')}
Test this PR on its own first, as below. Then, where the repos depend on each other (an API and its client, a shared package, docs for a feature), run them together from these checkouts and exercise the slice end to end. Your verdict is on this PR only: when a joint check fails because of a sibling, say which, and don't fail this PR for it. Don't change the siblings either.
`;
}

export function qaSystemAppend(agent: Pick<Agent, 'name'>, project: { name: string; qaBrief?: string }, pr: PullRequestDetail, sha: string, siblings: QaSibling[] = []): string {
  const brief = project.qaBrief?.trim();
  return `
# You are ${agent.name}, QA officer for ${project.name} aboard the Focus

Developers (other Claude Code agents, or the manager's teammates) open pull requests. You review and test each one before the manager merges it. Your report is posted on the pull request and the manager decides with it in front of them, so be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, acceptance criteria not met, obvious regressions, security holes), not for style preferences.

Pull request #${pr.number} "${pr.title}", branch \`${pr.branch}\` into \`${pr.baseBranch}\`: ${pr.url}
Your current directory is a throwaway checkout of its head, commit ${sha.slice(0, 7)}, detached.
${siblingsSection(siblings)}${brief ? `\nWhat to check on every PR of this project (from the manager):\n${brief}\n` : ''}
How to test:
1. Read the PR description and the linked issue, and work out the acceptance criteria. Check every one.
2. Review the code as a careful reviewer would: \`git diff origin/${pr.baseBranch}...HEAD\`. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, new logic without tests, and new tests that run code without checking what it does (they raise coverage but catch nothing).
3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).
4. Then go through every file the diff changes (\`git diff --stat origin/${pr.baseBranch}...HEAD\` lists them all: however many there are, don't pick a few), and find those whose changes no test exercises. Scripts, schemas, prompts and config often aren't tested, and a coverage report may not reach them. Read each of those files' changed lines one by one: a green suite says nothing about them, and they're where bugs get through. For each line, ask what input or state makes it wrong: a comparison off by one, a condition or guard the wrong way round, an argument or index read from the wrong place, a flag, default or schema setting flipped. A real bug there fails the PR like any other: name its file and line. Your report's files lists every changed file, none left out: the tests that exercise it (or none) and what you checked.
5. If the change touches a web UI, start its dev server in the background and exercise the change with the mcp__browser__ tools: click through it, try the edge cases, and check the console for errors. Stop the server afterwards.
   Call mcp__browser__screenshot on each state that shows the change working or failing: the last ${MAX_SCREENSHOTS} go on the pull request with your report, each with the caption you give it.
6. You may write throwaway scripts to probe behaviour, but don't commit them. ${SCRATCH_RULE} ${WAIT_RULE}

Rules: don't change the code under test, don't commit or push, and don't comment on, review or merge anything on GitHub: the office posts your report. Nobody can answer questions while you work, so make sensible calls and say what you assumed.

Finish with the structured QA report: the verdict, a two to four sentence summary, every check you made (acceptance criteria first), the commands you ran with their results, a caption for each screenshot you took, up to ${SPOT_CHECKS} spot-checks and, on a fail, precise fix instructions for the developer.

Spot-checks: the captain rarely reads a whole diff, but likes to look at the riskiest few places with their own eyes. From your review, pick up to ${SPOT_CHECKS} places most worth that look, riskiest first: a new route or permission, a changed guard or merge gate, a deleted or weakened test, data that could be lost, a tricky concurrency or error path. Give the file, the line where it starts, and in a sentence what could go wrong there. Pick none for a change too small or plain to need it.
`.trim();
}

/**
 * The message that starts a review: the pull request, its linked issues, and the files it changes (`changed`, from the
 * checkout's diff), each of which QA's report accounts for; on a re-test, the last round's findings.
 */
export function qaPrompt(repo: string, pr: PullRequestDetail, issues: IssueDetail[], round: Pick<QaReview, 'lastRound' | 'retryNote'> = {}, changed: string[] = []): string {
  const { lastRound, retryNote } = round;
  const parts = [
    `Please QA pull request #${pr.number} in ${repo}: ${pr.title}`,
    `URL: ${pr.url}`,
    pr.author ? `Author: @${pr.author}` : '',
    '',
    'PR description:',
    truncate(pr.body.trim() || '(empty)', 12_000),
  ];
  for (const issue of issues) {
    parts.push('', `Linked issue #${issue.number}: ${issue.title}`, truncate(issue.body.trim() || '(no description)', 12_000));
  }
  if (!issues.length) parts.push('', 'No linked issue: work out what the PR is meant to do from its title, description and commits.');
  if (changed.length) {
    const shown = changed.slice(0, NAMED_FILES);
    parts.push('', `The files it changes (${changed.length}): your report's files accounts for every one.`, ...shown.map((f) => `- ${f}`));
    if (changed.length > shown.length) parts.push(`- …and ${changed.length - shown.length} more (\`git diff --name-only\` lists them)`);
  }
  if (lastRound) {
    const { sha, report } = lastRound;
    const since = sha ? `\`git diff ${sha.slice(0, 7)}..HEAD\`` : 'the commits pushed since';
    parts.push(
      '',
      `This is a re-test. Last round you ${report.verdict === 'pass' ? 'passed' : 'failed'} it${sha ? ` at commit ${sha.slice(0, 7)}` : ''}:`,
      ...qaFindings(report, { skipped: true }),
      '',
      `Check those findings first. Then focus on what changed since (${since}), and finish with a quick smoke test of the main flow rather than a full review of the whole PR.`,
    );
  }
  if (retryNote) parts.push('', retryNote);
  return parts.filter((p, i, all) => p !== '' || all[i - 1] !== '').join('\n');
}

/** QA's findings on a failed round, for whoever has to fix them. */
export function fixPrompt(pr: { number: number; branch: string }, review: Pick<QaReview, 'sha'> & { report: QaReport }, cloud = false): string {
  return [
    `QA failed pull request #${pr.number}${review.sha ? ` (commit ${review.sha.slice(0, 7)})` : ''} and sent it back to you. Please fix it.`,
    '',
    ...qaFindings(review.report),
    '',
    fixAndPush('what QA found', pr.branch, cloud),
  ].join('\n');
}

/** For a PR QA passed whose checks on GitHub still fail after a re-run. */
export function checksFixPrompt(pr: { number: number; branch: string }, sha: string | undefined, checks: FailedCheck[], cloud = false): string {
  return [
    `QA passed pull request #${pr.number}, but its checks on GitHub fail${sha ? ` on commit ${sha.slice(0, 7)}` : ''}, and failed again when re-run. It was sent back to you. Please fix it.`,
    '',
    'Failing checks:',
    ...checks.map((c) => `- ${c.name}${c.url ? `: ${c.url}` : ''}`),
    '',
    'For GitHub Actions, `gh run view <run id> --log-failed` shows what went wrong.',
    '',
    fixAndPush('the failing checks', pr.branch, cloud),
  ].join('\n');
}

function fixAndPush(what: string, branch: string, cloud: boolean): string {
  return cloud
    ? `Fix ${what} on \`${branch}\`, run the tests, type checks and linters, commit, and push with \`git push origin HEAD:${branch}\`. That updates the pull request and QA tests it again.`
    : `Fix ${what} on \`${branch}\`, run the tests, type checks and linters, and commit. The office pushes your commits to the same pull request and QA tests it again.`;
}

/**
 * QA's findings on a round: the summary, failed checks and fix instructions. A re-test also gets the checks QA skipped
 * (`skipped`), so it can try them again.
 */
export function qaFindings(report: QaReport, { skipped = false } = {}): string[] {
  const lines = [truncate(report.summary || '(no summary)', 4000)];
  const list = (title: string, result: 'fail' | 'skip') => {
    const checks = report.checks.filter((c) => c.result === result);
    if (checks.length) lines.push('', title, ...checks.map((c) => `- ${c.name}${c.details ? `: ${truncate(c.details, 1000)}` : ''}`));
  };
  list('Failed checks:', 'fail');
  if (skipped) list('Skipped checks:', 'skip');
  if (report.fixInstructions) lines.push('', 'What needs fixing:', truncate(report.fixInstructions, 8000));
  return lines;
}
