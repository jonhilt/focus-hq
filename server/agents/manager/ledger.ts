import { type Closer, type LedgerEntry, reportCard, type ReportCard } from '../../../shared/ledger';
import type { Transcript } from '../engineer';
import { backfillWho, digestEntry, type Extractor, lastDigest, transcriptSpan, withFrictions } from '../sessionDigest';
import { prKey, qaBadge } from '../../../shared/qa';
import type { Agent } from '../../../shared/types';
import { errorMessage } from '../../util';
import { Part, Refused } from './core';

/** The ledger: what the office writes down as work lands, digests of agents' sessions, and the report card. */
export class Ledger extends Part {
  /** The pull requests (prKey) whose merge or close is in the ledger: the office notices some more than once. */
  private landed = new Set<string>();
  /** Reads an agent session's Claude Code transcript by its id (missing in the demo, which has none). */
  readTranscript?: (sessionId: string) => Promise<string | undefined>;
  /** Reads each digested span for its frictions (Haiku); without one, digests carry the facts alone. */
  extractor?: Extractor;
  /** The agents' transcripts on this machine, for digesting the ones from before digests began. */
  transcripts?: (since: number) => Promise<Transcript[]>;
  private backfilling = false;
  /** Transcripts a backfill found nothing in: left out of the count from then on. */
  private emptyTranscripts = new Set<string>();
  /** Each session's digest in hand, so two of the same session never overlap. */
  private digesting = new Map<string, Promise<void>>();

  /** Writes a PR the office knows (QA reviewed it, or an agent or lead opened it) merging or closing in the ledger, once. */
  recordLanding(repo: string, number: number, merged: boolean, by: Closer = 'github', headSha?: string): void {
    const key = prKey(repo, number);
    if (this.landed.has(key)) return;
    const review = this.store.reviews.get(key);
    const lead = this.core.manager.leadWith(repo, number);
    const projectId = review?.projectId ?? lead?.projectId ?? this.core.manager.prOwner(repo, number)?.projectId;
    if (!projectId) return;
    this.landed.add(key);
    // merged on GitHub, the office doesn't know the final head: a goal's PR is at the commit its lead last shipped
    const head = headSha ?? lead?.lead?.prs.find((p) => p.repo === repo && p.number === number)?.sha;
    const qa = qaBadge(review, { headSha: head ?? '' }).state;
    // the issues it closed: as the board last saw them, and the one its developer was given
    const owner = this.core.manager.prOwner(repo, number);
    const onBoard = [...this.store.boards.values()].flatMap((b) => b.prs).find((p) => p.repo === repo && p.number === number)?.closes ?? [];
    const closes = [...new Set([...onBoard, ...(owner?.task === 'issue' ? [owner.issue.number] : [])])];
    const common = { repo, pr: number, goal: lead?.lead?.title, by, qa, failedRounds: review?.failedRounds ?? 0, triages: review?.triages ?? 0 };
    this.record(projectId, merged ? { kind: 'merged', ...common, ...(closes.length && { closes }) } : { kind: 'closed', ...common });
  }

  /**
   * Digests what's new in the agent's session since its last digest (`sessionDigest.ts`): when they go home, when QA
   * gives a verdict, and when a lead's slice lands. A span already digested comes out empty, so it's safe to call at
   * each; a cloud session's transcript isn't on this machine, so it isn't digested.
   */
  digestSession(agent: Agent, prs: { repo: string; pr: number }[]): void {
    const read = this.readTranscript;
    const sessionId = agent.sessionId;
    if (!read || !sessionId || agent.cloud) return;
    // as they are now: the agent may be gone by the time the transcript's read
    const who = { id: agent.id, name: agent.name, task: agent.task, sessionId, costUsd: agent.costUsd };
    const goal = agent.lead?.title ?? prs.map((p) => this.core.manager.leadWith(p.repo, p.pr)?.lead?.title).find(Boolean);
    const digest = async () => {
      const text = await read(sessionId);
      const span = text && transcriptSpan(text, lastDigest(this.store.ledger, sessionId)?.toUuid);
      if (!span || this.store.ledger.some((e) => e.kind === 'session-digest' && e.key === `${sessionId}:${span.toUuid}`)) return;
      const entry = digestEntry(span, who, prs, this.store.ledger, goal);
      this.record(agent.projectId, this.extractor ? await withFrictions(entry, text, this.store.ledger, this.extractor, this.store.settings) : entry);
    };
    const next = (this.digesting.get(sessionId) ?? Promise.resolve())
      .then(digest)
      .catch((err: unknown) => console.warn(`Couldn't digest ${agent.name}'s session ${sessionId}: ${errorMessage(err)}`));
    this.digesting.set(sessionId, next);
    void next.finally(() => {
      if (this.digesting.get(sessionId) === next) this.digesting.delete(sessionId);
    });
  }

