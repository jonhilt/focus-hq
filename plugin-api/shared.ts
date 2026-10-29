// The plugin API's shared part (docs/plugins.md): Focus's types and pure values a plugin's server and browser parts
// both use. A plugin reaches Focus only through plugin-api/ (boundary.test.ts holds it to that); what isn't
// re-exported here, in server.ts, client.ts or testing.ts, the core can change without a plugin noticing.
import type { Agent as CoreAgent, LeadAgent as CoreLeadAgent, Project as CoreProject } from '../shared/types';
import type { LedgerEvent as CoreLedgerEvent } from '../shared/ledger';

export type {
  AgentStatus, AgentTask, ArchivedGoal, Contact, Effort, GoalArtifact, GoalNote, GoalRecord, IssueDraft, Issue, MessageReply, PullRequest, QaReview, ResumeCost, ResumeHow, TermLine, Planner, Preview, QaReport, QueuedGoal, Settings, SignIn, Snapshot, Waypoint,
} from '../shared/types';
/** A time of day, with the day when it isn't today (`14:05`, `Tue 09:30`). */
export { clock } from '../shared/clock';
/** An agent, a project and a line of the ledger as a plugin has them: its own copies (`PluginHost`), read-only. */
export type Agent = Readonly<CoreAgent>;
export type LeadAgent = Readonly<CoreLeadAgent>;
export type Project = Readonly<CoreProject>;
export type LedgerEvent = Readonly<CoreLedgerEvent>;
export { ACTIVE_STATUSES, AWAY_DESK, EFFORT_LEVELS } from '../shared/types';
/** Reading the ship as it stands: the projects the captain hasn't hidden, a project's board, what needs the captain, a pull request's QA badge, a goal's title, what the ledger says of something. */
export { shownProjects } from '../shared/hidden';
export { columns } from '../shared/board';
export { type Attention, inFlight, needLine, needsYou, turnRead } from '../shared/tricorder';
/** How the captain answers an agent from its panel (`PluginParts.captainAnswered`), and whether Ops' reply says it went through. */
export { type CaptainAnswer, landed } from '../shared/captainAnswer';
/** A lead's open question, what an agent said last, and what a lead showed on their screen this turn. */
export { openQuestion } from '../shared/artifacts';
export { lastWords, shownThisTurn } from '../shared/leadWords';
export { prKey, qaBadge } from '../shared/qa';
export { autoSendBackFor } from '../shared/qaRules';
/** What a pull request's merge button does now, as the board's does, and how a repo's pull requests merge. */
export { type MergeAction, mergeAction } from '../shared/mergeGateRules';
export { higherLane, type Lane, LANE_SAID, LANES, laneName } from '../shared/mergeLaneRules';
export { PUBLIC_WORDS_RULE, SHIP_WORDS } from '../shared/wording';
export type { SliceRecap } from '../shared/recap';
export { goalTitle } from '../shared/goalTitle';
/** Reading an agent: whether it's a goal's lead (a `LeadAgent`). */
export { hasLeadWork } from '../server/agents/leadRules';
/** The ledger as Focus reads it out: a line of it, and lines grouped by day. */
export { byDay, ledgerRow, type LedgerRow, trace } from '../shared/ledgerReview';
/** The crew's voices, and what a reply says aloud. */
export { type CrewVoice, forSpeech, linesToSpeak, sentences, spokenLine } from '../shared/voice';
export { leadVoice } from '../shared/crew';
/** Where a captain's decision came from, said after it (nothing for the captain in Focus). */
export { viaNote } from '../shared/ledger';
export type { DecidedVia, VerdictRoute, FixEffect, FixStatus, Friction, FrictionGroup, FrictionKind, LedgerEntry, SessionFacts, ThreadDecidedAs, ThreadProposal } from '../shared/ledger';
/** The ledger read as Focus reads it: the report card, the goals it closed, and the frictions, grouped and by digest. */
export { closedGoals, FIX_SESSIONS, FRICTION_KINDS, frictionGroups, frictionsByDigest, knownSignatures, OPEN_FRICTION_DAYS, reportCard, reportLines, unreadDigests } from '../shared/ledger';
/** Intents as ledger lines (`intent`): the one way to write one, a project's or a goal's, and a project's own read back. */
export { type IntentFields, intentEntry, projectIntents } from '../shared/intents';
/** The ship's permanent crew a plugin speaks for (the chief engineer), and a crew member of its own, always the same person. */
export { chiefEngineer, crewVoice, fixedCrew, plannerFor } from '../shared/crew';
/** A record's keys as its key type, and a record built from a list of keys, without a cast at each place. */
export { fieldsOf, isOneOf, isRecord, keysOf, recordOf } from '../shared/records';
export type { Flow, FlowRecording } from '../shared/flows';
/** Ops' state machines as data, and where a run of one is (`PluginHost.machines`). */
export type { MachineGraph, MachineRun, MachineState, MachineStep, MachineTransition } from '../shared/machines';
export type { PersonalEntry } from '../shared/personalLog';
export { FLOWS_FILE } from '../shared/flows';
export { pluginOn } from '../shared/projectPlugins';
/** Where a lead's page (or its picture) is served, and the size it's laid out for. */
export { ARTIFACT_SIZE, artifactUrl, optionUrl } from '../shared/artifacts';
