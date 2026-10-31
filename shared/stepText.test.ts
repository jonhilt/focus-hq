import { describe, expect, it } from 'vitest';
import { callHead, callLines, callTitle, entryLines, isTextLine, patchLines, relPath, replyLines, resultLines } from './stepText';
import type { SessionStep } from './types';

const call = (tool: string, input: Record<string, unknown>) => ({ kind: 'call' as const, id: 't1', tool, input, cwd: '/work' });
const texts = (tool: string, input: Record<string, unknown>) => callLines(call(tool, input)).map((l) => l.text);

describe('callLines', () => {
  it('shows a browser call by its action and what it acted on', () => {
    expect(callLines(call('mcp__browser__open', { url: 'http://localhost:5173/' }))).toEqual([{ kind: 'tool', text: '⏺ Browser.open(http://localhost:5173/)' }]);
    expect(texts('mcp__browser__screenshot', {})).toEqual(['⏺ Browser.screenshot()']);
  });

  it('shows a command whole in its head', () => {
    expect(callHead(call('Bash', { command: 'pnpm test' }))).toEqual({ kind: 'tool', text: '⏺ Bash(pnpm test)' });
  });

  it('shows paths inside the checkout relative to it, and the checkout itself as .', () => {
    expect(texts('Read', { file_path: '/work' })).toEqual(['⏺ Read(.)']);
    expect(texts('Read', { file_path: '/elsewhere/b.ts' })).toEqual(['⏺ Read(/elsewhere/b.ts)']);
    expect(relPath('/work/src/a.ts', '/work')).toBe('src/a.ts');
    expect(relPath('/work/a.ts', '')).toBe('/work/a.ts');
  });

  it('shows the first four lines a write adds and how many more there are', () => {
    expect(texts('Write', { file_path: '/work/a.ts', content: 'a\nb\nc\nd\ne\nf' })).toEqual(['⏺ Write(a.ts)', '  + a', '  + b', '  + c', '  + d', '  … +2 lines']);
    expect(texts('Write', { file_path: '/work/a.ts', content: 'a' })).toEqual(['⏺ Write(a.ts)', '  + a']);
    expect(texts('Write', { file_path: '/work/a.ts', content: 'a\nb\nc\nd\ne' }).at(-1)).toBe('  … +1 lines');
  });

  it('shows an edit as what it takes out and puts in, three lines of each', () => {
    expect(callLines(call('Edit', { file_path: '/work/a.ts', old_string: '1\n2\n3\n4', new_string: 'x' })).map((l) => [l.kind, l.text])).toEqual([
      ['tool', '⏺ Update(a.ts)'], ['error', '  - 1'], ['error', '  - 2'], ['error', '  - 3'], ['success', '  + x'],
    ]);
  });

  it('shows the first two edits of a multi-edit', () => {
    const edits = [1, 2, 3].map((n) => ({ old_string: `old${n}`, new_string: `new${n}` }));
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits })).toEqual(['⏺ MultiEdit(a.ts)', '  - old1', '  + new1', '  - old2', '  + new2']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts' })).toEqual(['⏺ MultiEdit(a.ts)']);
  });

  it('shows searches by their pattern', () => {
    expect(texts('Glob', { pattern: '**/*.ts' })).toEqual(['⏺ Glob(**/*.ts)']);
    expect(texts('Grep', { pattern: 'todo' })).toEqual(['⏺ Search("todo")']);
    expect(texts('WebSearch', { query: 'effect v4' })).toEqual(['⏺ Web Search(effect v4)']);
    expect(texts('WebFetch', { url: 'https://example.com' })).toEqual(['⏺ Fetch(https://example.com)']);
  });

  it('ticks off todos', () => {
    const todos = [
      { content: 'Measure', status: 'completed' },
      { content: 'Fix', status: 'in_progress' },
      { content: 'Prove', status: 'pending' },
    ];
    expect(callLines(call('TodoWrite', { todos })).map((l) => [l.kind, l.text])).toEqual([
      ['tool', '⏺ Update Todos'], ['success', '  ☒ Measure'], ['output', '  ◐ Fix'], ['output', '  ☐ Prove'],
    ]);
  });

  it('shows a helper by its description, whichever name starts it', () => {
    for (const name of ['Task', 'Agent']) expect(texts(name, { description: 'Find the tests' })).toEqual(['⏺ Task(Find the tests)']);
  });

  it('shows any other tool by its first argument', () => {
    expect(callLines(call('mcp__github__get_issue', { number: 7, repo: 'a/b' }))).toEqual([{ kind: 'tool', text: '⏺ github__get_issue(7)' }]);
    expect(callTitle(call('mcp__github__get_issue', { number: 7 }))).toEqual({ label: 'github__get_issue', arg: '7' });
  });

  // The model's input arrives before Claude Code checks it against the tool's schema, and a throw here ends the session.
  it('draws malformed todos and edits without throwing', () => {
    expect(texts('TodoWrite', { todos: '[{"content":"x","status":"pending"}]' })).toEqual(['⏺ Update Todos']);
    expect(texts('TodoWrite', { todos: [null, { content: 'Fix', status: 'in_progress' }, { status: 'pending' }] })).toEqual(['⏺ Update Todos', '  ◐ Fix']);
    expect(texts('TodoWrite', {})).toEqual(['⏺ Update Todos']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits: 'oops' })).toEqual(['⏺ MultiEdit(a.ts)']);
    expect(texts('MultiEdit', { file_path: '/work/a.ts', edits: [null, { old_string: 'a', new_string: 'b' }] })).toEqual(['⏺ MultiEdit(a.ts)', '  - a', '  + b']);
  });

  it('shows a Codex patch as each file it changes and its diff', () => {
    const changes = [{ path: '/work/a.ts', kind: { type: 'update' }, diff: '--- a/a.ts\n+++ b/a.ts\n-old\n+new\n context' }];
    expect(texts('apply_patch', { changes })).toEqual(['⏺ Update(a.ts)', '  - old', '  + new']);
    expect(callLines(call('apply_patch', { changes }))).toEqual(patchLines(changes, '/work'));
    expect(patchLines([{ path: '/work/b.ts', kind: { type: 'add' }, diff: '+x' }, { path: '/work/c.ts', kind: { type: 'delete' }, diff: '' }], '/work').map((l) => l.text))
      .toEqual(['⏺ Write(b.ts)', '  + x', '⏺ Delete(c.ts)']);
  });
});

