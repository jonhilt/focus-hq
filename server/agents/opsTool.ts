import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { RECAP_SCHEMA } from './recapSchema';
import { errorMessage } from '../util';
import { CONTACT_LIMITS as C } from './contacts';
import type { ExtraTool, OpsTools, ToolReply } from './types';

/** The note tool's input: what the goal's note keeps, and the goal's contacts. */
export const noteShape = {
  title: z.string().optional().describe('A better title for the goal, in a few words.'),
  done: z.string().optional().describe('What done looks like, as agreed with the captain.'),
  learned: z.string().optional().describe('One new line on what a slice taught you, or a decision and why.'),
  allLearned: z.array(z.string()).optional().describe('Replaces every learned line: to merge older lessons.'),
  next: z.array(z.string()).optional().describe('Ideas for what comes next, replacing the last ones.'),
  contact: z.string().max(C.text).optional().describe(`Log one loose thread you noticed and don't want lost, a question, a risk or an idea off the current path, as a contact on the goal's chart (at most ${C.text} characters, ${C.open} open at once). Ops gives it an id (c1, c2…).`),
  closeContact: z.object({
    id: z.string().describe('The contact\'s id, like c2.'),
    as: z.enum(['pursued', 'dropped']).describe('pursued: you\'re taking it up as work; dropped: it isn\'t worth it, or the course moved on.'),
    why: z.string().max(C.why).optional().describe(`Why, in a line (at most ${C.why} characters).`),
  }).optional().describe('Close an open contact once you pursue or drop it.'),
};

/** One tool's answer: what happened, in words (and any pictures), or (marked as an error) why it didn't. */
async function answer(run: () => Promise<string | ToolReply>, failed: string): Promise<{ content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean }> {
  try {
    const reply = await run();
    if (typeof reply === 'string') return { content: [{ type: 'text', text: reply }] };
    return { content: [{ type: 'text', text: reply.text }, ...reply.images.map((image) => ({ type: 'image' as const, data: Buffer.from(image).toString('base64'), mimeType: 'image/jpeg' }))] };
  } catch (err) {
    return { content: [{ type: 'text', text: `${failed}: ${errorMessage(err)}` }], isError: true };
  }
}

/** Ops' own tools' names: a plugin's tool with one of them is left out. */
export const OPS_TOOL_NAMES = ['ship', 'note', 'show', 'ask', 'propose_close'] as const;
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
 * Ops' tools for a goal's lead, as an in-process MCP server: mcp__office__ship, note, show, ask and
 * propose_close, and those the plugins switched on add.
 */
export function opsMcpServer(tools: OpsTools): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'office',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: 'Ops, the automated side of Focus: it pushes your work and opens pull requests for you, keeps your goal\'s note, puts what you show on your station\'s screen, and tells the captain when you think the goal is done. Never push or open pull requests yourself.',
    tools: [
      tool(
        'ship',
        'Ship the slice: Ops pushes every repo in your workspace with new commits, and opens (or updates) a pull request in each. Commit everything first. With it goes the slice\'s system recap, which the captain reviews it by before the diff: the primitives (the system\'s building blocks) it touches, each composed (used as it is: wiring, call sites), extended (its behaviour or contract changed) or added (a new one), and how they connect. Ops refuses the ship if a file the slice changes is under none of the primitives\' paths, then puts the recap in the pull requests and on your station\'s screen. Use the same primitive ids from slice to slice. In the recap, pick the slice\'s lane: ship merges it by itself once QA passes it, show merges it and tells the captain, ask waits for the captain; never lower than its rollup allows.',
        {
          title: z.string().describe('The pull requests’ title: imperative and specific, under 70 characters.'),
          summary: z.string().describe('The pull requests’ description in Markdown: what the slice does and why, and how you tested it.'),
          recap: RECAP_SCHEMA,
        },
        ({ title, summary, recap }) => answer(() => tools.ship({ title, summary, recap }), "Couldn't ship"),
      ),
      tool(
        'note',
        'Update the goal\'s note, which survives when your conversation gets summarised and which the captain sees. Send only what changes: each field replaces what was there, except learned, which adds a line, and contact and closeContact, which log and close loose threads on the goal\'s chart. Keep it short: a few lines, not a spec.',
        noteShape,
        (input) => answer(() => tools.note(input), "Couldn't update the note"),
      ),
      tool(
        'show',
        "Put a visual on your station's big screen for the captain: a diagram, a mockup, options side by side. They see a picture of it on the screen, switch between what you've shown, and open each one up close, live. Showing an id again replaces it.",
        {
          id: z.string().describe('A short name for it, lowercase with dashes (like "data-flow"): show the same id again to update it.'),
          title: z.string().describe('What it is, in a few words (at most 80 characters).'),
          html: z.string().describe('A self-contained HTML page: inline CSS and SVG, or a script from a CDN (mermaid, say). The screen shows it at 1280 × 800, so make it read well at that size.'),
        },
        (input) => answer(() => tools.show(input), "Couldn't show it"),
      ),
      tool(
        'ask',
        "Ask the captain a question best answered by looking: which layout, which diagram reads best, which of a few approaches. Each option is a page of its own, shown on your station's screen; up close, the captain steps through them one at a time, large, and picks one. Say why you're asking in context, and give each option a detail (what it means, what it trades off): they read it beside the page. Their pick comes back to you as a message from them, so end your turn after asking. Asking again replaces a question they haven't answered.",
        {
          question: z.string().describe('The question, in a sentence (at most 300 characters).'),
          context: z.string().optional().describe('Why you\'re asking and what matters in choosing, in a few sentences (at most 600 characters): the captain reads it above the options.'),
          options: z.array(z.object({
            label: z.string().describe('A few words naming this option (at most 60 characters).'),
            detail: z.string().optional().describe('What this option means and what it trades off, in a sentence or three (at most 500 characters): shown beside its page.'),
            html: z.string().describe('A self-contained HTML page showing it, laid out for 1280 × 800 like the show tool\'s.'),
          })).describe('2 to 4 options: the captain sees them lettered A, B, C, D in this order.'),
        },
        (input) => answer(() => tools.ask(input), "Couldn't ask"),
      ),
      tool(
        'propose_close',
        "Tell the captain you think the goal is done (what done looks like is met), or that nothing worthwhile is left. They close it or carry on. Then tell them why, and stop.",
        { reason: z.string().describe('Why, in a sentence or two.') },
        ({ reason }) => answer(() => tools.proposeClose({ reason }), "Couldn't propose closing"),
      ),
      ...extraTools(tools.extra ?? []).map((t) => tool(t.name, t.description, t.input, (input) => answer(() => t.run(input), `${t.name} failed`))),
    ],
  });
}
