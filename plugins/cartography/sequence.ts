// A view's scenario drawn as a sequence diagram (README.md): a lifeline per part, in the order the steps reach them, and
// each step an arrow down the page, numbered, with what happens over it. Its evidence (steps.ts) styles the arrow: dashed
// gold for a recorded message, solid for an import, red for nothing behind it. Pure SVG, free of Node and the DOM.
import { esc, layerColours, wrap } from './draw';
import type { MapPart, MapView, RepoMap } from './shared';
import { type CheckedStep, scenarioSteps } from './steps';

/** How to read a scenario's sequence. */
export const SEQUENCE_KEY = 'Read down, a step at a time. Gold: seen in a recorded run (dashed, a message over the wire; solid, a call). Lilac: a cited line that checks out. White: only an import between the two. Red: nothing in the code backs it, or its cited line fails its check. Open a step for its evidence.';

/** The sequence's measures: a lifeline's column, its head, a step's row, and the type sizes (budgets.test.ts holds them). */
export const SEQ = { col: 200, pad: 30, headW: 180, headH: 58, top: 24, first: 120, row: 74, label: 16, head: 17 } as const;

const INK = { bg: '#0b1020', panel: '#121a33', text: '#e8ecf5', muted: '#9aa6c4', line: '#cfe3ff', flow: '#ffcc66', cite: '#c9a0ff', none: '#ff7a7a', life: '#3a4670' };

/** The parts a scenario goes through, in the order its steps first reach them. */
export function lifelines(map: RepoMap, view: MapView): MapPart[] {
  const parts = map.model?.parts ?? [];
  const order = [...new Set([...scenarioSteps(map, view).flatMap((s) => [s.from, s.to]), ...view.parts])];
  return order.map((id) => parts.find((p) => p.id === id)).filter((p): p is MapPart => !!p);
}

/** Where each lifeline stands, and how big the drawing is. */
export function placeSequence(map: RepoMap, view: MapView): { x: Map<string, number>; parts: MapPart[]; W: number; H: number } {
  const parts = lifelines(map, view);
  const x = new Map(parts.map((p, i) => [p.id, SEQ.pad + SEQ.col * (i + 0.5)]));
  return { x, parts, W: SEQ.pad * 2 + parts.length * SEQ.col, H: SEQ.first + scenarioSteps(map, view).length * SEQ.row };
}

/** How wide a step's label may run: over its arrow, and past its ends to two columns' width, since its row is its own. */
const labelWidth = (span: number): number => Math.max(span - 40, SEQ.col * 2 - 40);

/** A step's label, in the lines it takes over its arrow, and where its middle stands: kept inside the drawing. */
export function stepLabel(step: CheckedStep, x: ReadonlyMap<string, number>, W: number): { lines: string[]; mid: number } {
  const a = x.get(step.from) ?? 0;
  const b = x.get(step.to) ?? 0;
  const max = labelWidth(Math.abs(b - a));
  const half = Math.min(max, W - 2 * SEQ.pad) / 2;
  const mid = a === b ? a + 70 : (a + b) / 2;
  return { lines: wrap(step.says, SEQ.label, max), mid: Math.min(Math.max(mid, SEQ.pad + half), W - SEQ.pad - half) };
}

/** Scenario `view` of `map`, its `steps` checked: lifelines left to right, and the steps down the page. */
export function sequenceSvg(map: RepoMap, view: MapView, steps: readonly CheckedStep[]): string {
  const { x, parts, W, H } = placeSequence(map, view);
  const colours = layerColours(map.model?.parts ?? []);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,sans-serif">`,
    `<defs>${[['cg-seq', INK.line], ['cg-seq-flow', INK.flow], ['cg-seq-cite', INK.cite], ['cg-seq-none', INK.none]].map(([id, fill]) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`).join('')}</defs>`,
  ];
  for (const part of parts) {
    const cx = x.get(part.id) ?? 0;
    const colour = colours.get(part.layer) ?? INK.muted;
    const name = wrap(part.label, SEQ.head, SEQ.headW - 20);
    out.push(
      `<line x1="${cx}" y1="${SEQ.top + SEQ.headH}" x2="${cx}" y2="${H - 8}" stroke="${INK.life}" stroke-width="2" stroke-dasharray="4 6"/>`,
      `<g><title>${esc(`${part.label}: ${part.does ?? part.paths.join(', ')}`)}</title>`,
      `<rect x="${cx - SEQ.headW / 2}" y="${SEQ.top}" width="${SEQ.headW}" height="${SEQ.headH}" rx="9" fill="${INK.panel}" stroke="${colour}" stroke-width="2.5"/>`,
      ...name.map((line, i) => `<text x="${cx}" y="${SEQ.top + SEQ.headH / 2 + 6 + (i - (name.length - 1) / 2) * 19}" text-anchor="middle" font-size="${SEQ.head}" font-weight="650" fill="#fff">${esc(line)}</text>`),
      '</g>',
    );
  }
  steps.forEach((step, i) => {
    const y = SEQ.first + i * SEQ.row + 40;
    const a = x.get(step.from) ?? 0;
    const b = x.get(step.to) ?? 0;
    const has = (k: string) => step.evidence.some((e) => e.kind === k);
    // a cite that doesn't hold makes the step as doubtful as one with nothing behind it
    const kind = step.problem ? 'none' : has('flow') ? 'flow' : has('call') ? 'call' : has('cite') ? 'cite' : step.evidence.length ? 'import' : 'none';
    const [colour, marker, dash] =
      kind === 'flow' ? [INK.flow, 'cg-seq-flow', ' stroke-dasharray="10 6"']
      : kind === 'call' ? [INK.flow, 'cg-seq-flow', '']
      : kind === 'cite' ? [INK.cite, 'cg-seq-cite', '']
      : kind === 'none' ? [INK.none, 'cg-seq-none', ' stroke-dasharray="4 5"']
      : [INK.line, 'cg-seq', ''];
    const { lines: label, mid } = stepLabel(step, x, W);
    const said = `${i + 1}. ${step.says}${step.problem ? ` (${step.problem})` : kind === 'none' ? ' (nothing in the code backs this step)' : ''}`;
    // a step within one part loops out to its right and back
    const d = a === b ? `M${a},${y - 12} C${a + 60},${y - 12} ${a + 60},${y + 12} ${a + 6},${y + 12}` : `M${a + (b > a ? 8 : -8)},${y} L${b + (b > a ? -6 : 6)},${y}`;
    out.push(
      `<g><title>${esc(said)}</title>`,
      `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2.5"${dash} marker-end="url(#${marker})"/>`,
      ...label.map((line, j) => `<text x="${mid}" y="${y - 16 - (label.length - 1 - j) * 19}" text-anchor="middle" font-size="${SEQ.label}" stroke="${INK.bg}" stroke-width="6" stroke-linejoin="round" paint-order="stroke" fill="${kind === 'none' ? INK.none : INK.text}">${esc(line)}</text>`),
      `<circle cx="${a}" cy="${y}" r="13" fill="${INK.bg}" stroke="${colour}" stroke-width="2"/><text x="${a}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${i + 1}</text>`,
      '</g>',
    );
  });
  out.push('</svg>');
  return out.join('');
}
