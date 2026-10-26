import type { Agent, MergeAction, PullRequest } from '../../plugin-api/shared';

// Merging from Comms: the pull requests a card can merge, and what its merge button does, as the board's button does
// (`mergeAction`), so the captain merges where they read the lead's turn rather than going to the board. Pure, so
// it's tested (mergingRules.test.ts); the card (needCard.ts) presses it.

/** A pull request on a project's board. */
export interface BoardPr {
  projectId: string;
  pr: PullRequest;
}

/** The lead's pull requests still open, as the board has them: the ones the board doesn't show (yet) are left out. */
export function openPrsOf(lead: Pick<Agent, 'projectId' | 'lead'>, board: readonly BoardPr[]): BoardPr[] {
  return (lead.lead?.prs ?? []).flatMap((mine) => {
    if (mine.outcome) return [];
    const on = board.find((b) => b.projectId === lead.projectId && b.pr.repo === mine.repo && b.pr.number === mine.number);
    return on ? [on] : [];
  });
}

/** What a card's merge button says and does: merge (asking first when `confirm` says why), or merge once QA passes. */
export interface MergePress {
  label: string;
  title: string;
  /** What pressing it asks of Ops; none while it can't be pressed. */
  does?: { merge: { override: boolean; confirm?: string } } | { whenPassed: boolean };
  /** Its `data-act`, for Comms' keys: M presses the first `merge`. */
  act?: 'merge';
}

const where = (pr: Pick<PullRequest, 'repo' | 'number'>) => `${pr.repo.split('/')[1] ?? pr.repo}#${pr.number}`;

/**
 * The merge button for `pr`, from what the board's button would do (`action`): merge it now, past a refused check
 * (`override`), once QA passes it, or nothing while its merge is queued or checking, or while it's a draft or conflicts.
 * It asks first only when there's a reason to (QA hasn't passed its head, or a check refused it): a QA-passed PR merges
 * with one press, Ops' merge check guarding it as on the board.
 */
export function mergePress(action: MergeAction, pr: Pick<PullRequest, 'repo' | 'number' | 'title' | 'isDraft' | 'mergeable'>, method: string): MergePress {
  const blocked = pr.isDraft ? 'It’s a draft' : pr.mergeable === 'CONFLICTING' ? 'It conflicts with its base branch: resolve it on the board' : undefined;
  const can = (press: MergePress): MergePress => (blocked ? { label: press.label, title: blocked } : press);
  switch (action.kind) {
    case 'merge': {
      const confirm = action.confirm && `${action.confirm}.\n\nMerge ${where(pr)} “${pr.title}” anyway?`;
      const merge = { override: action.override === true, ...(confirm && { confirm }) };
      if (action.override) return can({ label: `Merge ${where(pr)} anyway`, title: 'Merge past its merge check, on purpose', does: { merge }, act: 'merge' });
      return can({ label: `${method} & merge ${where(pr)}`, title: 'Ops checks it merged onto its base first, then merges it (M)', does: { merge }, act: 'merge' });
    }
    case 'when-passed':
      return can({ label: `Merge ${where(pr)} when QA passes`, title: 'Ops merges the commit QA passes, or tells you if QA fails it', does: { whenPassed: true } });
    case 'requested':
      return { label: `Merging ${where(pr)} when QA passes ✕`, title: 'Merges once QA passes it. Press to cancel', does: { whenPassed: false } };
    case 'queued':
      return { label: action.behind ? `${where(pr)} queued behind #${action.behind}` : `${where(pr)} queued to merge`, title: 'Another merge in this repo goes first' };
    case 'checking':
      return { label: `Checking ${where(pr)}’s merge…`, title: 'Ops is running the checks on it merged onto its base' };
  }
}
