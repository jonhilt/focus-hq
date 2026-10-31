import { Effect } from 'effect';
import { prKey } from '../../../shared/qa';
import type { Agent, LeadPr, PullRequest } from '../../../shared/types';
import { GitHub } from '../../github/service';
import { restackConflictsNote, restackedNote, restackUnknownNote } from '../lead';
import { hasLeadWork } from '../leadRules';
import { Workspace } from '../services';
import { restackPlan, type RestackStep } from '../stackRules';
import type { Restack } from '../types';
import { Part } from './core';

type StackedOn = NonNullable<LeadPr['stackedOn']>;
type Moved = Restack | { kind: 'failed'; why: string };

/**
 * A goal's stacked waypoints moved along: when the branch a waypoint's pull request sits on gets a push or lands, Ops
 * moves its branch onto that one's new head, or the branch it's to land on, and points its pull request there
 * (`restackPlan`). The lead hears of each move once, with how to bring their checkout along; a move that clashes pushes
 * nothing, and they hear how to do it themselves. Run as the board refreshes, after the goals claim their pull requests.
 */
export class Stacks extends Part {
  /** The pull requests (prKey) Ops is moving right now. */
  private moving = new Set<string>();

  /** The board refreshed: each goal's stacked pull requests are moved along as far as they need to be. Never throws. */
  async boardRefreshed(projectId: string, prs: readonly PullRequest[]): Promise<void> {
    for (const lead of this.store.agentsIn(projectId).filter(hasLeadWork)) {
      const plan = restackPlan(lead.lead, prs);
      if (plan.kind === 'none') continue;
      for (const key of new Set(plan.steps.map((s) => prKey(s.repo, s.number)))) {
        // each step planned again just before it's taken, from the goal as it is then: a refresh at the same time may
        // have taken it; and each kind once a refresh, so a step that leaves the goal as it was isn't taken again
        const taken = new Set<RestackStep['kind']>();
        for (let step = this.next(lead.id, prs, key, taken); step; step = this.next(lead.id, prs, key, taken)) {
          taken.add(step.kind);
          await this.take(lead.id, step).catch((err: unknown) => console.warn(`Couldn't move ${key} along its stack: ${String(err)}`));
        }
      }
    }
  }

  /** The next step for the pull request `key` of the lead's goal as it is now, of a kind not yet `taken`. */
  private next(leadId: string, prs: readonly PullRequest[], key: string, taken: ReadonlySet<RestackStep['kind']>): RestackStep | undefined {
    const work = this.store.agents.get(leadId)?.lead;
    const plan = work ? restackPlan(work, prs) : undefined;
    return plan?.kind === 'steps' ? plan.steps.find((s) => prKey(s.repo, s.number) === key && !taken.has(s.kind)) : undefined;
  }

  private async take(leadId: string, step: RestackStep): Promise<void> {
    switch (step.kind) {
      case 'record':
        this.stackedOn(leadId, step, () => step.stackedOn);
        return;
      case 'retarget':
        await this.retarget(step.repo, step.number, step.base);
        return;
      case 'no-upstream': {
        const lead = this.stackedOn(leadId, step, (s) => ({ ...s, stuck: step.stuck }));
        if (lead?.lead) this.core.leads.noteForLead(lead, 'Ops', restackUnknownNote(step, step.onto, this.folder(lead, step.repo)), { kind: 'restacked', repo: step.repo, number: step.number, stuck: true });
        return;
      }
      case 'restack':
        return this.restack(leadId, step);
    }
  }

