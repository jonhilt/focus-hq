// Goals: each a lead at a team station, slice by slice, and the room's log of closed ones.

import type { Lane } from '../mergeLane';
import type { ClaudeTask, Effort } from './agents';
import type { ChecksState } from './github';
import type { QaSpotCheck } from './qa';

/** A goal waiting for a free team station: what the captain said, and the effort its lead will start at. */
export interface QueuedGoal {
  id: string;
  text: string;
  effort?: Effort;
  /** Who handed it over, when it wasn't the captain directly: the Ops station, or a plugin's crew. */
  from?: string;
  at: number;
}

/**
 * What a goal's lead keeps track of, through Ops' note tool: not a spec, but the part of the goal that has to
 * survive a summarised conversation.
 */
export interface GoalNote {
  /** What done looks like, agreed with the captain at the start. */
  done: string;
  /** A line or two per slice: what it taught us, what we decided and why. */
  learned: string[];
  /** A few candidate next slices, rewritten rather than added to. */
  next: string[];
}

/**
 * One slice of a goal, as a waypoint on its chart: what it set out to do, what it taught us, and when. Ops keeps
 * them as the lead ships, notes and lands each slice (`server/agents/waypoints.ts`).
 */
export interface Waypoint {
  /** Which slice: 1, 2, … */
  slice: number;
  /** When the slice started (the goal opened, or the slice before moved on), and when its last pull request landed. */
  startedAt: number;
  landedAt?: number;
  /** What it set out to do: the title it last shipped under. Missing until it ships. */
  title?: string;
  /** What the lead said it was heading for as it started, on goals from when the note tool took a heading: its name until it ships. */
  heading?: string;
  /** The commits the lead made during it, and the last one's message, so the chart shows work as it's done. */
  commits?: number;
  lastCommit?: string;
  /** The tasks the lead added or moved on during it, on the task list it keeps for itself, as they last stood. */
  tasks?: ClaudeTask[];
  /** The opening of what it shipped with (its pull requests' description), cut short. */
  summary?: string;
  /** The lessons the lead added to the goal's note during the slice. */
  learned?: string[];
  /** What done looked like before the lead changed it during the slice: a course correction. */
  turnedFrom?: string;
  /** The guardrails on each of the slice's pull requests, as QA last reported. */
  shields?: Shield[];
  /** The places QA picked for the captain to look at, and which the captain has. */
  spotChecks?: SpotCheck[];
  /** What the slice does, seen: the screenshots QA took of its pull requests, as it last tested each. */
  evidence?: Evidence[];
  /** The helpers the lead sent out to explore during the slice, as probes, the latest few. */
  probes?: Probe[];
}

/**
 * A helper (a subagent) the lead sent out during a slice, as a probe on the goal's chart: it flies out from the waypoint
 * while it works, transmits what it found back when it reports, and is gone. `id` is the helper's (`Helper.id`).
 */
export interface Probe {
  id: string;
  description: string;
  /** The kind of subagent: Explore, general-purpose… */
  type?: string;
  launchedAt: number;
  /** Missing while it's out (or if it never reported: Focus restarted under it). */
  endedAt?: number;
  ok?: boolean;
  /** The opening of what it reported, cut short. */
  summary?: string;
}

/**
 * A screenshot QA took of one of a slice's pull requests, kept with the goal (its QA review, and the copy QA kept, go
 * once the pull request lands): served from /api/artifacts/<lead id>/<file>.
 */
export interface Evidence {
  repo: string;
  pr: number;
  caption: string;
  file: string;
}

/**
 * The guardrails on one of a slice's pull requests as QA last reported: its verdict, how its checks went, how many
 * rounds failed before (a fail then fixed is a hit the shields absorbed), and how CI stood then.
 */
export interface Shield {
  repo: string;
  pr: number;
  verdict: 'pass' | 'fail';
  checks: { pass: number; fail: number; skip: number };
  /** The checks that failed in that round, by name. */
  failing?: string[];
  /** Rounds of QA the pull request failed, the last one included. */
  failedRounds: number;
  ci?: ChecksState;
  at: number;
}

