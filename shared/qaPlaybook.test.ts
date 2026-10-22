import { describe, expect, it } from 'vitest';
import { qaSwitchSays, qaWhoLine, repoChecksLine } from './qaPlaybook';

describe('qaSwitchSays', () => {
  it('says when QA runs, either way', () => {
    expect(qaSwitchSays('autoQa', false)).toBe('Runs only when you press Send to QA on a pull request (Test every PR is off).');
    expect(qaSwitchSays('autoQa', true)).toContain('Tests every pull request the crew opens');
  });

  it('says what happens to a fail and to a pass', () => {
    expect(qaSwitchSays('autoSendBack', false)).toContain('comes to you');
    expect(qaSwitchSays('qaProof', true)).toContain('only with proof');
    expect(qaSwitchSays('qaProof', false)).toContain('own judgement');
    expect(qaSwitchSays('autoMerge', false)).toContain('you merge from the board');
    expect(qaSwitchSays('autoMerge', true)).toContain('merge check passes');
    expect(qaSwitchSays('checkMerges', true)).toContain('one merge at a time');
    expect(qaSwitchSays('checkMerges', false)).toContain('straight to GitHub');
  });
});

describe('qaWhoLine', () => {
  it('names the QA model and where it’s set', () => {
    expect(qaWhoLine({ model: 'claude-opus-5-5', qaModel: 'claude-sonnet-5-5' }, 'high')).toBe('Works on claude-sonnet-5-5 (Model for QA, in the manager’s Settings), thinking at high effort.');
  });

  it('falls back to Focus’s model, then Claude Code’s default, and the model’s own effort', () => {
    expect(qaWhoLine({ model: 'claude-opus-5-5', qaModel: '' }, undefined)).toContain('Works on claude-opus-5-5 (Focus’s Model');
    expect(qaWhoLine({ model: '', qaModel: '' }, undefined)).toBe('Works on Claude Code’s default model, thinking as hard as the model does by default.');
  });
});

describe('repoChecksLine', () => {
  const repo = { repo: 'acme/shop', cloned: true, packageJson: true, claudeMd: true, commands: ['pnpm run lint', 'pnpm test'] };

  it('lists the commands QA runs', () => {
    expect(repoChecksLine(repo)).toBe('Runs pnpm run lint, pnpm test, and anything else the repo’s CLAUDE.md asks.');
  });

  it('says QA works them out when Ops can’t tell', () => {
    expect(repoChecksLine({ ...repo, cloned: false, commands: [] })).toContain('hasn’t cloned it');
    expect(repoChecksLine({ ...repo, packageJson: false, commands: [] })).toBe('QA works out the checks itself (no package.json).');
    expect(repoChecksLine({ ...repo, commands: [] })).toContain('none of the merge checks');
  });
});
