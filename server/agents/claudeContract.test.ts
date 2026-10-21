import type { CanUseTool, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { BrowserPool } from './browserTool';
import { type Beat, holdsToClaudeContract, REAL, type Session } from './claudeContract';
import { ClaudeRunner } from './claudeRunner';
import { StandInClaude } from './claudeStandIn';
import { FakeClaude } from './fakeFocus';
import { now } from './invariants';
import type { RunHooks, RunRequest } from './types';

// The Claude Code contract (docs/contracts.md), held against streams distilled from real sessions, against the
// session's stand-in for Claude Code (claudeStandIn.ts, which the session's checks run on), and, a level up, Ops'
// runner on those real streams against the stand-ins for the whole runner.

interface QueryArgs {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}
const sdk = vi.hoisted(() => ({ code: undefined as ((args: QueryArgs) => unknown) | undefined }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  query: (args: QueryArgs) => sdk.code?.(args),
}));

const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

holdsToClaudeContract('Claude Code (2.1.289, recorded)', (session) => Promise.resolve(REAL[session]));

/** Ops' input to a stand-in: what it sends, until it closes. */
class Input implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting?: (r: IteratorResult<SDKUserMessage>) => void;
  private closed = false;
  push(text: string): void {
    const item: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    if (this.waiting) this.waiting({ value: item, done: false });
    else this.items.push(item);
    this.waiting = undefined;
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

type Step = ((c: StandInClaude) => void) | 'sends' | 'closes';
const workflowOf = (c: StandInClaude) => c.tasks.find((t) => t.kind === 'local_workflow')?.id;
const commandOf = (c: StandInClaude) => c.tasks.find((t) => t.kind === 'local_bash')?.id;

/** Each session as the stand-in plays it: Claude Code's moves and Ops', in the order the real one went. */
const SCRIPTS: Record<Session, Step[]> = {
  messages: [(c) => c.startTask('local_bash'), 'sends', (c) => c.fold(), (c) => c.endTurn(), 'sends', (c) => c.endTurn(), (c) => c.taskEnds(true), (c) => c.endTurn(), 'closes'],
  workflow: [(c) => c.startTask('local_bash'), (c) => c.startTask('local_workflow'), (c) => c.endTurn(), (c) => c.progress(), (c) => c.taskEnds(true, workflowOf(c)), (c) => c.taskEnds(true, commandOf(c)), (c) => c.fold(), (c) => c.endTurn(), 'closes'],
  'closed input': [(c) => c.startTask('local_bash'), (c) => c.endTurn(), 'closes', (c) => c.taskEnds(true), (c) => c.endTurn()],
};

/** The session's stand-in for Claude Code playing `session` out, with Ops approving whatever it's asked. */
async function standIn(session: Session, plays?: ConstructorParameters<typeof StandInClaude>[4]): Promise<Beat[]> {
  const beats: Beat[] = [];
  const input = new Input();
  let heard = 0;
  // called only once Claude Code is under way: it reads the brief a tick after it starts
  const flush = () => {
    for (const m of code.said.slice(heard)) beats.push({ claude: m });
    heard = code.said.length;
  };
  const canUseTool: CanUseTool = (tool, toolInput) => {
    flush();
    beats.push({ asks: tool });
    return Promise.resolve({ behavior: 'allow', updatedInput: toolInput });
  };
  input.push('the brief');
  const code = new StandInClaude([], { canUseTool, abortController: new AbortController() }, input, now, plays);
  await ticks();
  for (const step of SCRIPTS[session]) {
    flush();
    if (step === 'sends') {
      beats.push({ ops: 'sends' });
      input.push('a message');
    } else if (step === 'closes') {
      beats.push({ ops: 'closes' });
      input.close();
    } else step(code);
    await ticks();
  }
  flush();
  if (code.exitedNow) beats.push({ ends: true });
  return beats;
}

holdsToClaudeContract('the session’s stand-in (claudeStandIn.ts)', (session) => standIn(session));

// What the stand-in plays beyond the recorded streams, for the session's checks to reach: no recording backs these, so
// the contract can't hold them, and a stand-in that quietly lost one would leave the checks blind to its bug again.
describe('the session’s stand-in, beyond the recorded streams', () => {
  it('can list its background leaving out a workflow that still runs (eab2be2’s report: never recorded)', async () => {
    const input = new Input();
    input.push('the brief');
    const code = new StandInClaude([], { abortController: new AbortController() }, input, now);
    await ticks();
    code.startTask('local_workflow');
    code.listWithoutWorkflows();
    const last = code.said.findLast((m) => m.subtype === 'background_tasks_changed');
    expect(code.tasks.map((t) => t.kind)).toEqual(['local_workflow']);
    expect(last).toMatchObject({ tasks: [] });
  });
});

// ── a level up: Ops' runner on the real streams ──────────────────────

const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: '', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: true, leadEffort: 'high', leadCompactAt: 200_000 };
const request: RunRequest = { agentId: 'lead_contract', agentName: 'Lt. Lead', cwd: process.cwd(), prompt: 'the brief', systemAppend: '', settings, autonomy: 'ask' };
const hooks = (): RunHooks => ({ lines: () => undefined, activity: () => undefined, browser: () => undefined, screenshot: () => undefined, session: () => undefined, cost: () => undefined, permission: () => Promise.resolve(true) });

