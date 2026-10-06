import { randomBytes } from 'node:crypto';
import { sleep } from '../util';
import { qaOfficerFor } from '../../shared/crew';
import { optionText } from '../../shared/engineering';
import type { BriefingOfficer, BriefingQa, OfficerHooks, OfficerReply, OfficerTurn, QaReply, QaTurn } from './briefing';
import type { BriefingEngineer, EngineerReply, EngineerTurn } from './engineering';
import { mergeBrief } from './briefing';
import { asBreakdown } from './breakdown';
import type { NumberOneOfficer, NumberOneReply, NumberOneTurn } from './numberOne';
import type { Drafter, DraftRequest, DraftResult } from './planner';
import { renderText, renderToolUse } from './render';
import type { TriageDecision, Triager, TriageRequest } from './triage';
import { type AgentRunner, type AgentSession, type RunHooks, type RunOutcome, type RunRequest, type WorkspaceOps, STOPPED_BY_CAPTAIN } from './types';

const FILES: Record<string, string[]> = {
  web: ['src/App.tsx', 'src/components/Header.tsx', 'src/components/CartBadge.tsx', 'src/pages/Product.tsx', 'src/store/cart.ts', 'src/styles/theme.css'],
  api: ['src/server.ts', 'src/routes/auth.ts', 'src/routes/products.ts', 'src/routes/orders.ts', 'src/middleware/rateLimit.ts', 'test/orders.test.ts'],
  game: ['index.html', 'src/game.ts', 'src/ship.ts', 'src/asteroids.ts', 'src/audio.ts', 'src/hud.ts'],
};

const pick = <T>(list: T[], n: number) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

