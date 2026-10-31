import { describe, expect, it } from 'vitest';
import { appUrl, callStep, resultStep, screenshotFrame, toolActivity } from './render';

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

// The lines each call is drawn as are tested with the shared view (shared/stepText.test.ts); here, what it has the session busy with.
describe('toolActivity', () => {
  const act = (name: string, input: Record<string, unknown>) => toolActivity(name, input, '/work');

  it('shows a browser call as testing, by what it opened or did', () => {
    expect(act('mcp__browser__open', { url: 'http://localhost:5173/' })).toEqual({ status: 'testing', activity: 'Testing http://localhost:5173/ in the browser' });
    expect(act('mcp__browser__click', { selector: '#buy' }).activity).toBe('Testing in the browser (click)');
  });

  it('shows a command by its first line', () => {
    expect(act('Bash', { command: 'pnpm test\necho done' })).toEqual({ status: 'working', activity: 'Running pnpm test' });
  });

  it('shows paths inside the checkout relative to it', () => {
    expect(act('Read', { file_path: '/work/src/a.ts' }).activity).toBe('Reading src/a.ts');
    expect(act('Write', { file_path: '/work/a.ts', content: 'a' }).activity).toBe('Writing a.ts');
    expect(act('Edit', { file_path: '/work/a.ts', old_string: '1', new_string: 'x' }).activity).toBe('Editing a.ts');
  });

  it('shows searches by their pattern', () => {
    expect(act('Glob', { pattern: '**/*.ts' }).activity).toBe('Looking for **/*.ts');
    expect(act('Grep', { pattern: 'todo' }).activity).toBe('Searching for "todo"');
    expect(act('WebSearch', { query: 'effect v4' }).activity).toBe('Searching the web for effect v4');
    expect(act('WebFetch', { url: 'https://example.com' }).activity).toBe('Reading https://example.com');
  });

  it('is busy with the todo in progress, and keeps the status it has', () => {
    const todos = [
      { content: 'Measure', status: 'completed' },
      { content: 'Fix', status: 'in_progress' },
      { content: 'Prove', status: 'pending' },
    ];
    const r = act('TodoWrite', { todos });
    expect(r.activity).toBe('Fix');
    expect(r.status).toBeUndefined();
    expect(act('TodoWrite', { todos: [todos[0]] }).activity).toBeUndefined();
  });

  it('shows a helper by its description, whichever name starts it', () => {
    for (const name of ['Task', 'Agent']) expect(act(name, { description: 'Find the tests' })).toEqual({ status: 'working', activity: 'Delegating: Find the tests' });
  });

  it('shows any other tool by its name', () => {
    expect(act('mcp__github__get_issue', { number: 7, repo: 'a/b' })).toEqual({ activity: 'Using mcp__github__get_issue' });
  });

  // The model's input arrives before Claude Code checks it against the tool's schema, and a throw here ends the session.
  it('takes malformed todos without throwing', () => {
    expect(act('TodoWrite', { todos: '[{"content":"x","status":"in_progress"}]' }).activity).toBeUndefined();
    expect(act('TodoWrite', { todos: [null, { content: 'Fix', status: 'in_progress' }] }).activity).toBe('Fix');
  });
});

describe('callStep', () => {
  it('keeps all of the input and where it ran', () => {
    const input = { command: 'pnpm test', description: 'Run the tests' };
    expect(callStep('t1', 'Bash', input, '/work')).toEqual({ kind: 'call', id: 't1', tool: 'Bash', input, cwd: '/work' });
  });
});

describe('resultStep', () => {
  it('keeps the whole text, not a glance at it', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(resultStep('t1', { content: text })).toEqual({ kind: 'result', id: 't1', ok: true, text });
    const blocks = [{ type: 'text', text: 'first' }, { type: 'text', text }];
    expect(resultStep('t1', { content: blocks, is_error: true })).toEqual({ kind: 'result', id: 't1', ok: false, text: `first\n${text}` });
  });

  it('turns image blocks into data URLs, in the API’s shape and MCP’s', () => {
    const content = [{ type: 'text', text: 'Took 2 screenshots' }, png, { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' }];
    expect(resultStep('t1', { content })).toEqual({
      kind: 'result', id: 't1', ok: true, text: 'Took 2 screenshots',
      images: [{ src: 'data:image/png;base64,iVBORw0KGgo' }, { src: 'data:image/jpeg;base64,BBBB' }],
    });
  });

  it('has no images when none came back, and empty text when nothing did', () => {
    expect(resultStep('t1', {})).toEqual({ kind: 'result', id: 't1', ok: true, text: '' });
    expect(resultStep('t1', { content: [{ type: 'image', source: { type: 'url', url: 'https://x' } }] })).toEqual({ kind: 'result', id: 't1', ok: true, text: '' });
  });
});
