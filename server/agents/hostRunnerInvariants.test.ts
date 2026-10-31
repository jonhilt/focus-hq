import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Adapter, type AgentSession as HostSession, type Answer, type FakeSession, makeFakeAdapter } from 'agent-host';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { entryLines } from '../../shared/stepText';
import type { Settings } from '../../shared/types';
import { paths } from '../config';
import { BrowserPool } from './browserTool';
import { HostRunner } from './hostRunner';
import { type Action, checkAtOnce, type Later, now, type Running, type Subject } from './invariants';
import { refusedFile } from './pushGuard';
import { scratchDir } from './scratch';
import type { AgentSession, RunHooks, RunOutcome, RunRequest } from './types';

// A session on agent-host as Focus's `HostRunner` runs it, under Focus's rule that two things at once end as one after
// the other would (docs/invariants.md). Each Focus turn watches the host's conversation until the host's turn ends;
// meanwhile Claude Code says things, takes a message the captain sends, starts and ends background commands, sends a
// probe out from its scratch dir and raises a hand for the manager. Described here (what can happen to a session,
// what must hold once it has settled), not told what to expect: the runner and the host run as they are, on
// agent-host's fake agent (`makeFakeAdapter`), which this file drives as Claude Code would.
//
// Not held to the rule for a restart: the session keeps nothing of its own across one. What the host keeps (its
// journal, a cut-off turn it resumes) is agent-host's to hold, in its own tests; Focus's pick-up of it is
// `hostRunner.test.ts`'s.

vi.setConfig({ testTimeout: 120_000 });

/** A secret of Focus's own, set in its environment by hand: no session's environment may carry it (docs/settings.md). */
const SECRET = 'a-bot-token-nobody-else-sees';
process.env.FOCUS_BOT_TOKEN = SECRET;

const settings: Settings = { maxConcurrent: 4, autonomy: 'ask', model: '', conflictsModel: '', qaModel: '', mergeMethod: 'squash', attribution: true, userClaudeMd: false, leadEffort: 'high', leadCompactAt: 200_000 };
const request = (agentId: string, prompt: string, resumeSessionId?: string): RunRequest => ({ agentId, agentName: 'Ensign Dev', task: 'issue', cwd: process.cwd(), prompt, systemAppend: 'Work the issue.', settings, autonomy: 'ask', resumeSessionId });

/** What must hold of a session, once it has settled. */
export interface Said {
  /** What reached the conversation, in order. */
  received: string[];
  /** Whether Claude Code is in a turn. */
  agentTurn: boolean;
  /** Each Focus turn: under way, or how it ended. */
  turns: string[];
  /** How the host's turns ended, in order (its `TurnEnded`). */
  ended: string[];
  /** What Claude Code said, as Ops rendered it. */
  said: number;
  /** The answers Claude Code got, by the hand it raised. */
  hands: Record<string, string[]>;
  /** Raised hands the manager is still asked about. */
  asking: number;
  /** Background commands, as Claude Code has them, and as Ops was told while a turn watched. */
  running: string[];
  told: string[];
  /** Probes from its scratch dir Ops was told of, and commands its guard refused. */
  probes: number;
  refused: number;
  /** Whether the agent's scratch dir is there. */
  scratch: boolean;
}

/** Until what `read` says stops changing (four looks 5 ms apart, three seconds at most). */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 4 && i < 600; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const next = JSON.stringify(read());
    same = next === last ? same + 1 : 0;
    last = next;
  }
};

const ended = (o: RunOutcome) => (o.ok ? `done: ${o.summary}` : o.aborted ? 'stopped' : `failed: ${o.error ?? ''}`);

/** The environment each agent's sessions were lent, by agent. */
const lent = new Map<string, Record<string, string>>();

/** Each run's agent is its own, so a runner shutting down never clears the scratch dir of the next one's. */
let agents = 0;