const xml = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A placeholder for a screenshot QA takes in demo mode: a pretend page, as an SVG data URL. */
function placeholderShot(url: string, heading: string, caption: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700" viewBox="0 0 1100 700">
<rect width="1100" height="700" fill="#f4f6fb"/><rect width="1100" height="44" fill="#dfe3ec"/>
<rect x="16" y="10" width="760" height="24" rx="12" fill="#fff"/><text x="32" y="27" font-family="sans-serif" font-size="14" fill="#555">${xml(url)}</text>
<rect y="44" width="1100" height="90" fill="${accent}"/><text x="40" y="100" font-family="sans-serif" font-size="30" font-weight="bold" fill="#fff">${xml(heading)}</text>
<rect x="40" y="170" width="480" height="300" rx="12" fill="#fff" stroke="#d5d9e2"/><rect x="580" y="170" width="480" height="300" rx="12" fill="#fff" stroke="#d5d9e2"/>
<rect x="70" y="200" width="300" height="18" rx="9" fill="#d5d9e2"/><rect x="70" y="236" width="400" height="14" rx="7" fill="#e6e9f0"/>
<rect x="610" y="200" width="260" height="18" rx="9" fill="#d5d9e2"/><rect x="610" y="236" width="380" height="14" rx="7" fill="#e6e9f0"/>
<text x="550" y="560" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#333">${xml(caption)}</text>
<text x="550" y="600" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#888">Demo placeholder screenshot</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Pretend agents for `npm run demo`: realistic-looking terminal output, browser testing and the odd raised hand. */
export class DemoRunner implements AgentRunner {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  start(req: RunRequest, hooks: RunHooks): AgentSession {
    const inbox: string[] = [];
    let stopped = false;
    let finished = false;
    const abort = new AbortController();

    const wait = async (min: number, max: number) => {
      await sleep(((min + Math.random() * (max - min)) * 1000) / this.speed);
      if (stopped) throw new Error('stopped');
    };
    const tool = async (name: string, input: Record<string, unknown>, output: string[] = []) => {
      const r = renderToolUse(name, input, '/work');
      hooks.lines(r.lines);
      if (r.activity || r.status) hooks.activity(r.status ?? null, r.activity ?? '');
      await wait(1.2, 3.2);
      if (output.length) {
        hooks.lines(output.slice(0, 4).map((text, i) => ({ kind: 'output', text: `  ${i === 0 ? '⎿' : ' '}  ${text}` })));
      }
    };
    const say = async (text: string) => {
      hooks.lines(renderText(text));
      hooks.activity(null, text.split('\n')[0].slice(0, 80));
      await wait(1, 2.5);
    };
    const think = async () => {
      hooks.lines([{ kind: 'thinking', text: '✻ Thinking…' }]);
      hooks.activity('working', 'Thinking…');
      await wait(1.5, 3.5);
    };

    const titleMatch = /issue #(\d+) in (\S+)\.\s*\n\s*\nTitle: (.+)/.exec(req.prompt);
    const issueNumber = Number(titleMatch?.[1] ?? 0);
    const repo = titleMatch?.[2] ?? 'demo/app';
    const title = titleMatch?.[3]?.trim() ?? 'the task';
    const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
    const files = FILES[kind];
    const accent = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#c879ff'][issueNumber % 4];

    // a cloud agent pushes its own branch: that's how its work reaches the office
    const push = async () => {
      if (req.cloud) await tool('Bash', { command: `git push origin HEAD:${req.cloud.branch}` }, [`To github.com:${repo}.git`, `   4f2a91c..9e1d0b7  HEAD -> ${req.cloud.branch}`]);
    };

    const handleInbox = async () => {
      while (inbox.length) {
        const message = inbox.shift()!;
        await think();
        await say(`Good call – ${message.length > 60 ? 'I\'ll take that into account' : `"${message}"`}. Updating my changes.`);
        const file = pick(files, 1)[0];
        await tool('Edit', { file_path: `/work/${file}`, old_string: '// TODO: handle edge case', new_string: '// Handles the edge case the manager pointed out\nif (!input) return fallback;' }, ['Updated 1 file']);
        await tool('Bash', { command: 'npm test' }, ['Tests: 44 passed, 44 total']);
        await tool('Bash', { command: 'git commit -am "Address manager feedback"' }, ['[branch 4f2a91c] Address manager feedback', ' 1 file changed, 3 insertions(+)']);
        await push();
      }
    };

    // the QA officer: review the diff, run the tests, click through the UI, report a verdict
    const qaScript = async (): Promise<RunOutcome> => {
      hooks.session(req.resumeSessionId ?? `demo-qa-${randomBytes(4).toString('hex')}`);
      hooks.lines([{ kind: 'system', text: '✻ Claude Code (demo) · pretend model · QA' }]);
      const match = /pull request #(\d+) in (\S+): (.+)/.exec(req.prompt);
      const pr = Number(match?.[1] ?? 0);
      const prRepo = match?.[2] ?? repo;
      const prTitle = match?.[3]?.trim() ?? 'the change';
      const prKind = /api/.test(prRepo) ? 'api' : /game|dodger/.test(prRepo) ? 'game' : 'web';
      const changed = pick(FILES[prKind], 2);
      // every third PR has a problem the first time round; a re-test, or a re-check after a message, finds it fixed. Every
      // sixth (PR 9, 15, …) is stubborn: QA keeps failing it until the operations officer looks into why it's stuck
      const retest = /This is a re-test/.test(req.prompt);
      const stubborn = pr % 6 === 3 && !/operations officer/.test(req.prompt);
      const fails = !req.resumeSessionId && (stubborn || (!retest && pr % 3 === 0));
      if (req.resumeSessionId) {
        await say('Re-checking after your message.');
      } else if (retest) {
        const since = /git diff (\w+)\.\.HEAD/.exec(req.prompt)?.[1] ?? 'last round';
        await say(`Re-test of PR #${pr}: checking last round's findings first, then what changed since ${since}.`);
        await tool('Bash', { command: `git diff ${since}..HEAD --stat` }, [`${changed[0]} | 6 ++++--`, '1 file changed']);
      } else {
        await say(`I'll review PR #${pr} and test it against the linked issue.`);
        await tool('Bash', { command: 'git diff origin/main...HEAD --stat' }, [`${changed[0]} | 24 ++++--`, `${changed[1]} | 9 +++`, '2 files changed']);
        for (const file of changed) await tool('Read', { file_path: `/work/${file}` }, [`Read ${60 + Math.floor(Math.random() * 120)} lines`]);
        await think();
      }
      const captions = prKind === 'api' ? [] : [
        `${prTitle}: the page loads with the change`,
        fails ? 'With an empty list the page goes blank' : `${prKind === 'game' ? 'Playing' : 'Checking out'} works end to end`,
      ];
      await tool('Bash', { command: 'npm ci' }, ['added 412 packages in 9s']);
      await tool('Bash', { command: prKind === 'api' ? 'npm test' : 'npx vitest run' }, [`Tests  ${30 + pr} passed`]);
      await tool('Bash', { command: 'npx tsc --noEmit' }, ['(no output)']);
      if (prKind !== 'api') {
        await tool('Bash', { command: 'npm run dev &', run_in_background: true }, ['VITE ready on http://localhost:5173']);
        const pages = ['/', prKind === 'game' ? '/play' : '/cart'];
        for (let step = 0; step < 2; step++) {
          const url = `http://localhost:5173${pages[step]}`;
          await tool(`mcp__browser__${step === 0 ? 'open' : 'click'}`, step === 0 ? { url } : { text: prKind === 'game' ? 'Start' : 'Checkout' }, [`URL: ${url}`, '[screenshot]']);
          hooks.browser({ url, title: prTitle.slice(0, 40), mock: { heading: `QA: ${prTitle}`, accent: '#4f8fd6', step }, at: Date.now() });
          await wait(1.5, 3);
          await tool('mcp__browser__screenshot', {}, ['Screenshot', `URL: ${url}`, '[screenshot]']);
          hooks.screenshot({ url, title: prTitle.slice(0, 40), image: placeholderShot(url, prTitle, captions[step], fails && step === 1 ? '#c94f4f' : '#4f8fd6'), at: Date.now() });
        }
        await tool('mcp__browser__console', {}, [fails ? 'TypeError: Cannot read properties of undefined (reading \'length\')' : '(no console output)']);
      }
      const report = {
        verdict: fails ? 'fail' : 'pass',
        summary: fails
          ? `The happy path works, but the change breaks when the list is empty: the page throws in ${changed[0]} and renders nothing. Tests and type checks pass, so nothing covers that case yet.`
          : `${prTitle} works as the issue describes. Tests, type checks and a click-through in the browser all pass, and I found nothing in the diff to worry about.`,
        checks: [
          { name: 'Does what the issue asks', result: 'pass', details: `Exercised "${prTitle}" end to end.` },
          { name: 'Empty state', result: fails ? 'fail' : 'pass', details: fails ? `With nothing saved, ${changed[0]} reads .length of undefined and the page goes blank.` : 'Shows a friendly empty message.' },
          { name: 'Code review', result: 'pass', details: `Read the diff in ${changed.join(' and ')}: no leftover debug code, errors handled.` },
          { name: 'Tests cover the new logic', result: fails ? 'fail' : 'pass', details: fails ? 'No test for the empty case.' : 'New tests cover the main path and the empty case.' },
        ],
        commands: [
          { command: 'npm ci', result: 'ok' },
          { command: prKind === 'api' ? 'npm test' : 'npx vitest run', result: `${30 + pr} passed, 0 failed` },
          { command: 'npx tsc --noEmit', result: 'no errors' },
        ],
        screenshots: captions,
        fixInstructions: fails ? `Guard the empty case in \`${changed[0]}\` (treat a missing list as []), show the empty message instead, and add a test for it.` : undefined,
      };
      await say(fails ? 'Found a problem with the empty state. Writing up the report.' : 'All good. Writing up the report.');
      return { ok: true, summary: JSON.stringify(report), structured: report };
    };

    const script = async (): Promise<RunOutcome> => {
      if (req.outputSchema) return qaScript();
      const sessionId = req.resumeSessionId ?? `${req.cloud ? 'session_demo' : 'demo-'}${randomBytes(4).toString('hex')}`;
      hooks.session(sessionId);
      hooks.lines([{ kind: 'system', text: `✻ Claude Code (demo) · pretend model · acceptEdits${req.cloud ? ' · ☁ cloud' : ''}` }]);
      if (req.cloud) hooks.lines([{ kind: 'system', text: `☁ Cloud session: https://claude.ai/code/${sessionId}` }]);
      // a follow-up message, or QA's findings handed to an agent seated on the PR to fix them
      if (req.resumeSessionId || /^QA failed/.test(req.prompt)) {
        inbox.unshift(req.prompt);
        await handleInbox();
        await say('All set. The pull request has been updated with these changes.');
        return { ok: true, summary: 'Addressed the manager\'s feedback.' };
      }

      await say(`I'll start by getting familiar with the codebase for "${title}".`);
      await tool('Glob', { pattern: 'src/**/*.{ts,tsx}' }, [`Found ${12 + (issueNumber % 7)} files`]);
      for (const file of pick(files, 2)) {
        await tool('Read', { file_path: `/work/${file}` }, [`Read ${40 + Math.floor(Math.random() * 160)} lines`]);
      }
      await think();
      await tool('TodoWrite', {
        todos: [
          { content: 'Understand the current behaviour', status: 'completed' },
          { content: `Implement: ${title}`, status: 'in_progress' },
          { content: 'Add tests', status: 'pending' },
          { content: kind === 'api' ? 'Run the test suite' : 'Check it in the browser', status: 'pending' },
        ],
      });
      await handleInbox();

      for (const file of pick(files, 2)) {
        await tool('Edit', {
          file_path: `/work/${file}`,
          old_string: 'export function render(state) {\n  return view(state);',
          new_string: `export function render(state) {\n  // ${title}\n  return view(withFix(state));`,
        }, ['Updated 1 file']);
      }
      await tool('Write', {
        file_path: `/work/test/issue-${issueNumber}.test.ts`,
        content: `import { describe, it, expect } from 'vitest';\n\ndescribe('${title.replace(/'/g, '')}', () => {\n  it('works', () => {\n    expect(run()).toBe(true);\n  });\n});`,
      }, ['Created file']);

      if (issueNumber % 4 === 2) {
        hooks.lines([{ kind: 'tool', text: '⏺ Bash(rm -rf dist && npm run build)' }]);
        const ok = await hooks.permission('Bash', 'Bash(rm -rf dist && npm run build)', abort.signal);
        if (stopped) throw new Error('stopped');
        hooks.activity('working', ok ? 'Rebuilding' : 'Finding another way');
        hooks.lines([{ kind: ok ? 'output' : 'error', text: ok ? '  ⎿  built in 2.31s' : '  ⎿  Declined by the captain' }]);
        await wait(1, 2);
      }

      await tool('Bash', { command: kind === 'api' ? 'npm test' : 'npx vitest run' }, [
        `✓ test/issue-${issueNumber}.test.ts (3 tests)`,
        `Test Files  ${6 + (issueNumber % 3)} passed`,
        `Tests  ${41 + issueNumber} passed`,
      ]);

      if (kind !== 'api') {
        await tool('Bash', { command: 'npm run dev &', run_in_background: true }, ['VITE ready on http://localhost:5173']);
        const pages = ['/', kind === 'game' ? '/play' : '/products/42', kind === 'game' ? '/scores' : '/cart'];
        for (let step = 0; step < 3; step++) {
          const url = `http://localhost:5173${pages[step]}`;
          if (req.cloud) {
            // in the cloud there's no office browser: a Playwright script saves a screenshot, and reading it puts it on the laptop
            const file = `/tmp/shots/${step + 1}.png`;
            await tool('Bash', { command: `node shot.mjs ${url} ${file}` }, [`Saved ${file}`]);
            await tool('Read', { file_path: file }, ['[screenshot]']);
            hooks.browser({ url, title: `${step + 1}.png`, mock: { heading: title, accent, step }, at: Date.now() });
            hooks.activity('testing', `Checking a screenshot of ${url}`);
          } else {
            const name = step === 0 ? 'open' : step === 1 ? 'click' : 'screenshot';
            await tool(`mcp__browser__${name}`, step === 1 ? { text: 'Add to cart' } : { url }, [`URL: ${url}`, '[screenshot]']);
            hooks.browser({ url, title: title.slice(0, 40), mock: { heading: title, accent, step }, at: Date.now() });
          }
          await wait(1.5, 3);
        }
      }
      await handleInbox();
      await tool('Bash', { command: `git add -A && git commit -m "${title.replace(/"/g, '')} (#${issueNumber})"` }, [
        `[focus/issue-${issueNumber} a1b2c3d] ${title}`,
        ' 3 files changed, 58 insertions(+), 9 deletions(-)',
      ]);
      await push();
      const summary = `## Summary\n\nResolves "${title}".\n\n- Updated ${pick(files, 2).join(' and ')}\n- Added tests in \`test/issue-${issueNumber}.test.ts\`\n\n## Testing\n\n- \`npm test\` passes${kind !== 'api' ? '\n- Checked the flow in the browser' : ''}`;
      await say('Done! Committed the change with tests. Summary for the pull request:');
      hooks.lines(summary.split('\n').map((text) => ({ kind: 'text', text: `  ${text}` })));
      return { ok: true, summary };
    };

    const done = script()
      .catch((err): RunOutcome => (stopped ? { ok: false, summary: '', error: STOPPED_BY_CAPTAIN, aborted: true } : { ok: false, summary: '', error: String(err) }))
      .finally(() => {
        finished = true;
      });

    return {
      send: (text) => {
        if (finished) return false;
        inbox.push(text);
        return true;
      },
      stop: () => {
        stopped = true;
        abort.abort();
      },
      done,
    };
  }
}

/** Demo agents don't touch git. */
export const demoWorkspace: WorkspaceOps = {
  create: async (_repo, agentId) => `/demo/${agentId}`,
  remove: async () => undefined,
  dir: (agentId) => `/demo/${agentId}`,
  hasUncommittedChanges: async () => false,
  commitsAhead: async () => 2,
  // demo agents always commit something, so every session ends on a new commit
  head: async () => randomBytes(5).toString('hex'),
  push: async () => sleep(800),
  publish: async () => sleep(400),
  pull: async () => sleep(400),
  // no real checkout: the manager falls back to the PR's head as GitHub reports it
  checkoutPullRequest: async () => {
    await sleep(600);
    return '';
  },
};

/** The demo planner's judgement of an idea too big for one issue: a rebuild, or a list of three or more features. */
export function demoTooBig(idea: string): string | undefined {
  const rebuild = /\b(rebuild|rewrite|overhaul|redesign|replatform|migrate)\b/i.exec(idea);
  const features = idea.split(/,|\band\b|\bplus\b/i).filter((part) => part.trim()).length;
  if (rebuild && features >= 3) return `A ${rebuild[0].toLowerCase()} with ${features} separate features is several issues' worth of work.`;
  if (rebuild) return `A ${rebuild[0].toLowerCase()} is more than one agent can finish in one sitting.`;
  if (features >= 3) return `That's ${features} separate features, more than one agent can build in one sitting.`;
  return undefined;
}

/** The demo planner: pretends to read the code, then writes a plausible issue from the idea. */
export class DemoDrafter implements Drafter {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async draft(req: DraftRequest, activity: (text: string) => void): Promise<DraftResult> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Discarded');
    };
    const idea = req.idea || req.revise?.title || 'the change';
    const backend = /\b(api|endpoint|server|order|auth|login|rate|database|email)\b/i.test(idea);
    const repo = req.revise?.repo ?? (req.repos.find((r) => (backend ? /api|server|backend/ : /web|front|app|game|dodger/).test(r)) ?? req.repos[0]);
    const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
    const files = pick(FILES[kind], 3);
    const folder = repo.split('/')[1];

    activity('Pulling the latest code');
    await wait(1);
    if (req.revise) {
      activity('Rereading my draft');
      await wait(1.5);
      activity(`Reading ${folder}/${files[0]}`);
      await wait(2);
      activity('Thinking…');
      await wait(2);
      const note = req.revise.notes.trim().replace(/\.$/, '');
      const body = req.revise.body.replace(/\n+## Out of scope/, `\n- [ ] ${note.charAt(0).toUpperCase()}${note.slice(1)}\n\n## Out of scope`);
      return { repo, title: req.revise.title, body, tooBig: demoTooBig(req.idea), sessionId: req.resumeSessionId, costUsd: 0.04 };
    }
    for (const step of [`Reading ${folder}/CLAUDE.md`, `Searching ${folder} for related code`, ...files.map((f) => `Reading ${folder}/${f}`), 'Thinking…']) {
      activity(step);
      await wait(1.6 + Math.random() * 1.4);
    }
    const clean = idea.replace(/\s+/g, ' ').trim().replace(/[.!]$/, '');
    const title = clean.charAt(0).toUpperCase() + clean.slice(1, 70);
    const body = [
      '## Context',
      '',
      `The captain asked for: "${clean}". Today the relevant behaviour lives in \`${files[0]}\`, with supporting code in \`${files[1]}\`.`,
      '',
      '## What to build',
      '',
      `- ${title}, following the existing patterns in \`${files[0]}\`.`,
      `- Keep the change contained to ${folder}; update \`${files[2]}\` only where it has to change.`,
      '',
      '## Acceptance criteria',
      '',
      `- [ ] ${title} works end to end${kind === 'api' ? ' (covered by a test against the endpoint)' : ' in the browser'}.`,
      '- [ ] Empty and error states are handled (no blank screen or unhandled exception).',
      kind === 'api' ? '- [ ] Invalid input returns a 4xx with a helpful message.' : '- [ ] It looks right at phone width (375px).',
      '- [ ] Existing tests still pass, and new behaviour has a test.',
      '',
      '## Out of scope',
      '',
      '- Redesigning anything beyond what this change needs.',
      '',
      '## Assumptions',
      '',
      `- This belongs in ${repo}${req.repos.length > 1 ? ' rather than the other repos in the project' : ''}.`,
    ].join('\n');
    return { repo, title, body, tooBig: demoTooBig(idea), sessionId: `demo-plan-${randomBytes(3).toString('hex')}`, costUsd: 0.11 };
  }
}

