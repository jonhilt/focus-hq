import { arrive, type StepAt, stepPill, stepTick, type TrainingStep } from '../../../shared/trainingSteps';
import { ACTIVE_STATUSES, type Agent } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import { h } from './dom';

/** How long a move waits for the lead to finish its turn before giving up (ms). */
const WAIT_MS = 180_000;

/** How long typing out a reply takes per character (ms), so it reads as typed on a recording. */
const TYPE_MS = 35;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The training console's steps (docs/studio.md): once a scenario's reset is done, a pill over the bottom of the screen
 * says which of the captain's moves comes next, `]` makes it (a reply typed out in the pill first), and `[` steps back
 * so `]` can make one again. A move made by hand through a screen moves the pill on too.
 */
export class TrainingSteps {
  private steps: TrainingStep[] = [];
  private projectId: string | undefined;
  private at: StepAt = { index: 0, doneOnArrival: false };
  /** A reply being typed out, as far as it's got. */
  private typing: string | null = null;
  /** What a move is waiting for, while it waits. */
  private waiting: string | null = null;
  private running = false;
  private readonly pill = h('div', { class: 'training-steps' });
  private drawn = '';

  constructor(private readonly onError: (message: string) => void) {
    document.body.append(this.pill);
  }

  /** Starts a scenario's steps from the first, over `projectId`'s goal. */
  start(projectId: string, steps: TrainingStep[]): void {
    this.projectId = projectId;
    this.steps = steps;
    this.typing = null;
    this.at = arrive(steps, 0, this.lead());
    this.draw();
  }

  /** `]` makes the next move and `[` steps back: whether it took the key. */
  key(code: string): boolean {
    if (!this.steps.length || (code !== 'BracketRight' && code !== 'BracketLeft')) return false;
    if (code === 'BracketRight') void this.next();
    else if (!this.running) this.at = arrive(this.steps, this.at.index - 1, this.lead());
    this.draw();
    return true;
  }

  /** Each frame: a move made (by `]` or by hand) moves the pill on. */
  update(): void {
    if (!this.steps.length) return;
    this.at = stepTick(this.steps, this.at, this.lead());
    this.draw();
  }

  /** The scenario's lead, once its goal has started. */
  private lead(): Agent | undefined {
    return [...state.agents.values()].find((a) => a.task === 'lead' && a.projectId === this.projectId);
  }

  private async next(): Promise<void> {
    const index = this.at.index;
    const step = this.steps[index];
    if (!step || this.running) return;
    this.running = true;
    try {
      await this.make(step);
      // a move the lead shows only later, or not at all (a reply), or one made again: on to the next all the same
      if (this.at.index === index) this.at = arrive(this.steps, index + 1, this.lead());
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err));
    } finally {
      this.typing = null;
      this.running = false;
      this.draw();
    }
  }

  /**
   * Waits for the lead to finish its turn: the captain answers or replies to a lead that's listening, as the recorder
   * does, since a demo lead doesn't hear a message that comes mid-turn.
   */
  private async leadListening(): Promise<Agent | undefined> {
    this.waiting = 'waiting for the lead to finish…';
    this.draw();
    try {
      for (const until = Date.now() + WAIT_MS; Date.now() < until; await sleep(250)) {
        const lead = this.lead();
        if (lead && !ACTIVE_STATUSES.includes(lead.status)) return lead;
      }
      throw new Error('The lead is still busy: try ] again once its turn is over');
    } finally {
      this.waiting = null;
    }
  }

  /** Makes a move as the captain would through its screen. */
  private async make(step: TrainingStep): Promise<void> {
    const lead = step.do === 'answer' || step.do === 'reply' ? await this.leadListening() : this.lead();
    const projectId = this.projectId;
    if (!projectId) return;
    switch (step.do) {
      case 'start-goal': {
        const queued = state.project(projectId)?.goalQueue?.[0];
        if (!queued) throw new Error('There’s no goal waiting to start');
        await api.startQueued(projectId, queued.id, { station: 0 });
        return;
      }
      case 'answer': {
        const open = lead?.lead?.questions?.findLast((q) => !q.answer);
        if (!lead || !open) throw new Error('The lead hasn’t asked anything yet');
        await api.answer(lead.id, open.id, open.options[0].id);
        return;
      }
      case 'reply': {
        if (!lead) throw new Error('There’s no lead to tell yet');
        const text = step.say ?? '';
        for (let n = 1; n <= text.length; n++) {
          this.typing = text.slice(0, n);
          this.draw();
          await sleep(TYPE_MS);
        }
        await api.message(lead.id, text);
        return;
      }
      case 'approve': {
        if (!lead?.permission) throw new Error('The lead isn’t asking for anything yet');
        await api.permission(lead.id, lead.permission.id, true);
        return;
      }
      case 'merge': {
        const open = (lead?.lead?.prs ?? []).filter((p) => !p.outcome);
        if (!open.length) throw new Error('There are no pull requests to merge yet');
        for (const pr of open) await api.mergePr(projectId, pr.repo, pr.number);
        return;
      }
    }
  }

  private draw(): void {
    const lead = this.lead();
    const { where, next } = stepPill(this.steps, this.at, lead);
    const text = this.typing === null ? next : `Tell the lead: “${this.typing}▌`;
    const keys = this.waiting ?? (this.running ? 'working…' : '] next · [ back');
    const key = `${this.steps.length}|${where}|${text}|${keys}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.pill.classList.toggle('up', this.steps.length > 0);
    this.pill.replaceChildren(h('b', null, where), text, h('span', { class: 'keys' }, keys));
  }
}
