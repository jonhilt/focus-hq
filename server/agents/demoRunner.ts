import { randomBytes } from 'node:crypto';
import { sleep } from '../util';
import { renderText, renderToolUse } from './render';
import type { AgentRunner, AgentSession, RunHooks, RunOutcome, RunRequest, WorkspaceOps } from './types';

const FILES: Record<string, string[]> = {
  web: ['src/App.tsx', 'src/components/Header.tsx', 'src/components/CartBadge.tsx', 'src/pages/Product.tsx', 'src/store/cart.ts', 'src/styles/theme.css'],
  api: ['src/server.ts', 'src/routes/auth.ts', 'src/routes/products.ts', 'src/routes/orders.ts', 'src/middleware/rateLimit.ts', 'test/orders.test.ts'],
  game: ['index.html', 'src/game.ts', 'src/ship.ts', 'src/asteroids.ts', 'src/audio.ts', 'src/hud.ts'],
};

const pick = <T>(list: T[], n: number) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

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

    const handleInbox = async () => {
      while (inbox.length) {
        const message = inbox.shift()!;
        await think();
        await say(`Good call – ${message.length > 60 ? 'I\'ll take that into account' : `"${message}"`}. Updating my changes.`);
        const file = pick(files, 1)[0];
        await tool('Edit', { file_path: `/work/${file}`, old_string: '// TODO: handle edge case', new_string: '// Handles the edge case the manager pointed out\nif (!input) return fallback;' }, ['Updated 1 file']);
        await tool('Bash', { command: 'npm test' }, ['Tests: 44 passed, 44 total']);
        await tool('Bash', { command: 'git commit -am "Address manager feedback"' }, ['[branch 4f2a91c] Address manager feedback', ' 1 file changed, 3 insertions(+)']);
      }
    };

    const script = async (): Promise<RunOutcome> => {
      hooks.session(req.resumeSessionId ?? `demo-${randomBytes(4).toString('hex')}`);
      hooks.lines([{ kind: 'system', text: '✻ Claude Code (demo) · pretend model · acceptEdits' }]);
      if (req.resumeSessionId) {
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
        hooks.lines([{ kind: ok ? 'output' : 'error', text: ok ? '  ⎿  built in 2.31s' : '  ⎿  Declined by the manager' }]);
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
          const name = step === 0 ? 'open' : step === 1 ? 'click' : 'screenshot';
          const url = `http://localhost:5173${pages[step]}`;
          await tool(`mcp__browser__${name}`, step === 1 ? { text: 'Add to cart' } : { url }, [`URL: ${url}`, '[screenshot]']);
          hooks.browser({ url, title: title.slice(0, 40), mock: { heading: title, accent, step }, at: Date.now() });
          await wait(1.5, 3);
        }
      }
      await handleInbox();
      await tool('Bash', { command: `git add -A && git commit -m "${title.replace(/"/g, '')} (#${issueNumber})"` }, [
        `[focus/issue-${issueNumber} a1b2c3d] ${title}`,
        ' 3 files changed, 58 insertions(+), 9 deletions(-)',
      ]);
      const summary = `## Summary\n\nResolves "${title}".\n\n- Updated ${pick(files, 2).join(' and ')}\n- Added tests in \`test/issue-${issueNumber}.test.ts\`\n\n## Testing\n\n- \`npm test\` passes${kind !== 'api' ? '\n- Checked the flow in the browser' : ''}`;
      await say('Done! Committed the change with tests. Summary for the pull request:');
      hooks.lines(summary.split('\n').map((text) => ({ kind: 'text', text: `  ${text}` })));
      return { ok: true, summary };
    };

    const done = script()
      .catch((err): RunOutcome => (stopped ? { ok: false, summary: '', error: 'Stopped by the manager', aborted: true } : { ok: false, summary: '', error: String(err) }))
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
  push: async () => sleep(800),
};
