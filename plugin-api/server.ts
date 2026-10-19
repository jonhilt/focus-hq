// The plugin API's server part (docs/plugins.md): the contract a plugin's server.ts implements, what the office lends
// it (`PluginHost`), and the helpers it may share with the core. Anything the office does for a plugin (files,
// checkouts, GitHub) goes on the host, so the core decides what a plugin can do and a test can lend it a fake.
export * from './shared';
export type { BriefSpec, BriefWork, FocusPlugin, LeadTool, LeadToolContext, LeadToolReply, ModelShown, PageFrames, PluginHost, PluginParts, PluginRoute, PluginState } from '../server/plugins/contract';
/** The limits on a page a lead tool puts on the lead's screen (`LeadToolContext.show`): its id's and title's length. */
export { ARTIFACT_LIMITS } from '../server/agents/lead';
export { errorMessage, newId, randomHex, run, sleep, truncate } from '../server/util';
/** What a read-only Claude Code session is given and gives back (`host.readOnlySession`). */
export { CODE_TOOLS, type ReadOnlyResult, type ReadOnlyRun, type ReadOnlyTool, type ShipSessionRun, WEB_TOOLS } from '../server/agents/claudeCrew';
/** The ship as the crew's ship_status tool tells it (`host.shipStatus`), and its projects as a crew member's prompt lists them. */
export { type ChatProject, projectList, type ShipStatus } from '../server/agents/shipStatus';
/** GitHub, as a brief's Effect reads it (`BriefSpec.brief`), and a merged or closed pull request as it gives it. */
export { GitHub } from '../server/github/service';
export type { PastPullRequest } from '../server/github/provider';
/** A plugin's own folder for files, for its scripts (its server part has `host.dataDir()`, the same folder). */
export { pluginDataDir } from '../server/plugins/dataDir';
/** The office on this machine, for a plugin's scripts: its ledger, its agents' transcripts and its clones of repos. */
export { officeLedger, officeMirror, officeTranscript } from './office';
/** Reading an agent: whether it's a goal's lead (a `LeadAgent`), and its goal as the ledger would record it. */
export { goalRecord, hasLeadWork, pickStation } from '../server/agents/lead';
/** The demo's made-up files, by repo, for a plugin's scripted stand-in to talk about. */
export { FILES as DEMO_FILES } from '../server/agents/demoRunner';
/** Reading a Claude Code session's transcript (`host.transcript`), a line at a time. */
export { type Block, blocks, clip, type Line, messageFrom, resultText, transcriptLines } from '../server/agents/transcript';
/** QA's catch rate (docs/qa-catch.md): the office's latest run, and its totals. */
export { latestRun as latestQaCatch } from '../server/agents/qaCatchRuns';
export { type CatchRun, catchTotals } from '../server/agents/qaCatch';
/** Speech, for a plugin's scripts that talk to the office aloud: audio as whisper takes it, and what the demo hears. */
export { encodeWav, toMono16k } from '../client/src/ui/speech';
export { DEMO_TRANSCRIPT } from '../server/voice';
export type { VoiceStatus } from '../shared/types';
