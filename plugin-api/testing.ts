// The plugin API's test kit (docs/plugins.md): for a plugin's *.test.ts only. `office()` is a pretend office a test can
// switch the plugin on in; `OFFICE_DIR` is the office's own checkout, a real repo to try things on.
import { config } from '../server/config';

export { office, until } from '../server/agents/fakeOffice';
/** The demo's workspace, which a test's office works in unless it's given another, and the shape of one. */
export { demoWorkspace } from '../server/agents/demoRunner';
export type { WorkspaceOps } from '../server/agents/types';
export type { Store } from '../server/store';
export const OFFICE_DIR = config.root;
/** The office's two rules for a part that keeps state, checked by running it (docs/invariants.md). */
export { type Action, checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../server/agents/invariants';
/** The office's state machines as data, as `PluginHost.machines` lends them: to lay out and draw in a test. */
export { MACHINES } from '../server/agents/machines';
