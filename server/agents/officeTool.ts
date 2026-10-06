import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { errorMessage } from '../util';
import type { OfficeTools } from './types';

/** One tool's answer: what happened, in words, or (marked as an error) why it didn't. */
async function answer(run: () => Promise<string>, failed: string): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    return { content: [{ type: 'text', text: await run() }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `${failed}: ${errorMessage(err)}` }], isError: true };
  }
}

/** The office's tools for a goal's lead, as an in-process MCP server: mcp__office__ship, note and propose_close. */
export function officeMcpServer(tools: OfficeTools): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'office',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: 'The Focus office: it pushes your work and opens pull requests for you, keeps your goal\'s note, and tells the captain when you think the goal is done. Never push or open pull requests yourself.',
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
        {
          title: z.string().optional().describe('A better title for the goal, in a few words (at most 60 characters).'),
          done: z.string().optional().describe('What done looks like, as agreed with the captain: a few lines.'),
          slice: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional().describe("This slice's checklist, all of it (at most 7 items): send it again with items ticked off as you go."),
          learned: z.string().optional().describe('One new line on what a slice taught you, or a decision and why.'),
          allLearned: z.array(z.string()).optional().describe('Replaces every learned line: to merge older lessons when the list is full (at most 10).'),
          next: z.array(z.string()).optional().describe('Up to 3 candidate next slices, replacing the last ones.'),
        },
        (input) => answer(() => tools.note(input), "Couldn't update the note"),
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
