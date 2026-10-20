// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { QaPlaybook } from '../../../shared/types';
import { checksList, fullPrompt, stepsList } from './qaPlaybook';

const playbook: QaPlaybook = {
  steps: [
    { title: 'Works out the acceptance criteria', text: 'Read the PR description and the linked issue.' },
    { title: 'Runs the checks', text: 'Install dependencies if needed, then run these checks: `pnpm test`.' },
  ],
  repos: [
    { repo: 'acme/shop', cloned: true, packageJson: true, claudeMd: true, commands: ['pnpm test'] },
    { repo: 'acme/api', cloned: true, packageJson: false, claudeMd: false, commands: [] },
    { repo: 'acme/docs', cloned: false, packageJson: false, claudeMd: false, commands: [] },
  ],
  prompt: '# You are Lt. Q, QA officer for Shop aboard the Focus',
};

describe('the QA Playbook', () => {
  it('lists the steps by title, each opening to its exact text', () => {
    const list = stepsList(playbook);
    const steps = [...list.querySelectorAll('li')];
    expect(steps.map((li) => li.querySelector('summary')?.textContent)).toEqual(['Works out the acceptance criteria', 'Runs the checks']);
    expect(steps[1].querySelector('pre')?.textContent).toBe(playbook.steps[1].text);
    expect(steps.every((li) => !li.querySelector('details')?.open)).toBe(true);
  });

  it('says what QA runs on each repo and whether it follows a CLAUDE.md', () => {
    const rows = [...checksList(playbook).querySelectorAll('li')].map((li) => li.textContent);
    expect(rows[0]).toContain('Runs pnpm test');
    expect(rows[0]).toContain('QA follows its CLAUDE.md.');
    expect(rows[1]).toContain('QA works out the checks itself (no package.json).');
    expect(rows[1]).toContain('no CLAUDE.md');
    expect(rows[2]).toContain('hasn’t cloned it');
  });

  it('folds the whole instructions away, saying what else QA loads', () => {
    const prompt = fullPrompt(playbook, 'acme/shop');
    expect((prompt as HTMLDetailsElement).open).toBe(false);
    expect(prompt.querySelector('summary')?.textContent).toBe('Show the exact instructions QA gets');
    expect(prompt.querySelector('pre')?.textContent).toBe(playbook.prompt);
    expect(prompt.textContent).toContain('in acme/shop');
    expect(prompt.textContent).toContain('CLAUDE.md, and your Claude Code settings (user, project and local)');
  });
});
