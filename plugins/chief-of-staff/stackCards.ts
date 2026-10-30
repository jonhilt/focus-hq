import { answerLead, ARTIFACT_SIZE, artifactUrl, busy, focus, h, laneName, markdownHtml, optionUrl, prKey, qaBadge, spotCheckUrl, type Ui } from '../../plugin-api/client';
import type { Agent, PullRequest, QaReview } from '../../plugin-api/shared';
import { TW } from './bridgeKit';
import type { BoardPr } from './mergingRules';
import { isRecap } from './mentionRules';
import { mergeButton } from './needCard';
import type { Mention } from './shared';
import type { Card } from './stackRules';

// The cards of Comms' stack (stackRules.ts, README.md#the-watch): what a decision mentions drawn from what Focus holds
// as data, never a page about it. A pull request reads PullRequest, QA's review and the lead's recap, typed; an exhibit
// is a 1280 × 800 page, scaled to the card. Talk and the exhibits list are stream.ts's own.

/** Today's panel width, which a card never goes past, and what's inside its padding and a scroll bar. */
export const CARD_W = 460;
const INNER = CARD_W - 50;
/** How an exhibit's page, laid out at `ARTIFACT_SIZE`, scales to the card. */
const SCALE = INNER / ARTIFACT_SIZE.w;

type Lead = Pick<Agent, 'id' | 'name' | 'lead'>;

/** What a card, its spine and its mention say of the thing: its kind's glyph, its name, and where it stands. */
export interface Named {
  glyph: string;
  name: string;
  state: string;
}

/** A pull request on the board, by the mention's repo and number. */
const boardPr = (card: { repo: string; number: number }): BoardPr | undefined =>
  focus.shownPrs().find((b) => b.pr.repo === card.repo && b.pr.number === card.number);
const leadPr = (lead: Lead | undefined, card: { repo: string; number: number }) =>
  [...(lead?.lead?.prs ?? []), ...(lead?.lead?.landed ?? [])].find((p) => p.repo === card.repo && p.number === card.number);
const short = (repo: string, number: number) => `${repo.split('/')[1] ?? repo}#${number}`;

/** What a card is called on its spine and its mention. */
export function namedOf(card: Card, lead: Lead | undefined): Named {
  switch (card.kind) {
    case 'pr': {
      const on = boardPr(card);
      const outcome = leadPr(lead, card)?.outcome;
      const state = outcome ?? (on ? qaBadge(focus.reviews.get(prKey(card.repo, card.number)), on.pr).label : 'not open');
      return { glyph: 'PR', name: short(card.repo, card.number), state };
    }
    case 'artifact': {
      const x = lead?.lead?.artifacts?.find((a) => a.id === card.id);
      return { glyph: 'EX', name: x?.title ?? card.id, state: x?.slice ? `slice ${x.slice}` : '' };
    }
    case 'question': {
      const q = lead?.lead?.questions?.find((x) => x.id === card.id);
      return { glyph: 'Q', name: q?.question ?? card.id, state: q?.answer ? 'answered' : 'open' };
    }
    case 'talk':
      return { glyph: 'TALK', name: lead?.name ?? 'the lead', state: '' };
    case 'exhibits':
      return { glyph: 'EX', name: 'Exhibits', state: String((lead?.lead?.artifacts ?? []).filter((x) => !isRecap(x.id)).length) };
  }
}

/**
 * A decision's mentions, a row under its brief: each its glyph, name and state, and a slot at its end that's lit while
 * its card is open. Pressing one opens its card at the front, or closes it when it's lit.
 */
export function mentionsRow(mentions: readonly Mention[], lead: Lead | undefined, press: (m: Mention) => void): HTMLElement {
  return h('div', { class: 'tw:flex tw:flex-wrap tw:items-center tw:gap-[6px] tw:mt-[10px]', attrs: { 'data-part': 'mentions' } },
    h('span', { class: `${TW.label} tw:mr-[2px]` }, 'Mentions'),
    ...mentions.map((m) => {
      const { glyph, name, state } = namedOf(m, lead);
      return h('button', {
        class: 'tw:inline-flex tw:items-center tw:gap-[6px] tw:max-w-full tw:h-[26px] tw:pl-2 tw:pr-[6px] tw:bg-surface tw:border tw:border-solid tw:border-line tw:rounded-none tw:cursor-pointer tw:font-read tw:text-[12.5px] tw:text-ink tw:hover:bg-surface2',
        title: `${name}: open it beside the decision (press again to close it)`,
        attrs: { 'data-part': 'mention', 'data-kind': m.kind, 'data-id': m.id },
        onclick: () => press(m),
      },
      h('span', { class: 'tw:font-mono tw:text-[10.5px] tw:font-semibold tw:text-muted' }, glyph),
      h('span', { class: 'tw:truncate tw:max-w-[220px]' }, name),
      state ? h('span', { class: 'tw:text-muted tw:text-[12px] tw:whitespace-nowrap' }, state) : null,
      h('i', { class: 'tw:inline-block tw:w-[7px] tw:h-[7px] tw:shadow-[inset_0_0_0_1px_#8a94a3] tw:transition-colors tw:duration-300', attrs: { 'data-part': 'slot' } }));
    }));
}

