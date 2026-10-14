import { dataView, sequenceView, structureView, toSvg } from '../../shared/modelDrawing';
import type { ModelCite, SystemModel } from '../../shared/types';

// A lead's system model as a page for its station's screen (docs/goals.md): the same three views the studio draws
// (shared/modelDrawing.ts), as SVG, with the code each part cites carried in the page. A screen's page can't reach the
// office (it runs sandboxed), so everything it needs is in it, and it steps and picks by CSS alone: the drawings mark
// the shapes each step lights (data-steps) and each part's shapes (data-part), and a few lines of script add a class.
// At rest (the picture on the screen) it shows the whole model, before the scenario starts.

/** The lines round a cite, as the office read them when the page was made. */
export interface CitedLines {
  cite: ModelCite;
  from: number;
  lines: string[];
}

/** The smallest a view is drawn, as a share of its drawing's size, before it scrolls sideways: the screen is 1280 wide. */
const FIT = 0.45;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** JSON safe inside a <script>. */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The page: `title` over the three views, a strip to step through the scenario, and a side panel for the part picked. */
export function modelPage(model: SystemModel, title: string, sources: Record<string, CitedLines>): string {
  const marks = { marks: true };
  const views = [structureView(model, marks), sequenceView(model, marks), dataView(model, marks)];
  const parts = Object.fromEntries(model.nodes.map((n) => [n.id, {
    label: n.label,
    what: `${n.kind} · ${n.layer}${n.symbol ? ` · ${n.symbol}` : ''}`,
    where: n.cite ? `${n.cite.file.split(/[\\/]/).slice(-2).join('/')}:${n.cite.line}` : 'no cite',
    found: n.found !== false,
    change: n.change ?? null,
    links: model.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => {
      const other = e.from === n.id ? e.to : e.from;
      const name = model.nodes.find((x) => x.id === other)?.label ?? other;
      return `${e.from === n.id ? '→' : '←'} ${e.kind} ${name}${e.cite ? ` · ${e.cite.file.split(/[\\/]/).slice(-2).join('/')}:${e.cite.line}` : ''}${e.backed === false ? ' (not backed)' : ''}`;
    }),
    source: sources[n.id] ?? null,
  }]));
  const trace = model.trace.map((s) => ({ label: s.label, payload: s.payload ?? '' }));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;color:#e8fbff;font-family:Antonio,'Arial Narrow',sans-serif}
