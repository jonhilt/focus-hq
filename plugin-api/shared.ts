// The plugin API's shared part (docs/plugins.md): Focus's types and pure values a plugin's server and browser parts
// both use. A plugin reaches Focus only through plugin-api/ (boundary.test.ts holds it to that); what isn't
// re-exported here, in server.ts, client.ts or testing.ts, the core can change without a plugin noticing.
import type { Agent as CoreAgent, LeadAgent as CoreLeadAgent, Project as CoreProject } from '../shared/types';
import type { LedgerEvent as CoreLedgerEvent } from '../shared/ledger';

export type {
  AgentStatus, AgentTask, ArchivedGoal, Contact, Effort, GoalArtifact, GoalNote, GoalRecord, IssueDraft, Issue, MessageReply, ResumeCost, ResumeHow, TermLine, ModelCite, ModelKind, Planner, QaReport, QueuedGoal, Settings, SignIn, Snapshot, SystemModel, Waypoint,
} from '../shared/types';
/** A time of day, with the day when it isn't today (`14:05`, `Tue 09:30`). */
export { clock } from '../shared/clock';
/** An agent, a project and a line of the ledger as a plugin has them: its own copies (`PluginHost`), read-only. */
export type Agent = Readonly<CoreAgent>;
export type LeadAgent = Readonly<CoreLeadAgent>;
export type Project = Readonly<CoreProject>;
export type LedgerEvent = Readonly<CoreLedgerEvent>;
export { ACTIVE_STATUSES, AWAY_DESK, EFFORT_LEVELS, MODEL_KINDS } from '../shared/types';
/** Reading the ship as it stands: the projects the captain hasn't hidden, a project's board, what needs the captain, a pull request's QA badge, a goal's title, what the ledger says of something. */
export { shownProjects } from '../shared/hidden';
export { columns } from '../shared/board';
export { type Attention, inFlight, needsYou } from '../shared/tricorder';
export { prKey, qaBadge } from '../shared/qa';
export { goalTitle } from '../shared/goalTitle';
/** The ledger as Focus reads it out: a line of it, and lines grouped by day. */
export { byDay, ledgerRow, type LedgerRow, trace } from '../shared/ledgerReview';
/** The crew's voices, and what a reply says aloud. */
export { type CrewVoice, forSpeech, linesToSpeak, sentences, spokenLine } from '../shared/voice';
export { leadVoice } from '../shared/crew';
export type { CosRoute, FixEffect, FixStatus, Friction, FrictionGroup, FrictionKind, LedgerEntry, SessionFacts } from '../shared/ledger';
/** The ledger read as Focus reads it: the report card, the goals it closed, and the frictions, grouped and by digest. */
export { closedGoals, FIX_SESSIONS, FRICTION_KINDS, frictionGroups, frictionsByDigest, knownSignatures, OPEN_FRICTION_DAYS, reportCard, reportLines, unreadDigests } from '../shared/ledger';
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
export { ARTIFACT_SIZE, artifactUrl } from '../shared/artifacts';
