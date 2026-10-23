// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Project, QaPlaybook } from '../../../shared/types';
import { checksList, fullPrompt, stepsList, whenQaRuns } from './qaPlaybook';

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

describe('the switches for when QA runs', () => {
  const project = (fields: Partial<Project> = {}): Project => ({ id: 'p1', name: 'Shop', color: '#f90', repos: ['acme/shop'], maxAgents: 3, autoAssign: false, autoLabel: '', createdAt: 0, ...fields });
  const recordSwitch = (switches: HTMLElement[]) => switches.find((s) => s.textContent?.startsWith('Record proof video'))!;

  it('starts Record proof video off, then saves it on with a click, saying what it now does', () => {
    const save = vi.fn();
    const row = recordSwitch(whenQaRuns(project(), save));
    const button = row.querySelector('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(row.textContent).toContain('no recording (Record proof video is off)');
    button.click();
    expect(save).toHaveBeenCalledWith({ qaVideo: true });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(row.textContent).toContain('every action at real speed, the waits between them fast-forwarded');
    button.click();
    expect(save).toHaveBeenLastCalledWith({ qaVideo: false });
  });

  it('shows it on for a project that records, and saves nothing until it’s clicked', () => {
    const save = vi.fn();
    const row = recordSwitch(whenQaRuns(project({ qaVideo: true }), save));
    expect(row.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(save).not.toHaveBeenCalled();
  });
});
