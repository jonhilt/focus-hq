// The plugin API's shared part (docs/plugins.md): the office's types and pure values a plugin's server and browser parts
// both use. A plugin reaches the office only through plugin-api/ (boundary.test.ts holds it to that); what isn't
// re-exported here, in server.ts, client.ts or testing.ts, the core can change without a plugin noticing.
import type { Agent as OfficeAgent, LeadAgent as OfficeLeadAgent, Project as OfficeProject } from '../shared/types';
import type { LedgerEvent as OfficeLedgerEvent } from '../shared/ledger';

export type {
  AgentStatus, AgentTask, ArchivedGoal, Contact, GoalNote, GoalRecord, IssueDraft, Issue, MessageReply, ModelKind, Planner, QaReport, QueuedGoal, Settings, Snapshot, Waypoint,
} from '../shared/types';
/** An agent, a project and a line of the ledger as a plugin has them: its own copies (`PluginHost`), read-only. */
export type Agent = Readonly<OfficeAgent>;
export type LeadAgent = Readonly<OfficeLeadAgent>;
export type Project = Readonly<OfficeProject>;
export type LedgerEvent = Readonly<OfficeLedgerEvent>;
export { ACTIVE_STATUSES, AWAY_DESK, MODEL_KINDS } from '../shared/types';
/** Reading the office as it stands: the projects the captain hasn't hidden, a project's board, what needs the captain, a pull request's QA badge, a goal's title, what the ledger says of something. */
export { shownProjects } from '../shared/hidden';
export { columns } from '../shared/board';
export { type Attention, inFlight, needsYou } from '../shared/tricorder';
export { prKey, qaBadge } from '../shared/qa';
export { goalTitle } from '../shared/goalTitle';
export { trace } from '../shared/ledgerReview';
/** The crew's voices, and what a reply says aloud. */
export { type CrewVoice, linesToSpeak, spokenLine } from '../shared/voice';
export type { FixEffect, FixStatus, Friction, FrictionGroup, FrictionKind, LedgerEntry, SessionFacts } from '../shared/ledger';
/** The ledger read as the office reads it: the report card, the goals it closed, and the frictions, grouped and by digest. */
export { closedGoals, FIX_SESSIONS, FRICTION_KINDS, frictionGroups, frictionsByDigest, knownSignatures, OPEN_FRICTION_DAYS, reportCard, reportLines, unreadDigests } from '../shared/ledger';
/** The office's permanent crew a plugin speaks for (the chief engineer), and a crew member of its own, always the same person. */
export { chiefEngineer, crewVoice, fixedCrew, plannerFor } from '../shared/crew';
export type { Flow, FlowRecording, Frame, Trace } from '../shared/flows';
export { FLOWS_FILE } from '../shared/flows';
export { pluginOn } from '../shared/projectPlugins';