/** Lights the slots of the mentions whose cards are open, in place, so nothing typed on the decision is lost. */
export function lightMentions(root: HTMLElement, open: (m: { kind: string; id: string }) => boolean): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-part=mention]')) {
    const lit = open({ kind: el.dataset.kind ?? '', id: el.dataset.id ?? '' });
    el.toggleAttribute('data-lit', lit);
    el.classList.toggle('tw:border-muted', lit);
    el.querySelector('[data-part=slot]')?.classList.toggle('tw:bg-ink', lit);
  }
}

const head = (kind: string, ...right: (HTMLElement | null)[]) =>
  h('div', { class: 'tw:flex tw:items-center tw:gap-2 tw:mb-1' }, h('span', { class: `${TW.ch} tw:flex-1` }, kind), ...right);
const link = (label: string, href: string, part: string, title?: string) =>
  h('a', { class: `${TW.btn} tw:no-underline`, href, target: '_blank', rel: 'noopener', title, attrs: { 'data-part': part } }, label);
const section = (label: string, part: string, ...body: (HTMLElement | string | null)[]) =>
  h('div', { class: 'tw:mt-3 tw:pt-[10px] tw:border-0 tw:border-t tw:border-solid tw:border-hair-card', attrs: { 'data-part': part } },
    h('div', { class: `${TW.label} tw:mb-[6px]` }, label), ...body);
const fact = (label: string, value: string) =>
  h('div', { class: 'tw:px-2 tw:py-[5px] tw:border-0 tw:border-l tw:border-solid tw:border-hair-card tw:first:border-l-0' },
    h('i', { class: `${TW.label} tw:block tw:not-italic` }, label), h('b', { class: 'tw:font-medium tw:text-[13px]' }, value));

/** Whether it merges onto its base cleanly, and where Ops' merge check on it stands. */
export function mergesSay(pr: Pick<PullRequest, 'mergeable' | 'mergeCheck' | 'isDraft'>): string {
  if (pr.isDraft) return 'draft';
  if (pr.mergeable === 'CONFLICTING') return 'conflicts';
  const check = pr.mergeCheck?.state;
  if (check === 'refused') return 'check refused';
  if (check === 'queued' || check === 'checking') return `check ${check}`;
  return pr.mergeable === 'MERGEABLE' ? 'cleanly' : 'not known yet';
}

/** Its size, as GitHub counts it: lines added and removed, and files changed. Nothing when GitHub didn't say. */
export function sizeSays(pr: Pick<PullRequest, 'additions' | 'deletions' | 'changedFiles'>): string {
  if (pr.additions === undefined || pr.deletions === undefined) return '';
  const files = pr.changedFiles === undefined ? '' : ` · ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'}`;
  return `+${pr.additions} −${pr.deletions}${files}`;
}

const MARK = { pass: '✓', fail: '✗', skip: '–' } as const;

/**
 * QA's proof, beside the merge: its verdict and summary, each check, where to look (its spot-checks, each to its line
 * on GitHub), the screenshots and the recording of its browser, and its report on the pull request.
 */
