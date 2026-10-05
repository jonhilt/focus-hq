import type { Agent, QaReport, QaReview, QaScreenshot } from '../../shared/types';
import type { IssueDetail, PullRequestDetail } from '../github/provider';
import { truncate } from '../util';

// The QA officer's instructions, their report's schema, and the PR comment the office posts. Pure, so they're unit
// tested (qa.test.ts).

/** How many of the screenshots QA takes on purpose go on the pull request: the last ones. */
export const MAX_SCREENSHOTS = 8;

/** JSON schema for the QA officer's structured report (the Agent SDK's outputFormat). */
export const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands'],
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
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : []);
  const fix = typeof r.fixInstructions === 'string' && r.fixInstructions.trim() ? r.fixInstructions.trim() : undefined;
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
  };
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

const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;
/** A table cell: no pipes or line breaks to break the row. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') || ' ';

/** The QA report as a pull request comment, with the screenshots that made it to GitHub. */
export function qaComment(report: QaReport, by: { officer: string; sha?: string }, screenshots: QaScreenshot[], attribution: boolean): string {
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
  lines.push('', '### 📸 Screenshots');
  if (!screenshots.length) lines.push('', 'No screenshots were taken during this review.');
  screenshots.forEach((s, i) => {
    const caption = s.caption.replace(/\r?\n/g, ' ');
    lines.push('', `**${i + 1}. ${caption}**`, '', s.url ? `![${caption.replace(/[[\]]/g, '')}](${s.url})` : '_The image couldn\'t be uploaded._');
  });
  if (attribution) lines.push('', `<sub>Posted by the Focus office. QA reviews and tests; the manager decides what merges.</sub>`);
  return lines.join('\n');
}

export function qaSystemAppend(agent: Pick<Agent, 'name'>, project: { name: string; qaBrief?: string }, pr: PullRequestDetail, sha: string): string {
  const brief = project.qaBrief?.trim();
  return `
# You are ${agent.name}, QA officer for ${project.name} aboard the Focus

Developers (other Claude Code agents, or the manager's teammates) open pull requests. You review and test each one before the manager merges it. Your report is posted on the pull request and the manager decides with it in front of them, so be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, acceptance criteria not met, obvious regressions, security holes), not for style preferences.

Pull request #${pr.number} "${pr.title}", branch \`${pr.branch}\` into \`${pr.baseBranch}\`: ${pr.url}
Your current directory is a throwaway checkout of its head, commit ${sha.slice(0, 7)}, detached.
${brief ? `\nWhat to check on every PR of this project (from the manager):\n${brief}\n` : ''}
How to test:
1. Read the PR description and the linked issue, and work out the acceptance criteria. Check every one.
2. Review the code as a careful reviewer would: \`git diff origin/${pr.baseBranch}...HEAD\`. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, and new logic without tests.
3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).
4. If the change touches a web UI, start its dev server in the background and exercise the change with the mcp__browser__ tools: click through it, try the edge cases, and check the console for errors. Stop the server afterwards.
   Call mcp__browser__screenshot on each state that shows the change working or failing: the last ${MAX_SCREENSHOTS} go on the pull request with your report, each with the caption you give it.
5. You may write throwaway scripts to probe behaviour, but don't commit them.

Rules: don't change the code under test, don't commit or push, and don't comment on, review or merge anything on GitHub: the office posts your report. Nobody can answer questions while you work, so make sensible calls and say what you assumed.

Finish with the structured QA report: the verdict, a two to four sentence summary, every check you made (acceptance criteria first), the commands you ran with their results, a caption for each screenshot you took and, on a fail, precise fix instructions for the developer.
`.trim();
}

export function qaPrompt(repo: string, pr: PullRequestDetail, issues: IssueDetail[], lastRound?: QaReview['lastRound']): string {
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
  if (lastRound) {
    const { sha, report } = lastRound;
    const since = sha ? `\`git diff ${sha.slice(0, 7)}..HEAD\`` : 'the commits pushed since';
    parts.push(
      '',
      `This is a re-test. Last round you ${report.verdict === 'pass' ? 'passed' : 'failed'} it${sha ? ` at commit ${sha.slice(0, 7)}` : ''}:`,
      ...findings(report),
      '',
      `Check those findings first. Then focus on what changed since (${since}), and finish with a quick smoke test of the main flow rather than a full review of the whole PR.`,
    );
  }
  return parts.filter((p, i, all) => p !== '' || all[i - 1] !== '').join('\n');
}

/** QA's findings on a failed round, for whoever has to fix them. */
export function fixPrompt(pr: { number: number; branch: string }, review: Pick<QaReview, 'sha'> & { report: QaReport }, cloud = false): string {
  return [
    `QA failed pull request #${pr.number}${review.sha ? ` (commit ${review.sha.slice(0, 7)})` : ''} and sent it back to you. Please fix it.`,
    '',
    ...findings(review.report),
    '',
    cloud
      ? `Fix what QA found on \`${pr.branch}\`, run the tests, type checks and linters, commit, and push with \`git push origin HEAD:${pr.branch}\`. That updates the pull request and QA tests it again.`
      : `Fix what QA found on \`${pr.branch}\`, run the tests, type checks and linters, and commit. The office pushes your commits to the same pull request and QA tests it again.`,
  ].join('\n');
}

function findings(report: QaReport): string[] {
  const failed = report.checks.filter((c) => c.result === 'fail');
  const lines = [truncate(report.summary || '(no summary)', 4000)];
  if (failed.length) lines.push('', 'Failed checks:', ...failed.map((c) => `- ${c.name}${c.details ? `: ${truncate(c.details, 1000)}` : ''}`));
  if (report.fixInstructions) lines.push('', 'What needs fixing:', truncate(report.fixInstructions, 8000));
  return lines;
}
