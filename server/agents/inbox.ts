import type { RunFact, RunState } from './runJournal';

/**
 * An agent's inbox: what the manager has for them to hear next, what waits for the end of the turn they're in, and (a
 * goal's lead's) notes, news that goes with the next message they hear. It lives in their run journal (`Store.journal`),
 * so a message Ops took is never lost to a restart: each change is a fact on disk before it returns, and what's waiting
 * is what the journal adds up to.
 *
 * Only messages count (`length`): a turn that ends with one waiting carries on into another, but notes never start
 * or carry on a turn by themselves.
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

  /** News that waits for the next message, whoever's, and goes ahead of it: it never wakes them by itself. */
  note(text: string): void {
    this.record({ kind: 'queued', text, at: 'note' });
  }

  /** The notes waiting, without taking them. */
  get notes(): readonly string[] {
    return this.state().notes;
  }

  /** The notes waiting went into turn `turn`'s session, which was listening, ahead of a message. */
  notesSent(turn: string): void {
    if (this.state().notes.length) this.record({ kind: 'notes-sent', turn });
  }

  /** Heard once the turn in hand ends (`release`). */
  later(text: string): void {
    this.record({ kind: 'queued', text, at: 'later' });
  }

  /** The turn ended: what waited for it joins the rest. */
  release(): void {
    if (this.state().later.length) this.record({ kind: 'released' });
  }

  /** Everything waiting, notes first, taken to be heard: into turn `turn`'s prompt, or a session that's listening. */
  take(turn?: string): string[] {
    const { notes, inbox } = this.state();
    if (notes.length || inbox.length) this.record({ kind: 'taken', turn });
    return [...notes, ...inbox];
  }

  /** Everything waiting, dropped unheard. */
  clear(): void {
    const { inbox, later, notes } = this.state();
    if (inbox.length || later.length || notes.length) this.record({ kind: 'cleared' });
  }
}
