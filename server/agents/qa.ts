import { createHash } from 'node:crypto';
import type { Agent, FailedCheck, FileAccount, Project, QaPlaybook, QaProof, QaRepoChecks, QaReport, QaRecording, QaReview, QaScreenshot, QaSpotCheck, QaStep } from '../../shared/types';
import { filesCovered, mustOpen, qaProofFor, qaVideoFor, spotCheckUrl } from '../../shared/qa';
import { fieldsOf, isRecord } from '../../shared/records';
import type { IssueDetail, PullRequestDetail } from '../github/provider';
import { mergeCheckCommands, type PackageFacts } from '../packageManager';
import { truncate } from '../util';
import { blocks, transcriptLines } from './transcript';
import { huntingSteps, parseProofs, PROOFS_SCHEMA, proofsToKeep } from './qaProof';
import { clock } from './recording';
import { CREW_RULES, crewPrompt, crewText } from './crewFiles';

// The QA officer's instructions, their report's schema, and the PR comment Ops posts. Pure, so they're unit
// tested (qa.test.ts).

export { qaAgentModel } from '../../shared/qa';

/** How many of the screenshots QA takes on purpose go on the pull request: the last ones. */
export const MAX_SCREENSHOTS = 8;

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
    proofs: PROOFS_SCHEMA,
    spotChecks: {
      type: 'array',
      maxItems: SPOT_CHECKS,
      description: `The ${SPOT_CHECKS} or fewer places in the diff most worth a human's eyes, riskiest first: the reviewer spot-checks these rather than reading every line.`,
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
  const proofs = parseProofs(r.proofs);
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
    ...(proofs.length && { proofs }),
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
 * files its session never opened (`opened`, when Ops could read its tool calls). Nothing once QA has been sent
 * back already this review, or when Ops doesn't know the changed files.
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
  return `${evidenceFolder(pr, sha, at)}/${index + 1}.${ext}`;
}

/** Where the recording of QA's browser goes on the QA evidence branch: beside the round's screenshots. */
export function recordingPath(pr: number, sha: string | undefined, at: number, ext: string): string {
  return `${evidenceFolder(pr, sha, at)}/recording.${ext}`;
}

const evidenceFolder = (pr: number, sha: string | undefined, at: number) => `pr-${pr}/${sha ? `${sha.slice(0, 7)}-` : ''}${at}`;

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
 * tests and what QA checked, gaps first. Nothing when neither the report nor Ops knows the files.
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
 * A verdict's own mark, hidden at the end of its comment: after a restart Ops looks for it among the pull
 * request's comments before posting the verdict again, since the comment may have gone up just as it went down. One
 * verdict's, not the pull request's: a re-review posts another verdict on the same one.
 */
export const verdictMark = (id: string) => `\n\n<!-- focus-qa-verdict ${id} -->`;

/** Whether the verdict `body` (with its mark) is already among a pull request's `comments`. Never for a body without one. */
export function postedAlready(comments: readonly string[], body: string): boolean {
  const mark = /<!-- focus-qa-verdict \S+ -->/.exec(body)?.[0];
  return !!mark && comments.some((c) => c.includes(mark));
}

const PROOF_ICON = { failed: '❌', passed: '✅', broken: '⚠️' } as const;

/** The proofs QA named and what Ops saw of each, as a section of the comment. Nothing when it named none. */
export function proofSection(report: Pick<QaReport, 'proofs' | 'verdict' | 'advisory'>, shots = 0): string[] {
  const proofs = report.proofs ?? [];
  if (!proofs.length) return [];
  const what = (p: QaProof) => {
    if (p.kind === 'screenshot') return `screenshot ${p.screenshot ?? '?'}${shots ? '' : ' (none went on the PR)'}`;
    return p.kind === 'test' ? `\`${cell(p.file ?? '')}\` with \`${cell(p.command ?? '')}\`` : `\`${cell(p.command ?? '')}\``;
  };
  const seen = (p: QaProof) => {
    if (p.outcome === 'failed') return p.kind === 'screenshot' ? `holds: ${p.note ?? ''}` : `fails${p.note ? `: ${cell(truncate(p.note, 200))}` : ''}`;
    if (p.outcome === 'passed') return 'passed when Focus ran it';
    return `not proof: ${cell(p.note ?? 'not checked')}`;
  };
  return [
    '', '### 🧪 Proof', '', 'QA blocks a pull request only with proof Focus checks itself: it runs each test and check in QA\'s checkout before posting.', '',
    '| | Finding | Proof | What Focus saw |', '|---|---|---|---|',
    ...proofs.map((p) => `| ${p.outcome ? PROOF_ICON[p.outcome] : ' '} | ${cell(p.finding)} | ${p.kind}: ${what(p)} | ${seen(p)} |`),
  ];
}