  /**
   * The agents' transcripts on this machine that have no digest yet: what a backfill would read. A session still in
   * the office is left to be digested as it ends, and one a backfill found nothing in isn't counted again.
   */
  async undigested(): Promise<Transcript[]> {
    const digested = new Set(this.store.ledger.flatMap((e) => (e.kind === 'session-digest' ? [e.sessionId] : [])));
    const live = new Set([...this.store.agents.values()].flatMap((a) => (a.sessionId ? [a.sessionId] : [])));
    return (await this.transcripts?.(0) ?? []).filter((t) => !digested.has(t.sessionId) && !live.has(t.sessionId) && !this.emptyTranscripts.has(t.sessionId));
  }

  /**
   * Digests the transcripts on this machine from before digests began, a couple at a time, each dated by when its
   * session ended and marked backfilled. One backfill at a time; the captain hears when it starts and ends.
   */
  async backfill(): Promise<{ sessions: number }> {
    if (this.backfilling) throw new Refused({ message: 'Already digesting older sessions' });
    const pending = await this.undigested();
    if (!pending.length) return { sessions: 0 };
    this.backfilling = true;
    this.hub.toast('info', `🔧 Digesting ${pending.length} older sessions`);
    let done = 0;
    let empty = 0;
    let failed = 0;
    let costUsd = 0;
    const one = async (t: Transcript) => {
      const text = await t.read();
      const span = transcriptSpan(text);
      if (!span) {
        this.emptyTranscripts.add(t.sessionId);
        return void empty++;
      }
      if (this.store.ledger.some((e) => e.kind === 'session-digest' && e.sessionId === t.sessionId)) return;
      const who = backfillWho(t, text);
      const facts = digestEntry(span, { id: t.name, name: t.name.split('__')[0], task: who.task, sessionId: t.sessionId, costUsd: who.costUsd ?? 0 }, who.prs, this.store.ledger);
      const entry = { ...facts, facts: { ...facts.facts, costUsd: who.costUsd }, backfilled: true };
      const digest = this.extractor ? await withFrictions(entry, text, this.store.ledger, this.extractor, this.store.settings) : entry;
      costUsd += digest.extractCostUsd ?? 0;
      done++;
      this.record(who.projectId, digest, span.to ? Date.parse(span.to) : Date.now());
    };
    const queue = [...pending];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const name = t.name;
        await one(t).catch((err: unknown) => {
          failed++;
          console.warn(`Couldn't digest ${name}: ${errorMessage(err)}`);
        });
      }
    };
    void Promise.all([worker(), worker()]).finally(() => {
      this.backfilling = false;
      const besides = [empty && `${empty} had nothing in them`, failed && `${failed} couldn’t be read`].filter(Boolean).join(', ');
      this.hub.toast(failed ? 'error' : 'success', `🔧 Digested ${done} of ${pending.length} older sessions ($${costUsd.toFixed(2)})${besides ? `: ${besides}` : ''}`);
    });
    return { sessions: pending.length };
  }

  /** The pull requests an agent's session was for: a lead's slice's, the one QA reviewed, or the one a developer opened. */
  prsOf(agent: Agent): { repo: string; pr: number }[] {
    if (agent.lead) return agent.lead.prs.map((p) => ({ repo: p.repo, pr: p.number }));
    if (agent.task === 'review') return [{ repo: agent.repo, pr: agent.issue.number }];
    return agent.pr ? [{ repo: agent.repo, pr: agent.pr.number }] : [];
  }

  /** Writes an entry in the ledger, and shows the chief engineer the new report card. */
  record(projectId: string, entry: LedgerEntry, at = Date.now()): void {
    this.store.record({ ...entry, at, projectId });
    this.hub.send({ type: 'report', report: this.report() });
  }

  /** The ledger's last 30 days, summed up. */
  report(): ReportCard {
    const { problems, notes } = this.store.ledgerHealth;
    return { ...reportCard(this.store.ledger, Date.now()), ...(problems.length && { warnings: problems }), ...(notes.length && { notes }) };
  }
}
