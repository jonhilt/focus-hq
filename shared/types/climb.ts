// Main engineering's climber (docs/climber.md): an agent who takes the scorecard's worst gap in Focus's own repo and
// ships one pull request for it at a time, while the captain keeps climbing switched on.

/** Every climb's branch starts with this, so the office knows a climb's pull request even after the climber has gone home. */
export const CLIMB_BRANCH = 'focus/climb-';

export const isClimbBranch = (branch: string | undefined) => !!branch?.startsWith(CLIMB_BRANCH);

export interface Climb {
  /** The captain's switch: while it's on, a new climb starts whenever none is open. */
  keepClimbing: boolean;
  /** Where the climbs are: the project and repo the office itself runs from. */
  projectId?: string;
  repo?: string;
  /** The climb under way: its climber (while they're in the office) and, once it's opened, its pull request. */
  agentId?: string;
  pr?: { number: number; url: string };
  /** Climbs started so far, and how the last one ended. */
  cycles: number;
  last?: { pr?: number; outcome: 'merged' | 'closed' | 'nothing' | 'failed'; at: number };
  /** Why the office switched climbing off by itself (a climb that found nothing to do, or failed). */
  stoppedWhy?: string;
}

export const freshClimb = (): Climb => ({ keepClimbing: false, cycles: 0 });
