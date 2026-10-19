// A machine drawn (layout.ts laid it out): its states and arrows, with the states its runs are in now lit, each saying
// who's there, and the compound states round them outlined. One SVG, for the holodeck's screen and up close.
import type { MachineRun } from '../../plugin-api/shared';
import type { LaidState, MachineLayout } from './shared';

export const INK = {
  bg: '#0b1020',
  state: '#18233a',
  stroke: '#7e93b8',
  text: '#e8e4d8',
  edge: '#6f86a8',
  label: '#b9c2d6',
  final: '#1d3320',
  finalStroke: '#9fd39f',
  compound: '#5a6b8a',
  title: '#9fd3c7',
  lit: '#ffcc66',
  litText: '#14110a',
} as const;

const FONT = 'system-ui, sans-serif';

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Who's in a state, in a few words: one name, or one and how many more. */
export function whoIsThere(labels: readonly string[]): string {
  if (!labels.length) return '';
  const first = labels[0].length > 22 ? `${labels[0].slice(0, 21)}…` : labels[0];
  return labels.length === 1 ? first : `${first} +${labels.length - 1}`;
}

/** The runs in each state, by its id, and every compound state any of them is in. */
export function occupied(runs: readonly MachineRun[]): { at: Map<string, string[]>; within: Set<string> } {
  const at = new Map<string, string[]>();
  const within = new Set<string>();
  for (const run of runs) {
    at.set(run.state, [...(at.get(run.state) ?? []), run.label]);
    const parts = run.state.split('.');
    for (let i = 1; i < parts.length; i++) within.add(parts.slice(0, i).join('.'));
  }
  return { at, within };
}

function stateBox(s: LaidState, who: string[] | undefined, within: boolean): string {
  if (s.kind === 'anywhere') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.h / 2}" fill="none" stroke="${INK.stroke}" stroke-width="1.5" stroke-dasharray="3 3"/>`
      + `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + 5}" text-anchor="middle" fill="${INK.label}" font-size="15" font-style="italic">${escape(s.key)}</text>`;
  }
  if (s.kind === 'compound') {
    const stroke = within ? INK.lit : INK.compound;
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12" fill="none" stroke="${stroke}" stroke-width="${within ? 2.5 : 1.5}" stroke-dasharray="6 4"/>`
      + `<text x="${s.x + 12}" y="${s.y + 21}" fill="${within ? INK.lit : INK.title}" font-size="15" font-weight="600">${escape(s.key)}</text>`;
  }
  const lit = !!who?.length;
  const fill = lit ? INK.lit : s.kind === 'final' ? INK.final : INK.state;
  const stroke = lit ? INK.lit : s.kind === 'final' ? INK.finalStroke : INK.stroke;
  const box = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${lit ? 3 : 1.5}"/>`
    + `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + 5}" text-anchor="middle" fill="${lit ? INK.litText : INK.text}" font-size="15" font-weight="${lit ? 700 : 500}">${escape(s.key)}</text>`;
  if (!lit) return box;
  // who's there, on a tag under the box
  const tag = whoIsThere(who);
  const w = tag.length * 7.4 + 14;
  return `${box}<rect x="${s.x + s.w / 2 - w / 2}" y="${s.y + s.h + 3}" width="${w}" height="19" rx="9.5" fill="${INK.bg}" stroke="${INK.lit}"/>`
    + `<text x="${s.x + s.w / 2}" y="${s.y + s.h + 17}" text-anchor="middle" fill="${INK.lit}" font-size="13">${escape(tag)}</text>`;
}

/** `layout` as an SVG, with `runs` (of its machine) drawn over it: the states they're in lit, saying who. */
export function machineSvg(layout: MachineLayout, runs: readonly MachineRun[]): string {
  const { at, within } = occupied(runs.filter((r) => r.machine === layout.id));
  // compound states under the arrows, the states in them over
  const box = (s: LaidState) => stateBox(s, at.get(s.id), within.has(s.id));
  const compounds = layout.states.filter((s) => s.kind === 'compound').map(box);
  const leaves = layout.states.filter((s) => s.kind !== 'compound').map(box);
  const lines = layout.edges.map((e) => {
    const points = e.points.map((p) => `${p.x},${p.y}`).join(' ');
    const label = e.at ? `<text x="${e.at.x}" y="${e.at.y + 11}" fill="${INK.label}" font-size="12">${escape(e.label)}</text>` : '';
    return `<polyline points="${points}" fill="none" stroke="${INK.edge}" stroke-width="1.4" marker-end="url(#arrow)"/>${label}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="${FONT}">`
    + `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${INK.edge}"/></marker></defs>`
    + `${compounds.join('')}${lines.join('')}${leaves.join('')}</svg>`;
}
