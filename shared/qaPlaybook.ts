import { qaAgentModel } from './qa';
import type { Effort, QaRepoChecks, Settings } from './types';

// The QA station's Playbook in plain words: what each of QA's switches means as it's set, who QA is and how hard it
// thinks, and what it runs on each repo. Pure, so it's unit tested (shared/qaPlaybook.test.ts); client/src/ui/qaPanel.ts
// shows it beside the steps and instructions the server builds from QA's prompt (`qaPlaybook` in server/agents/qa.ts).

/** QA's switches at the QA station, by the project field each sets. */
export type QaSwitch = 'autoQa' | 'autoSendBack' | 'qaProof' | 'autoMerge' | 'checkMerges';

/** What a switch means for the project, set as it is (`on`). */
export function qaSwitchSays(which: QaSwitch, on: boolean): string {
  switch (which) {
    case 'autoQa':
      return on
        ? 'Tests every pull request the crew opens or pushes to, by itself, and any you press Send to QA on.'
        : 'Runs only when you press Send to QA on a pull request (Test every PR is off).';
    case 'autoSendBack':
      return on
        ? 'A pull request the crew opened that fails goes back to its developer to fix, and QA tests the fix: up to 3 rounds.'
        : 'A failed pull request comes to you: nobody is sent to fix it (Send failed PRs back is off).';
    case 'qaProof':
      return on
        ? 'Fails a pull request only with proof Ops checks itself: a test that fails when it runs it, a failing check, or a screenshot of a broken page. Findings without proof go on the PR as advice.'
        : 'Fails a pull request on its own judgement, no proof needed (Block only with proof is off).';
    case 'autoMerge':
      return on
        ? 'Merges a pull request the crew opened once QA passed its latest commit, its checks are green and its merge check passes.'
        : 'Nothing merges by itself: you merge from the board (Auto-merge is off).';
    case 'checkMerges':
      return on
        ? 'Before each merge, Ops merges the pull request onto its base and runs these scripts on the result, one merge at a time in each repo.'
        : 'Merges go straight to GitHub, with no trial merge and no wait behind other merges (Check merges is off). QA still runs these scripts.';
  }
}

/** Which model QA works on and how hard it thinks, from Focus's settings and the project's QA effort. */
export function qaWhoLine(settings: Pick<Settings, 'model' | 'qaModel'>, effort: Effort | undefined): string {
  const model = qaAgentModel(settings);
  const from = settings.qaModel.trim() ? ' (Model for QA, in the manager’s Settings)' : model ? ' (Focus’s Model: set Model for QA in the manager’s Settings for another)' : '';
  return `Works on ${model ?? 'Claude Code’s default model'}${from}, thinking ${effort ? `at ${effort} effort` : 'as hard as the model does by default'}.`;
}

/** What QA runs on a repo, in a sentence. */
export function repoChecksLine(repo: QaRepoChecks): string {
  if (!repo.cloned) return 'QA works out the checks itself (Ops hasn’t cloned it yet, so it can’t say).';
  if (!repo.packageJson) return 'QA works out the checks itself (no package.json).';
  if (!repo.commands.length) return 'QA works out the checks itself (its package.json has none of the merge checks).';
  return `Runs ${repo.commands.join(', ')}, and anything else the repo’s CLAUDE.md asks.`;
}