function qaProof(review: QaReview | undefined, pr: PullRequest): HTMLElement {
  const badge = qaBadge(review, pr).label;
  const report = review?.report;
  if (!review || !report) return section(`QA · ${badge}`, 'qa', review?.error ? h('div', { class: 'tw:text-[13px] tw:text-muted' }, review.error) : null);
  const shots = review.screenshots ?? [];
  const rec = review.recording;
  const clip = rec && (rec.mp4File ? `/api/qa-shots/${rec.mp4File}` : rec.mp4Url);
  return section(`QA · ${badge}${review.sha ? ` · ${review.sha.slice(0, 7)}` : ''}`, 'qa',
    h('div', { class: 'cos-md tw:text-[13.5px]/[1.55]', innerHTML: markdownHtml(report.summary) }),
    report.checks.length
      ? h('ul', { class: 'tw:list-none tw:p-0 tw:m-0 tw:mt-[6px] tw:text-[13px]' }, ...report.checks.map((c) =>
        h('li', { class: 'tw:grid tw:grid-cols-[16px_1fr] tw:gap-1', title: c.details }, h('span', { class: c.result === 'fail' ? 'tw:text-[#e5484d]' : 'tw:text-muted' }, MARK[c.result]), c.name)))
      : null,
    ...(report.spotChecks ?? []).map((s) => h('a', {
      class: 'tw:grid tw:grid-cols-[1fr_auto] tw:gap-2 tw:mt-[6px] tw:text-[13px] tw:text-ink tw:no-underline tw:hover:underline',
      href: spotCheckUrl(pr.url, s), target: '_blank', rel: 'noopener', title: 'Its line on GitHub', attrs: { 'data-part': 'spot' },
    }, h('span', null, 'Look at ', h('span', { class: 'tw:font-mono tw:text-[12px]' }, `${s.file}${s.line ? `:${s.line}` : ''}`), `: ${s.why}`), h('span', null, '↗'))),
    shots.length
      ? h('div', { class: 'tw:grid tw:grid-cols-2 tw:gap-[6px] tw:mt-2', attrs: { 'data-part': 'shots' } }, ...shots.map((s) =>
        h('a', { class: 'tw:block tw:text-[11.5px] tw:text-muted tw:no-underline', href: `/api/qa-shots/${s.file}`, target: '_blank', rel: 'noopener', title: s.caption },
          h('img', { class: 'tw:block tw:w-full tw:border tw:border-solid tw:border-hair-card', src: `/api/qa-shots/${s.file}`, alt: s.caption, loading: 'lazy' }),
          h('span', { class: 'tw:block tw:truncate tw:mt-[2px]' }, s.caption))))
      : null,
    clip
      ? h('figure', { class: 'tw:m-0 tw:mt-2', attrs: { 'data-part': 'recording' } },
        h('video', { class: 'tw:block tw:w-full tw:border tw:border-solid tw:border-hair-card', src: clip, controls: true, muted: true, preload: 'metadata' }),
        h('figcaption', { class: 'tw:text-[12px] tw:text-muted tw:mt-[2px]' }, `Recording · ${rec.shownSeconds}s of ${rec.realSeconds}s, ${rec.actions} actions`))
      : null,
    review.commentUrl ? h('div', { class: 'tw:mt-2' }, link('QA’s report ↗', review.commentUrl, 'qa-report', 'QA’s report on the pull request')) : null);
}

/** The lead's recap of the slice, typed: each primitive it touches, what it does to it, and the promises it could break. */
function recapOf(recap: NonNullable<NonNullable<Agent['lead']>['prs'][number]['recap']>): HTMLElement {
  const { primitives, invariants = [] } = recap.recap;
  return section('Recap', 'recap',
    ...primitives.map((p) => h('div', { class: 'tw:grid tw:grid-cols-[1fr_64px] tw:gap-2 tw:text-[12.5px]/[1.7]', title: p.paths.join('\n') },
      h('span', null, h('span', { class: 'tw:font-mono tw:text-[12px]' }, p.id), h('span', { class: 'tw:text-muted' }, ` · ${p.change}`)),
      h('i', { class: 'tw:not-italic tw:text-muted tw:text-right' }, p.impact))),
    invariants.length ? h('ul', { class: 'tw:m-0 tw:mt-[6px] tw:pl-4 tw:text-[12.5px] tw:text-muted' }, ...invariants.map((i) => h('li', null, i))) : null);
}

/**
 * A pull request's card: its lane and GitHub, title and branches, whether its checks pass, whether it merges cleanly,
 * QA's word, its size, QA's proof, the failing checks and the lead's recap, and at its foot the merge, as the board's.
 */