.top{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#0a1124;border-bottom:3px solid #ffcc66}
.top h1{font-size:22px;margin:0;color:#ffcc66;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top button{background:#cc99cc;border:0;border-radius:14px;padding:4px 14px;font:inherit;font-size:16px;cursor:pointer}
#step{color:#ffcc66;font-size:17px;min-width:320px}#payload{font-family:'JetBrains Mono',monospace;font-size:13px;color:#ffcc66}
.main{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:10px;padding:10px;height:calc(100% - 52px)}
.views{overflow:auto;display:flex;flex-direction:column;gap:10px}.views>*{flex:none}.row{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:10px;align-items:start}
.view{overflow-x:auto;border-radius:10px}.view svg{width:100%;height:auto;display:block}
.side{overflow:auto;background:#141a33;border-radius:10px;padding:10px 12px;font-size:14px}.side h3{margin:2px 0;color:#ffcc66}.side h4{margin:10px 0 4px;color:#ff9966;font-size:12px;letter-spacing:.08em}
.side p{margin:3px 0}.muted{color:#8fa3b8}.bad{color:#ff7a7a}
pre{font-family:'JetBrains Mono',monospace;font-size:11px;background:#050b18;border-radius:8px;padding:6px;overflow-x:auto;margin:6px 0}pre .hit{background:#3a3010;color:#ffcc66}pre span{color:#8fa3b8;margin-right:6px}
.now.edge{stroke:#ffcc66!important;stroke-width:7px!important}text.now{fill:#ffcc66!important}.now.row{fill:#2a2410!important}
</style><style id="pick"></style></head><body>
<div class="top"><h1>${esc(title)}</h1><button id="back">◀</button><button id="on">▶</button><span id="step"></span><span id="payload"></span></div>
<div class="main"><div class="views">
<div class="view"><div style="min-width:${Math.round(views[0].w * FIT)}px">${toSvg(views[0])}</div></div>
<div class="row"><div class="view"><div style="min-width:${Math.round(views[1].w * FIT)}px">${toSvg(views[1])}</div></div><div class="view"><div style="min-width:${Math.round(views[2].w * FIT)}px">${toSvg(views[2])}</div></div></div>
</div><div class="side" id="side"></div></div>
<script>
var TRACE=${json(trace)},PARTS=${json(parts)},SIMPLIFIED=${json(model.simplified)},step=-1,picked=null;
function e(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function show(){
  document.querySelectorAll('.now').forEach(function(x){x.classList.remove('now')});
  if(step>=0)document.querySelectorAll('[data-steps~="'+step+'"]').forEach(function(x){x.classList.add('now')});
  document.getElementById('step').textContent=step<0?'Before the scenario starts · '+TRACE.length+' steps':'Step '+(step+1)+' of '+TRACE.length+': '+TRACE[step].label;
  document.getElementById('payload').textContent=step<0?'':TRACE[step].payload;
}
function go(by){var n=TRACE.length;if(!n)return;var s=step<0?(by>0?0:n-1):step+by;step=s<0||s>=n?-1:s;show()}
function side(){
  var p=picked&&PARTS[picked],el=document.getElementById('side');
  document.getElementById('pick').textContent=picked?'rect[data-part="'+picked+'"],ellipse[data-part="'+picked+'"],polygon[data-part="'+picked+'"]{stroke:#fff!important;stroke-width:6px!important}':'';
  if(!p){el.innerHTML='<p class="muted">Click a part in any view to see the code it cites, and its connections. ◀ ▶ (or ← →) step through the scenario.</p>'+SIMPLIFIED.map(function(s){return '<p class="muted">Simplified: '+e(s)+'</p>'}).join('');return}
  var h='<h3>'+e(p.label)+'</h3><p class="muted">'+e(p.what)+(p.change?' · '+p.change:'')+'</p><p class="'+(p.found?'muted':'bad')+'">'+e(p.where)+(p.found?'':' (not found in the code)')+'</p>';
  if(p.source){h+='<pre>'+p.source.lines.map(function(l,i){var n=p.source.from+i;return '<div class="'+(n===p.source.cite.line?'hit':'')+'"><span>'+String(n).padStart(4)+'</span>'+e(l)+'</div>'}).join('')+'</pre>'}
  h+='<h4>CONNECTIONS</h4>'+p.links.map(function(l){return '<p class="'+(l.indexOf('(not backed)')>=0?'bad':'')+'">'+e(l)+'</p>'}).join('');
  el.innerHTML=h;
}
document.getElementById('back').onclick=function(){go(-1)};document.getElementById('on').onclick=function(){go(1)};
document.addEventListener('keydown',function(ev){if(ev.key==='ArrowLeft'||ev.key==='ArrowRight'){ev.preventDefault();go(ev.key==='ArrowLeft'?-1:1)}});
document.querySelector('.views').addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-part]');if(!t)return;var id=t.getAttribute('data-part');picked=picked===id?null:id;side()});
show();side();
</script></body></html>`;
}

/** The lines either side of each part's cite, read now, for the page to carry (a removed part's isn't in the code). */
export function citedLines(model: SystemModel, read: (file: string) => string[] | undefined, around = 8): Record<string, CitedLines> {
  const out: Record<string, CitedLines> = {};
  for (const n of model.nodes) {
    if (!n.cite || n.change === 'removed') continue;
    const all = read(n.cite.file);
    if (!all) continue;
    const at = Math.max(1, Math.min(all.length, n.cite.line));
    const from = Math.max(1, at - around);
    out[n.id] = { cite: n.cite, from, lines: all.slice(from - 1, at + around) };
  }
  return out;
}
