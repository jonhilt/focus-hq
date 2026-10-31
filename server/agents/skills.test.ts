import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { laneFloor } from '../../shared/mergeLaneRules';
import { installSkills, loadSkills, SKILLS_DIR, skillProblem, SkillFileError } from './skills';

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-skills-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const skill = (name: string, description = `Use it to ${name}.`) => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

const folderOf = (skills: Record<string, string>) => {
  const dir = tempDir();
  for (const [name, source] of Object.entries(skills)) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'SKILL.md'), source);
  }
  return dir;
};

describe('Focus’s skills', () => {
  it('has /ship-slice, which loads, with the exact commands the lead’s prompt no longer carries', () => {
    expect(loadSkills()).toContain('ship-slice');
    const shipSlice = fs.readFileSync(path.join(SKILLS_DIR, 'ship-slice', 'SKILL.md'), 'utf8');
    expect(shipSlice).toContain('gh pr create --draft');
    expect(shipSlice).toContain('gh pr ready');
    expect(shipSlice).toMatch(/Never push a base branch, or a branch whose pull request has merged/);
    // a fresh branch from the base mustn't track it, or a stray `git push` could land there
    expect(shipSlice).toContain('switch --no-track -c');
  });

  it('has /babysit-pr, which merges only through Ops, and only with the captain’s word', () => {
    expect(loadSkills()).toContain('babysit-pr');
    const babysit = fs.readFileSync(path.join(SKILLS_DIR, 'babysit-pr', 'SKILL.md'), 'utf8');
    expect(babysit).toContain('mcp__office__merge_when_passed');
    expect(babysit).toContain('If the captain told you to merge it');
    expect(babysit).not.toMatch(/gh pr merge|--approve/);
    // merge the base, never rebase or force: QA and Ops follow the branch's commits
    expect(babysit).toContain('git merge origin/<base>');
    expect(babysit).not.toMatch(/push --force|push -f\b/);
  });

  it('has /recap, whose lane floors are the ones Ops holds a recap to', () => {
    expect(loadSkills()).toContain('recap');
    const recap = fs.readFileSync(path.join(SKILLS_DIR, 'recap', 'SKILL.md'), 'utf8');
    expect(recap).toContain('mcp__office__recap');
    expect(recap).toContain('git -C <folder> diff --name-only origin/<base>...HEAD');
    const floors = (['composes', 'extends', 'adds'] as const).map((rollup) => `${rollup} → ${laneFloor(rollup)}`).join(', ');
    expect(recap).toContain(floors);
  });

  it('wants a skill named as its folder, saying when to use it', () => {
    expect(skillProblem('ship-slice', skill('ship-slice'), 'f')).toBeUndefined();
    expect(skillProblem('ship-slice', skill('open-pr'), 'f')).toMatch(/its name should be ship-slice/);
    expect(skillProblem('ship-slice', '---\nname: ship-slice\n---\n', 'f')).toMatch(/needs a description/);
    expect(skillProblem('Ship_Slice', skill('Ship_Slice'), 'f')).toMatch(/lowercase words joined by dashes/);
    expect(skillProblem('ship-slice', '# no frontmatter', 'f')).toMatch(/frontmatter/);
  });

  it('refuses a folder with a skill that’s wrong, or a folder with no SKILL.md, naming it', () => {
    expect(() => loadSkills(folderOf({ 'ship-slice': skill('open-pr') }))).toThrow(SkillFileError);
    const empty = tempDir();
    fs.mkdirSync(path.join(empty, 'ship-slice'));
    expect(() => loadSkills(empty)).toThrow(/ship-slice: a skill's folder holds its SKILL.md/);
  });

  it('copies every skill into a workspace’s .claude/skills, and takes away one Focus no longer has', () => {
    const workspace = tempDir();
    installSkills(workspace, folderOf({ 'ship-slice': skill('ship-slice'), 'old-one': skill('old-one') }));
    installSkills(workspace, folderOf({ 'ship-slice': skill('ship-slice', 'Use it to ship, now.') }));
    const installed = path.join(workspace, '.claude', 'skills');
    expect(fs.readdirSync(installed)).toEqual(['ship-slice']);
    expect(fs.readFileSync(path.join(installed, 'ship-slice', 'SKILL.md'), 'utf8')).toContain('Use it to ship, now.');
  });
});
