import { busy, confirmDialog, focus, h, LCARS, timeAgo, type Ui } from '../../plugin-api/client';
import { inbox } from './inboxApi';
import { type LandedAnswer, type LandedItem, landedWhere } from './landed';

// A slice that merged itself in Show, at the end of its goal's thread in Comms (stream.ts, README.md#landed-in-show):
// what landed, why the chief of staff let it, and the captain's three answers. Got it says they've heard; Redirect
// sends the lead their words; Revert has the lead undo it as their next slice. Each is recorded, and the card leaves.

/** The colour down a landed card's edge: news, not a call to make. */
export const LANDED_TONE = LCARS.lilac;

/** The card: once answered, `done` (the stream asks the inbox again, and the card's gone). */
export function landedCard(ui: Pick<Ui, 'error'>, item: LandedItem, done: () => void): HTMLElement {
  const project = focus.shown.find((p) => p.id === item.projectId)?.name;
  const url = `https://github.com/${item.repo}/pull/${item.number}`;
  const words = h('textarea', { class: 'cos-reply-text', attrs: { rows: '3', placeholder: `Words for ${item.who}: what to do instead, or why to revert it` } });
  const answer = (b: HTMLButtonElement, a: () => LandedAnswer | undefined) =>
    void busy(b, async () => {
      const said = a();
      if (!said) return;
      await inbox.decideLanded(item.id, said);
      done();
    }, ui.error);
  const got = h('button', { class: 'btn small primary', title: 'You’ve heard: off Comms, nothing sent', attrs: { 'data-act': 'ack' } }, 'Got it');
  got.onclick = () => answer(got, () => ({ ack: true }));
  const redirect = h('button', { class: 'btn small', title: `Send ${item.who} your words above, about what landed` }, 'Redirect');
  redirect.onclick = () => answer(redirect, () => {
    if (words.value.trim()) return { redirect: words.value.trim() };
    words.focus();
    return undefined;
  });
  const revert = h('button', { class: 'btn small danger', title: `${item.who} reverts it as their next slice, your words above as why` }, 'Revert');
  revert.onclick = () =>
    void busy(revert, async () => {
      if (!await confirmDialog({ title: 'Revert', message: `${item.who} reverts ${landedWhere(item)} as their next slice.`, confirmLabel: 'Revert it' })) return;
      await inbox.decideLanded(item.id, { revert: words.value.trim() });
      done();
    }, ui.error);
  return h('div', { class: 'cos-card', style: `--tone:${LANDED_TONE}` },
    h('div', { class: 'cos-need-title' }, item.goal ?? 'A slice landed'),
    h('div', { class: 'cos-need-trail' }, [project, item.who, `merged ${timeAgo(item.at)}`].filter(Boolean).join(' · ')),
    h('div', { class: 'cos-card-what' }, h('span', null, '✓'), `${landedWhere(item)} merged itself in Show`),
    item.why ? h('div', { class: 'cos-card-context' }, h('strong', null, 'Chief of Staff: '), item.why) : null,
    h('a', { class: 'muted', href: url, target: '_blank', rel: 'noopener', title: 'Its system recap heads the description' }, 'Open it on GitHub, its recap at the top ›'),
    words,
    h('div', { class: 'row cos-quick' }, got, redirect, revert),
    h('small', { class: 'cos-need-then' }, 'Nothing waits on you: it’s merged. Redirect or Revert goes to the lead as your message.'),
  );
}
