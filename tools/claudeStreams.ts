// Records what real Claude Code says down the SDK in a few tiny scripted sessions, on the cheapest model, for the
// facts the Claude Code contract (server/agents/claudeContract.test.ts) couldn't get from the transcripts on disk:
// what `background_tasks_changed` lists and when, what a turn's `result` counts as queued, what happens to a message
// sent mid-turn or as a turn ends, and to a tool that needs approval once the office's input has closed.
//
//   FOCUS_LIVE_CLAUDE=1 pnpm run claude-streams [scenario…]
//
// It keeps only the messages' shapes (`shapeOf`: kinds, flags, tool names, made-up ids), in data/claude-streams/
// (gitignored). A few cents a scenario; it stops a scenario that passes its budget. Never run by `pnpm test`.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { query, type CanUseTool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Ids, type Shape, shapeOf, spentOf } from './claudeStreamsRules';

const MODEL = 'claude-haiku-4-5-20251001';
const BUDGET_USD = 0.3;
const OUT = path.join(process.cwd(), 'data', 'claude-streams');

/** The office's side of a session: what it sends, and when it closes its input. */
interface Office {
  send(text: string): void;
  close(): void;
  readonly closed: boolean;
}

interface Scenario {
  prompt: string;
  /** What the office does on each message, given its shape and what came before. */
  react(shape: Shape, seen: Shape[], office: Office): void;
  timeoutMs: number;
}

const background = (seen: Shape[]): string[] => {
  const last = [...seen].reverse().find((s) => s.subtype === 'background_tasks_changed');
  return Array.isArray(last?.tasks) ? last.tasks : [];
};
const count = (seen: Shape[], p: (s: Shape) => boolean) => seen.filter(p).length;
const ended = (seen: Shape[], kind: string) => seen.some((s) => s.subtype === 'task_notification' && seen.some((t) => t.subtype === 'task_started' && t.task === s.task && t.task_type === kind));

const WORKFLOW = [
  "export const meta = { name: 'tiny', description: 'One agent says hi', phases: [{ title: 'Say' }] }",
  "const said = await agent('Reply with exactly the word hi and nothing else. Use no tools.', { label: 'hi' })",
  'return said',
].join('\n');

const SCENARIOS: Record<string, Scenario> = {
  // a message mid-turn, one as the turn ends, and a background command's report
  messages: {
    prompt: 'Use the Bash tool with run_in_background set to true to run: sleep 8; echo ok. Then reply with only the word STARTED. When you later hear it finished, reply with only the word FINISHED.',
    react(shape, seen, office) {
      const bash = (s: Shape) => s.type === 'assistant' && Array.isArray(s.blocks) && s.blocks.some((b) => b.startsWith('tool_use:Bash'));
      if (bash(shape) && count(seen, bash) === 1) office.send('Also put the word PING in your reply.');
      if (shape.type === 'result' && count(seen, (s) => s.type === 'result') === 1) office.send('Reply with only the word ACK.');
      if (shape.type === 'result' && ended(seen, 'local_bash') && !background(seen).length && !office.closed) office.close();
    },
    timeoutMs: 120_000,
  },
  // a workflow and a background command at once, the command ending first
  workflow: {
    prompt: `Do both of these in one go, then reply with only the word STARTED.\n1. Use the Bash tool with run_in_background set to true to run: sleep 3; echo ok\n2. Use the Workflow tool with exactly this script:\n\n${WORKFLOW}\n\nWhen you later hear each finished, reply with only the word FINISHED.`,
    react(shape, seen, office) {
      if (shape.type === 'result' && ended(seen, 'local_workflow') && ended(seen, 'local_bash') && !background(seen).length && !office.closed) office.close();
    },
    timeoutMs: 180_000,
  },
  // the office closes its input as the turn ends, with a command still running (879f9ec, put back)
  'closed-input': {
    prompt: 'Use the Bash tool with run_in_background set to true to run: sleep 6; echo ok. Then reply with only the word STARTED. When you later hear it finished, run `touch second.txt` with the Bash tool (not in the background), then reply with only the word DONE.',
    react(shape, _seen, office) {
      if (shape.type === 'result' && !office.closed) office.close();
    },
    timeoutMs: 60_000,
  },
};

/** The office's input: messages it sends, until it closes. */
class Input implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting?: (r: IteratorResult<SDKUserMessage>) => void;
  closed = false;
  push(text: string): void {
    const item: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    if (this.waiting) {
      this.waiting({ value: item, done: false });
      this.waiting = undefined;
    } else this.items.push(item);
  }
  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

async function record(name: string, scenario: Scenario): Promise<Shape[]> {
  const cwd = path.join(OUT, 'work', name);
  mkdirSync(cwd, { recursive: true });
  const started = Date.now();
  const seen: Shape[] = [];
  const event = (e: Shape) => seen.push({ ...e, ms: Date.now() - started });
  const input = new Input();
  const office: Office = {
    send: (text) => {
      event({ office: 'sends a message', closed: input.closed });
      input.push(text);
    },
    close: () => {
      event({ office: 'closes its input' });
      input.close();
    },
    get closed() {
      return input.closed;
    },
  };
  const canUseTool: CanUseTool = (tool, toolInput) => {
    event({ office: 'asked to approve', tool, closed: input.closed });
    return Promise.resolve({ behavior: 'allow', updatedInput: toolInput });
  };
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const abort = new AbortController();
  const timer = setTimeout(() => {
    event({ office: 'gives up (timeout)' });
    abort.abort();
  }, scenario.timeoutMs);
  input.push(scenario.prompt);
  const tasks = new Ids('t');
  const tools = new Ids('u');
  try {
    for await (const msg of query({ prompt: input, options: { cwd, model: MODEL, settingSources: [], systemPrompt: { type: 'preset', preset: 'claude_code' }, permissionMode: 'default', canUseTool, env, abortController: abort } })) {
      const shape = { ...shapeOf(msg, tasks, tools), ms: Date.now() - started };
      seen.push(shape);
      scenario.react(shape, seen, office);
      if (spentOf(seen) > BUDGET_USD) {
        event({ office: 'stops: over budget' });
        abort.abort();
      }
    }
    event({ office: 'the session ended' });
  } catch (err) {
    event({ office: 'the session threw', error: err instanceof Error ? err.message.slice(0, 120) : 'error' });
  } finally {
    clearTimeout(timer);
  }
  return seen;
}

async function main(): Promise<void> {
  if (process.env.FOCUS_LIVE_CLAUDE !== '1') {
    console.error('Talks to real Claude Code and spends money: set FOCUS_LIVE_CLAUDE=1 to run it.');
    process.exit(1);
  }
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error(`no scenario ${name}: ${Object.keys(SCENARIOS).join(', ')}`);
    const shapes = await record(name, scenario);
    const spent = spentOf(shapes);
    total += spent;
    writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(shapes, null, 1)}\n`);
    console.log(`${name}: ${shapes.length} messages, $${spent.toFixed(4)}`);
  }
  console.log(`total: $${total.toFixed(4)}`);
}

void main();