/** A place QA picked for the captain to look at, on one of the slice's pull requests; `checked` once they have. */
export interface SpotCheck extends QaSpotCheck {
  repo: string;
  pr: number;
  checked?: number;
}

/**
 * A loose thread the lead noticed along the way (a question, a risk, an idea off the course), kept as a sensor contact on
 * the goal's chart until it's pursued or dropped, so it isn't lost the way an idea for next is when that's rewritten.
 */
export interface Contact {
  /** c1, c2, …: unique within the goal. */
  id: string;
  text: string;
  /** The slice it was noticed in, and when. */
  slice: number;
  at: number;
  /**
   * Missing while it's open: pursued (taken up as work) or dropped (with why), in `slice`; or spun off by the captain as a
   * goal of its own, `goal` (its lead's id, unless it's waiting in line for a station) titled `title` when it started.
   */
  closed?: { as: 'pursued' | 'dropped'; why?: string; slice: number; at: number } | { as: 'spun off'; goal?: string; title: string; slice: number; at: number };
}

/** A closed goal, in its room's log: enough to look back on, and to pick it back up one day. */
export interface GoalRecord {
  id: string;
  title: string;
  note?: GoalNote;
  slices: number;
  /** Every pull request the goal opened, slice by slice, with how each ended. Goals closed before they were kept have only their last slice's. */
  prs: LeadPr[];
  /** The slice it was on as it closed, which a reopened goal picks up. Missing on goals closed before it was kept. */
  slice?: number;
  leadName: string;
  sessionId?: string;
  /**
   * The branch the goal was on as it closed, in every repo, with any uncommitted work committed to it as a WIP snapshot,
   * and the repos it was checked out from. Missing on goals closed before they were kept.
   */
  branch?: string;
  repos?: LeadWork['repos'];
  /** The goal as the captain first put it, for a reopened goal's lead. */
  brief?: string;
  /** What its lead showed, and asked with pictures, kept to look back at (and for a reopened goal's screen). */
  artifacts?: GoalArtifact[];
  questions?: GoalQuestion[];
  /** Its slices as waypoints on its chart, and the loose threads noticed on the way. Missing on goals closed before they were kept. */
  waypoints?: Waypoint[];
  contacts?: Contact[];
  openedAt: number;
  closedAt: number;
}

/** A closed goal as the ledger keeps it, for good, with the room it was in: its artifacts are served by its `id`. */
export type ArchivedGoal = GoalRecord & { projectId: string };

/** A pull request a goal's lead shipped, and what became of it. */
export interface LeadPr {
  repo: string;
  number: number;
  url: string;
  /** The commit last shipped to it, so shipping again leaves it alone until there's something new. */
  sha?: string;
  /** The branch it was opened from. Missing on ones shipped before it was kept. */
  branch?: string;
  /** Missing while it's open. */
  outcome?: 'merged' | 'closed';
  /** The slice it shipped in. Set once the slice is over (it lands, or the goal closes); missing on goals closed before. */
  slice?: number;
  /** How it merges once QA passes it, as last shipped (shared/mergeLane.ts). Missing is Ask. */
  lane?: Lane;
}

/**
 * A goal's lead at work: every repo of the project checked out side by side on the slice's branch, and the pull
 * requests the slice shipped. Once they've all merged or closed, the next slice starts on fresh code.
 */
