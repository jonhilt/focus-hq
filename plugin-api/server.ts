// The plugin API's server part (docs/plugins.md): the contract a plugin's server.ts implements, what the office lends
// it (`PluginHost`), and the helpers it may share with the core. Anything the office does for a plugin (files,
// checkouts, GitHub) goes on the host, so the core decides what a plugin can do and a test can lend it a fake.
export * from './shared';
export type { BriefSpec, BriefWork, FocusPlugin, LeadTool, LeadToolContext, PluginHost, PluginParts, PluginRoute, PluginState } from '../server/plugins/contract';
/** The limits on a page a lead tool puts on the lead's screen (`LeadToolContext.show`): its id's and title's length. */
export { ARTIFACT_LIMITS } from '../server/agents/lead';
export { errorMessage, run, sleep } from '../server/util';
/** A plugin's own folder for files, for its scripts (its server part has `host.dataDir()`, the same folder). */
export { pluginDataDir } from '../server/plugins/dataDir';
export { officeLedger } from './ledger';