/** The phone-width check the demo officer proposes, and the testable rewrite the demo QA officer suggests for it. */
const PHONE_CHECK = 'Works at phone width (375px)';
const PHONE_CHECK_REWRITE = 'At 375px wide nothing scrolls sideways and every button can be tapped';

/** The repo a demo briefing is about, and the made-up files it talks about. */
function demoCode(repos: string[]): { repo: string; files: string[]; folder: string } {
  const repo = repos.find((r) => /web|front|app|game|dodger/.test(r)) ?? repos[0];
  const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
  return { repo, files: FILES[kind], folder: repo.split('/')[1] };
}

/**
 * The demo Number One: reads the ship's real (demo) state for "what's going on", pretends to read a project's code or an
 * agent's worktree, and suggests work when the captain sounds like they want something built.
 */
export class DemoNumberOne implements NumberOneOfficer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    };
    const asked = req.messages.filter((m) => m.from === 'manager').at(-1)?.text.replace(/\s+/g, ' ').trim() ?? '';
    const q = asked.toLowerCase();
    const said = (text: string, spoken: string, costUsd = 0.04): NumberOneReply => ({ text, spoken, sessionId: req.resumeSessionId ?? `demo-one-${randomBytes(3).toString('hex')}`, costUsd });
    const project = req.projects.find((p) => q.includes(p.name.toLowerCase()) || p.repos.some((r) => q.includes(r.split('/')[1]))) ?? req.projects.find((p) => p.repos.length);
    activity('Thinking…');
    await wait(1);

    if (/going on|status|stuck|happening|needs me|who'?s/.test(q)) {
      activity('Checking the ship’s status');
      const ship = await req.shipStatus();
      await wait(1.2);
      const rooms = ship.projects.map((p) => {
        const working = p.agents.filter((a) => a.task !== 'review').map((a) => `${a.name} on ${a.issue} (${a.activity})`);
        const prs = p.prs.map((pr) => `#${pr.number} ${pr.qa}`);
        const needs = p.needsCaptain.length ? `Needs you: ${p.needsCaptain.join('; ')}.` : 'Nothing needs you there.';
        return `**${p.name}**: ${working.length ? working.join(', ') : 'nobody at a desk'}. ${prs.length ? `Open PRs: ${prs.join(', ')}.` : 'No open PRs.'} ${needs}`;
      });
      const waiting = ship.projects.reduce((n, p) => n + p.needsCaptain.length, 0);
      return said(rooms.join('\n\n') || 'There are no projects aboard yet.', waiting ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you, Captain. The details are on screen.` : 'All quiet, Captain. Nothing needs you right now.');
    }

    const agent = (await req.shipStatus()).projects.flatMap((p) => p.agents).find((a) => q.includes(a.name.toLowerCase().replace(/^(lt\.|ensign) /, '')));
    if (agent && /done|so far|progress|up to/.test(q)) {
      activity(`Reading ${agent.worktree ?? 'their branch'}`);
      await wait(1.5);
      const { files } = demoCode([agent.repo]);
      return said(
        `${agent.name} is on ${agent.issue}. In their worktree (\`${agent.worktree ?? 'cloud'}\`) they've changed \`${files[0]}\` and \`${files[4]}\` so far, and added a test next to it. It's half-finished: ${agent.activity.toLowerCase()}.`,
        `${agent.name} has made a start on two files and a test. It's not done yet.`,
      );
    }

    if (project && /how does|where|work|code|file|read/.test(q)) {
      const { files, folder } = demoCode(project.repos);
      activity(`Pulling the latest code of ${project.name}`);
      await wait(1.5);
      for (const file of [files[0], files[4]]) {
        activity(`Reading ${project.id}/${folder}/${file}`);
        await wait(1.2);
      }
      return said(
        `In ${project.name}, it starts in \`${folder}/${files[0]}\`, which hands off to \`${folder}/${files[4]}\` for the state. \`${folder}/${files[1]}\` only renders what it's given.`,
        `It starts in the app's entry point and keeps its state in one module. The files are on screen.`,
        0.07,
      );
    }

    if (project && /should we|could we|we need|let'?s|add|build|want/.test(q)) {
      return {
        ...said(
          `That sounds like work for ${project.name}. I'd start with a draft at the stand; if it turns out bigger than one issue, call a briefing instead.`,
          `That's one for ${project.name}. Want me to send it to the stand, or call a briefing?`,
        ),
        suggest: { projectId: project.id, idea: asked },
      };
    }

    return said(
      `Happy to think it through, Captain. Ask me how something works in ${project?.name ?? 'any project'}, what's going on aboard, or what an agent has done so far.`,
      'Happy to think it through, Captain.',
    );
  }
}