/**
 * The QA report as a pull request comment, with the screenshots that made it to GitHub, the recording of QA's browser
 * when there is one, and, when known, how it covered each changed file.
 */
export function qaComment(report: QaReport, by: { officer: string; sha?: string; pr?: string }, screenshots: QaScreenshot[], attribution: boolean, account?: FileAccount, recording?: QaRecording): string {
  const pass = report.verdict === 'pass';
  const commit = by.sha ? `commit \`${by.sha.slice(0, 7)}\`` : '';
  const tested = attribution ? [`**Tested by** ${by.officer} (Focus QA officer)`, commit].filter(Boolean).join(' · ') : commit && `**Tested at** ${commit}`;
  const heading = report.advisory ? '✅ Passed with advice' : pass ? '✅ Passed' : '❌ Failed';
  const lines = [`## 🔍 QA report: ${heading}`, ...(tested ? [tested] : []), '', report.summary || (pass ? 'Everything checked out.' : 'Problems found, see below.')];
  if (report.advisory) lines.push('', `> QA found problems, but none came with proof that held when Focus checked it (a test that fails, a failing check, or a screenshot of a broken page), so they don't block this pull request: they're advice, below.`);
  if (report.checks.length) {
    lines.push('', '| | Check | Details |', '|---|---|---|', ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`));
  }
  if (report.commands.length) {
    lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
  }
  lines.push(...proofSection(report, screenshots.length));
  if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
  if (report.advisory && report.fixInstructions) lines.push('', '### 💡 Advice (not proved)', '', report.fixInstructions);
  // each links to its file and line in the pull request's changed files, when we know the pull request's address
  const spot = (c: QaSpotCheck) => {
    const where = `\`${c.file}${c.line ? `:${c.line}` : ''}\``;
    return by.pr ? `[${where}](${spotCheckUrl(by.pr, c)})` : where;
  };
  if (report.spotChecks?.length) lines.push('', '### 🔦 Worth a human look', '', ...report.spotChecks.map((c) => `- ${spot(c)}: ${c.why}`));
  lines.push(...filesSection(report, account));
  if (recording) lines.push(...recordingSection(recording));
  lines.push('', '### 📸 Screenshots');
  if (!screenshots.length) lines.push('', 'No screenshots were taken during this review.');
  screenshots.forEach((s, i) => {
    const caption = s.caption.replace(/\r?\n/g, ' ');
    lines.push('', `**${i + 1}. ${caption}**`, '', s.url ? `![${caption.replace(/[[\]]/g, '')}](${s.url})` : '_The image couldn\'t be uploaded._');
  });
  if (attribution) lines.push('', `<sub>Posted by Ops, aboard the Focus. QA reviews and tests; the manager decides what merges.</sub>`);
  return lines.join('\n');
}

/** The recording of QA's browser in the comment: the GIF, which plays there, linking to the MP4, and how it was edited. */
export function recordingSection(r: QaRecording): string[] {
  const actions = `${r.actions} browser action${r.actions === 1 ? '' : 's'}`;
  return [
    '', '### 🎬 Recording',
    ...(r.gifUrl ? ['', `[![QA's browser session](${r.gifUrl})](${r.mp4Url})`] : []),
    '', `The session took ${clock(r.realSeconds)}; the clip shows it in ${clock(r.shownSeconds)}. Each of its ${actions} plays at real speed, and the waits between them are fast-forwarded (marked ⏩), never cut. [Watch the MP4](${r.mp4Url})`,
  ];
}

/** Another pull request of the same slice, checked out beside the one under test at `../<folder>` (`error` if that failed). */
export interface QaSibling {
  repo: string;
  number: number;
  folder: string;
  sha?: string;
  error?: string;
}

/** The slice's other PRs, checked out beside the one under test, as QA's instructions list them. */
export function siblingList(siblings: QaSibling[]): string {
  return siblings
    .map((s) => (s.error ? `- ${s.repo}#${s.number}: couldn't be checked out (${s.error})` : `- \`../${s.folder}\`: ${s.repo}#${s.number}${s.sha ? `, head ${s.sha.slice(0, 7)}` : ''}, detached`))
    .join('\n');
}

/** The steps of "How to test", in the order QA gets them, by their names in .focus/crew/qa.md. */
const STEPS = ['criteria', 'diff', 'checks', 'unread', 'browser', 'scripts'] as const;

/**
 * QA's "How to test" steps for a pull request into `baseBranch`, numbered in this order in its instructions
 * (`qaSystemAppend`) and listed by title at the QA station's Playbook. `checks` are the commands of the repo's own checks
 * when Ops knows them (`repoChecks`); without them QA works out which there are. `recorded`: QA's browser is recorded
 * for the pull request (the project's `qaVideo`).
 */
export function qaSteps(baseBranch: string, checks: readonly string[] = [], recorded = false): QaStep[] {
  const at = { baseBranch, checks: checks.map((c) => `\`${c}\``).join(', '), maxScreenshots: String(MAX_SCREENSHOTS), recorded, run: '', ...CREW_RULES };
  const values = { ...at, run: crewText('qa', checks.length ? 'run.listed' : 'run.unknown', at) };
  return STEPS.map((step) => ({ title: crewText('qa', `steps.${step}.title`, values), text: crewText('qa', `steps.${step}.text`, values) }));
}

/** QA's instructions for reviewing `pr` at `sha`: `checks` are the commands of its repo's checks, for step 3 (`qaSteps`). */
export function qaSystemAppend(agent: Pick<Agent, 'name'>, project: { name: string; qaBrief?: string; qaProof?: boolean; qaVideo?: boolean }, pr: PullRequestDetail, sha: string, siblings: QaSibling[] = [], checks: readonly string[] = []): string {
  const brief = project.qaBrief?.trim() ?? '';
  const [hunt, probe, proofStep] = huntingSteps().map((step) => step.text);
  return crewPrompt('qa', {
    name: agent.name,
    project: project.name,
    number: String(pr.number),
    title: pr.title,
    branch: pr.branch,
    baseBranch: pr.baseBranch,
    url: pr.url,
    sha: sha.slice(0, 7),
    siblings: siblings.length > 0,
    siblingList: siblingList(siblings),
    brief: !!brief,
    briefText: brief,
    steps: qaSteps(pr.baseBranch, checks, qaVideoFor(project)).map((step, i) => `${i + 1}. ${step.text}`).join('\n'),
    proof: qaProofFor(project),
    hunt,
    probe,
    proofStep,
    spotChecks: String(SPOT_CHECKS),
    publicWordsRule: CREW_RULES.publicWordsRule,
  }).trim();
}

/** What QA runs on `repo`, from what its clone's root says (`facts`; none when there's no clone) and the project's merge checks. */
export function repoChecks(repo: string, facts: PackageFacts | undefined, chosen?: readonly string[]): QaRepoChecks {
  return {
    repo,
    cloned: !!facts,
    packageJson: !!facts?.packageJson,
    claudeMd: !!facts?.claudeMd,
    commands: facts ? mergeCheckCommands(facts.scripts, facts.lockfiles, chosen).map((command) => command.join(' ')) : [],
  };
}

/** A pull request to show QA's instructions with before there's a real one: #123 into `main` in `repo`. */
function examplePr(repo: string): PullRequestDetail {
  return { number: 123, title: 'Example PR', body: '', url: `https://github.com/${repo}/pull/123`, branch: 'feature', baseBranch: 'main', headSha: '1234567', linkedIssues: [] };
}

/**
 * The QA station's Playbook for `project`, from QA's instructions as they'd be now (the officer `officer`): its steps,
 * proof mode's only when it's on, the checks it runs on each repo, and the whole instructions for an example pull request
 * in the first repo, whose checks step 3 names.
 */
export function qaPlaybook(officer: string, project: Pick<Project, 'name' | 'repos' | 'qaBrief' | 'qaProof' | 'qaVideo'>, repos: QaRepoChecks[]): QaPlaybook {
  const checks = repos[0]?.commands ?? [];
  const pr = examplePr(project.repos[0] ?? 'owner/repo');
  return {
    steps: [...qaSteps(pr.baseBranch, checks, qaVideoFor(project)), ...(qaProofFor(project) ? huntingSteps() : [])],
    repos,
    prompt: qaSystemAppend({ name: officer }, project, pr, pr.headSha, [], checks),
  };
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
      `This is a re-test. Last round you ${report.advisory ? 'failed it without proof that held, so it went up as a pass with advice' : report.verdict === 'pass' ? 'passed it' : 'failed it'}${sha ? ` at commit ${sha.slice(0, 7)}` : ''}:`,
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
    ...proofsToKeep(review.report),
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
    : `Fix ${what} on \`${branch}\`, run the tests, type checks and linters, and commit. Ops pushes your commits to the same pull request and QA tests it again.`;
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
  if (report.fixInstructions) lines.push('', report.advisory ? 'Advice (no proof held, so it didn\'t block):' : 'What needs fixing:', truncate(report.fixInstructions, 8000));
  const held = (report.proofs ?? []).filter((p) => p.outcome === 'failed' && p.kind !== 'screenshot');
  if (held.length) lines.push('', 'Proof that held (the developer was asked to add each test to the branch and make it pass, so it may be there under another name):', ...held.map((p) => `- ${p.finding}: \`${p.kind === 'test' ? `${p.file}\` with \`` : ''}${p.command}\``));
  return lines;
}
