// A slice's system recap (docs/goals.md#the-system-recap): what it does to the system, said as the primitives it touches,
// each composed (used as it is), extended (its behaviour or contract changed) or added, so the captain reviews the
// system first and reads only the diffs that matter. After Kent C. Dodds' visual recap. The lead sends it with each
// ship; Ops checks it covers every file the slice changes, then writes it into the pull requests (mermaid, which GitHub
// draws) and onto the lead's station screen. Pure, so it's tested (recap.test.ts).

import { LANE_SAID, type Lane, laneName, laneProblem } from '../../shared/mergeLane';

export const IMPACTS = ['composes', 'extends', 'adds'] as const;
export type Impact = (typeof IMPACTS)[number];

/** One building block of the system the slice touches. */
export interface RecapPrimitive {
  /** Its name, short, lowercase with dashes (`cos-verdict`): the same one from slice to slice. */
  id: string;
  /** What part of the system it belongs to, in a word or two (`chief of staff`). */
  group: string;
  impact: Impact;
  /** What the slice does to it, in a line. */
  change: string;
  /** Where it is, as the lead's workspace has it: files, or folders ending in `/` (`focus/plugins/chief-of-staff/`). */
  paths: string[];
}

/** One step between two primitives (or anything else the slice talks to): what the slice sends along it. */
export interface RecapStep {
  from: string;
  to: string;
  label: string;
  /** On a map's arrow between two primitives, set by Ops: whether an import backs it (recapImports.ts). */
  backed?: boolean;
}

export interface SliceRecap {
  primitives: RecapPrimitive[];
  /** The promises the slice could break, in plain words. */
  invariants?: string[];
  /** How the touched primitives connect: the system map. */
  map?: RecapStep[];
  /** What happens, in order: the change flow, as a sequence. */
  flow?: RecapStep[];
  /** How the lead would have it merge once QA passes it (shared/mergeLane.ts): none is Ask. */
  lane?: Lane;
}

/** The lane the slice ships in: the lead's pick, or Ask when they made none. */
export function recapLane(recap: Pick<SliceRecap, 'lane'> | undefined): Lane {
  return recap?.lane ?? 'ask';
}

/** What the lead ships with: the pull requests' title and description, and the slice's recap (none from before recaps). */
export interface ShipInput {
  title: string;
  summary: string;
  recap?: SliceRecap;
}

/** The most a recap takes of each: a recap is read at a glance. */
export const RECAP_LIMITS = { primitives: 16, invariants: 6, steps: 16, text: 160 } as const;

/** The slice's impact as a whole: its riskiest primitive's. */
export function rollup(recap: Pick<SliceRecap, 'primitives'>): Impact {
  return recap.primitives.some((p) => p.impact === 'adds') ? 'adds' : recap.primitives.some((p) => p.impact === 'extends') ? 'extends' : 'composes';
}

export const RISK: Record<Impact, string> = { composes: 'low risk', extends: 'medium risk', adds: 'high risk' };
const SAID: Record<Impact, string> = { composes: 'composes existing primitives', extends: 'extends existing primitives', adds: 'adds a primitive' };

/** Whether `path` (a file, or a folder: ending in `/` or not; a leading `./` or not) covers `file`. */
export function covers(path: string, file: string): boolean {
  const p = path.replace(/^\.\//, '');
  return p.endsWith('/') ? file.startsWith(p) : file === p || file.startsWith(`${p}/`);
}

/** The changed files, by the workspace's paths, that none of the recap's primitives covers. */
export function uncovered(recap: Pick<SliceRecap, 'primitives'>, changed: readonly string[]): string[] {
  const paths = recap.primitives.flatMap((p) => p.paths);
  return changed.filter((file) => !paths.some((path) => covers(path, file)));
}

/**
 * What's wrong with a recap, if anything, for the lead to fix and ship again: a primitive named twice or without a
 * change or paths, too much of anything, or changed files it doesn't cover (`changed`, by the workspace's paths).
 */
export function recapProblems(recap: SliceRecap, changed: readonly string[]): string[] {
  const L = RECAP_LIMITS;
  const out: string[] = [];
  if (!recap.primitives.length) out.push('Name at least one primitive the slice touches');
  if (recap.primitives.length > L.primitives) out.push(`It names ${recap.primitives.length} primitives (at most ${L.primitives}): group the small ones`);
  const seen = new Set<string>();
  for (const p of recap.primitives) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) out.push(`“${p.id}” isn’t a primitive’s id: lowercase letters, digits and dashes`);
    if (seen.has(p.id)) out.push(`${p.id} is named twice`);
    seen.add(p.id);
    if (!p.change.trim()) out.push(`Say what the slice does to ${p.id}`);
    if (!p.paths.length) out.push(`Say where ${p.id} is (its paths)`);
  }
  if ((recap.invariants?.length ?? 0) > L.invariants) out.push(`It lists ${recap.invariants?.length} invariants (at most ${L.invariants})`);
  for (const [name, steps] of [['map', recap.map], ['flow', recap.flow]] as const) {
    if ((steps?.length ?? 0) > L.steps) out.push(`Its ${name} has ${steps?.length} steps (at most ${L.steps})`);
  }
  const lane = recap.lane && laneProblem(recap.lane, rollup(recap));
  if (lane) out.push(lane);
  const missed = uncovered(recap, changed);
  if (missed.length) {
    const shown = missed.slice(0, 8).map((f) => `- ${f}`);
    if (missed.length > shown.length) shown.push(`- …and ${missed.length - shown.length} more`);
    out.push(`No primitive covers ${missed.length === 1 ? 'this changed file' : `these ${missed.length} changed files`}: add it to one’s paths, or name the primitive it belongs to\n${shown.join('\n')}`);
  }
  return out;
}

