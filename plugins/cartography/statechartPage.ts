// A state chart as the page on a lead's station screen (the statechart tool): one house style for every chart a lead
// shows, its cites checked against the lead's checkouts. Pure (reading a file is handed in).
import path from 'node:path';
import { esc } from './draw';
import { type ActorKind, type ChartCite, type ChartProp, flowchart, type NodeKind, type Statechart } from './statechart';

/** A cite as the page shows it: repo-relative, and why it didn't check out if it didn't. */
export interface CheckedCite {
  shown: string;
  problem?: string;
}

/**
 * `cite` checked against the lead's `checkouts`: the file is one `read` can read (inside a checkout) and has the line.
 * It's shown relative to its checkout, with the repo's name in front when there's more than one.
 */
export function checkCite(cite: ChartCite, checkouts: readonly { repo: string; dir: string }[], read: (file: string) => string[] | undefined): CheckedCite {
  const home = checkouts.find((c) => cite.file === c.dir || cite.file.startsWith(c.dir.endsWith(path.sep) ? c.dir : c.dir + path.sep));
  const rel = home ? path.relative(home.dir, cite.file) : cite.file;
  const shown = `${home && checkouts.length > 1 ? `${home.repo.split('/').pop() ?? home.repo}/` : ''}${rel}:${cite.line}`;
  const lines = read(cite.file);
  if (!lines) return { shown, problem: `${cite.file} isn't there (or isn't in one of your checkouts)` };
  if (cite.line < 1 || cite.line > lines.length) return { shown, problem: `${rel} has only ${lines.length} lines, so no line ${cite.line}` };
  return { shown };
}

/** Every cite in `c` checked, keyed as `citeKey` keys them, and what didn't check out, said where it's cited. */
export function checkCites(c: Statechart, check: (cite: ChartCite) => CheckedCite): { cites: Map<string, CheckedCite>; problems: string[] } {
  const cites = new Map<string, CheckedCite>();
  const problems: string[] = [];
  const places = [...(c.triggers ?? []).map((t) => ({ where: t.where, said: `Trigger "${t.transition}"` })), ...(c.risks ?? []).map((r) => ({ where: r.where, said: `Risk ${r.id}` }))];
  for (const { where, said } of places) {
    for (const cite of where) {
      const checked = cites.get(citeKey(cite)) ?? check(cite);
      cites.set(citeKey(cite), checked);
      if (checked.problem) problems.push(`${said}: ${checked.problem}.`);
    }
  }
  return { cites, problems };
}

export const citeKey = (c: ChartCite): string => `${c.file}:${c.line}`;

const STYLE = `body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;background:#0f1420;color:#e6e9ef;font-size:13px;line-height:1.45}
.wrap{max-width:1240px;margin:0 auto;padding:18px 20px 40px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px;color:#f5b041;border-bottom:1px solid #2a3245;padding-bottom:4px}
.sub{color:#9aa4b8}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{background:#171e2e;border:1px solid #2a3245;border-radius:8px;padding:10px 12px}
.diagram{background:#fff;border-radius:8px;padding:6px 8px;color:#212529}
.key{display:flex;gap:14px;align-items:center;padding:8px 6px;font-size:14px}
.key span{padding:4px 10px;border-radius:4px;border:2px solid}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #2a3245;padding:5px 6px;text-align:left;vertical-align:top}
th{color:#9aa4b8;font-weight:600}code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#9fd3ff}
code.flag{color:#ff7b72;text-decoration:underline wavy #ff7b72}
.pill{display:inline-block;border-radius:10px;padding:0 7px;font-size:11px;font-weight:600}
.c{background:#1f6f4a}.s{background:#2e5aa8}.sys{background:#6b4fa0}.m{background:#8a5a14}
.hi{color:#ff7b72;font-weight:700}.med{color:#f5b041;font-weight:700}.lo{color:#9aa4b8;font-weight:700}
.ok{color:#56d364}.bad{color:#ff7b72}.q{color:#f5b041}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}
.mermaid .flowchart-link{stroke:#333!important;stroke-width:1.5px!important}.mermaid marker path{fill:#333!important;stroke:#333!important}`;

// the house's legibility fixes: a step curve, room between ranks, labels on white; and after it's drawn, every edge's
// repeated points dropped, since mermaid's step curve ends each edge on a zero-length segment that turns an
// orient="auto" arrowhead askew
const SCRIPT = `mermaid.initialize({startOnLoad:false,theme:'default',themeVariables:{edgeLabelBackground:'#ffffff',fontFamily:'Helvetica,Arial,sans-serif',fontSize:'15px'},flowchart:{curve:'step',rankSpacing:55,nodeSpacing:28,wrappingWidth:280,padding:12}});
mermaid.run().then(()=>{for(const p of document.querySelectorAll('.mermaid path.flowchart-link')){const pts=[...p.getAttribute('d').matchAll(/(-?[\\d.]+),(-?[\\d.]+)/g)].map(m=>[+m[1],+m[2]]);const out=pts.filter((q,i)=>i===0||Math.hypot(q[0]-pts[i-1][0],q[1]-pts[i-1][1])>0.5);p.setAttribute('d','M'+out.map(q=>q.join(',')).join('L'));}});`;