  /**
   * Moves the pull request's branch onto the one below it, then points the pull request there. Its head as Ops set out
   * is kept first (`moving`): a move a restart cut off, found done when it's tried again, is still told to the lead.
   */
  private async restack(leadId: string, step: Extract<RestackStep, { kind: 'restack' }>): Promise<void> {
    const key = prKey(step.repo, step.number);
    if (this.moving.has(key)) return;
    this.moving.add(key);
    // a move of Ops' a restart cut off, whose head it set out from
    const cutOff = this.held(leadId, step)?.stackedOn?.moving;
    let moved: Moved;
    try {
      this.stackedOn(leadId, step, (s) => ({ ...s, moving: s.moving ?? step.head }));
      const work = Workspace.use((w) => w.restack(step.repo, step.branch, step.onto, step.upstream)).pipe(
        Effect.catch((err): Effect.Effect<Moved> => Effect.succeed({ kind: 'failed', why: err.message })),
      );
      moved = await this.runtime.runPromise(work);
    } finally {
      this.moving.delete(key);
    }
    if (moved.kind === 'failed') {
      const lead = this.stackedOn(leadId, step, ({ moving: _, ...s }) => s);
      if (lead) this.print(lead, [{ kind: 'system', text: `✻ Ops couldn't move ${key} onto ${step.onto}: ${moved.why}` }]);
      return;
    }
    if (moved.kind === 'conflicts') return this.clashed(leadId, step, moved.files);
    if (step.retarget) await this.retarget(step.repo, step.number, step.retarget);
    const from = moved.kind === 'restacked' ? moved.from : cutOff;
    const lead = this.stackedOn(leadId, step, () => step.stackedOn, moved.kind === 'restacked' ? moved.sha : undefined);
    // up to date with no move of Ops' cut off: it was there already, and there's nothing to tell
    if (!lead?.lead || !from) return;
    this.core.ledger.record(lead.projectId, { kind: 'restacked', repo: step.repo, pr: step.number, goal: lead.lead.title, onto: step.onto });
    this.core.leads.noteForLead(lead, 'Ops', restackedNote(step, step.onto, this.folder(lead, step.repo), from), { kind: 'restacked', repo: step.repo, number: step.number });
    this.boardChanged(lead.projectId);
  }

  /** The move clashed: nothing was pushed, and it stays where it is until the branch below or its own head moves. */
  private clashed(leadId: string, step: Extract<RestackStep, { kind: 'restack' }>, files: string[]): void {
    const lead = this.stackedOn(leadId, step, ({ moving: _, ...s }) => ({ ...s, stuck: { lower: step.stackedOn.sha, head: step.head } }));
    if (!lead?.lead) return;
    this.core.ledger.record(lead.projectId, { kind: 'restacked', repo: step.repo, pr: step.number, goal: lead.lead.title, onto: step.onto, files });
    this.core.leads.noteForLead(lead, 'Ops', restackConflictsNote(step, step.onto, step.upstream, this.folder(lead, step.repo), files), { kind: 'restacked', repo: step.repo, number: step.number, stuck: true });
    this.boardChanged(lead.projectId);
  }

  /** Points the pull request at `base` on GitHub. One that fails is pointed again as the board next refreshes. */
  private retarget(repo: string, number: number, base: string): Promise<void> {
    const edit = GitHub.use((gh) => gh.editPullRequestBase(repo, number, base)).pipe(
      Effect.catch((err) => Effect.sync(() => console.warn(`Couldn't base ${repo}#${number} on ${base}: ${err.message}`))),
    );
    return this.runtime.runPromise(edit);
  }

  /**
   * Sets where the lead's open pull request sits (and its head, `sha`, when Ops moved it), from where it sat as Ops
   * last knew it: the lead, or nothing when the pull request is no longer one of the goal's open ones.
   */
  private stackedOn(leadId: string, pr: Pick<LeadPr, 'repo' | 'number'>, next: (was: StackedOn) => StackedOn, sha?: string): Agent | undefined {
    const lead = this.store.agents.get(leadId);
    const held = this.held(leadId, pr);
    if (!lead?.lead || !held) return undefined;
    const stackedOn = next(held.stackedOn ?? { branch: '', sha: '' });
    this.update(lead, { lead: { ...lead.lead, prs: lead.lead.prs.map((p) => (p === held ? { ...p, stackedOn, ...(sha && { sha }) } : p)) } });
    return lead;
  }

  /** The lead's pull request, while it's one of the goal's open ones. */
  private held(leadId: string, pr: Pick<LeadPr, 'repo' | 'number'>): LeadPr | undefined {
    return this.store.agents.get(leadId)?.lead?.prs.find((p) => p.repo === pr.repo && p.number === pr.number && !p.outcome);
  }

  private folder(lead: Agent, repo: string): string {
    return lead.lead?.repos.find((r) => r.repo === repo)?.folder ?? repo.split('/')[1];
  }
}
