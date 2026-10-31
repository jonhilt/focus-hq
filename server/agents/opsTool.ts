import type { Tool, ToolResult } from 'agent-host';
import { Effect, Schema, SchemaIssue, SchemaTransformation } from 'effect';
import { z, type ZodType } from 'zod';
import { RecapSchema } from './recapSchema';
import { errorMessage } from '../util';
import type { ExtraTool, OpsTools, ToolReply } from './types';

/**
 * What the office server is, as the old runner's MCP server tells Claude. agent-host's tool server has no
 * instructions to carry it, so a lead on the host is to be told it in its system prompt.
 */
export const OPS_INSTRUCTIONS = 'Ops, the automated side of Focus: it follows the pull requests you open as the goal\'s and sends them to QA once they\'re ready, puts a recap on one when you send it, puts what you show on your station\'s screen, and tells the captain when you think the goal is done.';

/** One tool's answer: what happened, in words (and any pictures), or (marked as an error) why it didn't. */
async function answer(run: () => Promise<string | ToolReply>, failed: string): Promise<ToolResult> {
  try {
    const reply = await run();
    if (typeof reply === 'string') return { text: reply };
    return { text: reply.text, images: reply.images.map((data) => ({ data, mimeType: 'image/jpeg' })) };
  } catch (err) {
    return { text: `${failed}: ${errorMessage(err)}`, isError: true };
  }
}

/** Ops' own tools' names: a plugin's tool with one of them is left out. */
export const OPS_TOOL_NAMES = ['recap', 'show', 'ask', 'propose_close'] as const;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,40}$/;

/** The plugins' tools a lead's `office` server takes: well named, clear of Ops' own and of each other's (the first wins). */
export function extraTools(extra: readonly ExtraTool[]): ExtraTool[] {
  const taken = new Set<string>(OPS_TOOL_NAMES);
  return extra.filter((t) => {
    if (!TOOL_NAME.test(t.name) || taken.has(t.name)) return false;
    taken.add(t.name);
    return true;
  });
}

/**
 * A plugin's zod input as an Effect Schema: zod parses it, the tool getting what zod gives back, and a bad one reads
 * as zod's own summary of what's wrong. Its JSON Schema is the one zod makes from the shape (draft-07, the input's
 * side), carried by a check, as a declaration's own JSON Schema is left open. Throws when zod can't make one.
 */
export function zodInput(shape: Record<string, ZodType>): Schema.Codec<Record<string, unknown>> {
  const object = z.object(shape);
  const jsonSchema = z.toJSONSchema(object, { target: 'draft-7', io: 'input' });
  const json = Schema.Json.check(Schema.makeFilter(() => true, { toJsonSchema: () => jsonSchema }));
  return Schema.declareConstructor<Record<string, unknown>>()(
    [],
    () => (input) => {
      const parsed = object.safeParse(input);
      return parsed.success ? Effect.succeed(parsed.data) : Effect.fail(new SchemaIssue.InvalidValue({ message: z.prettifyError(parsed.error) }));
    },
    { toCodecJson: () => Schema.link<Record<string, unknown>>()(json, SchemaTransformation.passthrough({ strict: false })) },
  );
}

/** One of Ops' own, as agent-host serves it as `office`. */
function opsTool<A>(name: string, description: string, input: Schema.Codec<A>, failed: string, run: (input: A) => Promise<string>): Tool {
  return { name, server: 'office', description, input, handler: (args: A) => Effect.promise(() => answer(() => run(args), failed)) };
}

/** A plugin's, zod parsing its input. Null when zod can't make its JSON Schema: it's left out. */
function pluginTool(t: ExtraTool): Tool | null {
  let input: Schema.Codec<Record<string, unknown>>;
  try {
    input = zodInput(t.input);
  } catch (err) {
    console.warn(`The office tool ${t.name} is left out, as its input has no JSON Schema: ${errorMessage(err)}`);
    return null;
  }
  return { name: t.name, server: 'office', description: t.description, input, handler: (args: Record<string, unknown>) => Effect.promise(() => answer(() => t.run(args), `${t.name} failed`)) };
}

const Described = (description: string) => Schema.String.annotate({ description });

/**
 * Ops' tools for a goal's lead as agent-host's tools, served as `office`: mcp__office__recap, show, ask and
 * propose_close, and those the plugins switched on add. What they're for goes in the lead's instructions
 * (`OPS_INSTRUCTIONS`), as the host's tool server carries none.
 */
