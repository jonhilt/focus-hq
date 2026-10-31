import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { isRecord } from '../../shared/records';
import { config } from '../config';
import { splitFrontmatter } from './crewFiles';

// Focus's skills, .focus/skills/<name>/SKILL.md in Focus's own checkout (.focus/skills/README.md): procedures a lead
// loads when it needs one, rather than reading them in its prompt every turn. They're checked once, as Focus starts
// (`readSkills`), and copied into a lead's workspace as each of its turns starts (`installSkills`), where Claude Code
// finds them as the project's own.

export const SKILLS_DIR = path.join(config.root, '.focus', 'skills');

/** Where Claude Code looks for a project's skills, under the folder a session runs in. */
const INSTALLED = path.join('.claude', 'skills');

/** What's wrong with a skill, naming its file the way an editor would. */
export class SkillFileError extends Error {}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A SKILL.md's problems, if any: its frontmatter must name it as its folder does, and say when to use it. */
export function skillProblem(folder: string, source: string, file: string): string | undefined {
  let fields: unknown;
  try {
    fields = parse(splitFrontmatter(source, file).frontmatter);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (!isRecord(fields)) return `${file}: its frontmatter has no fields`;
  if (!SKILL_NAME.test(folder)) return `${file}: a skill's folder is its name, in lowercase words joined by dashes`;
  if (fields.name !== folder) return `${file}: its name should be ${folder}, as its folder is`;
  if (typeof fields.description !== 'string' || !fields.description.trim()) return `${file}: it needs a description, saying when to use it`;
  return undefined;
}

/** The skills in `dir`, by name, each checked: throws a `SkillFileError` on the first that's wrong. */
export function loadSkills(dir = SKILLS_DIR): string[] {
  const shown = (name: string) => path.relative(config.root, path.join(dir, name));
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const folder of folders) {
    const file = path.join(dir, folder, 'SKILL.md');
    if (!fs.existsSync(file)) throw new SkillFileError(`${shown(folder)}: a skill's folder holds its SKILL.md`);
    const problem = skillProblem(folder, fs.readFileSync(file, 'utf8'), shown(path.join(folder, 'SKILL.md')));
    if (problem) throw new SkillFileError(problem);
  }
  return folders.sort();
}

/** Reads and checks Focus's skills now, as Focus starts: throws a `SkillFileError` on the first that's wrong. */
export const readSkills = (): void => void loadSkills();

/**
 * Focus's skills copied into `workspace`'s `.claude/skills/`, replacing what was there: the folder is Ops', so a skill
 * taken out of Focus goes from the workspace too. A copy of the checkout's files, kept nowhere else.
 */
export function installSkills(workspace: string, dir = SKILLS_DIR): void {
  const target = path.join(workspace, INSTALLED);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const name of loadSkills(dir)) fs.cpSync(path.join(dir, name), path.join(target, name), { recursive: true });
}
