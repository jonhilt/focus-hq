import { describe, expect, it } from 'vitest';

// The contract Claude Code keeps at the SDK's `query` (docs/contracts.md): what the office relies on its stream doing,
// written once and held against streams distilled from real sessions and against each stand-in for Claude Code, so a
// stand-in can't quietly encode an assumption the real one doesn't keep (eab2be2 was missed because the session's
// stand-in did). Each expectation reads one of three sessions, as Claude Code and the office played it out, beat by
// beat. The real ones (`REAL`) keep the shapes and order of what 2.1.289 said on Haiku (`pnpm run claude-streams`),
// with the ids and words made up: never a real message's text, path or prompt.

type Msg = Record<string, unknown>;

/** One beat of a session: something Claude Code said, the office sending a message or closing its input, the office asked to approve a tool, or Claude Code's process ending. */
export type Beat = { claude: Msg } | { office: 'sends' | 'closes' } | { asks: string } | { ends: true };

/** The three sessions the contract reads. */
export type Session = 'messages' | 'workflow' | 'closed input';

/** A source of sessions: the real streams, or a stand-in playing the same session out. */
export type Play = (session: Session) => Promise<Beat[]>;

export interface Expectation {
  name: string;
  /** The real bug fix it would have caught, when one would have. */
  fix?: string;
  /** Where else it's seen: the office's transcripts on disk, counted (docs/contracts.md). */
  seen?: string;
  session: Session;
  holds(beats: Beat[]): void;
}

// ── reading a session ────────────────────────────────────────────────────────

const said = (b: Beat): Msg | undefined => ('claude' in b ? b.claude : undefined);
const is = (b: Beat, type: string, subtype?: string) => {
  const m = said(b);
  return !!m && m.type === type && (subtype === undefined || m.subtype === subtype);
};
const isInit = (b: Beat) => is(b, 'system', 'init');
const isResult = (b: Beat) => is(b, 'result');
const isList = (b: Beat) => is(b, 'system', 'background_tasks_changed');
const isBookend = (b: Beat) => is(b, 'system', 'task_started') || is(b, 'system', 'task_notification');
const isSends = (b: Beat) => 'office' in b && b.office === 'sends';
const isCloses = (b: Beat) => 'office' in b && b.office === 'closes';
const taskOf = (b: Beat) => said(b)?.task_id;
const listed = (b: Beat): { id: unknown; type: unknown }[] => {
  const tasks = said(b)?.tasks;
  return Array.isArray(tasks) ? tasks.map((t: Msg) => ({ id: t.task_id, type: t.task_type })) : [];
};
/** The last turn's edge before `at`: 'turn' when a turn is under way there (its init came after the last result). */
const under = (beats: Beat[], at: number): 'turn' | 'idle' => {
  for (let i = at - 1; i >= 0; i--) {
    if (isInit(beats[i])) return 'turn';
    if (isResult(beats[i])) return 'idle';
  }
  return 'idle';
};
const next = (beats: Beat[], from: number, p: (b: Beat) => boolean) => beats.findIndex((b, i) => i > from && p(b));
const all = (beats: Beat[], p: (b: Beat) => boolean) => beats.flatMap((b, i) => (p(b) ? [i] : []));
const queued = (b: Beat) => said(b)?.queued_turn_count;
const workflowStarts = (beats: Beat[]) => all(beats, (b) => is(b, 'system', 'task_started') && said(b)?.task_type === 'local_workflow');
const endOf = (beats: Beat[], task: unknown) => next(beats, -1, (b) => is(b, 'system', 'task_notification') && taskOf(b) === task);

// ── the contract ─────────────────────────────────────────────────────────────

