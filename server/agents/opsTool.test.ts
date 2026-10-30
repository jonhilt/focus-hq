import { toolServer } from 'agent-host';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { extraTools, opsTools } from './opsTool';
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

const servers = async () => ({ host: await client(toolServer('office', opsTools(lent()))) });

const RECAP = {
  repo: 'jonhilt/focus',
  number: 7,
  recap: {
    primitives: [{ id: 'office-tools', group: 'ops', impact: 'adds', change: 'Ops\' tools on agent-host.', paths: ['focus/server/agents/opsTool.ts'] }],
    invariants: ['The lead sees each tool as described.'],
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

  it('are Ops\' own in order, then the plugins\' well-named ones, each described with the JSON Schema of its input', async () => {
    const { host } = await servers();
    const listed = await host.list();
    expect(listed.map((t) => t.name)).toEqual(['recap', 'show', 'ask', 'propose_close', 'sample']);
    for (const t of listed) expect(t.description, t.name).not.toBe('');
    expect(listed.find((t) => t.name === 'recap')?.inputSchema).toMatchObject({ type: 'object', required: ['repo', 'number', 'recap'] });
    expect(listed.find((t) => t.name === 'ask')?.inputSchema).toMatchObject({ type: 'object', required: ['question', 'options'] });
  });

  it('give a plugin\'s tool zod\'s JSON Schema as it is, the draft it names too', async () => {
    const { host } = await servers();
    const sample = lent().extra?.[0];
    const listed = (await host.list()).find((t) => t.name === 'sample');
    expect(listed?.inputSchema).toEqual(z.toJSONSchema(z.object(sample?.input ?? {}), { target: 'draft-7', io: 'input' }));
  });

  it('are all served as office', () => {
    expect(opsTools(lent()).map((t) => t.server)).toEqual(['office', 'office', 'office', 'office', 'office']);
  });

  it('answer in words and pictures, with what zod parsed (defaults in, unknown fields out)', async () => {
    const { host } = await servers();
    for (const [name, args] of Object.entries(GOOD)) {
      const now = await host.call(name, args);
      expect(now.isError, name).toBeUndefined();
      if (name !== 'sample') expect(now.content[0].text, name).toMatch(new RegExp(`^${name === 'propose_close' ? 'proposeClose' : name} \\{`));
    }
    const sample = await host.call('sample', GOOD.sample);
    expect(sample.content).toEqual([
      { type: 'text', text: 'sample {"text":"hello","tone":"calm","tags":[{"name":"x","weight":0.5}]}' },
      { type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });

  it('say a tool that throws failed, in its message', async () => {
    const { host } = await servers();
    const now = await host.call('sample', { text: 'throw' });
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