/** The demo briefing officer: asks the usual questions in order, filling the brief with your answers. */
export class DemoOfficer implements BriefingOfficer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async turn(req: OfficerTurn, hooks: OfficerHooks): Promise<OfficerReply> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    };
    const { repo, files, folder } = demoCode(req.repos);
    const idea = req.idea.replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '');
    const answers = req.messages.filter((m) => m.from === 'manager').slice(1).map((m) => m.text.replace(/\s+/g, ' ').trim());
    const last = answers[answers.length - 1] ?? '';
    const line = (text: string) => (text.length > 140 ? `${text.slice(0, 139)}…` : text);
    let brief = req.brief;
    const update = (patch: Parameters<typeof mergeBrief>[1]) => {
      brief = mergeBrief(brief, patch);
      hooks.brief(brief);
    };
    const session = req.resumeSessionId ?? `demo-brief-${randomBytes(3).toString('hex')}`;
    const today = { title: 'Today', mermaid: `flowchart TD\n  U["${files[1]}"] -->|"renders"| A["${files[0]}"]\n  A -->|"reads and writes"| S["${files[4]}"]` };
    const optionA = { title: 'Option A: extend the existing module', mermaid: `flowchart TD\n  A["${files[0]}"] -->|"new calls"| S["${files[4]}"]\n  S -->|"persists"| P[("localStorage")]` };
    const optionB = { title: 'Option B: a module of its own', mermaid: `flowchart TD\n  A["${files[0]}"] -->|"uses"| N["new module"]\n  N -->|"reads"| S["${files[4]}"]` };

    if (req.goal) {
      const said = (text: string, costUsd = 0.05) => ({ text, sessionId: session, costUsd });
      const steps = req.goal.steps;
      if (req.kind === 'open') {
        for (const step of ['Pulling the latest code', `Reading ${folder}/CLAUDE.md`, `Reading ${folder}/${files[0]}`]) {
          hooks.activity(step);
          await wait(1.4);
        }
        hooks.activity('Updating the brief');
        update({ summary: idea, open_questions: [`Can \`${files[4]}\` carry it as it is?`] });
        await wait(1);
        return said(`I've had a look around \`${folder}/${files[0]}\`. Before we go anywhere: who's this for, and what would you see once it's done? My guess is returning users, finding what they meant to come back to.`, 0.08);
      }
      if (req.kind === 'step') {
        hooks.activity('Rereading the unknowns');
        await wait(1.5);
        hooks.activity(`Reading ${folder}/${files[4]}`);
        await wait(1.5);
        hooks.activity(`Writing up step ${steps.length + 1}`);
        await wait(1.5);
        const unknown = brief.openQuestions[0] ?? `whether \`${files[4]}\` can carry it`;
        const first = !steps.length;
        const title = `${first ? 'Thinnest slice' : 'Next slice'}: ${idea}`.slice(0, 70);
        const body = [
          '## Testing',
          '',
          first ? `${unknown} The thinnest slice that touches it will tell us.` : `Whether what step ${steps.length} built holds up once people use it from \`${files[1]}\`.`,
          '',
          '## Why now',
          '',
          first ? "It's the riskiest unknown: if it doesn't hold, the route changes." : `Step ${steps.length} landed, so the next unknown is how it feels in use.`,
          '',
          '## What to build',
          '',
          first ? `- Store and load ${idea} in \`${files[4]}\`, with the simplest possible UI in \`${files[0]}\`.` : `- Show ${idea} in \`${files[1]}\`, reusing what step ${steps.length} added.`,
          '',
          '## Done when',
          '',
          `- [ ] ${brief.acceptance[0] ?? `${idea} works end to end`}`,
          '- [ ] Existing tests still pass, and the new behaviour has a test',
          '',
          '## Not in this step',
          '',
          '- Polish, settings and anything the next step might change',
        ].join('\n');
        return { text: '', sessionId: session, costUsd: 0.12, step: { repo, title, body } };
      }
      if (req.kind === 'reconvene') {
        hooks.activity('Pulling the latest code');
        await wait(1.4);
        const landed = steps.at(-1)?.outcome === 'merged';
        if (!landed) return said(`It hasn't landed yet: ${steps.length ? `step ${steps.length} is still with the crew` : 'nothing filed so far'}. What's on your mind, do you want to rethink it?`);
        hooks.activity(`Reading what landed in ${folder}/${files[4]}`);
        await wait(1.5);
        hooks.activity('Updating the brief');
        update({ open_questions: [`Will people find it from \`${files[1]}\`?`, ...brief.openQuestions.slice(1)] });
        await wait(0.8);
        return said(`It landed, and it answered our first question: \`${files[4]}\` carries it without a new table. That moves the risk to whether people find it, so I'd make the next step about \`${files[1]}\`. Or, if that's enough for you, I think we're close to done. Take the next step?`);
      }
      hooks.activity('Thinking it over');
      await wait(1.5);
      const step = answers.length;
      hooks.activity('Updating the brief');
      await wait(0.8);
      if (step === 1) {
        update({ who: line(last), acceptance: [line(last)] });
        return said("That's where we're going, and I've put it on the screen as what we'd see once it's done. Why now: what goes wrong for people today?");
      }
      if (step === 2) {
        update({ why: line(last) });
        return said(`Got it. The riskiest unknown I can see is whether \`${files[4]}\` can carry it as it is, so I'd make the first step the thinnest slice end to end that finds out. Shall we take it?`);
      }
      return said(`Noted. Take the ${steps.length ? 'next' : 'first'} step whenever you're ready.`, 0.03);
    }

    if (req.kind === 'wrap-up') {
      hooks.activity('Rereading the brief');
      await wait(1.5);
      hooks.activity(`Reading ${folder}/${files[0]}`);
      await wait(1.5);
      hooks.activity('Writing up the issue');
      await wait(2);
      const title = (brief.summary || idea).replace(/^./, (c) => c.toUpperCase()).slice(0, 70);
      const list = (items: string[], check = false) => (items.length ? items : ['(none agreed)']).map((i) => `- ${check ? '[ ] ' : ''}${i}`).join('\n');
      const body = [
        '## Context',
        '',
        `${brief.why ? `${brief.why.replace(/\.?$/, '.')}` : `The captain wants: ${idea}.`}${brief.who ? ` It's for ${brief.who.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '')}.` : ''}`,
        '',
        `The relevant code lives in \`${files[0]}\` and \`${files[1]}\`. Agreed in a briefing in the observation lounge.`,
        '',
        ...(brief.approach
          ? ['### Approach', '', `Picked from engineering's options: ${optionText(brief.approach)}`, '']
          : brief.diagrams
              .filter((d) => d.title.startsWith('Chosen'))
              .flatMap((d) => ['### Approach', '', `${d.title.replace(/^Chosen: (.)/, (_, c: string) => c.toUpperCase())}, because it keeps the change in one place and needs no new wiring.`, '', '```mermaid', d.mermaid, '```', ''])),
        '## What to build',
        '',
        list(brief.scope.length ? brief.scope : [idea]),
        '',
        '## Acceptance criteria',
        '',
        list([...brief.acceptance, 'Existing tests still pass, and the new behaviour has tests'], true),
        '',
        '## Out of scope',
        '',
        list(brief.outOfScope),
      ].join('\n');
      return { text: '', sessionId: session, costUsd: 0.18, draft: { repo, title, body } };
    }

    if (req.kind === 'break-down') {
      hooks.activity('Rereading the brief');
      await wait(1.5);
      hooks.activity(`Searching ${folder} for where each piece would go`);
      await wait(1.5);
      hooks.activity('Breaking it down');
      await wait(2);
      const title = (brief.summary || idea).replace(/^./, (c) => c.toUpperCase()).slice(0, 70);
      const list = (items: string[], check = false) => (items.length ? items : ['(none agreed)']).map((i) => `- ${check ? '[ ] ' : ''}${i}`).join('\n');
      const epic = [
        '## Why',
        '',
        `${brief.why ? brief.why.replace(/\.?$/, '.') : `The captain wants: ${idea}.`}${brief.who ? ` It's for ${brief.who.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '')}.` : ''}`,
        '',
        '## Scope',
        '',
        list(brief.scope.length ? brief.scope : [idea]),
        '',
        '## Acceptance criteria',
        '',
        list(brief.acceptance, true),
        '',
        '## Out of scope',
        '',
        list(brief.outOfScope),
        ...(brief.approach ? ['', '## Approach', '', `Picked from engineering's options: ${optionText(brief.approach)}`] : []),
      ].join('\n');
      // the first piece is the foundation the second builds on; the rest can go side by side
      const pieces = [`Store and load ${idea}`, `Show ${idea} in the UI`, `Tests and edge cases for ${idea}`];
      const parts = (brief.scope.length >= 2 ? brief.scope : pieces).slice(0, 5);
      const sub = (part: string, i: number) => ({
        title: part.replace(/^./, (c) => c.toUpperCase()).slice(0, 70),
        body: [
          '## Context',
          '',
          `Part of the briefing on ${idea}. The relevant code lives in \`${files[i % files.length]}\`.`,
          '',
          '## What to build',
          '',
          `- ${part}`,
          '',
          '## Acceptance criteria',
          '',
          list([`${part} works end to end`, 'Existing tests still pass, and the new behaviour has tests'], true),
          '',
          '## Out of scope',
          '',
          '- The other parts of the epic',
        ].join('\n'),
        depends_on: i === 1 ? [1] : [],
      });
      const breakdown = asBreakdown({ repo, epic: { title, body: epic }, sub_issues: parts.map(sub) }, req.repos);
      return { text: '', sessionId: session, costUsd: 0.24, breakdown };
    }

    if (req.kind === 'open') {
      for (const step of ['Pulling the latest code', `Reading ${folder}/CLAUDE.md`, `Reading ${folder}/${files[0]}`, `Searching ${folder} for related code`]) {
        hooks.activity(step);
        await wait(1.4);
      }
      hooks.activity('Updating the brief');
      update({ summary: idea, open_questions: ['Who is this for?', 'What goes wrong for them today?', 'What tells us it worked?', 'What should we leave out?'], diagrams: [today] });
      await wait(1);
      return {
        text: `I've had a look: today this lives around \`${folder}/${files[0]}\`. Before I write anything down, who is this for, and what's going wrong for them today? My guess is returning users who lose track of something they meant to come back to.`,
        spoken: `I've had a look at the code. Who is this for, and what's going wrong for them today?`,
        sessionId: session,
        costUsd: 0.09,
      };
    }

    hooks.activity('Thinking it over');
    await wait(1.5);
    const step = answers.length;
    hooks.activity('Updating the brief');
    await wait(0.8);
    if (step === 1) {
      update({ who: line(last), open_questions: brief.openQuestions.slice(1) });
      return {
        text: `That narrows it. What goes wrong for them today, and why fix it now? I'd guess they lose track of things they meant to come back to, and some never do.`,
        spoken: `That narrows it. What goes wrong for them today, and why fix it now?`,
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 2) {
      update({ why: line(last), open_questions: brief.openQuestions.slice(1) });
      return {
        text: `Clear. What would tell us it's working? I'd suggest something checkable, like "it's still there after a reload, and on another device once signed in".`,
        spoken: `Clear. What would tell us it's working?`,
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 3) {
      update({ acceptance: [line(last), PHONE_CHECK], scope: [line(idea.replace(/^./, (c) => c.toUpperCase()))], open_questions: brief.openQuestions.slice(1), diagrams: [today, optionA, optionB] });
      return {
        text: `Noted, and I've added a phone-width check since \`${files[1]}\` has its own mobile layout. I've put two designs on the screen: A extends \`${files[4]}\` (smallest change, but that file grows), B gives it a module of its own (cleaner, more wiring). I'd go with A, but if you'd like a proper look at the how, ask engineering. And what should we leave out of this first version? I'd keep sharing and notifications for later.`,
        spoken: `Noted. I've put two designs on the screen and I'd go with A. What should we leave out of this first version?`,
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 4) {
      // QA's note came after the officer's last reply: take their rewrite on board
      const qaSpoke = req.messages.slice(req.messages.map((m) => m.from).lastIndexOf('officer')).some((m) => m.from === 'qa');
      const acceptance = qaSpoke ? brief.acceptance.map((a) => (a === PHONE_CHECK ? PHONE_CHECK_REWRITE : a)) : brief.acceptance;
      update({ out_of_scope: [line(last)], open_questions: [], acceptance, diagrams: [today, { ...optionA, title: optionA.title.replace(/^Option A/, 'Chosen') }] });
      const taken = qaSpoke ? ` I've swapped in ${qaOfficerFor(req.projectId).name}'s rewrite of the phone-width check; say if you'd rather keep it loose.` : '';
      return { text: `That's everything I needed: I've kept Option A on the screen as the chosen design, and nothing important is still open.${taken} Anything to add, or shall we wrap up?`, spoken: `That's everything I needed. Anything to add, or shall we wrap up?`, sessionId: session, costUsd: 0.04 };
    }
    update({ scope: [...brief.scope, line(last)] });
    return { text: `Added to the scope. Ready to wrap up whenever you are.`, spoken: `Added. Ready when you are.`, sessionId: session, costUsd: 0.03 };
  }
}

/** The demo QA officer at a briefing: chips in once, on the vague phone-width check, and stays quiet after that. */
export class DemoBriefingQa implements BriefingQa {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async check(req: QaTurn, activity: (text: string) => void): Promise<QaReply> {
    const session = req.resumeSessionId ?? `demo-brief-qa-${randomBytes(3).toString('hex')}`;
    activity('Reading the acceptance criteria');
    await sleep(1500 / this.speed);
    if (req.signal.aborted) throw new Error('Stopped');
    if (req.messages.some((m) => m.from === 'qa') || !req.brief.acceptance.includes(PHONE_CHECK)) return { sessionId: session, costUsd: 0.02 };
    activity(req.qaBrief ? 'Checking them against the QA brief' : 'Thinking how I’d test them');
    await sleep(1200 / this.speed);
    return {
      note: `“${PHONE_CHECK}” is hard to fail: I’d test “${PHONE_CHECK_REWRITE}”.`,
      sessionId: session,
      costUsd: 0.03,
    };
  }
}

/**
 * The demo operations officer at a stuck PR: re-runs a red check, retries QA when its fixes have landed (the demo's
 * stubborn PRs), sends a fix that pushed nothing back with a different plan, and escalates the second time round.
 */
export class DemoTriager implements Triager {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async triage(req: TriageRequest, activity: (text: string) => void): Promise<TriageDecision> {
    const folder = req.repo.split('/')[1];
    const file = /`([^`]+)`/.exec(req.review.report?.fixInstructions ?? '')?.[1] ?? 'src/App.tsx';
    for (const step of ["Reading QA's reports", `Reading ${folder}/${file}`, 'Reading the diff', "Checking GitHub's checks", 'Thinking…']) {
      activity(step);
      await sleep((1500 + Math.random() * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    }
    const red = req.checks[0];
    if (req.review.triage) return { action: 'escalate', note: `I already tried ${req.review.triage.action} and it's still stuck: this needs your call on what ${req.pr.title} should do.` };
    if (red) return { action: 'rerun-checks', note: `${red.name} timed out fetching dependencies, which looks like a runner outage rather than this change.` };
    if (req.review.report && (req.review.failedRounds ?? 0) > 1) {
      return {
        action: 'retry-qa',
        note: `The empty-state guard in \`${file}\` landed in the last fix, but QA keeps testing a stale dev server. Restart it from a clean install before checking the empty state.`,
      };
    }
    return { action: 'send-back', note: `Don't patch the symptom in ${file}: default the list to [] where it's loaded, and add the test QA asked for.` };
  }
}