export const CLAUDE_CONTRACT: Expectation[] = [
  {
    name: 'every turn opens with init, before Claude Code says anything in it',
    session: 'messages',
    holds: (beats) => {
      const spoken = all(beats, (b) => is(b, 'assistant'));
      expect(spoken.length).toBeGreaterThan(0);
      for (const i of spoken) expect(under(beats, i)).toBe('turn');
      expect(all(beats, isInit).length).toBe(all(beats, isResult).length);
    },
  },
  {
    name: 'a message sent mid-turn is folded into it: the turn ends counting nothing queued, and no turn of its own follows',
    seen: '180 of the 310 messages sent during a turn',
    session: 'messages',
    holds: (beats) => {
      const sent = next(beats, -1, isSends);
      expect(under(beats, sent)).toBe('turn');
      const ended = next(beats, sent, isResult);
      expect(queued(beats[ended])).toBe(0);
      // the next turn is the next message's, not this one's
      expect(next(beats, ended, isInit)).toBeGreaterThan(next(beats, ended, isSends));
    },
  },
  {
    name: 'a message sent as the turn ends is taken in a turn of its own, though the ending turn counted nothing queued',
    fix: 'the race found on main',
    seen: 'the other 130',
    session: 'messages',
    holds: (beats) => {
      const sent = all(beats, isSends).find((i) => isResult(beats[i - 1]));
      expect(sent).toBeDefined();
      expect(queued(beats[(sent ?? 0) - 1])).toBe(0);
      const turn = next(beats, sent ?? 0, isInit);
      expect(turn).toBeGreaterThan(-1);
      expect(next(beats, sent ?? 0, (b) => isBookend(b) || isSends(b) || isInit(b))).toBe(turn);
    },
  },
  {
    name: 'the background list comes before a task’s own start and end, and already says it',
    seen: 'every one of the 12 starts and ends recorded',
    session: 'workflow',
    holds: (beats) => {
      const bookends = all(beats, isBookend);
      expect(bookends.length).toBeGreaterThan(0);
      for (const i of bookends) {
        // the list, then (as a task ends) its patch, then the bookend
        let at = i - 1;
        while (at > 0 && is(beats[at], 'system', 'task_updated')) at--;
        expect(isList(beats[at])).toBe(true);
        expect(listed(beats[at]).some((t) => t.id === taskOf(beats[i]))).toBe(is(beats[i], 'system', 'task_started'));
      }
    },
  },
  {
    name: 'a running workflow is in every background list from its start to its end',
    fix: 'eab2be2',
    session: 'workflow',
    holds: (beats) => {
      const starts = workflowStarts(beats);
      expect(starts.length).toBeGreaterThan(0);
      for (const start of starts) {
        const task = taskOf(beats[start]);
        // from the list that says it started, just before its start, up to the one that says it ended, just before its end
        const lists = all(beats, isList).filter((i) => i >= start - 1 && i < endOf(beats, task));
        lists.pop();
        expect(lists.length).toBeGreaterThan(0);
        for (const i of lists) expect(listed(beats[i]).map((t) => t.id)).toContain(task);
      }
    },
  },
  {
    name: 'a background task that ends while no turn is under way is taken in a turn of Claude Code’s own',
    fix: '879f9ec',
    seen: '151 reports while idle',
    session: 'messages',
    holds: (beats) => {
      const idleEnds = all(beats, (b) => is(b, 'system', 'task_notification')).filter((i) => under(beats, i) === 'idle');
      expect(idleEnds.length).toBeGreaterThan(0);
      for (const i of idleEnds) expect(next(beats, i, (b) => isInit(b) || isResult(b) || isSends(b))).toBe(next(beats, i, isInit));
    },
  },
  {
    name: 'a background task that ends during a turn is folded into it, with no turn of its own',
    seen: '667 of the 736 reports during a turn',
    session: 'workflow',
    holds: (beats) => {
      const during = all(beats, (b) => is(b, 'system', 'task_notification')).filter((i) => under(beats, i) === 'turn');
      expect(during.length).toBeGreaterThan(0);
      for (const i of during) {
        const ended = next(beats, i, isResult);
        expect(queued(beats[ended])).toBe(0);
        const after = next(beats, ended, (b) => isInit(b) || isBookend(b) || isSends(b));
        if (after > -1) expect(isInit(beats[after])).toBe(false);
      }
    },
  },
  {
    name: 'with the office’s input closed, a report still gets its turn, and a tool needing approval there fails without asking',
    fix: '879f9ec',
    seen: '34 cancelled tools in the office’s transcripts',
    session: 'closed input',
    holds: (beats) => {
      const closed = next(beats, -1, isCloses);
      const report = next(beats, closed, (b) => is(b, 'system', 'task_notification'));
      expect(report).toBeGreaterThan(closed);
      expect(next(beats, report, isInit)).toBeGreaterThan(report);
      const failed = beats.slice(closed).filter((b) => is(b, 'user') && JSON.stringify(said(b)).includes('"is_error":true'));
      expect(failed.length).toBeGreaterThan(0);
      expect(beats.slice(closed).some((b) => 'asks' in b)).toBe(false);
    },
  },
  {
    name: 'Claude Code exits once the office’s input has closed, with no turn under way and nothing running',
    session: 'closed input',
    holds: (beats) => {
      const closed = next(beats, -1, isCloses);
      const end = next(beats, -1, (b) => 'ends' in b);
      expect(end).toBe(beats.length - 1);
      expect(end).toBeGreaterThan(closed);
      expect(isResult(beats[end - 1])).toBe(true);
      const lists = all(beats, isList);
      expect(listed(beats[lists[lists.length - 1]])).toEqual([]);
    },
  },
  {
    name: 'a background command’s start says it’s in the background, and names the tool call that started it',
    seen: '429 background commands',
    session: 'messages',
    holds: (beats) => {
      const starts = all(beats, (b) => is(b, 'system', 'task_started') && said(b)?.task_type === 'local_bash');
      expect(starts.length).toBeGreaterThan(0);
      for (const i of starts) expect(said(beats[i])).toMatchObject({ is_backgrounded: true, tool_use_id: expect.any(String) });
    },
  },
];

