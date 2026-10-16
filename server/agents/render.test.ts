import { describe, expect, it } from 'vitest';
import { appUrl, renderToolUse, screenshotFrame } from './render';

const png = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } };

describe('appUrl', () => {
  it('takes a browser tool’s url', () => {
    expect(appUrl({ name: 'mcp__playwright__browser_navigate', input: { url: 'http://localhost:5173/cart' } })).toBe('http://localhost:5173/cart');
  });

  it('finds the last local address in a command or script', () => {
    const command = 'npm run dev & sleep 3 && node shot.mjs http://localhost:5173/ http://127.0.0.1:5173/cart';
    expect(appUrl({ name: 'Bash', input: { command } })).toBe('http://127.0.0.1:5173/cart');
    expect(appUrl({ name: 'Write', input: { file_path: '/tmp/shot.mjs', content: "await page.goto('http://localhost:3000/login');" } }))
      .toBe('http://localhost:3000/login');
  });

  it('ignores pages read for research and commands without a local address', () => {
    expect(appUrl({ name: 'WebFetch', input: { url: 'https://vitejs.dev/config' } })).toBeUndefined();
    expect(appUrl({ name: 'Bash', input: { command: 'curl https://registry.npmjs.org/vite' } })).toBeUndefined();
  });
});

describe('screenshotFrame', () => {
  it('turns an image the agent read into a frame, labelled with the page it last opened', () => {
    const frame = screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'Read', input: { file_path: '/tmp/shots/cart.png' } }, 'http://localhost:5173/cart', 42);
    expect(frame).toEqual({ url: 'http://localhost:5173/cart', title: 'cart.png', image: 'data:image/png;base64,iVBORw0KGgo', at: 42 });
  });

  it('falls back to the file it read', () => {
    const frame = screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'Read', input: { file_path: '/tmp/cart.png' } }, undefined, 1);
    expect(frame?.url).toBe('/tmp/cart.png');
  });

  it('reads MCP-shaped images and keeps the last one', () => {
    const content = [
      { type: 'text', text: 'Took 2 screenshots' },
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ];
    const frame = screenshotFrame({ type: 'tool_result', content }, { name: 'mcp__playwright__browser_take_screenshot', input: {} }, undefined, 1);
    expect(frame?.image).toBe('data:image/jpeg;base64,BBBB');
    expect(frame?.url).toBe('mcp__playwright__browser_take_screenshot');
  });

  it('leaves our own browser tool and plain results alone', () => {
    expect(screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'mcp__browser__open', input: { url: 'http://localhost:5173' } }, undefined, 1)).toBeNull();
    expect(screenshotFrame({ type: 'tool_result', content: 'ok' }, { name: 'Bash', input: {} }, undefined, 1)).toBeNull();
    expect(screenshotFrame({ type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }, undefined, undefined, 1)).toBeNull();
  });
});

