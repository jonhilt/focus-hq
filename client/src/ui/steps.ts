import { callTitle, patchFiles, records, todoList } from '../../../shared/stepText';
import type { SessionStep } from '../../../shared/types';
import { h } from './dom';
import { fold } from './fold';

// What a session did, a step at a time, in Pi's look: each tool call a line of its own (Claude Code's `⏺ Bash(…)`), a
// peek at what it changed or gave back under it, and all of it (the whole command, diff or prompt, the whole output)
// when it's opened. Its thinking is a quiet line that opens to all of it. Nothing's cut: what's long is only folded.

type Call = Extract<SessionStep, { kind: 'call' }>;
type Result = Extract<SessionStep, { kind: 'result' }>;
type Think = Extract<SessionStep, { kind: 'think' }>;

/** A line of a step's detail, coloured by what it is: added, removed, or plain. */
type Row = { cls: 'add' | 'del' | 'plain' | 'dim'; text: string };

/** How many lines of a step's output or diff show while it's folded. */
export const PEEK = 3;

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
const lines = (text: string) => text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
const rows = (text: string, cls: Row['cls'] = 'plain'): Row[] => (text ? lines(text).map((t) => ({ cls, text: t })) : []);

/** A unified diff's lines, coloured; its file headers left out. */
const diffRows = (diff: string): Row[] =>
  lines(diff).filter((l) => !/^(\+\+\+|---) /.test(l)).map((l) => ({ cls: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'dim' : 'plain', text: l }));

/** What a call changes in files, as diff rows: an edit's old and new, a write's content, a patch's diffs. Null for a call that changes none. */
export function changeRows(call: Pick<Call, 'tool' | 'input'>): Row[] | null {
  const { tool, input } = call;
  const edit = (e: Record<string, unknown>): Row[] => [...rows(str(e.old_string), 'del').map((r) => ({ ...r, text: `- ${r.text}` })), ...rows(str(e.new_string), 'add').map((r) => ({ ...r, text: `+ ${r.text}` }))];
  if (tool === 'Edit') return edit(input);
  if (tool === 'MultiEdit') return records(input.edits).flatMap((e, i) => [...(i > 0 ? [{ cls: 'dim' as const, text: '…' }] : []), ...edit(e)]);
  if (tool === 'Write') return rows(str(input.content), 'add').map((r) => ({ ...r, text: `+ ${r.text}` }));
  if (tool === 'apply_patch') return patchFiles(input.changes).flatMap((c) => [{ cls: 'dim' as const, text: `${c.kind || 'update'} ${c.path}` }, ...diffRows(c.diff)]);
  return null;
}

