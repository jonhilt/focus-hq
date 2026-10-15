// The plugin API's shared part (docs/plugins.md): the office's types and pure values a plugin's server and browser parts
// both use. A plugin reaches the office only through plugin-api/ (boundary.test.ts holds it to that); what isn't
// re-exported here, in server.ts, client.ts or testing.ts, the core can change without a plugin noticing.
export type { Agent, AgentStatus, AgentTask, ArchivedGoal, GoalRecord, Issue, LeadAgent, ModelKind, Planner, Project, QaReport, Settings } from '../shared/types';
export { MODEL_KINDS } from '../shared/types';
export type { FrictionKind, LedgerEntry, LedgerEvent, SessionFacts } from '../shared/ledger';
/** The ledger read as the office reads it: the report card, the goals it closed, and the frictions, grouped and by digest. */
export { closedGoals, FRICTION_KINDS, frictionGroups, frictionsByDigest, OPEN_FRICTION_DAYS, reportCard } from '../shared/ledger';
export type { Flow, FlowRecording } from '../shared/flows';
export { FLOWS_FILE } from '../shared/flows';
export { pluginOn } from '../shared/projectPlugins';
