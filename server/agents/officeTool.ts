import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { errorMessage } from '../util';
import type { OfficeTools } from './types';

/** The office's tools for a session, as an in-process MCP server: mcp__office__ship for the project's lead. */
export function officeMcpServer(tools: OfficeTools): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'office',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: 'The Focus office: it pushes your work and opens pull requests for you. Never push or open pull requests yourself.',
    tools: [
      tool(
        'ship',
        'Ship the slice: the office pushes every repo in your workspace with new commits, and opens (or updates) a pull request in each. Commit everything first.',
        {
          title: z.string().describe('The pull requests’ title: imperative and specific, under 70 characters.'),
          summary: z.string().describe('The pull requests’ description in Markdown: what the slice does and why, and how you tested it.'),
        },
        async ({ title, summary }) => {
          try {
            return { content: [{ type: 'text', text: await tools.ship({ title, summary }) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `Couldn't ship: ${errorMessage(err)}` }], isError: true };
          }
        },
      ),
    ],
  });
}