/**
 * Registers the contract for one source: `play` plays each session out. `simplifies` names the expectations it
 * knowingly doesn't keep, each with why: those are held to fail (`it.fails`), so a stand-in that comes to keep one is
 * told to drop the excuse.
 */
export function holdsToClaudeContract(name: string, play: Play, simplifies: Record<string, string> = {}): void {
  const unknown = Object.keys(simplifies).filter((k) => !CLAUDE_CONTRACT.some((e) => e.name === k));
  describe(`${name} keeps the Claude Code contract`, () => {
    it('excuses only expectations the contract has', () => expect(unknown).toEqual([]));
    for (const e of CLAUDE_CONTRACT) {
      const title = e.fix ? `${e.name} (${e.fix})` : e.name;
      if (simplifies[e.name]) it.fails(`${title} [simplified: ${simplifies[e.name]}]`, async () => e.holds(await play(e.session)));
      else it(title, async () => e.holds(await play(e.session)));
    }
  });
}

// ── the real streams, distilled ──────────────────────────────────────────────
// Claude Code 2.1.289 on claude-haiku-4-5, recorded by `pnpm run claude-streams` (19 Oct 2026): the beats as they came,
// leaving out the CLI's own ui_log, thinking_tokens and rate_limit_event, which the office doesn't read. Ids and words
// are made up; the shapes, flags, tool names and order are what Claude Code said.

