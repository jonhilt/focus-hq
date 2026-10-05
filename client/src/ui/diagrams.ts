import type { BriefDiagram } from '../../../shared/types';
import { fill, h } from './dom';

type Drawn = { svg: string } | { error: string };

// Mermaid is big, so it's fetched only once there's a diagram to draw, and kept out of the office's start-up bundle
let mermaid: Promise<typeof import('mermaid').default> | null = null;
const load = () =>
  (mermaid ??= import('mermaid').then(({ default: m }) => {
    // drawn at their natural size (the aside scrolls) rather than shrunk to its width, where labels get too small to read
    const natural = { useMaxWidth: false };
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      suppressErrorRendering: true,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      flowchart: natural,
      sequence: natural,
      class: natural,
    });
    return m;
  }));

// the panel redraws on every briefing event, so each source is drawn once and its result reused, finished or not
const drawn = new Map<string, Drawn>();
const drawing = new Map<string, Promise<Drawn>>();
let ids = 0;

function draw(source: string): Promise<Drawn> {
  let pending = drawing.get(source);
  if (!pending) {
    pending = load()
      .then((m) => m.render(`brief-diagram-${++ids}`, source))
      .then(({ svg }): Drawn => ({ svg }), (err: unknown): Drawn => ({ error: err instanceof Error ? err.message : String(err) }))
      .then((result) => {
        drawn.set(source, result);
        return result;
      });
    drawing.set(source, pending);
  }
  return pending;
}

function show(slot: HTMLElement, result: Drawn, source: string): void {
  if ('svg' in result) {
    slot.innerHTML = result.svg;
    return;
  }
  fill(slot, h('p', { class: 'brief-diagram-error' }, `⚠ ${result.error}`), h('pre', null, source));
}

/** A diagram on the wall screen under its title: the SVG once Mermaid has drawn it, or its source and the error if it can't. */
export function diagramView(diagram: BriefDiagram): HTMLElement {
  const slot = h('div', { class: 'brief-diagram-svg' });
  const done = drawn.get(diagram.mermaid);
  if (done) {
    show(slot, done, diagram.mermaid);
  } else {
    slot.append(h('p', { class: 'muted' }, 'Drawing…'));
    void draw(diagram.mermaid).then((result) => show(slot, result, diagram.mermaid));
  }
  return h('figure', { class: 'brief-diagram' }, h('figcaption', null, diagram.title || 'Untitled'), slot);
}
