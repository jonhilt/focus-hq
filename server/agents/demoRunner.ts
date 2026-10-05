import { randomBytes } from 'node:crypto';
import { sleep } from '../util';
import type { BriefingOfficer, OfficerHooks, OfficerReply, OfficerTurn } from './briefing';
import { mergeBrief } from './briefing';
import type { Drafter, DraftRequest, DraftResult } from './planner';
import { renderText, renderToolUse } from './render';
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
      // every third PR has a problem the first time round; a re-test, or a re-check after a message, finds it fixed
      const retest = /This is a re-test/.test(req.prompt);
      const fails = !req.resumeSessionId && !retest && pr % 3 === 0;
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
      return { repo, title: req.revise.title, body, sessionId: req.resumeSessionId, costUsd: 0.04 };
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
    return { repo, title, body, sessionId: `demo-plan-${randomBytes(3).toString('hex')}`, costUsd: 0.11 };
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
    const repo = req.repos.find((r) => /web|front|app|game|dodger/.test(r)) ?? req.repos[0];
    const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
    const files = FILES[kind];
    const folder = repo.split('/')[1];
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
        '## What to build',
        '',
        list(brief.scope.length ? brief.scope : [idea]),
        '',
        ...brief.diagrams
          .filter((d) => d.title.startsWith('Chosen'))
          .flatMap((d) => ['## Approach', '', `${d.title.replace(/^Chosen: (.)/, (_, c: string) => c.toUpperCase())}, because it keeps the change in one place and needs no new wiring.`, '', '```mermaid', d.mermaid, '```', '']),
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
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 2) {
      update({ why: line(last), open_questions: brief.openQuestions.slice(1) });
      return {
        text: `Clear. What would tell us it's working? I'd suggest something checkable, like "it's still there after a reload, and on another device once signed in".`,
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 3) {
      update({ acceptance: [line(last), 'Works at phone width (375px)'], scope: [line(idea.replace(/^./, (c) => c.toUpperCase()))], open_questions: brief.openQuestions.slice(1), diagrams: [today, optionA, optionB] });
      return {
        text: `Noted, and I've added a phone-width check since \`${files[1]}\` has its own mobile layout. I've put two designs on the screen: A extends \`${files[4]}\` (smallest change, but that file grows), B gives it a module of its own (cleaner, more wiring). I'd go with A. And what should we leave out of this first version? I'd keep sharing and notifications for later.`,
        sessionId: session,
        costUsd: 0.05,
      };
    }
    if (step === 4) {
      update({ out_of_scope: [line(last)], open_questions: [], diagrams: [today, { ...optionA, title: optionA.title.replace(/^Option A/, 'Chosen') }] });
      return { text: `That's everything I needed: I've kept Option A on the screen as the chosen design, and nothing important is still open. Anything to add, or shall we wrap up?`, sessionId: session, costUsd: 0.04 };
    }
    update({ scope: [...brief.scope, line(last)] });
    return { text: `Added to the scope. Ready to wrap up whenever you are.`, sessionId: session, costUsd: 0.03 };
  }
}