const init = (): Beat => ({ claude: { type: 'system', subtype: 'init', session_id: 'session-1', apiKeySource: 'none', claude_code_version: '2.1.289', model: 'claude-haiku-4-5', permissionMode: 'default' } });
const thinks = (): Beat => ({ claude: { type: 'assistant', parent_tool_use_id: null, message: { id: 'm', model: 'claude-haiku-4-5', content: [{ type: 'thinking', thinking: '' }] } } });
const says = (): Beat => ({ claude: { type: 'assistant', parent_tool_use_id: null, message: { id: 'm', model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'Done.' }] } } });
const calls = (tool: string, id: string, background = false): Beat => ({ claude: { type: 'assistant', parent_tool_use_id: null, message: { id: 'm', model: 'claude-haiku-4-5', content: [{ type: 'tool_use', id, name: tool, input: background ? { command: 'sleep 1', run_in_background: true } : {} }] } } });
const answers = (id: string, content: string, isError = false): Beat => ({ claude: { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } } });
const inBackground = (id: string, task: string) => answers(id, `Command running in background with ID: ${task}. Output is being written to: /tmp/tasks/${task}.output`);
const lists = (...tasks: [string, string][]): Beat => ({ claude: { type: 'system', subtype: 'background_tasks_changed', tasks: tasks.map(([task_id, task_type]) => ({ task_id, task_type, description: 'a task' })) } });
const starts = (task: string, type: string, tool: string): Beat => ({ claude: { type: 'system', subtype: 'task_started', task_id: task, task_type: type, tool_use_id: tool, description: 'a task', ...(type === 'local_bash' && { is_backgrounded: true }), ...(type === 'local_workflow' && { workflow_name: 'tiny' }) } });
const patched = (task: string): Beat => ({ claude: { type: 'system', subtype: 'task_updated', task_id: task, patch: { status: 'completed', end_time: 1 } } });
const ended = (task: string, tool: string): Beat => ({ claude: { type: 'system', subtype: 'task_notification', task_id: task, tool_use_id: tool, status: 'completed', summary: 'Finished', output_file: `/tmp/tasks/${task}.output` } });
const progress = (task: string, tool: string): Beat => ({ claude: { type: 'system', subtype: 'task_progress', task_id: task, tool_use_id: tool, description: 'a task', usage: { total_tokens: 10, tool_uses: 0, duration_ms: 10 } } });
const result = (turns: number): Beat => ({ claude: { type: 'result', subtype: 'success', is_error: false, result: 'Done.', duration_ms: 1000, num_turns: turns, total_cost_usd: 0, queued_turn_count: 0 } });
const sends: Beat = { office: 'sends' };
const closes: Beat = { office: 'closes' };
const ends: Beat = { ends: true };

export const REAL: Record<Session, Beat[]> = {
  // a command in the background, a message sent mid-turn and another as the turn ends, then the command's report
  messages: [
    init(), thinks(), calls('Bash', 'u1', true), sends,
    lists(['t1', 'local_bash']), starts('t1', 'local_bash', 'u1'), inBackground('u1', 't1'),
    thinks(), says(), result(2), sends,
    init(), thinks(), says(), result(1),
    lists(), patched('t1'), ended('t1', 'u1'),
    init(), thinks(), says(), result(1), closes, ends,
  ],
  // a command and a workflow in the background at once; the workflow ends first, between turns, and the command's
  // report comes during the turn that takes the workflow's
  workflow: [
    init(), thinks(), calls('Bash', 'u1', true),
    lists(['t1', 'local_bash']), starts('t1', 'local_bash', 'u1'), inBackground('u1', 't1'),
    calls('Workflow', 'u2'), { asks: 'Workflow' },
    lists(['t1', 'local_bash'], ['t2', 'local_workflow']), starts('t2', 'local_workflow', 'u2'), answers('u2', 'Workflow launched in the background'), progress('t2', 'u2'),
    thinks(), says(), result(3),
    progress('t2', 'u2'), progress('t2', 'u2'),
    lists(['t1', 'local_bash']), patched('t2'), ended('t2', 'u2'),
    init(),
    lists(), patched('t1'), ended('t1', 'u1'),
    thinks(), calls('Read', 'u3'), answers('u3', 'hi'), thinks(), says(), result(2), closes, ends,
  ],
  // the office closes its input as the turn ends with a command still running (879f9ec put back): the command's
  // report gets a turn anyway, and each tool that needs approval in it fails
  'closed input': [
    init(), thinks(), calls('Bash', 'u1', true),
    lists(['t1', 'local_bash']), starts('t1', 'local_bash', 'u1'), inBackground('u1', 't1'),
    thinks(), says(), result(2), closes,
    lists(), patched('t1'), ended('t1', 'u1'),
    init(), thinks(), calls('Bash', 'u2'), answers('u2', 'Tool permission request failed: AbortError: Stream closed', true),
    thinks(), calls('Bash', 'u3'), answers('u3', 'Tool permission request failed: AbortError: Stream closed', true),
    thinks(), calls('Bash', 'u4'), answers('u4', 'Tool permission request failed: AbortError: Stream closed', true),
    thinks(), says(), result(4), ends,
  ],
};
