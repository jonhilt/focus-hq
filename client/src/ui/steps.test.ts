// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { SessionStep, TermLine } from '../../../shared/types';
import { fold } from './fold';
import { changeCount, changeRows, inputRows, PEEK, SENT_PEEK, sentEl, stepEl, thinkEl } from './steps';
import { TermView } from './terminal';

// A session's steps in its pane (steps.ts, terminal.ts), and the fold they open with (fold.ts), which Comms' told
// messages share: each step a line with a peek, opening in place to all of it, and nothing of it cut.

type Call = Extract<SessionStep, { kind: 'call' }>;
type Result = Extract<SessionStep, { kind: 'result' }>;

const call = (tool: string, input: Record<string, unknown>, id = 'u1'): Call => ({ kind: 'call', id, tool, input, cwd: '/work' });
const result = (text: string, ok = true, id = 'u1'): Result => ({ kind: 'result', id, ok, text });
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
const toggle = (el: Element) => el.querySelector<HTMLButtonElement>(':scope > [data-part=fold-toggle]');
const body = (el: Element) => el.querySelector<HTMLElement>(':scope > [data-part=fold-body]');

describe('fold', () => {
  const draw = (open = new Set<string>()) => {
    let built = 0;
    const el = fold({ id: 'x', open, head: 'Head', hint: 'first words', peek: document.createElement('div'), body: () => { built++; return 'all of it'; } });
    return { el, open, built: () => built };
  };

  it('is folded behind a button that says so, its body not built until it opens', () => {
    const { el, built } = draw();
    expect(toggle(el)?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el)?.getAttribute('aria-controls')).toBe(body(el)?.id);
    expect(body(el)?.hidden).toBe(true);
    expect(built()).toBe(0);
  });

  it('opens in place, hiding its hint and peek, and folds again, keeping which are open by id', () => {
    const { el, open, built } = draw();
    toggle(el)?.click();
    expect(body(el)?.hidden).toBe(false);
    expect(body(el)?.textContent).toBe('all of it');
    expect(el.querySelector<HTMLElement>('.fold-hint')?.hidden).toBe(true);
    expect(el.querySelector<HTMLElement>('.fold-peek')?.hidden).toBe(true);
    expect(open.has('x')).toBe(true);
    toggle(el)?.click();
    toggle(el)?.click();
    // built once, however often it opens
    expect(built()).toBe(1);
  });

  it('opens from its peek too, the start of what it folds', () => {
    const { el, open } = draw();
    el.querySelector<HTMLElement>('.fold-peek')?.click();
    expect(open.has('x')).toBe(true);
  });

  it('is drawn open when its id is open', () => {
    expect(body(draw(new Set(['x'])).el)?.hidden).toBe(false);
  });
});

