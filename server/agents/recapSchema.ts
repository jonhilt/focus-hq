import { Schema } from 'effect';
import { z } from 'zod';
import { LANES } from '../../shared/mergeLaneRules';
import { IMPACTS } from './recap';

// The ship tool's recap, as the lead sends it (recap.ts says what each part is for): as zod for the old runner's MCP
// server, and as an Effect Schema for agent-host's tools, the agent seeing the same JSON Schema from both
// (opsTool.test.ts). The zod one goes with the old runner.

const SAY = {
  from: 'A primitive’s id, or anything else the slice talks to (“user”, “github”).',
  label: 'What the slice sends or does along it, in a few words.',
  id: 'The primitive’s name: short, lowercase with dashes (“merge-gate”, “cos-verdict”), the same from slice to slice.',
  group: 'What part of the system it belongs to, in a word or two (“chief of staff”, “QA”).',
  impact: 'composes: used as it is (wiring, call sites); extends: its behaviour or contract changed; adds: a new primitive.',
  change: 'What the slice does to it, in a line.',
  paths: 'Where it is, as your workspace has it, repo folder first: files, or folders ending in / (“focus/shared/mergeGateRules.ts”, “focus/plugins/chief-of-staff/”). Every file the slice changes must be under one, tests and docs too.',
  primitives: 'Each building block the slice touches, riskiest first.',
  invariants: 'The promises the slice could break, in plain words (“A card the user owes never leaves their queue unanswered”). They go in the pull request, as the rest does.',
  map: 'How the touched primitives connect: each an arrow on the system map.',
  flow: 'What happens, in order: each a message in the change flow’s sequence diagram.',
  lane: 'How it merges once QA passes it. ship: by itself; show: by itself, and the captain is told; ask: the captain merges it. Pick by how much the captain would want to see it first. The rollup sets the lowest you may pick: composes allows ship, extends show, adds only ask. Left out, it’s ask.',
  recap: 'The slice’s system recap.',
};

const step = z.object({
  from: z.string().describe(SAY.from),
  to: z.string(),
  label: z.string().describe(SAY.label),
});

export const RECAP_SCHEMA = z.object({
  primitives: z.array(z.object({
    id: z.string().describe(SAY.id),
    group: z.string().describe(SAY.group),
    impact: z.enum(IMPACTS).describe(SAY.impact),
    change: z.string().describe(SAY.change),
    paths: z.array(z.string()).describe(SAY.paths),
  })).describe(SAY.primitives),
  invariants: z.array(z.string()).optional().describe(SAY.invariants),
  map: z.array(step).optional().describe(SAY.map),
  flow: z.array(step).optional().describe(SAY.flow),
  lane: z.enum(LANES).optional().describe(SAY.lane),
}).describe(SAY.recap);

const described = (description: string) => Schema.String.annotate({ description });

const Step = Schema.Struct({ from: described(SAY.from), to: Schema.String, label: described(SAY.label) });

/** The recap as agent-host takes it: optional fields left out rather than null, arrays mutable as `SliceRecap` has them. */
export const RecapSchema = Schema.Struct({
  primitives: Schema.mutable(Schema.Array(Schema.Struct({
    id: described(SAY.id),
    group: described(SAY.group),
    impact: Schema.Literals(IMPACTS).annotate({ description: SAY.impact }),
    change: described(SAY.change),
    paths: Schema.mutable(Schema.Array(Schema.String)).annotate({ description: SAY.paths }),
  }))).annotate({ description: SAY.primitives }),
  invariants: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: SAY.invariants })),
  map: Schema.optionalKey(Schema.mutable(Schema.Array(Step)).annotate({ description: SAY.map })),
  flow: Schema.optionalKey(Schema.mutable(Schema.Array(Step)).annotate({ description: SAY.flow })),
  lane: Schema.optionalKey(Schema.Literals(LANES).annotate({ description: SAY.lane })),
}).annotate({ description: SAY.recap });
