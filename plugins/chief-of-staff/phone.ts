// The chief of staff on the phone (the Tricorder, README.md): what needs the captain at the top of its home screen,
// most urgent first, then the turns it has words ready for, each sent with a tap.
import './phone.css';
import { type Agent, type Attention, focus, h, needsYou, type PhoneHost, type PhonePlugin, prKey, type PullRequest } from '../../plugin-api/phone';
import { hailing } from './here';
import { hailKey } from './inbox';
import { inbox } from './inboxApi';
import { laneOf, lineOf } from './lanes';
import { type CosRead, CHIEF_OF_STAFF, readOf } from './shared';

/** When its words go by themselves, to the minute: the phone's screen is drawn again every few seconds. */
export function sendsIn(sendsAt: number | undefined, now: number): string {
  if (sendsAt === undefined) return 'Waits for you to send';
  const min = Math.ceil((sendsAt - now) / 60_000);
  return min > 1 ? `Sends itself in ${min} min` : 'Sends itself within a minute';
}

function agentEntry(host: PhoneHost, agent: Agent, { icon, what }: { icon: string; what: string }): HTMLElement {
  const project = focus.project(agent.projectId);
  return h('li', null, h('a', { class: 'cos-entry', href: host.agentHref(agent.id), style: `--accent:${project?.color ?? 'var(--lcars-gold)'}` },
    h('span', { class: 'icon' }, icon),
    h('span', { class: 'text' }, h('strong', null, what), h('small', null, `${agent.name} · ${project?.name ?? ''} · ${host.workLabel(agent)}`)),
  ));
}

function prEntry(host: PhoneHost, projectId: string, pr: PullRequest, { icon, what }: { icon: string; what: string }): HTMLElement {
  const project = focus.project(projectId);
  return h('li', null, h('button', { class: 'cos-entry', type: 'button', style: `--accent:${project?.color ?? 'var(--lcars-gold)'}`, attrs: { 'data-key': `cos-pr:${projectId}:${prKey(pr.repo, pr.number)}` }, onclick: () => host.showPr(projectId, pr) },
    h('span', { class: 'icon' }, icon),
    h('span', { class: 'text' }, h('strong', null, what), h('small', null, `${project?.name ?? ''} · ${pr.repo}#${pr.number} ${pr.title}`)),
  ));
}

/** What needs the captain, a line each as Comms says it (`lineOf`), most urgent first; all clear when nothing does. */
function needsYouStrip(host: PhoneHost, attention: Attention[]): HTMLElement {
  const items = attention.map((a) => ('agent' in a ? agentEntry(host, a.agent, lineOf(a, focus.reviews)) : prEntry(host, a.projectId, a.pr, lineOf(a, focus.reviews))));
  return h('section', { class: `cos-needs-you ${items.length ? 'alert' : 'clear'}` },
    h('h2', { class: 'bar' }, h('span', null, 'Needs you'), h('span', { class: 'count' }, String(items.length))),
    items.length ? h('ul', null, ...items) : h('p', { class: 'cos-all-clear' }, '✓ All clear. Nothing is waiting on you.'),
  );
}

/** What a ready turn's entry says: its headline, the words that would go, whether they can be held, and when they go. */
export function readyLine(read: CosRead | undefined, now: number): { ask: string; words: string; holdable: boolean; when: string } {
  const judged = read?.judged;
  return {
    ask: judged?.ask ?? 'Carry on',
    words: judged?.message ?? '',
    holdable: read?.sendsAt !== undefined,
    when: sendsIn(read?.sendsAt, now),
  };
}

/**
 * The turns it would carry on or send back, its words ready: each sent with a tap, or held when they'd otherwise go by
 * themselves (`CosRead.sendsAt`). Out of Needs you, as in Comms' tray, and gone when there are none.
 */
function readyStrip(host: PhoneHost, ready: Agent[], now: number): HTMLElement | null {
  if (!ready.length) return null;
  return h('section', { class: 'cos-ready' },
    h('h2', { class: 'bar' }, h('span', null, 'Ready to send'), h('span', { class: 'count' }, String(ready.length))),
    h('ul', null, ...ready.map((lead) => readyEntry(host, lead, now))),
  );
}

function readyEntry(host: PhoneHost, lead: Agent, now: number): HTMLElement {
  const line = readyLine(readOf(lead), now);
  const id = hailKey({ kind: 'turn', agent: lead });
  const key = `ready:${id}`;
  return h('li', { attrs: { 'data-key': key } },
    h('a', { class: 'cos-entry', href: host.agentHref(lead.id), style: `--accent:${focus.project(lead.projectId)?.color ?? 'var(--lcars-lilac)'}` },
      h('span', { class: 'text' }, h('strong', null, line.ask), h('small', null, `${lead.name} · ${host.workLabel(lead)}`))),
    h('blockquote', { class: 'cos-words' }, line.words),
    h('div', { class: 'actions' },
      host.button(`${key}:send`, '▶ Send', () => inbox.decide(id, { send: true }), { class: 'go' }),
      line.holdable ? host.button(`${key}:hold`, '✋ Hold', () => inbox.hold(id)) : null,
      h('small', { class: 'sends-in' }, line.when),
    ),
    host.errors(key),
  );
}

const chiefOfStaff: PhonePlugin = {
  id: CHIEF_OF_STAFF,
  // its Needs you, in place of the core's
  hails: true,
  home: (host) => {
    const now = Date.now();
    const ready = needsYou(focus.shownAgents(), focus.shownPrs(), focus.reviews).flatMap((a) => (a.kind === 'turn' && laneOf(a, now) === 'ready' ? [a.agent] : []));
    return [needsYouStrip(host, hailing(now)), readyStrip(host, ready, now)];
  },
};

export default chiefOfStaff;
