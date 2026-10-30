import { busy, callPlugin, confirmDialog, fill, focus, h, markdownHtml, pluginState } from '../../plugin-api/client';
import { isRecord } from '../../plugin-api/shared';
import { TW } from './bridgeKit';
import { collapsedMessage } from './collapsedMessage';
import { lineEntries } from './lineList';
import { startedWaiting } from './lineRules';
import { CHIEF_OF_STAFF, cosStateOf, freshLine, type LineStart } from './shared';

// The direct line in Comms (README.md#the-direct-line): the user's conversation with the chief of staff, tied to no
// goal, in the viewer's place, looking as the Talk panel does. What it started from the line is a notice in the
// conversation, "I started … because …", with Close (its undo); what it told an open goal's lead, a quieter one, folded
// to "Told <lead> · <goal> · <time>" and opening to all of it (collapsedMessage.ts).

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** What the line is doing this moment, which isn't saved (`CosLive`). */
const activityNow = (): string => {
  const kept = pluginState<unknown>(CHIEF_OF_STAFF);
  return isRecord(kept) && typeof kept.lineActivity === 'string' ? kept.lineActivity : '';
};

export const lineNow = () => cosStateOf(pluginState<unknown>(CHIEF_OF_STAFF)).line ?? freshLine();

/** The goals it started from the line waiting in the muster (`startedWaiting`), in the shown projects, as this browser has Focus. */
export function startedNow(): LineStart[] {
  const { started } = lineNow();
  const aboard = new Set(started.filter((s) => focus.agent(s.leadId)?.task === 'lead').map((s) => s.leadId));
  return startedWaiting(started, aboard).filter((s) => !focus.isHidden(s.projectId));
}

/** Closes a goal it started from the line, from the line or the muster: through Focus, which warns first about work that would be lost. */
export async function closeStarted(s: LineStart): Promise<void> {
  const first = await callPlugin<{ warn?: string[] }>(CHIEF_OF_STAFF, '/line/close', { key: s.key });
  if (!first.warn) return;
  const title = focus.agent(s.leadId)?.lead?.title ?? s.text;
  if (await confirmDialog({ title: 'Close goal', message: `Close “${title}”?\n\n${first.warn.join('\n')}`, confirmLabel: 'Close goal', danger: true })) {
    await callPlugin(CHIEF_OF_STAFF, '/line/close', { key: s.key, force: true });
  }
}

