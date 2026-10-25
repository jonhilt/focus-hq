// The plugin API's test kit (docs/plugins.md): for a plugin's *.test.ts only. `focus()` is a pretend Focus a test can
// switch the plugin on in; `FOCUS_DIR` is Focus's own checkout, a real repo to try things on.
import { config } from '../server/config';

export { focus, leadOpensPrs, until } from '../server/agents/fakeFocus';
/** The demo's workspace, which a test's Focus works in unless it's given another, and the shape of one. */
export { demoWorkspace } from '../server/agents/demoRunner';
export type { WorkspaceOps } from '../server/agents/types';
export type { Store } from '../server/store';
export const FOCUS_DIR = config.root;
/** Focus's two rules for a part that keeps state, checked by running it (docs/invariants.md). */
export { type Action, checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../server/agents/invariants';
/** Ops' state machines as data, as `PluginHost.machines` lends them: to lay out and draw in a test. */
export { MACHINES } from '../server/agents/machines';

// Ops' own words to a lead, for a plugin's tests that tell who a message is from
export { conflictsResolvedNote } from '../server/agents/lead';
export { CARRY_ON_AFTER_LIMIT } from '../server/agents/manager/planLimit';
