// A view of a map as a page for a lead's station screen (the map tool, leadTool.ts): its question, the drawing and its
// sentences, laid out for 1280 × 800 as the show tool's pages are. Pure.
import { esc, MATRIX_HINT, viewDrawing, wireMatrix } from './draw';
import type { MapView, RepoMap } from './shared';

const STYLE = `body{margin:0;background:#0b1020;color:#e8ecf5;font:16px/1.45 system-ui,sans-serif;padding:22px 32px;box-sizing:border-box}
h1{font-size:26px;margin:0;color:#ffcc66}.sub,.key{color:#9aa6c4;font-size:14px;margin:4px 0}
.drawing svg{display:block;max-width:100%;max-height:560px;height:auto;margin:8px auto}
ul{columns:2;column-gap:32px;margin:6px 0;padding-left:22px;font-size:14px}li{break-inside:avoid;margin:2px 0}`;

/**
 * The matrix answering the pointer on a page (draw.ts `wireMatrix`, carried as its source). The bundler that keeps
 * function names wraps some in `__name(…)`, which the page doesn't have: it's given one that hands each back.
 */
const MATRIX_SCRIPT = `var __name = function (f) { return f; }; (${wireMatrix.toString()})(document);`;

/** View `view` of `map` as a self-contained page. */
export function mapPage(map: RepoMap, view: MapView): string {
  const { svg, key, sentences } = viewDrawing(map, view);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(view.question)}</title><style>${STYLE}</style></head><body>
<h1>${esc(view.question)}</h1>
<div class="sub">${esc(map.repo)}${map.commit ? ` · ${esc(map.commit.slice(0, 7))}` : ''} · from its architecture model, its code and its history</div>
<div class="key">${esc(key)}</div>
<div class="drawing">${svg}</div>
${svg.includes('data-matrix') ? `<div class="key" data-said>${esc(MATRIX_HINT)}</div><script>${MATRIX_SCRIPT}</script>` : ''}
${sentences.length ? `<ul>${sentences.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
</body></html>`;
}