export interface LeadWork {
  /** The team station the goal has: 0 … TEAM_STATIONS-1. */
  station: number;
  /** The goal in a few words. */
  title: string;
  /**
   * The goal as the captain first put it (`goalBrief`). The lead hears it again with the note at each new slice, so it
   * survives a summarised conversation, or one that's gone. Missing on goals started before it was kept.
   */
  brief?: string;
  /** The lead's note on the goal, once they've written one. */
  note?: GoalNote;
  /** The lead thinks the goal is done, or that nothing worthwhile is left: the captain closes it, or carries on. */
  closing?: { reason: string; at: number };
  /**
   * The turn of the lead's the captain last read (its `finishedAt`), on whichever screen: it stops hailing them
   * (`needsYou`) on every screen until their next turn ends.
   */
  readTurn?: number;
  /**
   * What plugins noted of the lead's latest turn, by plugin id (`PluginGoals.mark`), each in a shape of its own that
   * only it reads: kept with the lead, sent to the browser, and cleared as the lead's next turn starts.
   */
  marks?: Record<string, unknown>;
  /** When the lead's latest turn started: a plugin's mark on an earlier one is refused (`PluginGoals.mark`). */
  turnStarted?: number;
  /**
   * Each repo, checked out at ./<folder> in the lead's workspace, and the branch it ships into. `branch` is the one it's
   * on when that isn't the goal's (`Agent.branch`): Ops starts a repo a fresh one from its base when it ships
   * again after its pull request merged (`needsFreshBranch`).
   */
  repos: { repo: string; folder: string; baseBranch: string; branch?: string }[];
  /**
   * Reopened from the room's log (the goal closed at `closedAt`), until every repo is checked out again on its branch: the
   * lead's next start does that before picking their conversation back up, however often it fails first.
   */
  reopening?: { closedAt: number };
  /**
   * The captain closed the goal at `at`, and its uncommitted work is being committed as WIP snapshots: a restart before
   * the goal's filed finishes the close (`Leads.recoverCloses`), so a snapshot never stays on a goal that's still open.
   */
  closeStarted?: { at: number };
  /** Which slice this is: 1, 2, … */
  slice: number;
  /** This slice's pull requests. */
  prs: LeadPr[];
  /** The pull requests of the slices that landed before this one, each with its `slice`, so the closed goal keeps them all. */
  landed?: LeadPr[];
  /** Every slice so far as a waypoint on the goal's chart, this one last. Missing on goals started before they were kept. */
  waypoints?: Waypoint[];
  /** The loose threads the lead has noticed, open and closed, oldest first. */
  contacts?: Contact[];
  /** What the lead has put on the station's screen, in the order they first showed it. Cleared when the goal closes. */
  artifacts?: GoalArtifact[];
  /** The questions the lead has asked with visual options, oldest first: at most the last one is still open. */
  questions?: GoalQuestion[];
}

/**
 * A question the lead put to the captain with Ops' ask tool, each option a page of its own (served like an
 * artifact, as `<question id>.<option id>`). The captain answers by picking one, or by telling the lead in chat
 * instead; it stays, answered, for the goal.
 */
export interface GoalQuestion {
  /** The slice it was asked in. Missing on questions asked before it was kept. */
  slice?: number;
  /** q1, q2, …: unique within the goal. */
  id: string;
  question: string;
  /** Why the lead's asking, and what matters in choosing. */
  context?: string;
  /** a, b, c, d in the order the lead gave them, each with what it means and trades off (`detail`). */
  options: { id: string; label: string; detail?: string; image?: boolean }[];
  at: number;
  /** How the captain answered: the `option` they picked on screen (with what they added), or no `option` when they replied in chat (`note` is what they said). */
  answer?: { option?: string; note?: string; at: number };
}

/**
 * A visual the lead put on their station's screen with Ops' show tool (a diagram, a mockup, a comparison): a
 * self-contained HTML page, and a picture of it for the screen. Served from /api/artifacts/<lead id>/<id>.html and .jpg.
 */
export interface GoalArtifact {
  /** The slice it was last shown in. Missing on ones shown before it was kept. */
  slice?: number;
  /** The lead's own name for it: showing the same id again replaces it. */
  id: string;
  title: string;
  /** When it was last shown: the screen shows the latest, and the picture's URL changes with it. */
  at: number;
  /** There's a picture of it for the screen. Missing when Ops couldn't render one (no browser to hand). */
  image?: boolean;
}