export function opsTools(tools: OpsTools): Tool[] {
  const say = {
    repo: 'The pull request\'s repo, owner/name.',
    number: 'The pull request\'s number.',
    id: 'A short name for it, lowercase with dashes (like "data-flow"): show the same id again to update it.',
    title: 'What it is, in a few words (at most 80 characters).',
    html: 'A self-contained HTML page: inline CSS and SVG, or a script from a CDN (mermaid, say). The screen shows it at 1280 × 800, so make it read well at that size.',
    question: 'The question, in a sentence (at most 300 characters).',
    context: 'Why you\'re asking and what matters in choosing, in a few sentences (at most 600 characters): the captain reads it above the options.',
    label: 'A few words naming this option (at most 60 characters).',
    detail: 'What this option means and what it trades off, in a sentence or three (at most 500 characters): shown beside its page.',
    optionHtml: 'A self-contained HTML page showing it, laid out for 1280 × 800 like the show tool\'s.',
    options: '2 to 4 options: the captain sees them lettered A, B, C, D in this order.',
    reason: 'Why, in a sentence or two.',
  };
  return [
    opsTool(
      'recap',
      'Put a system recap on one of the goal\'s open pull requests (one you opened with gh, once Ops is following it), which the captain reviews it by before the diff: the primitives (the system\'s building blocks) it touches, each composed (used as it is: wiring, call sites), extended (its behaviour or contract changed) or added (a new one), and how they connect. Ops refuses one that leaves a file the pull request changes under none of its primitives\' paths (paths start with the repo\'s folder), then puts it in the pull request\'s description and on your station\'s screen. It also picks the lane the pull request merges in once QA passes it: ship merges it by itself, show merges it and tells the captain, ask waits for the captain; never lower than its rollup allows. With no recap, a pull request is in ask. Send it again to replace it.',
      Schema.Struct({ repo: Described(say.repo), number: Schema.Int.annotate({ description: say.number }), recap: RecapSchema }),
      "Couldn't put the recap on it",
      (input) => tools.recap(input),
    ),
    opsTool(
      'show',
      "Put a visual on your station's big screen for the captain: a diagram, a mockup, options side by side. They see a picture of it on the screen, switch between what you've shown, and open each one up close, live. Showing an id again replaces it.",
      Schema.Struct({ id: Described(say.id), title: Described(say.title), html: Described(say.html) }),
      "Couldn't show it",
      (input) => tools.show(input),
    ),
    opsTool(
      'ask',
      "Ask the captain a question best answered by looking: which layout, which diagram reads best, which of a few approaches. Each option is a page of its own, shown on your station's screen; up close, the captain steps through them one at a time, large, and picks one. Say why you're asking in context, and give each option a detail (what it means, what it trades off): they read it beside the page. Their pick comes back to you as a message from them, so end your turn after asking. Asking again replaces a question they haven't answered.",
      Schema.Struct({
        question: Described(say.question),
        context: Schema.optionalKey(Described(say.context)),
        options: Schema.mutable(Schema.Array(Schema.Struct({ label: Described(say.label), detail: Schema.optionalKey(Described(say.detail)), html: Described(say.optionHtml) }))).annotate({ description: say.options }),
      }),
      "Couldn't ask",
      (input) => tools.ask(input),
    ),
    opsTool(
      'propose_close',
      "Tell the captain you think the goal is done (what done looks like is met), or that nothing worthwhile is left. They close it or carry on. Then tell them why, and stop.",
      Schema.Struct({ reason: Described(say.reason) }),
      "Couldn't propose closing",
      ({ reason }) => tools.proposeClose({ reason }),
    ),
    opsTool(
      'merge_when_passed',
      "Only when the captain has told you to merge one of the goal's open pull requests: Ops merges it once QA passes it, at exactly the commit QA passed, as the captain's own merge when passed does, in whatever lane it's in. A fail drops the request. Never use it on your own judgement: without the captain's word, the lane decides.",
      Schema.Struct({ repo: Described(say.repo), number: Schema.Int.annotate({ description: say.number }) }),
      "Couldn't ask Ops to merge it",
      (input) => tools.mergeWhenPassed(input),
    ),
    ...extraTools(tools.extra ?? []).flatMap((t) => pluginTool(t) ?? []),
  ];
}
