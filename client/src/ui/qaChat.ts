import { lineDiff, QA_CHAT_TURNS, type QaChangeRow, qaChangeRows, type QaSettingsNow } from '../../../shared/qaChat';
import type { QaChatReply, QaChatTurn, QaSettingsChange } from '../../../shared/types';
import { busy, fill, h } from './dom';

// Talking to the QA officer under the Playbook: the captain says what they want in plain words, the officer answers
// (POST /projects/:id/qa-chat), and a change it proposes shows as a diff the captain applies or discards. qaPanel.ts
// puts it there; everything it reaches is handed in, so it's tested in happy-dom (qaChat.test.ts).

export interface QaChatDeps {
  officer: string;
  /** The officer's answer to the talk so far. */
  ask: (turns: QaChatTurn[]) => Promise<QaChatReply>;
  /** Saves a change to the project's settings (the Playbook shows them afresh). */
  apply: (change: QaSettingsChange) => Promise<unknown>;
  /** QA's settings as they are now, for the diff. */
  now: () => QaSettingsNow;
  error: (message: string) => void;
  /** The text box as it goes on the page: with the mic beside it. */
  field: (input: HTMLTextAreaElement) => HTMLElement;
}

/** What happened to a change the officer proposed. */
type Outcome = 'pending' | 'applied' | 'discarded';

/** One line of the talk, and with an officer's, the change it proposed: its rows as they were when proposed. */
interface Entry extends QaChatTurn {
  change?: QaSettingsChange;
  rows?: QaChangeRow[];
  outcome?: Outcome;
}

const SAID: Record<Outcome, string> = { pending: 'hasn’t applied it yet', applied: 'applied it', discarded: 'discarded it' };

/**
 * The talk as the officer is given it: the latest turns, an officer's carrying what it proposed and what the captain
 * did with it, so it doesn't propose an applied change again.
 */
export function turnsToSend(entries: Entry[]): QaChatTurn[] {
  return entries.slice(-QA_CHAT_TURNS).map((e) => ({
    who: e.who,
    text: e.rows?.length ? `${e.text}\n(Proposed: ${e.rows.map((r) => (r.field === 'qaBrief' ? 'a new brief' : `${r.label} ${r.from} → ${r.to}`)).join('; ')}. The captain ${SAID[e.outcome ?? 'pending']}.)` : e.text,
  }));
}

/** "Talk to <officer>": the talk, the box to say something in, and Send. */
export function qaChat(deps: QaChatDeps): HTMLElement {
  const entries: Entry[] = [];
  const list = h('div', { class: 'qa-chat-log' });
  const input = h('textarea', { class: 'qa-chat-input', placeholder: 'e.g. “run the e2e suite too”, “stop sending failed PRs back”, “why do you read every file?”' });
  const send = h('button', { class: 'btn', type: 'button' }, 'Send');
  const thinking = h('p', { class: 'muted qa-chat-thinking', hidden: true }, `${deps.officer} is thinking…`);

  const render = () => fill(list, ...entries.map((e) => entryView(e, deps, render)));
  const say = () => {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    entries.push({ who: 'captain', text });
    input.value = '';
    render();
    thinking.hidden = false;
    void busy(send, async () => {
      try {
        const answer = await deps.ask(turnsToSend(entries));
        entries.push({ who: 'officer', text: answer.reply, ...(answer.change && { change: answer.change, rows: qaChangeRows(answer.change, deps.now()), outcome: 'pending' as const }) });
      } catch (err) {
        // what they said goes back in the box, to send again
        entries.pop();
        input.value = text;
        throw err;
      } finally {
        thinking.hidden = true;
        render();
      }
    }, deps.error);
  };
  send.onclick = say;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      say();
    }
  });
  return h('div', { class: 'qa-chat' }, list, thinking, h('div', { class: 'qa-chat-say' }, deps.field(input), send));
}

function entryView(e: Entry, deps: QaChatDeps, render: () => void): HTMLElement {
  return h('div', { class: `qa-chat-turn ${e.who}` },
    h('strong', null, e.who === 'captain' ? 'You' : deps.officer),
    h('p', null, e.text),
    e.rows?.length ? changeView(e, deps, render) : null,
  );
}

/** A proposed change as a diff, one row per setting (the brief's a line at a time), with Apply and Discard while it's pending. */
export function changeView(e: Entry, deps: Pick<QaChatDeps, 'apply' | 'error'>, render: () => void): HTMLElement {
  const { change, rows = [] } = e;
  const apply = h('button', { class: 'btn small', type: 'button' }, 'Apply');
  apply.onclick = () => void busy(apply, async () => {
    if (change) await deps.apply(change);
    e.outcome = 'applied';
    render();
  }, deps.error);
  const discard = h('button', { class: 'btn small', type: 'button' }, 'Discard');
  discard.onclick = () => {
    e.outcome = 'discarded';
    render();
  };
  return h('div', { class: `qa-chat-change ${e.outcome ?? 'pending'}` },
    h('table', null, ...rows.map((r) => h('tr', null,
      h('th', null, r.label),
      r.field === 'qaBrief' ? h('td', { colSpan: 3 }, briefDiff(r)) : [h('td', { class: 'from' }, r.from), h('td', null, '→'), h('td', { class: 'to' }, r.to)],
    ))),
    e.outcome === 'pending' ? h('div', { class: 'actions' }, apply, discard) : h('small', { class: 'muted' }, e.outcome === 'applied' ? 'Applied.' : 'Discarded.'),
  );
}

/** The brief, a line at a time: taken out, added, or as it was. */
function briefDiff(row: QaChangeRow): HTMLElement {
  const mark = { same: ' ', added: '+', removed: '−' } as const;
  return h('pre', { class: 'qa-chat-diff' }, ...lineDiff(row.from, row.to).map((l) => h('div', { class: l.kind }, `${mark[l.kind]} ${l.text}`)));
}
