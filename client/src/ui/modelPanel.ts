import { dataView, type ModelFocus, sequenceView, structureView, toSvg } from '../../../shared/modelDrawing';
import { edgeFor } from '../../../shared/systemModel';
import type { ModelCite, SystemModel } from '../../../shared/types';
import { api } from '../net/api';
import { LCARS } from '../world/starship';
import type { Ui } from './context';
import { fill, h } from './dom';

// A system model up close (docs/studio.md): its three views live, as SVG, crisp at any size: the structure across the
// top, the sequence and the data under it. Step through the scenario (the arrows, or ← and →) and every view follows;
// click a part in any of them to pick it there and in the others, and see the lines of code it cites, with what it
// connects to and where.

/** Opens `model` up close. */
export function openModelPanel(ui: Ui, model: SystemModel): void {
  const focus: ModelFocus = {};
  const views = h('div', { class: 'model-views' });
  const part = h('div', { class: 'model-part' });
  const where = h('b', { class: 'model-step' });
  const back = h('button', { class: 'btn small' }, '◀');
  const on = h('button', { class: 'btn small' }, '▶');
  const step = (by: number) => {
    const n = model.trace.length;
    if (!n) return;
    const next = focus.step === undefined ? (by > 0 ? 0 : n - 1) : focus.step + by;
    focus.step = next < 0 || next >= n ? undefined : next;
    draw();
  };
  back.onclick = () => step(-1);
  on.onclick = () => step(1);

  const draw = () => {
    const s = focus.step !== undefined ? model.trace[focus.step] : undefined;
    where.textContent = s && focus.step !== undefined ? `Step ${focus.step + 1} of ${model.trace.length}: ${s.label}` : `Before the scenario starts · ${model.trace.length} steps`;
    views.innerHTML = `<div class="model-structure">${toSvg(structureView(model, focus))}</div><div class="model-row"><div>${toSvg(sequenceView(model, focus))}</div><div>${toSvg(dataView(model, focus))}</div></div>`;
  };

  views.addEventListener('click', (e) => {
    const picked = (e.target as Element | null)?.closest('[data-part]')?.getAttribute('data-part');
    if (!picked) return;
    focus.picked = focus.picked === picked ? undefined : picked;
    draw();
    void showPart(part, model, focus.picked);
  });
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  window.addEventListener('keydown', keys);

  const body = h('div', { class: 'model-panel' },
    h('div', { class: 'row model-bar' }, back, on, where, h('span', { class: 'grow' }), h('span', { class: 'muted' }, 'Click a part to see its code · ← → step')),
    h('div', { class: 'model-main' }, views, part),
  );
  ui.panels.open({ title: `Model · ${model.question}`, body, accent: LCARS.gold, full: true });
  ui.panels.own(() => window.removeEventListener('keydown', keys));
  draw();
  void showPart(part, model, undefined);
}

const short = (c: ModelCite) => `${c.file.split(/[\\/]/).slice(-2).join('/')}:${c.line}`;

/** The picked part: what it is, its code round its cite, and its connections with theirs. */
async function showPart(box: HTMLElement, model: SystemModel, id: string | undefined): Promise<void> {
  const n = model.nodes.find((x) => x.id === id);
  if (!n) {
    fill(box, h('p', { class: 'muted' }, 'Pick a part in any view to see the code it cites, and its connections.'),
      ...model.simplified.map((s) => h('p', { class: 'muted' }, `Simplified: ${s}`)));
    return;
  }
  const links = model.edges.filter((e) => e.from === n.id || e.to === n.id);
  const name = (x: string) => model.nodes.find((m) => m.id === x)?.label ?? x;
  const code = h('pre', { class: 'model-code' }, 'Loading…');
  fill(box,
    h('h3', null, n.label),
    h('p', { class: 'muted' }, `${n.kind} · ${n.layer}${n.symbol ? ` · ${n.symbol}` : ''}`),
    h('p', { class: n.found === false ? 'model-bad' : 'muted' }, n.cite ? `${short(n.cite)}${n.found === false ? ' (not found in the code)' : ''}` : 'No cite'),
    code,
    h('h4', null, 'Connections'),
    ...links.map((e) => h('p', { class: e.backed === false ? 'model-bad' : '' }, `${e.from === n.id ? '→' : '←'} ${e.kind} ${name(e.from === n.id ? e.to : e.from)}${e.cite ? ` · ${short(e.cite)}` : ''}${e.backed === false ? ' (not backed)' : ''}`)),
    ...model.trace.map((s, i) => (s.from === n.id || s.to === n.id) && edgeFor(model.edges, s.from, s.to) ? h('p', { class: 'muted' }, `Step ${i + 1}: ${s.label}`) : null),
  );
  if (!n.cite) return void (code.textContent = '');
  try {
    const src = await api.studioSource(n.cite.file, n.cite.line);
    fill(code, ...src.lines.map((l, i) => h('div', { class: src.from + i === src.line ? 'hit' : '' }, h('span', null, String(src.from + i).padStart(4)), ` ${l}`)));
  } catch (err) {
    code.textContent = err instanceof Error ? err.message : String(err);
  }
}