/** A session; `only` and `except`, the actions offered, by name, when a check is after some of them. */
const sessionOf = (only?: RegExp, except?: RegExp): Subject<Said> => ({
  name: 'host session',
  start: async (later: Later) => {
    const agentId = `dev_host_${++agents}`;
    const dir = scratchDir(agentId);
    // what Claude Code got answered, by request, and its background as it last listed it
    const hands: Record<string, string[]> = {};
    let running: string[] = [];
    const endings: string[] = [];
    // numbered by kind, so a command's or a hand's number doesn't hang on how many messages came before it
    const ids = new Map<string, number>();
    const id = (prefix: string) => {
      ids.set(prefix, (ids.get(prefix) ?? 0) + 1);
      return `${prefix}${ids.get(prefix)}`;
    };
    /** One of Claude Code's own messages, as the host's events carry it. */
    const sdk = (fields: Record<string, unknown>) => ({ session_id: 's', uuid: id('u'), ...fields });
    const main = { _tag: 'Main' as const };

    const fake = makeFakeAdapter({ script: (s) => s.beginTurn() });
    const agent = (): FakeSession | undefined => fake.sessions.at(-1);
    // Claude Code as the fake plays it, with what the real one says beside: each answer it's given, and a stopped
    // command's notification
    const adapter: Adapter = {
      open: (options) =>
        fake.open((lent.set(agentId, options.env), options)).pipe(
          Effect.map((session): HostSession => ({
            ...session,
            answer: (requestId, answer: Answer) => {
              (hands[requestId] ??= []).push(answer._tag);
              return session.answer(requestId, answer);
            },
            stopBackground: (taskId) =>
              (session.stopBackground?.(taskId) ?? Effect.void).pipe(
                Effect.andThen(
                  Effect.suspend(() => {
                    running = running.filter((t) => t !== taskId);
                    return agent()?.emit({ _tag: 'RawEvent', source: main, raw: sdk({ type: 'system', subtype: 'task_notification', task_id: taskId, status: 'stopped', summary: 'stopped' }) }) ?? Effect.void;
                  }),
                ),
              ),
            // an interrupt ends a turn only when there's one to end
            interrupt: () =>
              Effect.suspend(() => {
                if (agent()?.inTurn) endings.push('interrupted');
                return session.interrupt();
              }),
          })),
        ),
    };
    const runner = new HostRunner(new BrowserPool(), adapter, path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-host-inv-')), 'journal.sqlite'));

    const turns: string[] = [];
    let session: AgentSession | undefined;
    let under = false;
    const told = new Map<string, string>();
    let said = 0;
    let probes = 0;
    let refused = 0;
    /** The manager's open asks: each answered by an action of its own, or let go when the turn's over. */
    const asks: ((approved: boolean) => void)[] = [];

    const hooks = (): RunHooks => ({
      lines: (ls) => void (said += ls.flatMap(entryLines).filter((l) => l.text.includes('Said something')).length),
      activity: () => undefined,
      browser: () => undefined,
      screenshot: () => undefined,
      session: () => undefined,
      cost: () => undefined,
      question: () => Promise.resolve(undefined),
      permission: (_tool, _summary, signal) =>
        new Promise<boolean>((resolve) => {
          const answer = (approved: boolean) => {
            asks.splice(asks.indexOf(answer), 1);
            resolve(approved);
          };
          asks.push(answer);
          signal.addEventListener('abort', () => answer(false), { once: true });
        }),
      background: (e) => {
        if (e.kind === 'started') told.set(e.id, e.description);
        if (e.kind === 'ended') told.delete(e.id);
      },
      probe: (e) => void (e.kind === 'started' && probes++),
    });

    const turn = (prompt: string, resume?: string) => {
      const at = turns.push('under way') - 1;
      under = true;
      // Ops drops what was left running as a turn ends (the manager's lead-done): each turn tells it afresh
      told.clear();
      const started = runner.start(request(agentId, prompt, resume), hooks());
      session = started;
      void started.done.then((o) => {
        turns[at] = ended(o);
        if (session === started) under = false;
      });
    };

    const said_ = (): Said => ({
      received: fake.sessions.flatMap((s) => s.received),
      agentTurn: !!agent()?.inTurn,
      turns: [...turns],
      ended: [...endings],
      said,
      hands: Object.fromEntries(Object.entries(hands).map(([k, v]) => [k, [...v]])),
      asking: asks.length,
      running: [...running],
      // once no turn watches, what Ops was last told is Ops' to settle
      told: under ? [...told.keys()] : [],
      probes,
      refused,
      scratch: fs.existsSync(dir),
    });

    /** Something Claude Code does, out there: in a turn of its own, unless `anytime`. */
    const claude = (label: string, work: (s: FakeSession) => Effect.Effect<void>, anytime = false) => () =>
      later(label, () => {
        const s = agent();
        if (!s || s.closed || (!anytime && !s.inTurn)) throw new Error('no turn under way');
        return Effect.runPromise(work(s));
      });

    /** Claude Code's Bash, as it runs it: Ops' guard is asked first (the PreToolUse hook the adapter hands it). */
    const bash = async (s: FakeSession, command: string): Promise<boolean> => {
      const [guard] = runner.extend(s.options.conversationId, s.options.labels).hooks?.PreToolUse ?? [];
      const input = { hook_event_name: 'PreToolUse' as const, tool_name: 'Bash', tool_input: { command }, tool_use_id: 't', session_id: 's', transcript_path: '', cwd: process.cwd() };
      const verdict = await guard?.hooks[0](input, 't', { signal: new AbortController().signal });
      return !JSON.stringify(verdict ?? {}).includes('"deny"');
    };

    const actions = (): Action[] =>
      ([
        {
          name: 'the captain sends a message',
          run: () => {
            if (!session?.send('a message')) throw new Error('not listening');
          },
        },
        {
          name: 'the captain stops the turn',
          run: () => {
            if (!under) throw new Error('no turn to stop');
            session?.stop();
          },
        },
        {
          name: 'the agent’s next turn starts',
          run: () => {
            const s = agent();
            if (under || !s) throw new Error('a turn is under way');
            turn('the next turn', s.agentSessionId);
          },
        },
        { name: 'Claude Code says something', run: claude('Claude Code says', (s) => s.emit({ _tag: 'AssistantMessage', text: 'Said something', source: main, raw: sdk({ type: 'assistant', parent_tool_use_id: null, message: { id: id('msg_'), content: [{ type: 'text', text: 'Said something' }] } }) })) },
        {
          name: 'Claude Code starts a command in the background',
          run: claude('a command starts', (s) =>
            Effect.suspend(() => {
              const task = id('b');
              running = [...running, task];
              return s.emit({ _tag: 'BackgroundChanged', tasks: running.map((t) => ({ id: t, description: 'pnpm dev' })), waiting: false, source: main, raw: sdk({ type: 'system', subtype: 'task_started', task_id: task, task_type: 'local_bash', tool_use_id: `toolu_${task}`, description: 'pnpm dev', is_backgrounded: true }) });
            }),
          ),
        },
        {
          name: 'a background command ends',
          run: claude(
            'a command ends',
            (s) =>
              Effect.suspend(() => {
                const [task, ...rest] = running;
                if (!task) return Effect.die(new Error('nothing running'));
                running = rest;
                return s.emit({ _tag: 'BackgroundChanged', tasks: rest.map((t) => ({ id: t, description: 'pnpm dev' })), waiting: false, source: main, raw: sdk({ type: 'system', subtype: 'task_notification', task_id: task, status: 'completed', summary: 'exit code 0' }) });
              }),
            true,
          ),
        },
        {
          name: 'the captain stops a command',
          run: async () => {
            const task = running[0];
            if (!task || !(await session?.stopTask?.(task))) throw new Error('nothing to stop, or not listening');
          },
        },
        {
          name: 'Claude Code sends a probe out from its scratch dir',
          run: claude('a probe runs', (s) =>
            Effect.promise(async () => {
              const command = 'node "$FOCUS_SCRATCH/probe.mjs"';
              if (!(await bash(s, command))) throw new Error('refused');
              return { _tag: 'RawEvent' as const, source: main, raw: sdk({ type: 'assistant', parent_tool_use_id: null, message: { id: id('msg_'), content: [{ type: 'tool_use', id: id('toolu_'), name: 'Bash', input: { command } }] } }) };
            }).pipe(Effect.flatMap((event) => s.emit(event))),
          ),
        },
        {
          name: 'Claude Code clears a folder outside its scratch dir',
          run: claude('rm -rf runs', (s) =>
            Effect.promise(async () => {
              if (!(await bash(s, 'rm -rf "$FOCUS_SCRATCH/../elsewhere"'))) refused++;
            }),
          ),
        },
        { name: 'Claude Code raises a hand', run: claude('a hand goes up', (s) => s.emit({ _tag: 'PermissionRequested', requestId: id('p'), tool: 'Bash', input: { command: 'curl x' }, summary: 'Bash(curl x)', source: main })) },
        {
          name: 'the manager approves',
          run: () => {
            if (!asks[0]) throw new Error('nothing asked');
            asks[0](true);
          },
        },
        {
          name: 'the manager declines',
          run: () => {
            if (!asks[0]) throw new Error('nothing asked');
            asks[0](false);
          },
        },
        {
          name: 'the turn ends',
          run: claude('the turn ends', (s) =>
            Effect.gen(function* () {
              yield* s.emit({ _tag: 'Usage', costUsd: 0, source: main, raw: sdk({ type: 'result', subtype: 'success', result: 'Done', is_error: false, duration_ms: 1000, num_turns: 1, total_cost_usd: 0 }) });
              endings.push('completed');
              yield* s.endTurn();
            }),
          ),
        },
        {
          name: 'the turn fails',
          run: claude('the turn fails', (s) =>
            Effect.suspend(() => {
              endings.push('failed');
              return s.endTurn('failed');
            }),
          ),
        },
      ] satisfies Action[]).filter((a) => (!only || only.test(a.name)) && !except?.test(a.name));

    turn('the brief');
    const running_: Running<Said> = {
      actions,
      durable: said_,
      settle: () => steady(() => [said_(), asks.length]),
      close: () => {
        runner.closingNow();
        void runner.shutDown();
      },
      restart: () => {
        throw new Error('a session keeps nothing of its own across a restart: not held to that rule');
      },
    };
    // started once Claude Code is in the brief's turn: the reference runs read a session's state straight after it starts
    await running_.settle();
    return running_;
  },
});
const session = sessionOf();

/** Takes the named actions one at a time, each settled before the next, and what held after each. */
async function walk(s: Running<Said>, names: string[]): Promise<Said[]> {
  const seen: Said[] = [];
  for (const name of names) {
    const action = s.actions().find((a) => a.name === name);
    if (!action) throw new Error(`no action "${name}"`);
    await Promise.resolve()
      .then(() => action.run())
      .catch(() => undefined);
    await s.settle();
    seen.push(s.durable());
  }
  return seen;
}

describe('a session on agent-host, under Focus’s rule for two things at once', () => {
  // a description that never got a turn past a raised hand, a command or a probe, or never ended one, would prove
  // nothing of what a turn does with them
  it('reaches a turn that hears a message, runs a command and a probe, has a hand answered, and ends', async () => {
    const s = await session.start(now);
    const seen = await walk(s, [
      'Claude Code says something',
      'the captain sends a message',
      'Claude Code starts a command in the background',
      'Claude Code raises a hand',
      'Claude Code sends a probe out from its scratch dir',
      'Claude Code clears a folder outside its scratch dir',
      'the manager approves',
      'the turn ends',
      'the agent’s next turn starts',
      'the captain stops a command',
      'the turn fails',
    ]);
    s.close?.();
    // mid-turn: the message in the conversation, the command told, the hand up, the scratch dir there
    expect(seen[5]).toMatchObject({ received: ['the brief', 'a message'], agentTurn: true, turns: ['under way'], said: 1, running: ['b1'], told: ['b1'], asking: 1, probes: 1, refused: 1, scratch: true });
    // answered once, by the manager; the turn over as the host's ended, its scratch dir gone
    expect(seen[7]).toMatchObject({ turns: ['done: Done'], ended: ['completed'], hands: { p1: ['AllowOnce'] }, asking: 0, scratch: false });
    // the next turn carries the same conversation on, and the command Claude Code left running stops on the captain's word
    expect(seen[9]).toMatchObject({ received: ['the brief', 'a message', 'the next turn'], turns: ['done: Done', 'under way'], running: [], told: [], scratch: true });
    expect(seen[10]).toMatchObject({ turns: ['done: Done', 'failed: The session failed'], ended: ['completed', 'failed'], scratch: false });
  });

  it('ends two things at once as one after the other would, a message and the turn’s end among them', async () => {
    await checkAtOnce(sessionOf(), { runs: 25, prefix: 4 });
  });

  // Found by the check above (docs/invariants.md): a message sent as the turn ended reached Claude Code after it and
  // started a turn of its own that no Focus turn watched (the next one attached to it, its own prompt unsent). agent-host
  // now says a message `started` a turn, and the Focus turn carries on through it (`atTurnEnd`).
  it('hears a message sent as the turn ends in a turn Focus watches', async () => {
    const held: (() => void)[] = [];
    const later: Later = (_label, work) => new Promise<void>((go) => held.push(go)).then(work);
    const s = await session.start(later);
    const run = (name: string) => Promise.resolve().then(() => s.actions().find((a) => a.name === name)?.run());
    const ending = run('the turn ends');
    await s.settle();
    held.shift()?.();
    await ending;
    // Claude Code has ended its turn; the message is on its way before Focus has heard so
    await run('the captain sends a message').catch(() => undefined);
    await s.settle();
    const said = s.durable();
    s.close?.();
    expect(said.agentTurn && !said.turns.includes('under way')).toBe(false);
  });
});

describe('a session on agent-host, its promises', () => {
  // docs/agents.md: "A Focus turn ends when the host's turn does, with how it ended"
  it('ends each Focus turn once, as the host’s turn ended: done, stopped or failed', async () => {
    const s = await session.start(now);
    const seen = await walk(s, ['the turn ends', 'the agent’s next turn starts', 'the captain stops the turn', 'the agent’s next turn starts', 'the turn fails', 'the turn ends']);
    s.close?.();
    expect(seen.at(-1)).toMatchObject({ turns: ['done: Done', 'stopped', 'failed: The session failed'], ended: ['completed', 'interrupted', 'failed'], agentTurn: false });
  });

  // docs/agents.md: "A message sent mid-turn reaches the agent in that turn"
  it('takes a message sent mid-turn into the turn under way, and refuses one once the turn’s over', async () => {
    const s = await session.start(now);
    const [mid, , after] = await walk(s, ['the captain sends a message', 'the turn ends', 'the captain sends a message']);
    s.close?.();
    expect(mid).toMatchObject({ received: ['the brief', 'a message'], agentTurn: true, turns: ['under way'] });
    expect(after).toMatchObject({ received: ['the brief', 'a message'], turns: ['done: Done'] });
  });

  // docs/autonomy.md: "A hand already up stays up until you answer it"; and once the turn's over, it's declined
  it('answers a raised hand once: the manager’s answer, or declined when the turn ends first', async () => {
    const s = await session.start(now);
    const seen = await walk(s, ['Claude Code raises a hand', 'Claude Code raises a hand', 'the manager declines', 'the turn ends', 'the manager approves']);
    s.close?.();
    expect(seen[1]).toMatchObject({ asking: 2, hands: {} });
    expect(seen.at(-1)).toMatchObject({ asking: 0, hands: { p1: ['Deny'], p2: ['Declined'] } });
  });

  // docs/agents.md, Scratch dirs: "Ops empties it when a run starts and deletes it when the run ends"
  it('gives each turn an empty scratch dir, and deletes it as the turn ends', async () => {
    const s = await session.start(now);
    const dir = scratchDir(`dev_host_${agents}`);
    fs.writeFileSync(path.join(dir, 'left.txt'), 'from this turn');
    const [over, next] = await walk(s, ['the turn ends', 'the agent’s next turn starts']);
    const left = fs.existsSync(path.join(dir, 'left.txt'));
    s.close?.();
    expect(over.scratch).toBe(false);
    expect(next.scratch).toBe(true);
    expect(left).toBe(false);
  });

  // docs/goals.md: "every local session's git runs Ops' hooks (set through its environment so a repo's own
  // core.hooksPath can't replace them)"; docs/settings.md: "one set there by hand isn't handed on to what Focus starts:
  // agents"; docs/agents.md: "exported to it as FOCUS_SCRATCH"
  it('lends the session its scratch dir and the push guard through its environment, and none of Focus’s secrets', async () => {
    const s = await session.start(now);
    const agentId = `dev_host_${agents}`;
    s.close?.();
    const env = lent.get(agentId) ?? {};
    const n = Number(env.GIT_CONFIG_COUNT) - 1;
    expect([env[`GIT_CONFIG_KEY_${n}`], env[`GIT_CONFIG_VALUE_${n}`]]).toEqual(['core.hooksPath', paths.gitHooks]);
    expect(env.FOCUS_PUSH_REFUSED).toBe(refusedFile(agentId));
    expect(fs.existsSync(path.join(paths.gitHooks, 'pre-push'))).toBe(true);
    expect(env.FOCUS_SCRATCH).toBe(scratchDir(agentId));
    expect(process.env.FOCUS_BOT_TOKEN).toBe(SECRET);
    expect(Object.values(env)).not.toContain(SECRET);
    expect(env.FOCUS_BOT_TOKEN).toBeUndefined();
  });
});