describe('resultLines', () => {
  it('shows the first four lines like Claude Code’s ⎿ output, and how many more there are', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(resultLines({ ok: true, text }).map((l) => l.text)).toEqual(['  ⎿  line 1', '     line 2', '     line 3', '     line 4', '     … +46 lines']);
  });

  it('marks a failure, an empty result, and the images it gave back', () => {
    expect(resultLines({ ok: false, text: 'boom' })).toEqual([{ kind: 'error', text: '  ⎿  boom' }]);
    expect(resultLines({ ok: true, text: '\n  \n' })).toEqual([{ kind: 'output', text: '  ⎿  (no output)' }]);
    expect(resultLines({ ok: true, text: 'shot', images: [{ src: 'data:image/png;base64,AA' }] }).map((l) => l.text)).toEqual(['  ⎿  shot', '     [screenshot]']);
  });
});

describe('entryLines', () => {
  it('draws each step the way Claude Code shows it', () => {
    expect(entryLines({ kind: 'reply', text: 'Done.\nAll green.' })).toEqual([{ kind: 'text', text: '⏺ Done.' }, { kind: 'text', text: '  All green.' }]);
    expect(replyLines('Hi')).toEqual([{ kind: 'text', text: '⏺ Hi' }]);
    expect(entryLines({ kind: 'think', text: '  Weighing it  ' })).toEqual([{ kind: 'thinking', text: '✻ Weighing it' }]);
    expect(entryLines({ kind: 'think', text: '' })).toEqual([{ kind: 'thinking', text: '✻ Thinking…' }]);
    expect(entryLines(call('Bash', { command: 'ls' }))).toEqual([{ kind: 'tool', text: '⏺ Bash(ls)' }]);
    expect(entryLines({ kind: 'result', id: 't1', ok: true, text: 'a.ts' })).toEqual([{ kind: 'output', text: '  ⎿  a.ts' }]);
  });

  it('indents a subagent’s step under the session’s', () => {
    const step: SessionStep = { ...call('Bash', { command: 'ls' }), helper: 'Explore' };
    expect(entryLines(step)).toEqual([{ kind: 'tool', text: '    ⏺ Bash(ls)' }]);
  });

  it('draws a subagent’s reply as output, indented, not as the session’s words', () => {
    expect(entryLines({ kind: 'reply', text: 'found it\nin a.ts', helper: 'Explore' })).toEqual([
      { kind: 'output', text: '    ⏺ found it' },
      { kind: 'output', text: '      in a.ts' },
    ]);
  });

  it('leaves a line of text as it is', () => {
    const line = { kind: 'system' as const, text: 'Started' };
    expect(entryLines(line)).toEqual([line]);
    expect(isTextLine(line)).toBe(true);
    expect(isTextLine({ kind: 'reply', text: 'x' })).toBe(false);
  });
});

describe('patchLines', () => {
  it('shows each file a patch changes, relative to the folder, with the first lines of its diff', () => {
    const lines = patchLines([{ path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n++count;\n context' }, { path: '/repo/b.ts', kind: { type: 'add' }, diff: '+hello' }], '/repo');
    expect(lines).toEqual([
      { kind: 'tool', text: '⏺ Update(src/a.ts)' },
      { kind: 'error', text: '  - old' },
      { kind: 'success', text: '  + new' },
      { kind: 'success', text: '  + +count;' },
      { kind: 'tool', text: '⏺ Write(b.ts)' },
      { kind: 'success', text: '  + hello' },
    ]);
    expect(patchLines(undefined, '/repo')).toEqual([]);
  });
});