const KEY: [NodeKind, string][] = [
  ['works', '<span style="border-color:#868e96;background:#f1f3f5">Works</span>'],
  ['bug', '<span style="border-color:#c92a2a;background:#fde8e8;color:#8b1a1a">Bug</span>'],
  ['fix', '<span style="border-color:#2b8a3e;background:#e6f4ea;color:#1e5e2c">Fixed in the model, not yet built</span>'],
  ['risk', '<span style="border-color:#e8590c;background:#fff4e0;color:#7a3b00">Looks risky, not modelled</span>'],
];

const PILL: Record<ActorKind, string> = { person: 'c', staff: 's', system: 'sys', other: 'm' };
const STATUS: Record<ChartProp['status'], string> = { holds: 'ok', broken: 'bad', unchecked: 'q' };

/** A section of the page: its heading (numbered as the page lays them out) and what's under it. */
interface Section {
  title: string;
  body: string;
}

const pill = (name: string, kind: ActorKind) => `<span class="pill ${PILL[kind]}">${esc(name)}</span>`;

function citesHtml(where: readonly ChartCite[], cites: ReadonlyMap<string, CheckedCite>): string {
  return where
    .map((c) => {
      const checked = cites.get(citeKey(c)) ?? { shown: `${c.file}:${c.line}` };
      return checked.problem ? `<code class="flag" title="${esc(checked.problem)}">${esc(checked.shown)} (not found)</code>` : `<code>${esc(checked.shown)}</code>`;
    })
    .join(', ');
}

function flowSection(c: Statechart): Section[] {
  const used = new Set(c.nodes.map((n) => n.kind));
  const key = KEY.filter(([kind]) => used.has(kind)).map(([, html]) => html).join('\n');
  const actors = c.actors?.length ? `Actors: ${c.actors.map((a) => pill(a.name, a.kind)).join(' ')}.` : '';
  const leftOut = c.leftOut ? `Left out of the drawing: ${esc(c.leftOut)}` : '';
  const under = actors || leftOut ? `<div class="sub" style="margin-top:6px">${[actors, leftOut].filter(Boolean).join(' ')}</div>` : '';
  return [{ title: 'The flow', body: `<div class="diagram">
<div class="key"><b>Key</b>
${key}</div>
<div class="mermaid">
${flowchart(c)}
</div></div>
${under}` }];
}

function triggerSection(c: Statechart, cites: ReadonlyMap<string, CheckedCite>): Section[] {
  if (!c.triggers?.length) return [];
  const kinds = new Map((c.actors ?? []).map((a) => [a.name, a.kind]));
  const rows = c.triggers.map((t) => `<tr><td>${esc(t.transition)}</td><td>${pill(t.actor, kinds.get(t.actor) ?? 'other')}</td><td>${esc(t.guard)}</td><td>${citesHtml(t.where, cites)}</td></tr>`);
  return [{ title: 'Trigger table', body: `<table>
<tr><th>Transition</th><th>Actor</th><th>Guard / permission</th><th>Where</th></tr>
${rows.join('\n')}
</table>` }];
}

const propItem = (p: ChartProp) => `<li><b>${esc(p.id)}</b> ${esc(p.text)} <span class="${STATUS[p.status]}">${p.status}${p.note ? `: ${esc(p.note)}` : ''}</span></li>`;

function propertySection(c: Statechart): Section[] {
  const cards = [
    ['Safety', c.properties?.safety ?? []],
    ['Liveness', c.properties?.liveness ?? []],
  ] as const;
  const shown = cards.filter(([, props]) => props.length);
  if (!shown.length) return [];
  return [{ title: 'Properties worth checking', body: `<div class="grid">
${shown.map(([name, props]) => `<div class="card"><b>${name}</b><ul>\n${props.map(propItem).join('\n')}\n</ul></div>`).join('\n')}
</div>` }];
}

function riskSection(c: Statechart, cites: ReadonlyMap<string, CheckedCite>): Section[] {
  if (!c.risks?.length) return [];
  const rows = c.risks.map((r) => `<tr><td class="${r.severity}">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.path)}</td><td>${citesHtml(r.where, cites)}</td></tr>`);
  return [{ title: 'What already looks breakable', body: `<table>
<tr><th></th><th>Risk</th><th>Path</th><th>Where</th></tr>
${rows.join('\n')}
</table>` }];
}

function openSection(c: Statechart): Section[] {
  return [
    ...(c.open?.length ? [{ title: 'Open for you', body: `<ul>${c.open.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` }] : []),
    ...(c.formal ? [{ title: 'Formal check', body: `<div class="card">${esc(c.formal)}</div>` }] : []),
  ];
}

/** `c` as a self-contained page, its cites as `cites` checked them. Sections with nothing in them are left out. */
export function statechartPage(c: Statechart, cites: ReadonlyMap<string, CheckedCite> = new Map()): string {
  const sections = [...flowSection(c), ...triggerSection(c, cites), ...propertySection(c), ...riskSection(c, cites), ...openSection(c)]
    .map((s, i) => `<h2>${i + 1}. ${s.title}</h2>\n${s.body}`)
    .join('\n\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
${STYLE}
</style></head><body><div class="wrap">
<h1>${esc(c.title)}</h1>
<div class="sub">${esc(c.source)}</div>

${sections}
</div>
<script>${SCRIPT}</script>
</body></html>`;
}
