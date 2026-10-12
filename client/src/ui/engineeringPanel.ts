import { chiefEngineer } from '../../../shared/crew';
import { FIX_SESSIONS, type FixEffect, type FixStatus, reportLines } from '../../../shared/ledger';
import type { FixKind, Retro, RetroDraft } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';
import { scorecardView } from './scorecardView';
import { markdownHtml } from './terminal';

const KIND: Record<FixKind, string> = { check: 'Check', 'qa-rule': 'QA rule', pointer: 'Pointer', delete: 'Delete' };

/**
 * The engineering station: the scorecard, the ledger's report card, and the chief engineer's retro. On the captain's word they look
 * over the session digests' frictions that keep coming back and draft an issue for each. They change nothing: the
 * captain accepts a draft (it's filed in the repository picked beside it) or rejects it.
 */
export function openEngineeringPanel(ui: Ui): void {
  const eng = chiefEngineer();
  const body = h('div', { class: 'engineering' });
  // the window outlives re-renders, so a retro finishing doesn't reset what you typed
  const days = h('input', { type: 'number', min: '1', max: '60', value: String(state.retro?.days ?? 14), style: 'width:80px' });

  // the agents' sessions from before digests began: counted once when the panel opens
  const older = h('div', { class: 'row', style: 'margin:10px 0' });
  const showOlder = (count: number) => {
    if (!count) return fill(older);
    const go = h('button', { class: 'btn small' }, 'Digest them');
    go.onclick = () => {
      void busy(go, () => api.backfillDigests().then(() => fill(older, h('span', { class: 'muted' }, `Digesting ${count} older sessions: the report card fills in as they’re done`))), ui.error);
    };
    fill(older, h('span', { class: 'muted grow' }, `${count} older agent sessions haven’t been digested`), go);
  };
  void api.undigested().then((r) => showOlder(r.sessions)).catch(() => undefined);

  const render = () => {
    const retro = state.retro;
    const card = state.report ? reportLines(state.report) : undefined;
    const running = retro?.status === 'gathering' || retro?.status === 'thinking';
    const start = h('button', { class: 'btn primary' }, retro?.status === 'done' ? 'Start a new retro' : 'Start a retro');
    start.disabled = running;
    start.onclick = () =>
      void busy(start, async () => {
        const window = Number(days.value);
        const { unread, costUsd } = await api.retroPreview(window);
        const reading = unread
          ? `${eng.name} first reads the ${unread} sessions of the last ${window} days no one has read yet, for their frictions: roughly $${costUsd.toFixed(2)} of Claude usage, a batch at a time with a pause between. Sessions read before aren’t read again.`
          : `Every session of the last ${window} days has been read already, so this only drafts.`;
        if (!confirm(`Start a retro?\n\n${reading}`)) return;
        await api.retroStart(window);
      }, ui.error).then(render);
    const stop = h('button', { class: 'btn' }, 'Stop');
    const ledger = h('button', { class: 'btn small' }, 'Review the ledger →');
    ledger.onclick = () => ui.openLedger();
    stop.onclick = () => void busy(stop, () => api.retroStop().then(() => undefined), ui.error);

    fill(body,
      scorecardView(ui),
      card ? h('div', { class: 'card' }, h('strong', null, card.headline), h('ul', null, ...card.lines.map((l) => h('li', null, l)))) : null,
      state.report?.fixes.length ? fixes(state.report.fixes) : null,
      older,
      h('div', { class: 'row', style: 'margin:14px 0' },
        h('span', { class: 'muted' }, 'Look back over the last'), days, h('span', { class: 'muted' }, 'days'),
        running ? stop : start,
        h('span', { class: 'grow' }),
        ledger,
        retro?.costUsd ? h('small', { class: 'muted' }, `$${retro.costUsd.toFixed(2)}`) : null,
      ),
      retro && retro.status !== 'idle' ? status(retro) : null,
      retro?.status === 'done' ? findings(ui, retro) : null,
      !retro || retro.status === 'idle'
        ? h('div', { class: 'briefing-note' }, `${eng.name} looks over the frictions found in the agents’ sessions in the window, and drafts an issue for each that came up in three or more, with the moments quoted. Accept one and it’s filed; reject it and it isn’t raised again. Nothing changes unless you say so.`)
        : null,
    );
  };

  ui.panels.open({ title: `${eng.name} · Chief engineer`, body, accent: LCARS.gold, wide: true });
  ui.panels.own(state.on('retro', render));
  ui.panels.own(state.on('report', render));
  ui.panels.own(state.on('scorecards', render));
  render();
}

