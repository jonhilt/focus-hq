import type { RunFact, RunState } from './runJournal';

/**
 * An agent's inbox: what the manager has for them to hear next, and what waits for the end of the turn they're in. It
 * lives in their run journal (`Store.journal`), so a message the office took is never lost to a restart: each change
 * is a fact on disk before it returns, and what's waiting is what the journal adds up to.
 */
export class Inbox {
  constructor(
    private readonly record: (fact: RunFact) => RunState,
    private readonly state: () => RunState,
  ) {}

  /** How many messages wait for their next turn (not counting those waiting for this one to end). */
  get length(): number {
    return this.state().inbox.length;
  }

  /** Heard next, after whatever's already waiting. */
  push(text: string): void {
    this.record({ kind: 'queued', text, at: 'end' });
  }

  /** Heard next, before whatever's already waiting. */
  unshift(text: string): void {
    this.record({ kind: 'queued', text, at: 'front' });
  }

  /** Heard once the turn in hand ends (`release`). */
  later(text: string): void {
    this.record({ kind: 'queued', text, at: 'later' });
  }

  /** The turn ended: what waited for it joins the rest. */
  release(): void {
    if (this.state().later.length) this.record({ kind: 'released' });
  }

  /** Everything waiting, taken to be heard: into turn `turn`'s prompt, or a session that's listening. */
  take(turn?: string): string[] {
    const waiting = this.state().inbox;
    if (waiting.length) this.record({ kind: 'taken', turn });
    return [...waiting];
  }

  /** Everything waiting, dropped unheard. */
  clear(): void {
    const { inbox, later } = this.state();
    if (inbox.length || later.length) this.record({ kind: 'cleared' });
  }
}
