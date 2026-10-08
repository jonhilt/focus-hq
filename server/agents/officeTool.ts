import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { errorMessage } from '../util';
import { NOTE_LIMITS as L } from './lead';
import type { OfficeTools } from './types';

/**
 * The note tool's input, with the limits `checkNote` enforces (`NOTE_LIMITS`), so the lead sees them up front rather
 * than learning them by being refused. The office still checks the whole note: learned adds to lines already there.
 */
export const noteShape = {
  title: z.string().max(L.title).optional().describe(`A better title for the goal, in a few words (at most ${L.title} characters).`),
  done: z.string().max(L.done).optional().describe(`What done looks like, as agreed with the captain: a few lines (at most ${L.done} characters).`),
  slice: z.array(z.object({
    text: z.string().max(L.item).describe(`One item (at most ${L.item} characters).`),
    done: z.boolean().optional(),
  })).max(L.slice).optional().describe(`This slice's checklist, all of it (at most ${L.slice} items of ${L.item} characters each): send it again with items ticked off as you go.`),
  learned: z.string().max(L.line).optional().describe(`One new line on what a slice taught you, or a decision and why (at most ${L.line} characters).`),
  allLearned: z.array(z.string().max(L.line)).max(L.learned).optional().describe(`Replaces every learned line: to merge older lessons when the list is full (at most ${L.learned} lines of ${L.line} characters each).`),
  next: z.array(z.string().max(L.item)).max(L.next).optional().describe(`Up to ${L.next} candidate next slices (at most ${L.item} characters each), replacing the last ones.`),
};

/** One tool's answer: what happened, in words, or (marked as an error) why it didn't. */
async function answer(run: () => Promise<string>, failed: string): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    return { content: [{ type: 'text', text: await run() }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `${failed}: ${errorMessage(err)}` }], isError: true };
  }
}

/** The office's tools for a goal's lead, as an in-process MCP server: mcp__office__ship, note, show, ask and propose_close. */
export function officeMcpServer(tools: OfficeTools): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'office',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: 'The Focus office: it pushes your work and opens pull requests for you, keeps your goal\'s note, puts what you show on your station\'s screen, and tells the captain when you think the goal is done. Never push or open pull requests yourself.',
    tools: [
      tool(
        'ship',
        'Ship the slice: the office pushes every repo in your workspace with new commits, and opens (or updates) a pull request in each. Commit everything first.',
        {
          title: z.string().describe('The pull requests’ title: imperative and specific, under 70 characters.'),
          summary: z.string().describe('The pull requests’ description in Markdown: what the slice does and why, and how you tested it.'),
        },
        ({ title, summary }) => answer(() => tools.ship({ title, summary }), "Couldn't ship"),
      ),
      tool(
        'note',
        'Update the goal\'s note, which survives when your conversation gets summarised and which the captain sees. Send only what changes: each field replaces what was there, except learned, which adds a line. Keep it short; the office refuses a note that grows into a spec.',
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
        "Ask the captain a question best answered by looking: which layout, which diagram reads best, which of a few approaches. Each option is a page of its own, shown side by side on your station's screen; they open them up close and pick one. Their pick comes back to you as a message from them, so end your turn after asking. Asking again replaces a question they haven't answered.",
        {
          question: z.string().describe('The question, in a sentence (at most 300 characters).'),
          options: z.array(z.object({
            label: z.string().describe('A few words naming this option (at most 60 characters).'),
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
    ],
  });
}
