import { z } from 'zod';
import { MODEL_LIMITS } from '../../shared/systemModel';
import { MODEL_CHANGES, MODEL_EDGE_KINDS, MODEL_KINDS } from '../../shared/types';

// A system model as a goal lead's `model` tool takes it: zod, as the Claude Agent
// SDK's tool boundary needs. What it means, and how the office checks it, is in shared/systemModel.ts.

/** Where in the code something is, as a model cites it. */
const CITE = z.object({ file: z.string().describe('The file\'s absolute path, as you read it.'), line: z.number().int().min(1) });
const CHANGE = z.enum(MODEL_CHANGES).optional().describe('For a model of a change (a slice, a pull request): added, changed or removed by it. Leave out what it doesn\'t touch. A removed part or connection is cited where it was (it isn\'t checked).');

export const MODEL_SCHEMA = z.object({
  question: z.string().max(MODEL_LIMITS.question).describe('The question it answers, in a sentence.'),
  nodes: z.array(z.object({
    id: z.string().describe('Short, lowercase, letters, digits and dashes.'),
    label: z.string().max(MODEL_LIMITS.label).describe('What it is, in a few words.'),
    kind: z.enum(MODEL_KINDS).describe('ui (a page or component), route (an endpoint), handler, service, store (a table, cache or file), queue (a channel, event bus or message queue), external (another system), job (background work), type (a data shape that matters).'),
    layer: z.string().describe('Its layer or owner (UI, API, Domain, Data, External…): parts in the same layer share a colour. Use few layers.'),
    symbol: z.string().optional().describe('Its name in the code (class, function, component, table), as written there: the check looks for it at its cite, and connections to it should mention it.'),
    cite: CITE.optional().describe('Where it is defined.'),
    change: CHANGE,
  })).max(MODEL_LIMITS.nodes),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(MODEL_EDGE_KINDS),
    label: z.string().optional(),
    cite: CITE.optional().describe('The line where `from` reaches `to`: it (or a line within two of it) must mention `to`\'s symbol.'),
    change: CHANGE,
  })).max(MODEL_LIMITS.edges),
  trace: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().describe('What happens at this step, in a few words.'),
    payload: z.string().optional().describe('What moves: the data\'s type and its fields that matter, like "ProposalDto { title, body }".'),
  })).max(MODEL_LIMITS.steps).describe('One concrete scenario, in order, each step along a connection (either way along it).'),
  simplified: z.array(z.string()).max(MODEL_LIMITS.simplified).describe('What you left out or simplified.'),
  checks: z.array(z.object({ q: z.string(), a: z.string(), cite: CITE.optional() })).max(MODEL_LIMITS.checks).optional().describe('Two or three questions the captain should be able to answer from it, with the answer and the line that confirms it.'),
});
