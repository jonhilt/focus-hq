import { toolServer } from 'agent-host';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { extraTools, opsMcpServer, opsTools } from './opsTool';
import type { ExtraTool, OpsTools } from './types';

describe('the plugins\' tools', () => {
  const t = (name: string) => ({ name, description: name, input: {}, run: () => Promise.resolve(name) });

  it('takes those well named and clear of Ops\' own and of each other\'s, the first of a name winning', () => {
    const first = t('map');
    const kept = extraTools([first, t('show'), t('Map Tool'), t('map'), t('trace_view')]);
    expect(kept.map((x) => x.name)).toEqual(['map', 'trace_view']);
    expect(kept[0]).toBe(first);
  });
});

// The office tools on agent-host against the old runner's MCP server, both asked over MCP as Claude Code asks them.

interface Listed {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface Called {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
}

interface Server {
  connect(transport: never): Promise<void>;
}

/** A client for an MCP server in this process: a request in, its result back. */
async function client(server: Server) {
  const replies = new Map<number, (result: unknown) => void>();
  const transport = {
    onmessage: undefined as ((message: unknown) => void) | undefined,
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message: { id?: number; result?: unknown; error?: { message: string } }) => {
      if (message.id !== undefined) replies.get(message.id)?.(message.result ?? message.error);
      return Promise.resolve();
    },
  };
  await server.connect(transport as never);
  let id = 0;
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve) => {
      replies.set(++id, resolve);
      transport.onmessage?.({ jsonrpc: '2.0', id, method, params });
    });
  return {
    list: async () => ((await request('tools/list', {})) as { tools: Listed[] }).tools,
    call: async (name: string, args: unknown) => (await request('tools/call', { name, arguments: args })) as Called,
  };
}

/**
 * A tool's JSON Schema with what's said the same either way taken out: the draft zod names at the top (`$schema`),
 * and Effect's `additionalProperties: true`, which is what leaving it out means.
 */
function normalized(schema: unknown, top = true): unknown {
  if (Array.isArray(schema)) return schema.map((s) => normalized(s, false));
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key, value]) => !(top && key === '$schema') && !(key === 'additionalProperties' && value === true))
      .map(([key, value]) => [key, normalized(value, false)]),
  );
}

/** Ops' tools that say what they were given, and a plugin's that answers with a picture (or throws, when asked to). */
function lent(): OpsTools {
  const said = (what: string) => (input: unknown) => Promise.resolve(`${what} ${JSON.stringify(input)}`);
  const sample: ExtraTool = {
    name: 'sample',
    description: 'A plugin\'s tool, for the test.',
    input: {
      text: z.string().describe('What to say.'),
      count: z.number().int().optional().describe('How many.'),
      tone: z.enum(['calm', 'loud']).default('calm'),
      tags: z.array(z.object({ name: z.string(), weight: z.number().min(0).max(1).optional() })).optional(),
    },
    run: (input) => {
      if (input.text === 'throw') return Promise.reject(new Error('it broke'));
      return Promise.resolve({ text: `sample ${JSON.stringify(input)}`, images: [new Uint8Array([1, 2, 3])] });
    },
  };
  return {
    recap: said('recap'),
    show: said('show'),
    ask: said('ask'),
    proposeClose: said('proposeClose'),
    extra: [sample, { ...sample, name: 'show' }, { ...sample, name: 'Bad Name' }, { ...sample, name: 'dated', input: { when: z.date() } }],
  };
}

const servers = async () => {
  const tools = lent();
  return { mcp: await client(opsMcpServer(tools).instance), host: await client(toolServer('office', opsTools(tools))) };
};

const RECAP = {
  repo: 'jonhilt/focus',
  number: 7,
  recap: {
    primitives: [{ id: 'office-tools', group: 'ops', impact: 'adds', change: 'Ops\' tools on agent-host.', paths: ['focus/server/agents/opsTool.ts'] }],
    invariants: ['The two servers say the same.'],
    map: [{ from: 'office-tools', to: 'agent-host', label: 'serves' }],
    lane: 'ask',
  },
};

/** A good input for each tool both serve. */
const GOOD: Record<string, unknown> = {
  recap: RECAP,
  show: { id: 'data-flow', title: 'Data flow', html: '<p>hi</p>' },
  ask: { question: 'Which?', options: [{ label: 'A', html: '<p>a</p>', detail: 'The first.' }, { label: 'B', html: '<p>b</p>' }] },
  propose_close: { reason: 'Done.' },
  sample: { text: 'hello', tags: [{ name: 'x', weight: 0.5 }], extra: 'dropped' },
};

describe('the office tools on agent-host', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('are what the MCP server serves: the same names in the same order, descriptions and JSON Schemas', async () => {
    const { mcp, host } = await servers();
    const [old, now] = await Promise.all([mcp.list(), host.list()]);
    expect(now.map((t) => t.name)).toEqual(['recap', 'show', 'ask', 'propose_close', 'sample']);
    expect(now.map((t) => t.name)).toEqual(old.map((t) => t.name));
    for (const [i, t] of now.entries()) {
      expect(t.description).toBe(old[i].description);
      expect(normalized(t.inputSchema), t.name).toEqual(normalized(old[i].inputSchema));
    }
  });

  it('give a plugin\'s tool zod\'s JSON Schema as it is, the draft it names too', async () => {
    const { mcp, host } = await servers();
    const [old, now] = await Promise.all([mcp.list(), host.list()]);
    expect(now.find((t) => t.name === 'sample')?.inputSchema).toEqual(old.find((t) => t.name === 'sample')?.inputSchema);
  });

  it('are all served as office', () => {
    expect(opsTools(lent()).map((t) => t.server)).toEqual(['office', 'office', 'office', 'office', 'office']);
  });

  it('answer as the MCP server does, words and pictures, with what zod parsed (defaults in, unknown fields out)', async () => {
    const { mcp, host } = await servers();
    for (const [name, args] of Object.entries(GOOD)) {
      const [old, now] = await Promise.all([mcp.call(name, args), host.call(name, args)]);
      expect(now, name).toEqual(old);
      expect(now.isError, name).toBeUndefined();
    }
    const sample = await host.call('sample', GOOD.sample);
    expect(sample.content).toEqual([
      { type: 'text', text: 'sample {"text":"hello","tone":"calm","tags":[{"name":"x","weight":0.5}]}' },
      { type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });

  it('say a tool that throws failed, in its message, as the MCP server does', async () => {
    const { mcp, host } = await servers();
    const [old, now] = await Promise.all([mcp.call('sample', { text: 'throw' }), host.call('sample', { text: 'throw' })]);
    expect(now).toEqual(old);
    expect(now).toEqual({ content: [{ type: 'text', text: 'sample failed: it broke' }], isError: true });
  });

  it('tell the agent what\'s wrong with a bad input, in words', async () => {
    const { host } = await servers();
    const show = await host.call('show', { id: 'x', html: '<p></p>' });
    expect(show.isError).toBe(true);
    expect(show.content[0].text).toMatch(/^Invalid input for show: Missing key\s+at \["title"\]$/);
    const recap = await host.call('recap', { ...RECAP, number: 1.5 });
    expect(recap.content[0].text).toMatch(/^Invalid input for recap: Expected an integer\s+at \["number"\]$/);
    const sample = await host.call('sample', { text: 3, tone: 'shouty' });
    expect(sample.isError).toBe(true);
    expect(sample.content[0].text).toBe(
      'Invalid input for sample: ✖ Invalid input: expected string, received number\n  → at text\n✖ Invalid option: expected one of "calm"|"loud"\n  → at tone',
    );
  });
});