/** How many lines a change adds and takes away: `+12 −4`. */
export function changeCount(change: Row[]): string {
  const add = change.filter((r) => r.cls === 'add').length;
  const del = change.filter((r) => r.cls === 'del').length;
  return [add ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ');
}

/** All of what a call was given that its line doesn't show: the whole command, a helper's prompt, a tool's input. */
export function inputRows(call: Pick<Call, 'tool' | 'input' | 'cwd'>): Row[] {
  const { tool, input } = call;
  if (tool === 'Bash') {
    const command = str(input.command);
    return lines(command).length > 1 || command.length > 100 ? rows(command) : [];
  }
  if (tool === 'Task' || tool === 'Agent') return rows(str(input.prompt));
  if (['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'apply_patch', 'TodoWrite', 'WebSearch', 'WebFetch'].includes(tool)) {
    // their line says it all, but for options it leaves out
    const shown = new Set(['file_path', 'pattern', 'old_string', 'new_string', 'content', 'edits', 'changes', 'todos', 'query', 'url', 'replace_all']);
    const rest = Object.fromEntries(Object.entries(input).filter(([k]) => !shown.has(k)));
    return Object.keys(rest).length ? rows(JSON.stringify(rest, null, 2), 'dim') : [];
  }
  const { label, arg } = callTitle(call);
  // a tool with one short argument says it on its line
  const values = Object.values(input);
  if (values.length <= 1 && arg.length <= 100 && !arg.includes('\n') && label) return [];
  return rows(JSON.stringify(input, null, 2), 'dim');
}

const rowEls = (list: Row[]) => list.map((r) => h('div', { class: `row ${r.cls}` }, r.text || ' '));

/** A block of rows: a step's detail, its output. */
const block = (list: Row[], cls = '') => h('div', { class: `rows ${cls}`.trim() }, ...rowEls(list));

/** The images a result gave back, small, each opening at full size in a tab of its own. */
const imageStrip = (result: Result | undefined) =>
  result?.images?.length ? h('div', { class: 'shots' }, ...result.images.map((i) => h('a', { href: i.src, target: '_blank', rel: 'noreferrer' }, h('img', { src: i.src, alt: 'What the tool gave back', loading: 'lazy' })))) : null;

/** A call and (once it's back) its result, as a step: its line, a peek, and all of it when opened. */
export function stepEl(call: Call, result: Result | undefined, open: Set<string>): HTMLElement {
  const { label, arg } = callTitle(call);
  const change = changeRows(call);
  const input = inputRows(call);
  const output = result ? rows(result.text.trim()) : [];
  const todos = call.tool === 'TodoWrite' ? todoList(call.input.todos) : [];
  const failed = result !== undefined && !result.ok;
  const head = h('span', { class: 'call' }, h('b', null, '⏺ ', label), call.tool === 'TodoWrite' ? '' : h('span', { class: 'arg' }, `(${arg.split('\n')[0]})`));
  // folded, a step shows what it changed, else what it gave back: the first few lines of either
  const peekOf = change ?? output;
  const count = change ? changeCount(change) : output.length > PEEK + 1 ? `${output.length} lines` : '';
  // one line more than a peek shows whole: folding it away saves nothing
  const more = input.length > 0 || peekOf.length > PEEK + 1 || (change !== null && output.length > 0 && failed);
  const cls = `step${failed ? ' failed' : ''}${result ? '' : ' running'}${call.helper ? ' sub' : ''}`;
  const todoEl = todos.length
    ? block(todos.map((t) => ({ cls: t.status === 'completed' ? 'add' : 'plain', text: `${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${t.content}` })), 'todos')
    : null;
  if (!more) {
    return h('div', { class: cls, attrs: { 'data-part': 'step', 'data-id': call.id } }, h('div', { class: 'step-head' }, head, count && h('span', { class: 'count' }, count)), todoEl, peekOf.length ? block(peekOf, 'peek') : null, imageStrip(result));
  }
  const el = fold({
    id: `step:${call.id}`,
    open,
    head,
    hint: count || undefined,
    peek: h('div', null, todoEl, block(peekOf.length > PEEK + 1 ? peekOf.slice(0, PEEK) : peekOf, 'peek'), peekOf.length > PEEK + 1 ? h('div', { class: 'row dim more' }, `▸ ${peekOf.length - PEEK} more lines`) : null),
    body: () => h('div', null, todoEl?.cloneNode(true) ?? null, input.length ? block(input, 'input') : null, change ? block(change, 'diff') : null, output.length ? block(output, change ? 'output after-diff' : 'output') : null),
    classes: { root: cls, toggle: 'step-head', mark: 'mark', hint: 'count', body: 'step-body' },
    part: 'step',
  });
  el.dataset.id = call.id;
  el.append(...[imageStrip(result)].filter((x): x is HTMLDivElement => x !== null));
  return el;
}

/** A result whose call isn't in view (it scrolled away, or came before the transcript did), as a step of its own. */
export function orphanResultEl(result: Result, open: Set<string>): HTMLElement {
  return stepEl({ kind: 'call', id: result.id, tool: '…', input: {}, cwd: '', ...(result.helper && { helper: result.helper }) }, result, open);
}

/**
 * The agent's thinking: a quiet line with its first words, opening to all of it. Null when it kept it to itself: Claude
 * Code sends a block for each thought it doesn't show, and a line saying only that it thought says nothing.
 */
export function thinkEl(step: Think, id: string, open: Set<string>): HTMLElement | null {
  const text = step.text.trim();
  if (!text) return null;
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const cls = `think${step.helper ? ' sub' : ''}`;
  return fold({ id, open, head: h('span', { class: 'think-label' }, '✻ Thinking'), hint: first, body: () => block(rows(text)), classes: { root: cls, toggle: 'think-head', mark: 'mark', hint: 'think-hint', body: 'think-body' }, part: 'think' });
}

/** How many lines of a message sent to the session show before the rest folds away. */
export const SENT_PEEK = 4;

/**
 * A message sent to the session (`▶ Captain: …`, a brief from Ops): whole when it's short; a long one (a PR to review,
 * a goal's brief) its first lines, opening in place to all of it, as Comms folds what's told to a lead.
 */
export function sentEl(text: string, id: string, open: Set<string>): HTMLElement {
  const all = text.split('\n');
  if (all.length <= SENT_PEEK + 2) return h('div', { class: 'manager' }, text);
  const peek = h('div', { class: 'sent-peek' }, all.slice(1, SENT_PEEK).join('\n'), h('div', { class: 'more' }, `▸ ${all.length - SENT_PEEK} more lines`));
  return fold({ id, open, head: h('span', { class: 'sent-head' }, all[0]), peek, body: () => all.slice(1).join('\n'), classes: { root: 'manager sent', toggle: 'sent-toggle', mark: 'mark', body: 'sent-body' }, part: 'sent' });
}