/** The direct line's view: its element, drawn again with `render`, and its box to type in. */
export function lineView(error: (message: string) => void): { el: HTMLElement; render: () => void; focusBox: () => void } {
  const status = h('div', { class: 'tw:text-[13px] tw:text-muted', attrs: { 'data-part': 'line-status' } });
  const fresh = h('button', { class: TW.btn, title: 'Start the conversation afresh: the goals it started stay as they are' }, 'New conversation');
  const head = h('div', { class: 'tw:flex-none tw:grid tw:grid-cols-[1fr_auto] tw:gap-x-3 tw:px-[18px] tw:pt-[14px] tw:pb-[10px] tw:border-b tw:border-solid tw:border-hair-card' },
    h('span', { class: TW.label }, 'Direct line'),
    h('span', { class: 'tw:col-start-1 tw:font-display tw:text-[19px]/[1.25] tw:font-semibold tw:tracking-[.02em]' }, 'Chief of Staff'),
    h('div', { class: 'tw:row-span-2 tw:col-start-2 tw:row-start-1 tw:self-center' }, fresh),
    status);
  const said = h('div', { class: 'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden tw:[overflow-wrap:anywhere] tw:flex tw:flex-col tw:gap-5 tw:px-[18px] tw:py-[14px]', attrs: { 'data-part': 'line-said' } });
  const box = h('textarea', {
    class: 'tw:flex-none tw:h-[72px] tw:min-h-0 tw:mx-[18px] tw:mb-[14px] tw:border tw:border-solid tw:border-line tw:bg-transparent tw:text-ink tw:text-[14.5px]/[1.5] tw:p-2 tw:resize-none tw:outline-none tw:rounded-none tw:focus:border-muted tw:font-read',
    attrs: { placeholder: 'Talk to the Chief of Staff: it starts a goal itself when what you say calls for one', 'data-part': 'line-box' },
  });
  const el = h('div', { class: `${TW.table} tw:flex tw:flex-col tw:bg-surface tw:border tw:border-solid tw:border-line tw:shadow-lift-3 cos-cut`, attrs: { 'data-part': 'line' } }, head, said, box);

  // the words it told a lead that the user opened, by id: open still when the line's drawn again
  const unfolded = new Set<string>();

  fresh.onclick = () => void busy(fresh, () => callPlugin(CHIEF_OF_STAFF, '/line/new', {}), error);

  const startedEl = (s: LineStart) => {
    const lead = focus.agent(s.leadId);
    const title = lead?.lead?.title ?? s.text;
    const gone = s.closed !== undefined || !lead;
    const shut: HTMLButtonElement = h('button', { class: TW.btn, title: 'Close the goal it started: its undo', attrs: { 'data-part': 'line-close' }, onclick: () => void busy(shut, () => closeStarted(s), error) }, 'Close');
    return h('div', { class: `${TW.card} ${gone ? 'tw:opacity-50' : ''}`, attrs: { 'data-part': 'line-started' } },
      h('div', { class: TW.ch }, gone ? `Started · closed` : `Started · ${clock(s.at)}`),
      h('div', { class: 'tw:text-[14.5px]/[1.5] tw:mt-[3px]' }, 'I started ', h('b', { class: 'tw:font-semibold' }, title), ` in ${s.project} because ${s.why.replace(/^\w/, (c) => c.toLowerCase())}`),
      h('div', { class: 'tw:flex tw:gap-[6px] tw:mt-[10px]' }, gone ? null : shut));
  };

  const render = () => {
    const line = lineNow();
    const activity = activityNow();
    status.textContent = line.status === 'thinking' ? `Thinking · ${activity || 'reading what you said'}` : line.status === 'failed' ? `Lost the thread: ${line.error ?? 'it failed'}` : 'Waiting for you';
    box.disabled = line.status === 'thinking';
    const entries = lineEntries(line);
    const key = JSON.stringify([entries, entries.flatMap((e) => (e.kind === 'started' ? [focus.agent(e.start.leadId)?.lead?.title ?? null, !!focus.agent(e.start.leadId)] : e.kind === 'told' ? [focus.agent(e.told.leadId)?.name ?? null] : []))]);
    if (said.dataset.key === key) return;
    said.dataset.key = key;
    fill(said, ...entries.map((e) => {
      if (e.kind === 'started') return startedEl(e.start);
      if (e.kind === 'told') {
        const { leadId, goal, at, text } = e.told;
        return collapsedMessage({ id: `${leadId}@${at}`, head: `Told ${focus.agent(leadId)?.name ?? 'its lead'} · ${goal} · ${clock(at)}`, text, open: unfolded, part: 'line-told' });
      }
      const text = h('div', { class: 'cos-md' });
      text.innerHTML = markdownHtml(e.message.text);
      const you = e.message.from === 'user';
      return h('div', { class: `tw:text-[14.5px]/[1.65] ${you ? 'tw:pl-3 tw:border-0 tw:border-l-2 tw:border-solid tw:border-line' : ''}`, attrs: { 'data-from': you ? 'you' : 'cos' } },
        h('small', { class: 'tw:block tw:text-[12.5px] tw:text-muted tw:mb-1' }, `${you ? 'You' : 'Chief of Staff'} · ${clock(e.message.at)}`), text);
    }), entries.length ? null : h('div', { class: 'tw:text-muted tw:text-[14px]' }, 'Talk something over. When it calls for work, the chief of staff tells the goal it fits, or starts a new one in the right project and says so here, with a way to close it.'));
    said.scrollTop = said.scrollHeight;
  };

  box.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const words = box.value.trim();
    if (!words) return;
    box.value = '';
    void callPlugin(CHIEF_OF_STAFF, '/line/say', { text: words }).catch((err: Error) => {
      box.value = words;
      error(err.message);
    });
  };

  return { el, render, focusBox: () => box.focus() };
}
