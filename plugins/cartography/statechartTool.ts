// The statechart tool in every goal lead's toolkit (mcp__office__statechart): a lead sends a state chart as data and
// Ops draws the page, so every chart the captain sees is in one house style and legible. A chart that isn't a strict
// top-down tree is refused with every problem at once; cites that don't check out are drawn flagged and said back.
import { z } from 'zod';
import { ARTIFACT_LIMITS, type LeadTool, sourceReader } from '../../plugin-api/server';
import { chartProblems, LABEL_MAX, NODE_MAX, type Statechart } from './statechart';
import { checkCite, checkCites, statechartPage } from './statechartPage';
import { screenTitle } from './views';

const DESCRIPTION = `Put a state chart (or flow chart) on your station's screen in the office's one house style: you send the chart as data, the office draws the page (the flow as a top-down chart with a key, then whichever of the trigger table, properties, risks and open questions you give). Reach for it whenever you'd draw how something moves from state to state, rather than drawing one with show.
The flow must be a strict top-down tree, or it's refused with every problem listed: one root (a start dot is added above it), exactly one arrow into every other node, no arrows looping back. Where two paths end the same way, repeat a short end node under each. A "branch" node is a small empty diamond: the label on the arrow into it is its question ("what does the client do?"), and it has at least two arrows out, each labelled with an answer.
Node kinds: works (grey), bug (red: found broken), fix (green: fixed in the model, not yet built), risk (orange: looks risky, not modelled). Draw each bug's fix under it, on an edge labelled "with the fix"; a bug without one is warned about.
Keep text plain and short: a node at most ${NODE_MAX} characters, a label at most ${LABEL_MAX}. Don't wrap it yourself (no <br/>): the office wraps it.`;

const cite = z.object({ file: z.string().describe('Absolute path of a file in one of your checkouts'), line: z.number().int().describe('Its line') });
const prop = z.object({
  id: z.string().describe('P1, P2…'),
  text: z.string().describe('The property, in a sentence'),
  status: z.enum(['holds', 'broken', 'unchecked']),
  note: z.string().optional().describe('A few words on the status, like "TLC: Publish breaks it (R1)"'),
});

const INPUT = {
  id: z.string().describe('A short name for it, lowercase with dashes (like "proposal-flow"): the same id again replaces it'),
  title: z.string().describe('The question it answers, in plain English, like "What happens to a proposal, from first draft to signed"'),
  source: z.string().describe('One line: what code it was read from, as of when'),
  nodes: z
    .array(z.object({ id: z.string(), text: z.string().optional().describe(`What's so at this point, plain and at most ${NODE_MAX} characters; a branch has none`), kind: z.enum(['works', 'bug', 'fix', 'risk', 'branch']) }))
    .describe('The boxes. One root; every other node has exactly one arrow into it'),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional().describe(`What happens, at most ${LABEL_MAX} characters; into a branch, its question`) })).describe('Arrows, top-down only: none loops back, none joins another into one node'),
  actors: z.array(z.object({ name: z.string(), kind: z.enum(['person', 'staff', 'system', 'other']) })).optional().describe('Who moves things, shown as pills; a trigger\'s actor takes its colour by name'),
  leftOut: z.string().optional().describe('What the drawing leaves out'),
  triggers: z
    .array(z.object({ transition: z.string(), actor: z.string(), guard: z.string().describe('What must hold, or who may'), where: z.array(cite) }))
    .optional()
    .describe('What moves each transition: the trigger table'),
  properties: z.object({ safety: z.array(prop).optional(), liveness: z.array(prop).optional() }).optional().describe('Properties worth checking'),
  risks: z
    .array(z.object({ id: z.string().describe('R1, R2…'), severity: z.enum(['hi', 'med', 'lo']), title: z.string(), path: z.string().describe('A concrete story of how it breaks'), where: z.array(cite) }))
    .optional()
    .describe('What already looks breakable'),
  open: z.array(z.string()).optional().describe('Questions for the captain'),
  formal: z.string().optional().describe('A paragraph on any TLA+ or other model check, if there was one'),
};

const Input = z.object(INPUT);

export const statechartTool: LeadTool = {
  name: 'statechart',
  description: DESCRIPTION,
  input: INPUT,
  async run(lead, raw) {
    const { id, ...chart }: Statechart & { id: string } = Input.parse(raw);
    const { errors, warnings } = chartProblems(chart);
    if (errors.length) throw new Error(`The chart wasn't drawn. Fix these and send it again:\n${errors.map((e) => `- ${e}`).join('\n')}`);
    const read = sourceReader(lead.checkouts.map((c) => c.dir));
    const { cites, problems } = checkCites(chart, (c) => checkCite(c, lead.checkouts, read));
    const where = await lead.show({ id, title: screenTitle(chart.title, ARTIFACT_LIMITS.title), html: statechartPage(chart, cites) });
    const flagged = problems.length ? `\nThese cites didn't check out, and are drawn flagged:\n${problems.map((p) => `- ${p}`).join('\n')}` : '';
    const advice = warnings.length ? `\nWorth fixing:\n${warnings.map((w) => `- ${w}`).join('\n')}` : '';
    return `${where} ${chart.nodes.length} nodes.${flagged}${advice}`;
  },
};
