import { h } from '../../plugin-api/client';

// A card's pictures side by side are too small to review: pressed, one opens large over Comms, live, and ← and →
// step through the rest. Esc closes it and nothing else, so the captain is back where they were in Comms.

/** One of the pictures a card shows side by side: its live page, and a press to pick it, when it's an option. */
export interface Zoomable {
  title: string;
  detail?: string;
  html: string;
  pick?: { label: string; run: () => void };
}

/** The size the lead's pages are laid out for (the screen's), scaled to fit what's left of the window. */
const PAGE = { w: 1280, h: 800 };

/** The scale that fits a page into `w` by `h`, never larger than it is. */
export const fitScale = (w: number, h: number): number => Math.min(1, w / PAGE.w, h / PAGE.h);

/** Where a step from `at` lands among `n`, round from the end to the start and back. */
export const zoomStep = (at: number, step: number, n: number): number => (((at + step) % n) + n) % n;

/** Opens `items[start]` large over everything, returning how to close it. */
export function openZoom(items: readonly Zoomable[], start: number): () => void {
  let at = start;
  const frame = h('iframe', { class: 'cos-zoom-frame', attrs: { sandbox: 'allow-scripts', width: String(PAGE.w), height: String(PAGE.h) } });
  const stage = h('div', { class: 'cos-zoom-stage' }, frame);
  const title = h('strong');
  const detail = h('small', { class: 'muted' });
  const pick = h('button', { class: 'btn small primary' });
  const count = h('small', { class: 'muted' });
  const prev = h('button', { class: 'btn small', title: 'The one before (←)', onclick: () => show(-1) }, '‹');
  const next = h('button', { class: 'btn small', title: 'The next one (→)', onclick: () => show(1) }, '›');
  const shut = h('button', { class: 'btn small', title: 'Back to Comms (Esc)', onclick: () => close() }, 'Close');
  const bar = h('div', { class: 'cos-zoom-bar' }, prev, count, next, h('div', { class: 'cos-zoom-says' }, title, detail), pick, shut);
  const box = h('div', { class: 'cos-zoom', onclick: (e: MouseEvent) => e.target === box && close() }, stage, bar);

  const fit = () => {
    const s = fitScale(stage.clientWidth, stage.clientHeight);
    frame.style.transform = `scale(${s})`;
    frame.style.margin = `${(stage.clientHeight - PAGE.h * s) / 2}px ${(stage.clientWidth - PAGE.w * s) / 2}px`;
  };
  function show(step: number) {
    at = zoomStep(at, step, items.length);
    const it = items[at];
    if (!it) return;
    frame.src = it.html;
    title.textContent = it.title;
    detail.textContent = it.detail ?? '';
    count.textContent = `${at + 1} of ${items.length}`;
    pick.hidden = !it.pick;
    pick.textContent = it.pick?.label ?? '';
    pick.onclick = () => {
      close();
      it.pick?.run();
    };
    prev.hidden = next.hidden = items.length < 2;
  }
  // ahead of the panel's own Esc (and Comms' keys), so only the picture closes
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.key !== 'Escape' && !step) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (step) show(step);
    else close();
  };
  function close() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', fit);
    box.remove();
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', fit);
  document.body.append(box);
  show(0);
  fit();
  return close;
}