describe('a step', () => {
  it('peeks at the first lines of a long output and opens to every line of it', () => {
    const el = stepEl(call('Bash', { command: 'pnpm test' }), result(numbered(50)), new Set());
    expect(el.querySelector('.count')?.textContent).toBe('50 lines');
    expect(el.querySelectorAll('.peek .row')).toHaveLength(PEEK);
    expect(el.textContent).toContain(`▸ ${50 - PEEK} more lines`);
    toggle(el)?.click();
    const output = body(el)?.querySelectorAll('.output .row');
    expect(output).toHaveLength(50);
    expect(output?.[49]?.textContent).toBe('line 50');
  });

  it('shows a short output whole, with nothing to open', () => {
    const el = stepEl(call('Bash', { command: 'ls' }), result(numbered(PEEK + 1)), new Set());
    expect(toggle(el)).toBeNull();
    expect(el.querySelectorAll('.peek .row')).toHaveLength(PEEK + 1);
  });

  it('opens to the whole of a long command, which its line cuts to its first', () => {
    const command = `cat <<'EOF'\n${numbered(5)}\nEOF`;
    const el = stepEl(call('Bash', { command }), result('ok'), new Set());
    expect(el.querySelector('.arg')?.textContent).toBe("(cat <<'EOF')");
    toggle(el)?.click();
    expect(body(el)?.querySelector('.input')?.textContent).toContain('line 5');
  });

  it('peeks at an edit as its diff, counts what it adds and takes away, and opens to all of it', () => {
    const edit = call('Edit', { file_path: '/work/a.ts', old_string: numbered(4), new_string: 'x\ny' });
    expect(changeCount(changeRows(edit) ?? [])).toBe('+2 −4');
    const el = stepEl(edit, result('The file has been updated'), new Set());
    expect(el.querySelector('.count')?.textContent).toBe('+2 −4');
    expect(el.querySelector('.call')?.textContent).toBe('⏺ Update(a.ts)');
    toggle(el)?.click();
    expect([...body(el)?.querySelectorAll('.diff .del') ?? []].map((r) => r.textContent)).toEqual(['- line 1', '- line 2', '- line 3', '- line 4']);
    expect([...body(el)?.querySelectorAll('.diff .add') ?? []].map((r) => r.textContent)).toEqual(['+ x', '+ y']);
  });

  it("draws a Codex patch's diffs, file by file", () => {
    const patch = call('apply_patch', { changes: [{ path: '/work/a.ts', kind: { type: 'update' }, diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new' }] });
    expect(changeRows(patch)).toEqual([{ cls: 'dim', text: 'update /work/a.ts' }, { cls: 'dim', text: '@@ -1 +1 @@' }, { cls: 'del', text: '-old' }, { cls: 'add', text: '+new' }]);
  });

  it("opens a helper's call to its whole prompt, and any other tool's to its input", () => {
    expect(inputRows(call('Agent', { description: 'Look', prompt: 'Find the tests\nthen report' })).map((r) => r.text)).toEqual(['Find the tests', 'then report']);
    expect(inputRows(call('mcp__github__get_issue', { number: 7, repo: 'a/b' })).map((r) => r.text).join('\n')).toContain('"repo": "a/b"');
    expect(inputRows(call('Read', { file_path: '/work/a.ts' }))).toEqual([]);
  });

  it('is red when it failed, and shows the images it gave back', () => {
    const el = stepEl(call('Read', { file_path: '/work/shot.png' }), { ...result('', false), images: [{ src: '/api/session-images/abc.png' }] }, new Set());
    expect(el.classList.contains('failed')).toBe(true);
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/api/session-images/abc.png');
  });
});

describe('thinking', () => {
  it('is a line with its first words, opening to all of it', () => {
    const el = thinkEl({ kind: 'think', text: 'Check the cart first.\nThen the API.' }, 'th', new Set());
    expect(el?.textContent).toContain('Check the cart first.');
    if (el) toggle(el)?.click();
    expect(el && body(el)?.textContent).toContain('Then the API.');
  });

  it("isn't drawn when the agent kept it to itself", () => {
    expect(thinkEl({ kind: 'think', text: '' }, 'th', new Set())).toBeNull();
  });
});

describe('TermView', () => {
  const at = (entry: SessionStep | { kind: 'manager' | 'system'; text: string }): TermLine => ({ t: 1, ...entry });

  it("draws a call's result into its step when it comes, in place", () => {
    const term = new TermView();
    term.append([at({ kind: 'reply', text: 'Running the **tests**' }), at(call('Bash', { command: 'pnpm test' }))]);
    const step = term.el.querySelector('[data-part=step]');
    expect(step?.classList.contains('running')).toBe(true);
    term.append([at(result(numbered(10)))]);
    expect(term.el.querySelectorAll('[data-part=step]')).toHaveLength(1);
    expect(term.el.querySelector('[data-part=step]')?.classList.contains('running')).toBe(false);
    expect(term.el.querySelector('.md strong')?.textContent).toBe('tests');
  });

  it('keeps a step open when its whole history is drawn again', () => {
    const term = new TermView();
    const history = [at(call('Bash', { command: 'pnpm test' })), at(result(numbered(10)))];
    term.append(history);
    const first = term.el.querySelector('[data-part=step]');
    if (first) toggle(first)?.click();
    term.clear();
    term.append(history);
    const again = term.el.querySelector('[data-part=step]');
    expect(again && body(again)?.hidden).toBe(false);
  });

  it("marks a subagent's steps, and draws a result whose call isn't in view as a step of its own", () => {
    const term = new TermView();
    term.append([at({ ...call('Grep', { pattern: 'x' }, 'h1'), helper: 'agent-1' }), at(result('found', true, 'gone'))]);
    expect(term.el.querySelector('[data-part=step]')?.classList.contains('sub')).toBe(true);
    expect(term.el.querySelectorAll('[data-part=step]')).toHaveLength(2);
  });

  it("draws Ops' lines as it always has: a message sent in full, notices folded between", () => {
    const term = new TermView();
    term.append([at({ kind: 'manager', text: '▶ Captain: ship it' }), at({ kind: 'system', text: '✻ Pushing focus/a' })]);
    expect(term.el.querySelector('.manager')?.textContent).toBe('▶ Captain: ship it');
    expect(term.el.querySelector('details.fold summary')?.textContent).toContain('Pushing focus/a');
  });
});

describe('a message sent to the session', () => {
  const brief = ['▶ Please QA pull request #1', ...Array.from({ length: 30 }, (_, i) => `detail ${i + 1}`)].join('\n');

  it('is whole when short', () => {
    expect(sentEl('▶ Captain: ship it', 's', new Set()).textContent).toBe('▶ Captain: ship it');
  });

  it('shows the first lines of a long one, opening in place to all of it', () => {
    const el = sentEl(brief, 's', new Set());
    expect(el.querySelector('.sent-head')?.textContent).toBe('▶ Please QA pull request #1');
    expect(el.textContent).toContain(`▸ ${31 - SENT_PEEK} more lines`);
    toggle(el)?.click();
    expect(body(el)?.textContent).toContain('detail 30');
  });
});
