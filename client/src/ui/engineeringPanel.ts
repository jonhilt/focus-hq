import { chiefEngineer } from '../../../shared/crew';
import { reportLines } from '../../../shared/ledger';
import type { FixKind, Retro, RetroProposal } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { busy, fill, h, timeAgo } from './dom';

const KIND: Record<FixKind, string> = { check: 'Check', 'qa-rule': 'QA rule', pointer: 'Pointer', delete: 'Delete' };

/**
 * The engineering station: the ledger's report card, and the chief engineer's retro. On the captain's word they look
 * back over the office's recent sessions and propose changes to how it works, each resting on moments they cite. They
 * change nothing; what to do with a proposal is the captain's call.
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
      if (!confirm(`Digest ${count} older sessions? Haiku reads each one for its frictions: roughly $${(count * 0.04).toFixed(2)} all told, and it runs in the background.`)) return;
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
    start.onclick = () => void busy(start, () => api.retroStart(Number(days.value)).then(() => undefined), ui.error).then(render);
    const stop = h('button', { class: 'btn' }, 'Stop');
    stop.onclick = () => void busy(stop, () => api.retroStop().then(() => undefined), ui.error);

    fill(body,
      card ? h('div', { class: 'card' }, h('strong', null, card.headline), h('ul', null, ...card.lines.map((l) => h('li', null, l)))) : null,
      older,
      h('div', { class: 'row', style: 'margin:14px 0' },
        h('span', { class: 'muted' }, 'Look back over the last'), days, h('span', { class: 'muted' }, 'days'),
        running ? stop : start,
        h('span', { class: 'grow' }),
        retro?.costUsd ? h('small', { class: 'muted' }, `$${retro.costUsd.toFixed(2)}`) : null,
      ),
      retro && retro.status !== 'idle' ? status(retro) : null,
      retro?.status === 'done' ? findings(retro) : null,
      !retro || retro.status === 'idle'
        ? h('div', { class: 'briefing-note' }, `${eng.name} reads every agent’s session in the window (who said what, QA’s verdicts, the tool errors), the ledger and closed goals, and brings you the changes to how the office works that the evidence supports. Each one cites the moments it rests on. Nothing changes unless you act on it.`)
        : null,
    );
  };

  ui.panels.open({ title: `${eng.name} · Chief engineer`, body, accent: LCARS.gold, wide: true });
  ui.panels.own(state.on('retro', render));
  ui.panels.own(state.on('report', render));
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

function findings(retro: Retro): HTMLElement {
  return h('div', { class: 'cards' },
    retro.summary ? h('p', null, retro.summary) : null,
    h('h3', null, `Proposals (${retro.proposals.length})`),
    ...retro.proposals.map(proposal),
    retro.wentWell.length ? h('h3', null, 'Went well') : null,
    retro.wentWell.length ? h('ul', null, ...retro.wentWell.map((w) => h('li', null, w))) : null,
    retro.watch.length ? h('h3', null, 'To watch') : null,
    retro.watch.length ? h('ul', null, ...retro.watch.map((w) => h('li', null, w))) : null,
  );
}

function proposal(p: RetroProposal, i: number): HTMLElement {
  return h('div', { class: 'card retro-proposal' },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, `${i + 1}. ${p.title}`), h('span', { class: 'chip' }, KIND[p.kind])),
    h('p', null, p.problem),
    h('p', null, h('span', { class: 'label' }, 'Fix '), p.fix),
    h('p', null, h('span', { class: 'label' }, 'Measure '), p.measure),
    h('details', null,
      h('summary', null, `Evidence (${p.evidence.length})`),
      h('ul', null, ...p.evidence.map((e) => h('li', null, h('code', null, e.session), e.at ? ` ${e.at}` : '', `: ${e.quote}`))),
    ),
  );
}
