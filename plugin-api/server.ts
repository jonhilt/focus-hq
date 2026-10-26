// The plugin API's server part (docs/plugins.md): the contract a plugin's server.ts implements, what Focus lends
// it (`PluginHost`), and the helpers it may share with the core. Anything Focus does for a plugin (files,
// checkouts, GitHub) goes on the host, so the core decides what a plugin can do and a test can lend it a fake.
export * from './shared';
export type { BriefSpec, BriefWork, FocusPlugin, LeadNews, LeadNote, LeadTool, LeadToolContext, LeadToolReply, LentJournal, LentJournals, PageFrames, PluginGoals, PluginHost, PluginParts, PluginRoute, PluginState } from '../server/plugins/contract';
/** The limits on a page a lead tool puts on the lead's screen (`LeadToolContext.show`): its id's and title's length. */
export { ARTIFACT_LIMITS } from '../server/agents/leadRules';
/** Reads a file a lead cites, as the model tool checks a cite: its lines, or undefined if it's missing or outside `roots` (their checkouts). */
export { sourceReader } from '../server/agents/sourceReader';
export { errorMessage, newId, randomHex, run, sleep, truncate } from '../server/util';
/** A route's say on picking a conversation back up on your API key (`how`: now, or once your plan's limit resets). */
export { resumeHow } from '../server/apiRequests';
export { demoPace } from '../server/demoPace';
/** What a read-only Claude Code session is given and gives back (`host.readOnlySession`). */
export { CODE_TOOLS, type ReadOnlyResult, type ReadOnlyRun, type ReadOnlyTool, type ShipSessionRun, WEB_TOOLS } from '../server/agents/claudeCrew';
/**
 * The environment Focus's Claude Code sessions run in, for a plugin that starts one through the Agent SDK itself:
 * `agentEnv(false)` signs in with your plan whatever the API key's doing, and with no argument as Focus's new
 * sessions do now (`host.signIn`).
 */
export { agentEnv } from '../server/agents/claudeRunner';
/** The ship as the crew's ship_status tool tells it (`host.shipStatus`), and its projects as a crew member's prompt lists them. */
export { type ChatProject, projectList, type ShipStatus } from '../server/agents/shipStatus';
/** GitHub, as a brief's Effect reads it (`BriefSpec.brief`), and a merged or closed pull request as it gives it. */
export { GitHub } from '../server/github/service';
export type { PastPullRequest } from '../server/github/provider';
/**
 * A folder of crew files, as the core's .focus/crew/ (its README.md): a plugin's own crew, beside its code, each role's
 * prompt and texts checked against what the code fills in, and a digest of its words for a version.
 */
export { crewFolder, type CrewFolder, CrewFileError } from '../server/agents/crewFiles';
export type { CrewRole } from '../server/agents/crewRoles';
/**
 * A scorer's file, as .focus/scorers/ keeps them (its README.md): how a model grades a crew role's real work, its rubric
 * and the scale it grades on, checked as it's read, with a digest of both for a version.
 */
export { loadScorer, type Scorer, ScorerFileError, scoreOf } from '../server/agents/scorerFiles';
/** A plugin's own folder for files, for its scripts (its server part has `host.dataDir()`, the same folder). */
export { pluginDataDir } from '../server/plugins/dataDir';
/** Focus on this machine, for a plugin's scripts: its ledger, its agents' transcripts and its clones of repos. */
export { focusLedger, focusMirror, focusRunJournals, focusSavedState, focusTranscript } from './focus';
/** Reading an agent: its goal as the ledger would record it (whether it's a goal's lead is in shared.ts). */
export { goalRecord } from '../server/agents/lead';
/** The demo's made-up files, by repo, for a plugin's scripted stand-in to talk about. */
export { FILES as DEMO_FILES } from '../server/agents/demoRunner';
/** Reading a Claude Code session's transcript (`host.transcript`), a line at a time. */
export { type Block, blocks, clip, type Line, messageFrom, resultText, transcriptLines } from '../server/agents/transcript';
/** What a lead said since the last message to it, clipped to its end as the ledger's `captain-replies` keep it. */
export { leadTail } from '../server/agents/sessionDigest';
/** Reading Ops' journals (`host.journals`): a fact and what a journal adds up to, fact by fact, and a run's fact in words. */
export type { Stamped } from '../server/journals';
export { factLine, type JournalEntry, type RunFact, type TurnKind } from '../server/agents/runJournal';
export { EMPTY_REVIEW, evolveReview, type ReviewEntry, type ReviewFact } from '../server/agents/reviewJournal';
/** QA's catch rate (docs/qa-catch.md): Focus's latest run, and its totals. */
export { latestRun as latestQaCatch } from '../server/agents/qaCatchRuns';
export { type CatchRun, catchTotals } from '../server/agents/qaCatch';
/** Speech, for a plugin's scripts that talk to Focus aloud: audio as whisper takes it, and what the demo hears. */
export { encodeWav, toMono16k } from '../client/src/ui/speech';
export { DEMO_TRANSCRIPT } from '../server/voice';
export type { VoiceStatus } from '../shared/types';
