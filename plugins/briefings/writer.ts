// Ops' briefing writer: a lead sends a brief (what to explain, and where its facts are) and a
// read-only session writes the explainer from it, on the model, effort and speed the captain set for briefings
// (`writerRun`), reading the lead's code and what they've said. The explain tool checks its receipts as it does a
// lead's, and its stage in pictures, and hands the session back what didn't hold up (explainTool.ts `writeUp`).
import { z } from 'zod';
import { CODE_TOOLS, type LeadToolContext, type PluginHost, type PluginState } from '../../plugin-api/server';
import type { ExplainerInput } from './explainer';
import { EXPLAIN_CRAFT, WRITTEN } from './explainTool';
import { type BriefingsState, writerRun } from './shared';
import type { Sources } from './sources';

/** What a lead asks the writer for. */
export interface Brief {
  id: string;
  title: string;
  brief: string;
}

/** The explainer the writer wrote, and how: its session (to send it back to), and what it took. */
export interface Written {
  input: ExplainerInput;
  sessionId?: string;
  model: string;
  effort: string;
  fast: boolean;
  seconds: number;
  costUsd?: number;
}

/** Writes a brief up; given `fix`, the same session again with what to put right, adding to what it's `spent` so far. */
export type Write = (lead: LeadToolContext, brief: Brief, fix?: { sessionId?: string; problems: string[]; spent: Pick<Written, 'seconds' | 'costUsd'> }) => Promise<Written>;

/** How many of the lead's latest messages the writer reads. */
const SAID = 3;

/** The writer's prompt: the brief, what the lead said lately, and where their code is. */
export function writerPrompt(lead: LeadToolContext, brief: Brief, said: readonly { text: string; at: string }[]): string {
  const name = lead.agent.name ?? 'The lead';
  const folders = lead.checkouts.map((c) => c.dir.split('/').at(-1) ?? c.repo);
  const recent = said.slice(-SAID).map((s) => `[${s.at}]\n${s.text}`).join('\n\n---\n\n');
  return [
    `${name} asks you for a briefing titled "${brief.title}":`,
    brief.brief,
    recent ? `What ${name} has said lately (quote it exactly, as a said ref):\n\n${recent}` : '',
    folders.length
      ? `${name}'s code is in your working folder${folders.length > 1 ? ` and beside it (${folders.join(', ')}): give a file ref's path with its repo's folder first` : ': give a file ref\'s path from there'}. Read what the brief points at, and quote it exactly.`
      : '',
  ].filter(Boolean).join('\n\n');
}

/** The writer's instructions, the same for every brief. */
const WRITER_SYSTEM = `You write briefings for the captain of Focus: animated explainers a lead asks for, explained hyper intuitively, bottom up, with the simplest step-by-step animations so the captain understands concretely. One idea per beat, plain words, and finish on the decision the lead is asking for, if there is one.\n\n${EXPLAIN_CRAFT}\n\nAnswer with the beats and the stage, in the schema.`;

/** What the writer is asked: the brief written up, or, sent back, what to put right in what it wrote. */
export function writerAsk(prompt: () => Promise<string>, fix?: Parameters<Write>[2]): Promise<string> | string {
  return fix ? `Ops checked your explainer (its receipts, then its stage at the middle of each beat), and these don't hold up yet:\n${fix.problems.join('\n')}\n\nFix them and send the whole explainer again.` : prompt();
}

/** What a brief has taken so far: this run's seconds and cost, added to what the runs before it spent. */
export function spentSoFar(seconds: number, costUsd: number | undefined, before?: Pick<Written, 'seconds' | 'costUsd'>): Pick<Written, 'seconds' | 'costUsd'> {
  const spent = before ?? { seconds: 0 };
  return { seconds: seconds + spent.seconds, costUsd: costUsd === undefined ? spent.costUsd : costUsd + (spent.costUsd ?? 0) };
}

/** Ops' writer: a read-only session on the captain's briefing setting, which notes what each brief cost. */
export function opsWriter(host: PluginHost, state: PluginState<BriefingsState>, sources: Sources): Write {
  // without its $schema line, which Claude Code's schema check doesn't know
  const { $schema: _, ...schema } = z.toJSONSchema(WRITTEN);
  return async (lead, brief, fix) => {
    const how = writerRun(state.get().writer, host.settings());
    const [home = host.dataDir(), ...others] = lead.checkouts.map((c) => c.dir);
    const started = Date.now();
    const result = await host.readOnlySession({
      cwd: home,
      readable: others,
      system: WRITER_SYSTEM,
      systemAppend: '',
      prompt: await writerAsk(async () => writerPrompt(lead, brief, await sources.said(lead)), fix),
      resume: fix?.sessionId,
      settings: host.settings(),
      signal: AbortSignal.timeout(8 * 60_000),
      activity: () => {},
      builtins: CODE_TOOLS,
      schema,
      maxTurns: 30,
      ...how,
    });
    const spent = spentSoFar((Date.now() - started) / 1000, result.costUsd, fix?.spent);
    state.set({ last: { ...how, ...spent, at: Date.now() } });
    return { input: { id: brief.id, title: brief.title, ...WRITTEN.parse(result.structured) }, sessionId: result.sessionId, ...how, ...spent };
  };
}