function status(retro: Retro): HTMLElement {
  const tone = retro.status === 'failed' ? 'bad' : retro.status === 'done' ? 'ok' : 'warn';
  return h('div', { class: 'qa-now' },
    h('span', { class: `chip ${tone}` }, retro.status),
    h('div', { class: 'grow' },
      h('strong', null, retro.status === 'failed' ? (retro.error ?? retro.activity) : retro.activity),
      h('small', null, [
        retro.sessions ? `${retro.sessions} sessions over ${retro.days} days` : `the last ${retro.days} days`,
        retro.startedAt ? `started ${timeAgo(retro.startedAt)}` : '',
      ].filter(Boolean).join(' · ')),
    ),
  );
}

function findings(ui: Ui, retro: Retro): HTMLElement {
  return h('div', { class: 'cards' },
    retro.summary ? h('p', null, retro.summary) : null,
    retro.drafts.length ? h('h3', null, `Drafts (${retro.drafts.length})`) : null,
    ...retro.drafts.map((d, i) => draft(ui, d, i)),
    retro.watch.length ? h('h3', null, 'To watch: seen in two sessions') : null,
    retro.watch.length ? h('ul', null, ...retro.watch.map((w) => h('li', null, w))) : null,
  );
}

/** Where an accepted draft is filed: the last repository picked, kept between drafts and visits. */
const FILE_IN = 'focus.retro.fileIn';

function draft(ui: Ui, d: RetroDraft, i: number): HTMLElement {
  const head = h('div', { class: 'row' }, h('strong', { class: 'grow' }, `${i + 1}. ${d.title}`), h('span', { class: 'chip' }, KIND[d.kind]), h('span', { class: 'chip off' }, `${d.sessions} sessions`));
  const text = h('div', { class: 'markdown' });
  text.innerHTML = markdownHtml(d.body);
  const details = h('details', null, h('summary', null, 'The issue as it would be filed'), text);
  const tags = h('p', null, h('span', { class: 'label' }, 'Measure '), d.measure, h('br'), h('small', { class: 'muted' }, d.signatures.join(' · ')));
  if (d.decision) {
    const issue = d.decision.issue;
    const said = d.decision.accepted
      ? h('span', { class: 'chip ok' }, issue ? h('a', { href: issue.url, target: '_blank' }, `Filed ${issue.repo}#${issue.number}`) : 'Accepted')
      : h('span', { class: 'chip off' }, 'Rejected');
    return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, said, h('small', { class: 'muted' }, timeAgo(d.decision.at))));
  }
  const repos = state.projects.flatMap((p) => p.repos.map((repo) => ({ projectId: p.id, repo, label: `${repo} (${p.name})` })));
  const pick = h('select', null, ...repos.map((r) => h('option', { value: `${r.projectId} ${r.repo}` }, r.label)));
  const last = localStorage.getItem(FILE_IN);
  if (last && repos.some((r) => `${r.projectId} ${r.repo}` === last)) pick.value = last;
  const accept = h('button', { class: 'btn primary small' }, 'Accept and file');
  const reject = h('button', { class: 'btn small' }, 'Reject');
  accept.disabled = !repos.length;
  accept.onclick = () => {
    const [projectId, repo] = pick.value.split(' ');
    localStorage.setItem(FILE_IN, pick.value);
    void busy(accept, () => api.decideDraft(d.id, true, projectId, repo).then(() => undefined), ui.error);
  };
  reject.onclick = () => void busy(reject, () => api.decideDraft(d.id, false).then(() => undefined), ui.error);
  return h('div', { class: 'card retro-draft' }, head, tags, details, h('div', { class: 'row' }, h('small', { class: 'muted' }, 'File in'), pick, accept, reject));
}

const FIX: Record<FixStatus, { tone: string; label: string }> = {
  waiting: { tone: 'off', label: 'waiting for its fix' },
  'too-early': { tone: 'warn', label: 'too early to tell' },
  stopped: { tone: 'ok', label: 'stopped it' },
  fewer: { tone: 'ok', label: 'fewer' },
  recurring: { tone: 'bad', label: 'still recurring' },
};

const share = (c: { hits: number; sessions: number }) => `${c.hits} of ${c.sessions} sessions`;

/** Each retro fix the captain accepted: did its frictions stop coming up once it landed? */
function fixes(list: FixEffect[]): HTMLElement {
  return h('div', { class: 'cards', style: 'margin-top:12px' },
    h('h3', null, 'Retro fixes'),
    ...list.map((f) => {
      const { tone, label } = FIX[f.status];
      const issue = f.issue ? `${f.issue.repo}#${f.issue.number}` : 'not filed';
      const since = f.landed
        ? `since ${f.landed.repo}#${f.landed.pr} merged ${timeAgo(f.landed.at)}: ${share(f.after)}${f.status === 'too-early' ? ` (says once ${FIX_SESSIONS} are in)` : ''}`
        : 'its issue hasn’t been closed by a merge yet';
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('strong', { class: 'grow' }, f.title), h('span', { class: `chip ${tone}` }, label)),
        h('small', { class: 'muted' }, `${issue} · before: ${share(f.before)} · ${since}`),
      );
    }),
  );
}