/**
 * `ClaudeRunner` hearing what Claude Code said in a real session, beat by beat (Ops' own moves left to the
 * runner): where in it the runner closed its input, by the index of the beat it had just heard, and the session.
 */
async function replay(session: Session) {
  const beats = REAL[session].flatMap((b) => ('claude' in b ? [b.claude] : []));
  let heard = -1;
  let closedAt: number | undefined;
  sdk.code = ({ prompt }) => {
    void (async () => {
      for await (const _ of prompt) void _;
      closedAt = heard;
    })();
    return {
      async *[Symbol.asyncIterator]() {
        for (const [i, m] of beats.entries()) {
          await ticks();
          heard = i;
          yield m;
        }
        await ticks();
      },
      getContextUsage: () => Promise.resolve({ percentage: 5, totalTokens: 50_000, rawMaxTokens: 1_000_000 }),
      stopTask: () => Promise.resolve(),
      interrupt: () => Promise.resolve(),
      setPermissionMode: () => Promise.resolve(),
      applyFlagSettings: () => Promise.resolve(),
    };
  };
  const s = new ClaudeRunner(new BrowserPool()).start(request, hooks());
  const outcome = await s.done;
  const lastResult = beats.findLastIndex((m) => m.type === 'result');
  return { closedAt, lastResult, outcome, session: s, beats };
}

describe('Ops’ runner on the real streams', () => {
  it('keeps listening until the last turn is over, through the turns Claude Code takes for its background tasks', async () => {
    for (const session of ['messages', 'workflow', 'closed input'] satisfies Session[]) {
      const { closedAt, lastResult, outcome } = await replay(session);
      expect({ session, closedAt }).toEqual({ session, closedAt: lastResult });
      expect(outcome).toMatchObject({ ok: true });
    }
  });

  it('refuses a message once it has stopped listening', async () => {
    const { session } = await replay('messages');
    expect(session.send('too late')).toBe(false);
  });
});

/**
 * What the stand-ins for the whole runner (FakeClaude, which the manager's tests run on, and DemoRunner) keep of what
 * the runner does on real streams. Neither says anything at the SDK's `query`, so the stream contract above can't
 * hold them: what they assume is in docs/invariants.md.
 */
describe('FakeClaude, against what the runner does on real streams', () => {
  it.fails('refuses a message once its session has stopped listening [simplified: a session always takes a message, as Claude Code takes one sent as a turn ends; its turns end when the test says]', () => {
    const claude = new FakeClaude();
    const s = claude.start(request, hooks());
    claude.deaf = true;
    expect(s.send('too late')).toBe(false);
  });

  it('can’t stop a background task once its session has stopped listening', async () => {
    const claude = new FakeClaude();
    const s = claude.start(request, hooks());
    claude.deaf = true;
    expect(await s.stopTask?.('b1')).toBe(false);
  });
});
