import { z } from 'zod';
import { LANES } from '../../shared/mergeLaneRules';
import { IMPACTS } from './recap';

// The ship tool's recap, as the lead sends it (recap.ts says what each part is for).

const step = z.object({
  from: z.string().describe('A primitive’s id, or anything else the slice talks to (“user”, “github”).'),
  to: z.string(),
  label: z.string().describe('What the slice sends or does along it, in a few words.'),
});

export const RECAP_SCHEMA = z.object({
  primitives: z.array(z.object({
    id: z.string().describe('The primitive’s name: short, lowercase with dashes (“merge-gate”, “cos-verdict”), the same from slice to slice.'),
    group: z.string().describe('What part of the system it belongs to, in a word or two (“chief of staff”, “QA”).'),
    impact: z.enum(IMPACTS).describe('composes: used as it is (wiring, call sites); extends: its behaviour or contract changed; adds: a new primitive.'),
    change: z.string().describe('What the slice does to it, in a line.'),
    paths: z.array(z.string()).describe('Where it is, as your workspace has it, repo folder first: files, or folders ending in / (“focus/shared/mergeGateRules.ts”, “focus/plugins/chief-of-staff/”). Every file the slice changes must be under one, tests and docs too.'),
  })).describe('Each building block the slice touches, riskiest first.'),
  invariants: z.array(z.string()).optional().describe('The promises the slice could break, in plain words (“A card the user owes never leaves their queue unanswered”). They go in the pull request, as the rest does.'),
  map: z.array(step).optional().describe('How the touched primitives connect: each an arrow on the system map.'),
  flow: z.array(step).optional().describe('What happens, in order: each a message in the change flow’s sequence diagram.'),
  lane: z.enum(LANES).optional().describe('How it merges once QA passes it. ship: by itself; show: by itself, and the captain is told; ask: the captain merges it. Pick by how much the captain would want to see it first. The rollup sets the lowest you may pick: composes allows ship, extends show, adds only ask. Left out, it’s ask.'),
}).describe('The slice’s system recap.');
