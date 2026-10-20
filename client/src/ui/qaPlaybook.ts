import { repoChecksLine } from '../../../shared/qaPlaybook';
import type { QaPlaybook } from '../../../shared/types';
import { h } from './dom';

// The parts of the QA station's Playbook the server builds from QA's own instructions (GET /projects/:id/qa-playbook):
// its steps, what it runs on each repo, and the instructions in full. qaPanel.ts puts them beside QA's switches.

/** QA's steps in order, each title opening to the exact text QA gets. */
export function stepsList(playbook: QaPlaybook): HTMLElement {
  return h('ol', { class: 'qa-steps' }, ...playbook.steps.map((step) =>
    h('li', null, h('details', null, h('summary', null, step.title), h('pre', { class: 'qa-step-text' }, step.text)))));
}

/** What QA runs on each repo, and whether it follows a CLAUDE.md there. */
export function checksList(playbook: QaPlaybook): HTMLElement {
  return h('ul', { class: 'qa-repo-checks' }, ...playbook.repos.map((repo) =>
    h('li', null,
      h('strong', null, repo.repo),
      h('div', null, repoChecksLine(repo)),
      repo.cloned ? h('small', { class: 'muted' }, repo.claudeMd ? 'QA follows its CLAUDE.md.' : 'It has no CLAUDE.md at its root.') : null,
    )));
}

/** QA's instructions in full, folded away, and what else its session loads. */
export function fullPrompt(playbook: QaPlaybook, repo: string | undefined): HTMLElement {
  return h('details', { class: 'qa-prompt' },
    h('summary', null, 'Show the exact instructions QA gets'),
    h('p', { class: 'muted' },
      `As they'd be for a pull request #123 "Example PR"${repo ? ` in ${repo}` : ''}. QA's Claude Code session also loads the repo's CLAUDE.md, and your Claude Code settings (user, project and local), as every agent's does.`),
    h('pre', null, playbook.prompt));
}
