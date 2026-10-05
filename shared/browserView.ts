import type { BrowserFrame } from './types';

// The laptop in the room and the agent's panel both ask this, so they never disagree about the browser.
// The server keeps an agent's last frame until the agent goes, so a finished agent still shows where it got to.

/** Whether an agent's screen shows the browser next to the terminal. */
export const showsBrowser = (frame: BrowserFrame | undefined): frame is BrowserFrame => frame !== undefined;