/** The demo engineer: reads a few files, then lays out three options for the briefing's change, recommending the middle one. */
export class DemoEngineer implements BriefingEngineer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async propose(req: EngineerTurn, activity: (text: string) => void): Promise<EngineerReply> {
    const { files, folder } = demoCode(req.repos);
    for (const step of ['On the way to the lounge', 'Rereading the brief', `Reading ${folder}/CLAUDE.md`, `Reading ${folder}/${files[0]}`, `Reading ${folder}/${files[4]}`, `Searching ${folder} for callers of ${files[4].split('/').pop()}`, 'Weighing the options']) {
      activity(step);
      await sleep(1300 / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    }
    const what = (req.brief.summary || req.idea).replace(/[.!?]$/, '').toLowerCase();
    // sent back with a note: the note becomes a trade-off on the recommended option, so the rework shows on the screen
    const heard = req.request ? [`Reworked for your note: ${req.request}`] : [];
    return {
      report: {
        options: [
          {
            title: 'Extend the existing module',
            approach: `Add ${what} to \`${files[4]}\` and render it from \`${files[0]}\`. No new modules.`,
            touches: [files[4], files[0]],
            tradeoffs: ['Smallest diff, ships fastest', `\`${files[4]}\` keeps growing`],
            risks: ['Mixes two concerns in one file'],
            size: 'one agent',
          },
          {
            title: 'A module of its own',
            approach: `A new module owns ${what}; \`${files[0]}\` calls it and \`${files[4]}\` stays as it is.`,
            touches: [files[0], files[1], 'a new module beside ' + files[4]],
            tradeoffs: [...heard, 'Clear home for the feature, easy to test', 'A little more wiring up front'],
            risks: ['Two places to keep in step until the old path is gone'],
            size: 'one agent',
          },
          {
            title: 'Rework the data layer first',
            approach: `Move persistence out of \`${files[4]}\` into a store every screen shares, then build ${what} on it.`,
            touches: [files[4], files[0], files[1], files[3]],
            tradeoffs: ['Pays down debt the next features need', 'Biggest change by far'],
            risks: ['Touches screens that work today', 'Needs a migration for saved data'],
            size: 'several issues',
          },
        ],
        recommended: 1,
        why: 'it gives the feature a home without the cost of reworking the data layer now.',
      },
      sessionId: req.resumeSessionId ?? `demo-engineer-${randomBytes(3).toString('hex')}`,
      costUsd: 0.12,
    };
  }
}
