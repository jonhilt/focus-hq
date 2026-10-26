import { busy, fill, focus, h } from '../../plugin-api/client';
import type { Agent, GoalArtifact } from '../../plugin-api/shared';
import { artifactUrl, prKey, qaBadge } from '../../plugin-api/shared';
import { activity, age, conversation, doing, previewFor, WORKSPACE_TABS, type WorkspaceTab } from './streamList';
import type { ThreadEntry } from './thread';

// A lead's workspace (README.md#a-thread-per-goal): the stream's pane at the right, beside the goal's thread. A tab each
// for what the lead works with besides the thread: their conversation (their words and the captain's alone), what they
// put on their station's screen, the preview of their pull request when the project runs one, their pull requests with
// QA's word on each, and what they've been doing lately. The box to talk to the lead is at its foot: it's who it's for.

/** The tab the workspace was on, and the screen's visual picked, when the stream last closed. */
let keptTab: WorkspaceTab = 'talk';
let keptArt: string | null = null;

type LeadPr = NonNullable<Agent['lead']>['prs'][number];

/** A pull request's line in the workspace: merged, closed or open, QA's word while it's open, and its recap's title. */
const prLine = (p: LeadPr): string =>
  [p.outcome ?? 'open', p.outcome ? null : qaBadge(focus.reviews.get(prKey(p.repo, p.number)), { headSha: p.sha ?? '' }).label, p.recap?.title].filter(Boolean).join(' · ');

export interface Workspace {
  el: HTMLElement;
  /** Shows lead `lead`'s workspace with their thread's `entries`; drawn again only when what the tab shows changed. */
  show(lead: Agent, entries: readonly ThreadEntry[]): void;
}