/** Text as mermaid takes it in a label: one line, short, without what breaks its parser. */
const label = (text: string): string => {
  const one = text.replace(/\s+/g, ' ').replace(/;/g, ',').replace(/["`#<>{}[\]|]/g, "'").trim();
  return one.length > RECAP_LIMITS.text ? `${one.slice(0, RECAP_LIMITS.text - 1)}…` : one;
};
/** A node's or participant's name as mermaid takes it: letters, digits and underscores. */
const node = (id: string): string => `n_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;

/** The system map: the primitives as nodes coloured by impact (anything else they talk to plain), the steps as arrows. */
export function mapMermaid(recap: SliceRecap): string {
  const ids = new Set([...recap.primitives.map((p) => p.id), ...(recap.map ?? []).flatMap((s) => [s.from, s.to])]);
  const lines = ['flowchart LR'];
  for (const id of ids) lines.push(`  ${node(id)}["${label(id)}"]`);
  // an arrow no import backs is dashed: a runtime call maybe, or one the lead got wrong
  for (const s of recap.map ?? []) lines.push(`  ${node(s.from)} ${s.backed === false ? '-.->' : '-->'}|"${label(s.label)}"| ${node(s.to)}`);
  lines.push(
    '  classDef composes fill:#0f2d1a,stroke:#2ea043,stroke-width:2px,color:#56d364',
    '  classDef extends fill:#3d2f00,stroke:#d29922,stroke-width:2px,color:#f2cc60',
    '  classDef adds fill:#3c1618,stroke:#da3633,stroke-width:2px,color:#ff7b72',
  );
  for (const impact of IMPACTS) {
    const of = recap.primitives.filter((p) => p.impact === impact).map((p) => node(p.id));
    if (of.length) lines.push(`  class ${of.join(',')} ${impact}`);
  }
  return lines.join('\n');
}

/** The change flow: each step a message between participants, in the order they first appear. */
export function flowMermaid(steps: readonly RecapStep[]): string {
  const ids = [...new Set(steps.flatMap((s) => [s.from, s.to]))];
  return ['sequenceDiagram', ...ids.map((id) => `  participant ${node(id)} as ${label(id)}`), ...steps.map((s) => `  ${node(s.from)}->>${node(s.to)}: ${label(s.label)}`)].join('\n');
}

/** What the map's key says of its dashed arrows, when it has any. */
function unbackedSaid(recap: SliceRecap): string {
  const n = (recap.map ?? []).filter((s) => s.backed === false).length;
  return n ? `Dashed: Ops found no import behind ${n === 1 ? 'this arrow' : `these ${n} arrows`} (a runtime call, or one to check).` : '';
}

const fence = (code: string) => `\`\`\`mermaid\n${code}\n\`\`\``;

/** Where the recap starts and ends in a pull request's description. */
export const RECAP_START = '<!-- system-recap:start -->';
export const RECAP_END = '<!-- system-recap:end -->';

/**
 * The recap as a pull request shows it: a block GitHub opens out, with the rollup in its summary, the primitives
 * touched, the invariants, and the map and flow as mermaid. A blank line around each fence, or GitHub won't draw it.
 */
/** The lane line: which one, and what it does once QA passes. */
function laneSaid(recap: SliceRecap): string {
  const lane = recapLane(recap);
  return `**Lane:** ${laneName(lane)}, ${recap.lane ? 'the lead’s pick' : 'as the lead picked none'}: it ${LANE_SAID[lane]}.`;
}

export function recapMarkdown(recap: SliceRecap): string {
  const impact = rollup(recap);
  const rows = recap.primitives.map((p) => `| \`${p.id}\` | ${label(p.group)} | ${p.impact} | ${label(p.change)} |`);
  const counts = IMPACTS.map((i) => [i, recap.primitives.filter((p) => p.impact === i).length] as const).filter(([, n]) => n);
  const parts = [
    RECAP_START,
    '',
    '<details open>',
    `<summary>System recap: <b>${SAID[impact]}</b> (${RISK[impact]})</summary>`,
    '',
    `**Classification:** ${impact}. ${counts.map(([i, n]) => `${n} ${i}`).join(', ')}.`,
    '',
    laneSaid(recap),
    '',
    '### Primitives touched',
    '',
    '| Primitive | Group | Impact | What changed |',
    '| --- | --- | --- | --- |',
    ...rows,
  ];
  if (recap.invariants?.length) parts.push('', '### Invariants touched', '', ...recap.invariants.map((i) => `- ${label(i)}`));
  parts.push('', '### System map', '', fence(mapMermaid(recap)));
  const unbacked = unbackedSaid(recap);
  if (unbacked) parts.push('', `_${unbacked}_`);
  if (recap.flow?.length) parts.push('', '### Change flow', '', fence(flowMermaid(recap.flow)));
  parts.push('', '</details>', '', RECAP_END);
  return parts.join('\n');
}

/**
 * A pull request's description with the recap in it: in place of the one it has, or else ahead of its signature
 * (`---` before Ops' attribution), or at its end.
 */
export function withRecap(body: string, recap: string): string {
  const start = body.indexOf(RECAP_START);
  const end = body.indexOf(RECAP_END, start);
  if (start >= 0 && end >= 0) return `${body.slice(0, start)}${recap}${body.slice(end + RECAP_END.length)}`;
  const signed = body.lastIndexOf('\n\n---\n');
  return signed >= 0 ? `${body.slice(0, signed)}\n\n${recap}${body.slice(signed)}` : `${body.trimEnd()}\n\n${recap}`;
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The recap as the lead's station screen shows it, laid out for 1280 × 800: the table and invariants, then the map and flow. */
export function recapPage(recap: SliceRecap, title: string): string {
  const impact = rollup(recap);
  const badge = (i: Impact) => `<span class="badge ${i}">${i}</span>`;
  const rows = recap.primitives.map((p) => `<tr><td><code>${escape(p.id)}</code></td><td>${escape(p.group)}</td><td>${badge(p.impact)}</td><td>${escape(label(p.change))}</td></tr>`).join('');
  const invariants = recap.invariants?.length ? `<h3>Invariants touched</h3><ul>${recap.invariants.map((i) => `<li>${escape(label(i))}</li>`).join('')}</ul>` : '';
  const flow = recap.flow?.length ? `<h3>Change flow</h3><pre class="mermaid">${escape(flowMermaid(recap.flow))}</pre>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;width:1280px;min-height:800px}
.wrap{padding:20px 34px}
.sum{display:flex;align-items:center;gap:12px;font-size:22px;border:1px solid #30363d;border-radius:8px;padding:10px 16px;background:#161b22}
.sum .t{margin-left:auto;font-size:16px;color:#7d8590}
.badge{border-radius:20px;padding:2px 11px;font-size:15px;font-weight:600;white-space:nowrap}
.composes{background:#0f2d1a;color:#56d364;border:1px solid #238636}
.extends{background:#3d2f00;color:#f2cc60;border:1px solid #9e6a03}
.adds{background:#3c1618;color:#ff7b72;border:1px solid #da3633}
.grid{display:grid;grid-template-columns:520px 1fr;gap:26px;margin-top:-2px}
h3{font-size:17px;margin:16px 0 6px;padding-bottom:5px;border-bottom:1px solid #30363d}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#161b22}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#262c36;border-radius:5px;padding:1px 5px;font-size:13px}
ul{font-size:15px;line-height:1.45;padding-left:18px}
pre.mermaid{margin:0 0 10px}
.key{font-size:14px;color:#7d8590;margin:0 0 10px}
.lane{font-size:15px;color:#e6edf3}
</style></head><body><div class="wrap">
<div class="sum">System recap: <b>${SAID[impact]}</b> <span class="badge ${impact}">${RISK[impact]}</span><span class="lane" title="${escape(LANE_SAID[recapLane(recap)])}">Lane: <b>${laneName(recapLane(recap))}</b></span><span class="t">${escape(title)}</span></div>
<div class="grid"><div>
<h3>Primitives touched</h3><table><tr><th>Primitive</th><th>Group</th><th>Impact</th><th>What changed</th></tr>${rows}</table>
${invariants}
</div><div>
<h3>System map</h3><pre class="mermaid">${escape(mapMermaid(recap))}</pre>${unbackedSaid(recap) ? `<p class="key">${escape(unbackedSaid(recap))}</p>` : ''}
${flow}
</div></div></div>
<script>mermaid.initialize({startOnLoad:true,theme:'dark',sequence:{mirrorActors:false}});</script>
</body></html>`;
}
