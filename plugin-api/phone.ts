// The plugin API's part for the phone (the Tricorder, docs/plugins.md): the contract a plugin's phone.ts
// default-exports, and the same read-only view of Focus and its own routes as the 3D ship's (browser.ts). Nothing of
// three.js or the 3D world, so the Tricorder stays small.
export * from './shared';
export * from './browser';
export type { PhoneHost, PhonePlugin } from '../client/src/tricorder/phonePlugins';
export { h } from '../client/src/ui/dom';