export function prCard(ui: Pick<Ui, 'error'>, card: { repo: string; number: number }, lead: Lead | undefined): HTMLElement {
  const on = boardPr(card);
  const mine = leadPr(lead, card);
  const url = on?.pr.url ?? mine?.url ?? '';
  const github = url ? link('GitHub ↗', url, 'github', 'Open it on GitHub (G)') : null;
  if (!on) {
    return h('div', null, head('Pull request', github),
      h('div', { class: 'tw:text-[15px]' }, mine?.recap?.title ?? short(card.repo, card.number)),
      h('div', { class: 'tw:mt-2 tw:text-[13.5px] tw:text-muted' }, mine?.outcome ? `It ${mine.outcome}.` : 'It isn’t open on the board.'));
  }
  const { pr } = on;
  const review = focus.reviews.get(prKey(pr.repo, pr.number));
  const size = sizeSays(pr);
  const merge = mergeButton(ui, on, 'tw:w-full tw:justify-center', TW.go, TW.btn);
  return h('div', null,
    head(`Pull request${mine?.lane ? ` · ${laneName(mine.lane)} lane` : ''}`, github),
    h('div', { class: 'tw:text-[16px]/[1.35]' }, pr.title),
    h('div', { class: 'tw:text-[12.5px] tw:text-muted tw:mt-[2px] tw:font-mono tw:truncate' }, `${pr.repo}#${pr.number} · ${pr.branch} → ${pr.baseBranch}`),
    h('div', { class: 'tw:grid tw:grid-cols-3 tw:mt-[10px] tw:border tw:border-solid tw:border-hair-card', attrs: { 'data-part': 'facts' } },
      fact('Checks', pr.checks), fact('Merges', mergesSay(pr)), fact('QA', qaBadge(review, pr).label)),
    size ? h('div', { class: 'tw:mt-[6px] tw:font-mono tw:text-[12px] tw:text-muted', attrs: { 'data-part': 'size' } }, size) : null,
    qaProof(review, pr),
    pr.failedChecks.length
      ? section('Failing checks', 'failing', ...pr.failedChecks.map((c) => (c.url ? h('a', { class: 'tw:block tw:text-[13px] tw:text-ink', href: c.url, target: '_blank', rel: 'noopener' }, `${c.name} ↗`) : h('div', { class: 'tw:text-[13px]' }, c.name))))
      : null,
    mine?.recap ? recapOf(mine.recap) : null,
    h('div', { class: 'tw:mt-3 tw:pt-[10px] tw:border-0 tw:border-t tw:border-solid tw:border-hair-card tw:flex tw:flex-col tw:gap-1', attrs: { 'data-part': 'merge' } },
      merge, h('small', { class: 'tw:text-center tw:text-[12px] tw:text-muted' }, merge.title)));
}

/** A lead's page, laid out at `ARTIFACT_SIZE`, scaled down whole to the card's width, live. */
const scaled = (src: string, title: string) =>
  h('div', { class: 'tw:relative tw:overflow-hidden tw:bg-white tw:border tw:border-solid tw:border-hair-card', style: `width:${INNER}px;height:${Math.round(ARTIFACT_SIZE.h * SCALE)}px` },
    h('iframe', { class: 'tw:absolute tw:left-0 tw:top-0 tw:border-0 tw:origin-top-left', src, title, attrs: { loading: 'lazy' }, style: `width:${ARTIFACT_SIZE.w}px;height:${ARTIFACT_SIZE.h}px;transform:scale(${SCALE})` }));

/** An exhibit's card: the page the lead put up, whole and live, scaled to the card, and a tab of its own. */
export function artifactCard(id: string, lead: Lead | undefined, when: (at: number) => string): HTMLElement {
  const x = lead?.lead?.artifacts?.find((a) => a.id === id);
  if (!lead || !x) return h('div', null, head('Exhibit'), h('div', { class: 'tw:text-[13.5px] tw:text-muted' }, 'It’s no longer on their screen.'));
  const src = artifactUrl(lead.id, x, 'html');
  return h('div', null,
    head(`Exhibit${x.slice ? ` · slice ${x.slice}` : ''}`, link('New tab ↗', src, 'new-tab')),
    h('div', { class: 'tw:text-[16px]/[1.35]' }, x.title),
    h('div', { class: 'tw:text-[12.5px] tw:text-muted tw:mt-[2px] tw:mb-[10px]' }, `${lead.name} put it up ${when(x.at)}`),
    scaled(src, x.title));
}

/** The lead's question's card: what they ask, why, and each option's page scaled to the card, picked from here. */
export function questionCard(ui: Pick<Ui, 'error'>, id: string, lead: Lead | undefined): HTMLElement {
  const q = lead?.lead?.questions?.find((x) => x.id === id);
  if (!lead || !q) return h('div', null, head('Question'), h('div', { class: 'tw:text-[13.5px] tw:text-muted' }, 'It’s no longer asked.'));
  const picked = q.answer?.option;
  return h('div', null,
    head(q.answer ? 'Question · answered' : 'Question'),
    h('div', { class: 'tw:text-[16px]/[1.35]' }, q.question),
    q.context ? h('div', { class: 'cos-md tw:text-[13.5px]/[1.55] tw:text-muted tw:mt-1', innerHTML: markdownHtml(q.context) }) : null,
    ...q.options.map((o) => {
      const pick: HTMLButtonElement = h('button', { class: o.id === picked ? TW.go : TW.btn, attrs: { 'data-part': 'pick' }, onclick: () => void busy(pick, () => answerLead(lead.id, q.id, o.id), ui.error) }, `Pick ${o.id.toUpperCase()}`);
      pick.disabled = !!q.answer;
      return section(`${o.id.toUpperCase()} · ${o.label}`, 'option',
        o.detail ? h('div', { class: 'tw:text-[13px] tw:text-muted tw:mb-[6px]' }, o.detail) : null,
        scaled(optionUrl(lead.id, q, o.id, 'html'), o.label),
        h('div', { class: 'tw:mt-[6px]' }, pick));
    }));
}