describe('renderToolUse', () => {
  const texts = (name: string, input: Record<string, unknown>) => renderToolUse(name, input, '/work').lines.map((l) => l.text);

  it('shows a browser call by its action and what it acted on, as testing', () => {
    expect(renderToolUse('mcp__browser__open', { url: 'http://localhost:5173/' }, '/work')).toEqual({
      lines: [{ kind: 'tool', text: '⏺ Browser.open(http://localhost:5173/)' }],
      status: 'testing',
      activity: 'Testing http://localhost:5173/ in the browser',
    });
    expect(renderToolUse('mcp__browser__click', { selector: '#buy' }, '/work').activity).toBe('Testing in the browser (click)');
    expect(texts('mcp__browser__screenshot', {})).toEqual(['⏺ Browser.screenshot()']);
  });

  it('shows a command by its first line', () => {
    const r = renderToolUse('Bash', { command: 'pnpm test\necho done' }, '/work');
    expect(r.status).toBe('working');
    expect(r.activity).toBe('Running pnpm test');
  });

  it('shows paths inside the checkout relative to it, and the checkout itself as .', () => {
    expect(renderToolUse('Read', { file_path: '/work/src/a.ts' }, '/work').activity).toBe('Reading src/a.ts');
    expect(texts('Read', { file_path: '/work' })).toEqual(['⏺ Read(.)']);
    expect(texts('Read', { file_path: '/elsewhere/b.ts' })).toEqual(['⏺ Read(/elsewhere/b.ts)']);
  });

  it('shows the first four lines a write adds and how many more there are', () => {
    const r = renderToolUse('Write', { file_path: '/work/a.ts', content: 'a\nb\nc\nd\ne\nf' }, '/work');
    expect(r.lines.map((l) => l.text)).toEqual(['⏺ Write(a.ts)', '  + a', '  + b', '  + c', '  + d', '  … +2 lines']);
    expect(r.activity).toBe('Writing a.ts');
    expect(texts('Write', { file_path: '/work/a.ts', content: 'a' })).toEqual(['⏺ Write(a.ts)', '  + a']);
    expect(texts('Write', { file_path: '/work/a.ts', content: 'a\nb\nc\nd\ne' }).at(-1)).toBe('  … +1 lines');
  });

  it('shows an edit as what it takes out and puts in, three lines of each', () => {
    const r = renderToolUse('Edit', { file_path: '/work/a.ts', old_string: '1\n2\n3\n4', new_string: 'x' }, '/work');
    expect(r.lines.map((l) => [l.kind, l.text])).toEqual([
      ['tool', '⏺ Update(a.ts)'], ['error', '  - 1'], ['error', '  - 2'], ['error', '  - 3'], ['success', '  + x'],
    ]);
    expect(r.activity).toBe('Editing a.ts');
  });

  it('shows the first two edits of a multi-edit', () => {
    const edits = [1, 2, 3].map((n) => ({ old_string: `old${n}`, new_string: `new${n}` }));
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits })).toEqual(['⏺ MultiEdit(a.ts)', '  - old1', '  + new1', '  - old2', '  + new2']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts' })).toEqual(['⏺ MultiEdit(a.ts)']);
  });

  it('shows searches by their pattern', () => {
    expect(renderToolUse('Glob', { pattern: '**/*.ts' }, '/work')).toMatchObject({ lines: [{ text: '⏺ Glob(**/*.ts)' }], activity: 'Looking for **/*.ts' });
    expect(renderToolUse('Grep', { pattern: 'todo' }, '/work')).toMatchObject({ lines: [{ text: '⏺ Search("todo")' }], activity: 'Searching for "todo"' });
    expect(renderToolUse('WebSearch', { query: 'effect v4' }, '/work')).toMatchObject({ lines: [{ text: '⏺ Web Search(effect v4)' }], activity: 'Searching the web for effect v4' });
    expect(renderToolUse('WebFetch', { url: 'https://example.com' }, '/work')).toMatchObject({ lines: [{ text: '⏺ Fetch(https://example.com)' }], activity: 'Reading https://example.com' });
  });

  it('ticks off todos, and is busy with the one in progress', () => {
    const todos = [
      { content: 'Measure', status: 'completed' },
      { content: 'Fix', status: 'in_progress' },
      { content: 'Prove', status: 'pending' },
    ];
    const r = renderToolUse('TodoWrite', { todos }, '/work');
    expect(r.lines.map((l) => [l.kind, l.text])).toEqual([
      ['tool', '⏺ Update Todos'], ['success', '  ☒ Measure'], ['output', '  ◐ Fix'], ['output', '  ☐ Prove'],
    ]);
    expect(r.activity).toBe('Fix');
    expect(r.status).toBeUndefined();
    expect(renderToolUse('TodoWrite', { todos: [todos[0]] }, '/work').activity).toBeUndefined();
  });

  it('shows a helper by its description, whichever name starts it', () => {
    for (const name of ['Task', 'Agent']) {
      expect(renderToolUse(name, { description: 'Find the tests' }, '/work')).toMatchObject({ lines: [{ text: '⏺ Task(Find the tests)' }], activity: 'Delegating: Find the tests' });
    }
  });

  it('shows any other tool by its first argument', () => {
    expect(renderToolUse('mcp__github__get_issue', { number: 7, repo: 'a/b' }, '/work')).toEqual({
      lines: [{ kind: 'tool', text: '⏺ github__get_issue(7)' }],
      activity: 'Using mcp__github__get_issue',
    });
  });

  // The model's input arrives before Claude Code checks it against the tool's schema, and a throw here ends the session.
  it('renders malformed todos and edits without throwing', () => {
    expect(texts('TodoWrite', { todos: '[{"content":"x","status":"pending"}]' })).toEqual(['⏺ Update Todos']);
    expect(texts('TodoWrite', { todos: [null, { content: 'Fix', status: 'in_progress' }, { status: 'pending' }] })).toEqual(['⏺ Update Todos', '  ◐ Fix']);
    expect(texts('TodoWrite', {})).toEqual(['⏺ Update Todos']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits: 'oops' })).toEqual(['⏺ MultiEdit(a.ts)']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits: [null, { old_string: 'a', new_string: 'b' }] })).toEqual(['⏺ MultiEdit(a.ts)', '  - a', '  + b']);
  });
});