export function workspace(opts: {
  /** How an entry of the thread reads, as the stream draws it. */
  entryEl: (e: ThreadEntry, lead: string) => HTMLElement;
  fold: () => void;
  send: (lead: Agent, words: string) => Promise<unknown>;
  error: (message: string) => void;
  /** Hands over what stops the workspace listening, for when the stream closes. */
  own: (stop: () => void) => void;
}): Workspace {
  const title = h('b', null);
  const live = h('i', { class: 'cos-st-dot' });
  const status = h('small', null);
  const tabs = h('div', { class: 'cos-ws-tabs' });
  const body = h('div', { class: 'cos-ws-body' });
  const talkSlot = h('div', { class: 'cos-ws-talk' });
  const el = h('div', { class: 'cos-ws' },
    h('div', { class: 'cos-ws-h' }, live, title, status, h('button', { class: 'cos-st-foldbtn', title: 'Fold the workspace away', onclick: opts.fold }, '›')),
    tabs, body, talkSlot);

  let lead: Agent | undefined;
  let entries: readonly ThreadEntry[] = [];
  let shownKey = '';
  let talkFor = '';

  // what the tab shows depends on: drawn again only when it changes, so nothing jumps under the captain's eyes
  const keyOf = (a: Agent): string => {
    const work = a.lead;
    const preview = focus.preview(a.projectId);
    // the browser keeps a capped log, so its length stops changing: the last line says when one came in
    const lines = focus.lines(a.id);
    const last = lines.at(-1);
    const parts: Record<WorkspaceTab, string> = {
      talk: `${entries.length}|${entries.at(-1)?.at ?? ''}`,
      screen: `${(work?.artifacts ?? []).map((x) => `${x.id}@${x.at}${x.image ? '+' : ''}`).join(',')}|${keptArt ?? ''}`,
      browser: preview ? `${preview.repo}#${preview.number}|${preview.status}|${preview.links[0]?.url ?? ''}|${preview.activity}|${preview.error ?? ''}|${preview.title}` : '',
      // what each pull request's line says, QA's badge included (it reads more of a review than its status)
      prs: [...(work?.landed ?? []), ...(work?.prs ?? [])].map((p) => `${p.repo}#${p.number}:${prLine(p)}`).join(','),
      activity: `${lines.length}|${last?.t ?? ''}|${last?.text ?? ''}`,
    };
    return `${a.id}|${keptTab}|${parts[keptTab]}`;
  };

  const draw = () => {
    if (!lead) return;
    const a = lead;
    const work = a.lead;
    const prs = [...(work?.landed ?? []), ...(work?.prs ?? [])];
    const counts: Record<WorkspaceTab, number> = {
      talk: conversation(entries).length,
      screen: work?.artifacts?.length ?? 0,
      browser: previewFor(focus.preview(a.projectId), prs) ? 1 : 0,
      prs: prs.length,
      activity: activity(focus.lines(a.id)).length,
    };
    fill(tabs, ...WORKSPACE_TABS.map((t) => h('button', { class: `cos-ws-tab${keptTab === t.tab ? ' on' : ''}`, onclick: () => { keptTab = t.tab; draw(); } }, t.label, counts[t.tab] ? h('span', null, String(counts[t.tab])) : null)));
    const key = keyOf(a);
    if (key === shownKey) return;
    shownKey = key;
    const drawTab: Record<WorkspaceTab, () => HTMLElement[]> = {
      talk: () => talkTab(a),
      screen: () => screenTab(a),
      browser: () => browserTab(a, prs),
      prs: () => prsTab(prs),
      activity: () => activityTab(a),
    };
    fill(body, ...drawTab[keptTab]());
    // the conversation and the activity read from the end
    if (keptTab === 'talk' || keptTab === 'activity') body.scrollTop = body.scrollHeight;
  };

  const talkTab = (a: Agent): HTMLElement[] => {
    const said = conversation(entries);
    return said.length ? said.map((e) => opts.entryEl(e, a.name)) : [h('p', { class: 'muted' }, 'Nothing said yet.')];
  };

  const screenTab = (a: Agent): HTMLElement[] => {
    const arts = [...(a.lead?.artifacts ?? [])].sort((x, y) => y.at - x.at);
    if (!arts.length) return [h('p', { class: 'muted' }, `${a.name} hasn't put anything on their screen.`)];
    const shown = arts.find((x) => x.id === keptArt) ?? arts[0];
    const pick = (x: GoalArtifact) => () => { keptArt = x.id; draw(); };
    return [
      h('div', { class: 'cos-ws-art-h' }, h('b', null, shown.title), h('small', null, `${age(Date.now() - shown.at)} ago`), h('a', { href: artifactUrl(a.id, shown, 'html'), target: '_blank', rel: 'noopener' }, 'Open ›')),
      // its picture fits the pane (the page is laid out for the station's screen); without one, the page itself
      shown.image ? h('a', { href: artifactUrl(a.id, shown, 'html'), target: '_blank', rel: 'noopener' }, h('img', { class: 'cos-ws-pic', src: artifactUrl(a.id, shown, 'jpg'), alt: shown.title })) : h('iframe', { class: 'cos-ws-frame', src: artifactUrl(a.id, shown, 'html'), title: shown.title }),
      ...(arts.length > 1 ? [h('div', { class: 'cos-ws-thumbs' }, ...arts.map((x) => h('button', { class: `cos-ws-thumb${x === shown ? ' on' : ''}`, onclick: pick(x) },
        x.image ? h('img', { src: artifactUrl(a.id, x, 'jpg'), alt: '' }) : null, h('span', null, x.title), h('small', null, `${age(Date.now() - x.at)} ago`))))] : []),
    ];
  };

  const browserTab = (a: Agent, prs: readonly { repo: string; number: number }[]): HTMLElement[] => {
    const preview = previewFor(focus.preview(a.projectId), prs);
    if (!preview) return [h('p', { class: 'muted' }, `No preview of ${a.name}'s pull requests is running. Start one from the pull request's ▶ Preview.`)];
    const url = preview.links[0]?.url;
    return [
      h('div', { class: 'cos-ws-url' }, h('span', null, `${preview.repo}#${preview.number}`), h('span', { class: 'cos-ws-url-at' }, url ?? preview.activity), url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open ›') : null),
      url && preview.status === 'running' ? h('iframe', { class: 'cos-ws-frame tall', src: url, title: preview.title }) : h('p', { class: 'muted' }, preview.error ?? preview.activity),
    ];
  };

  const prsTab = (prs: readonly LeadPr[]): HTMLElement[] => {
    if (!prs.length) return [h('p', { class: 'muted' }, 'No pull requests yet.')];
    return [...prs].reverse().map((p) => h('div', { class: `cos-ws-pr ${p.outcome ?? 'open'}` },
      h('a', { href: p.url, target: '_blank', rel: 'noopener' }, `${p.repo}#${p.number}`),
      h('span', null, prLine(p))));
  };

  const activityTab = (a: Agent): HTMLElement[] => {
    const done = activity(focus.lines(a.id));
    if (!done.length) return [h('p', { class: 'muted' }, 'Nothing recorded yet.')];
    return done.map((x) => h('div', { class: `cos-ws-act ${x.kind}` }, h('small', null, new Date(x.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })), h('span', null, x.text)));
  };

  // the box to talk to the lead: made once per lead, so a reply being written isn't wiped as the pane is drawn again
  const drawTalk = (a: Agent) => {
    if (talkFor === a.id) return;
    talkFor = a.id;
    const box = h('textarea', { rows: 2, placeholder: `Write to ${a.name}: it goes straight to them` });
    const send = h('button', { class: 'cos-st-send', onclick: () => {
      const words = box.value.trim();
      if (words) void busy(send, () => opts.send(a, words).then(() => { box.value = ''; }), opts.error);
    } }, 'Send');
    fill(talkSlot, h('div', { class: 'cos-st-talk' }, box, send));
  };

  // a lead's activity comes in as they work: drawn again while it's what the pane shows
  opts.own(focus.onLines((id) => {
    if (lead && id === lead.id && keptTab === 'activity') draw();
  }));

  return {
    el,
    show(a, list) {
      lead = a;
      entries = list;
      title.textContent = `${a.name}'s workspace`;
      status.textContent = doing(a.status);
      live.className = `cos-st-dot ${a.status === 'error' ? 'error' : ['working', 'testing', 'pushing', 'setting-up'].includes(a.status) ? 'working' : ''}`;
      drawTalk(a);
      draw();
    },
  };
}
