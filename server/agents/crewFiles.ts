import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EFFORT_LEVELS, type Effort } from '../../shared/types';
import { isOneOf, isRecord } from '../../shared/records';
import { config } from '../config';
import { CREW_ROLES, type CrewRole, type CrewRoleName, type CrewSettingKey } from './crewRoles';
import { SCRATCH_RULE } from './scratch';
import { WAIT_RULE } from './wait';
import { PUBLIC_WORDS_RULE } from '../../shared/wording';
import { checkTemplate, parseTemplate, renderTemplate, type Template, TemplateError, type TemplateValues, type TemplateVars } from './crewTemplate';

// The crew's files, .focus/crew/<role>.md in Focus's own checkout (.focus/crew/README.md): each one's frontmatter
// holds its settings and short texts, its body its system prompt. They're read and checked once, when Focus starts
// (`loadCrew`), so a broken one stops Focus with the file and line at fault rather than reaching an agent.

export const CREW_DIR = path.join(config.root, '.focus', 'crew');

/** The settings a crew file gives: the captain's own (~/.focus/state.json) still win where they set one. */
export interface CrewSettings {
  model?: string;
  effort?: Effort;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface CrewFile {
  role: string;
  description: string;
  settings: CrewSettings;
  prompt: Template;
  texts: Readonly<Record<string, Template>>;
  /** Its prompt's and texts' words in short (8 hex digits): a different digest means the role was told something else. */
  digest: string;
}

/** What's wrong with a crew file, naming it (and the line, where there is one) the way an editor would. */
export class CrewFileError extends Error {}

const fail = (file: string, message: string, line?: number): never => {
  throw new CrewFileError(`${file}${line ? `:${line}` : ''}: ${message}`);
};

/** `source` split at its frontmatter (between `---` lines, first thing in the file), and the line its body starts on. */
export function splitFrontmatter(source: string, file: string): { frontmatter: string; body: string; bodyLine: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!m) return fail(file, 'starts with its frontmatter, between two --- lines', 1);
  return { frontmatter: m[1], body: source.slice(m[0].length), bodyLine: (m[0].match(/\n/g)?.length ?? 0) + 1 };
}

/** "8m", "90s" or "2h" in milliseconds, or undefined when it isn't one. */
export function durationMs(value: unknown): number | undefined {
  const m = typeof value === 'string' ? /^(\d+(?:\.\d+)?)\s*(s|m|h)$/.exec(value.trim()) : undefined;
  const unit: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
  return m ? Number(m[1]) * (unit[m[2]] ?? 0) : undefined;
}

/** Each setting's check: its value as Ops reads it, or an error saying what it should be. */
const SETTINGS: Record<CrewSettingKey, (value: unknown) => Partial<CrewSettings> | string> = {
  model: (v) => (typeof v === 'string' && v.trim() ? { model: v.trim() } : 'model is a model id, like claude-haiku-4-5-20251001'),
  effort: (v) => (isOneOf(EFFORT_LEVELS, v) ? { effort: v } : `effort is one of ${EFFORT_LEVELS.join(', ')}`),
  maxTurns: (v) => (Number.isInteger(v) && Number(v) > 0 ? { maxTurns: Number(v) } : 'maxTurns is a whole number above 0'),
  timeout: (v) => {
    const ms = durationMs(v);
    return ms && ms > 0 ? { timeoutMs: ms } : 'timeout is a time like 90s, 8m or 2h';
  },
};

const isSetting = (key: string): key is CrewSettingKey => key in SETTINGS;

/** The frontmatter's settings, each one the role reads and checked. */
function settingsOf(fields: Record<string, unknown>, role: CrewRole, file: string): CrewSettings {
  const settings: CrewSettings = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'description' || key === 'texts') continue;
    if (!isSetting(key)) return fail(file, `${key} isn't a crew file setting: they're description, texts, ${Object.keys(SETTINGS).join(', ')}`);
    if (!role.settings?.some((s) => s === key)) return fail(file, `${key} isn't read for this role yet, so setting it would do nothing`);
    const read = SETTINGS[key](value);
    if (typeof read === 'string') return fail(file, read);
    Object.assign(settings, read);
  }
  return settings;
}

/** `texts:` flattened to dotted names (`assignment.issue`), each a string. */
function flatTexts(value: unknown, file: string, prefix = ''): [string, string][] {
  if (value === undefined && !prefix) return [];
  if (!isRecord(value)) return fail(file, `texts${prefix && `.${prefix.slice(0, -1)}`} is a map of names to texts`);
  return Object.entries(value).flatMap(([key, v]): [string, string][] => (typeof v === 'string' ? [[`${prefix}${key}`, v]] : flatTexts(v, file, `${prefix}${key}.`)));
}

/** A template parsed and checked against `vars`, its errors told as `file`'s, `where` saying which part of it. */
function template(src: string, vars: TemplateVars, file: string, where: { line: number } | { text: string }): Template {
  try {
    const parsed = parseTemplate(src, 'line' in where ? where.line : 1);
    const wrong = checkTemplate(parsed, vars);
    if (wrong) throw wrong;
    return parsed;
  } catch (err) {
    if (!(err instanceof TemplateError)) throw err;
    return 'line' in where ? fail(file, err.message, err.line) : fail(file, `texts.${where.text}: ${err.message}`);
  }
}

/** The role's texts, every one it needs and no others, each checked. */
function textsOf(value: unknown, role: CrewRole, file: string): Record<string, Template> {
  const given = new Map(flatTexts(value, file));
  const wanted = role.texts ?? [];
  const missing = wanted.filter((name) => !given.has(name));
  if (missing.length) fail(file, `texts is missing ${missing.join(', ')}`);
  const extra = [...given.keys()].filter((name) => !wanted.includes(name));
  if (extra.length) fail(file, `texts has ${extra.join(', ')}, which this role doesn't use${wanted.length ? `: its texts are ${wanted.join(', ')}` : ''}`);
  return Object.fromEntries([...given].map(([name, src]) => [name, template(src, role.textVars ?? role.vars, file, { text: name })]));
}

/** What a prompt's words come to, short: the same words always give the same digest, and any change gives another. */
const digestOf = (body: string, texts: [string, string][]): string =>
  createHash('sha256').update(JSON.stringify([body, ...texts])).digest('hex').slice(0, 8);

/** A crew file's source, read and checked as the role `spec` describes: `file` is how errors name it. */
export function parseCrewFile(spec: CrewRole, role: string, source: string, file: string): CrewFile {
  const { frontmatter, body, bodyLine } = splitFrontmatter(source, file);
  let fields: unknown;
  try {
    fields = parse(frontmatter) ?? {};
  } catch (err) {
    return fail(file, `its frontmatter isn't YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(fields)) return fail(file, 'its frontmatter is a map of settings', 2);
  const description = typeof fields.description === 'string' ? fields.description.trim() : '';
  if (!description) fail(file, 'description says, in a line, who this role is');
  return {
    role,
    description,
    settings: settingsOf(fields, spec, file),
    texts: textsOf(fields.texts, spec, file),
    prompt: template(body, spec.vars, file, { line: bodyLine }),
    digest: digestOf(body, flatTexts(fields.texts, file)),
  };
}

/**
 * Every role's file in `dir` (`<role>.md`), read and checked; a file there that's no role's is an error too (a misspelt
 * name, say). A README.md is the folder's own.
 */
export function loadCrew<Roles extends Record<string, CrewRole>>(dir: string, roles: Roles): Map<string, CrewFile> {
  const shown = (name: string) => path.relative(config.root, path.join(dir, name)) || name;
  const names = Object.keys(roles);
  const stray = fs.readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md' && !names.includes(name.slice(0, -3)));
  if (stray.length) throw new CrewFileError(`${stray.map(shown).join(', ')}: no crew role has that name: they're ${names.join(', ')}`);
  return new Map(
    Object.entries(roles).map(([role, spec]) => {
      const file = path.join(dir, `${role}.md`);
      if (!fs.existsSync(file)) throw new CrewFileError(`${shown(`${role}.md`)}: missing: every crew role has its file`);
      return [role, parseCrewFile(spec, role, fs.readFileSync(file, 'utf8'), shown(`${role}.md`))];
    }),
  );
}

type TextName<S> = S extends { texts: readonly (infer T extends string)[] } ? T : never;
type TextVarsOf<S extends CrewRole> = S extends { textVars: infer V extends TemplateVars } ? V : S['vars'];

/** A folder of crew files, `<role>.md` for each of `roles`, read and checked the first time one's asked for (or at `check`). */
export interface CrewFolder<Roles extends Record<string, CrewRole>> {
  /** Reads and checks every file now: throws a `CrewFileError` on the first that's wrong. */
  check(): void;
  file(role: keyof Roles & string): CrewFile;
  /** The role's system prompt, filled in. */
  prompt<R extends keyof Roles & string>(role: R, values: TemplateValues<Roles[R]['vars']>): string;
  /** One of the role's texts, filled in. */
  text<R extends keyof Roles & string>(role: R, name: TextName<Roles[R]>, values: TemplateValues<TextVarsOf<Roles[R]>>): string;
}

export function crewFolder<Roles extends Record<string, CrewRole>>(dir: string, roles: Roles): CrewFolder<Roles> {
  let loaded: Map<string, CrewFile> | undefined;
  const file = (role: string): CrewFile => {
    loaded ??= loadCrew(dir, roles);
    const found = loaded.get(role);
    if (!found) throw new CrewFileError(`${path.relative(config.root, path.join(dir, `${role}.md`))} wasn't loaded`);
    return found;
  };
  return {
    check: () => {
      loaded = loadCrew(dir, roles);
    },
    file,
    prompt: (role, values) => renderTemplate(file(role).prompt, values),
    text: (role, name, values) => {
      const text = file(role).texts[name];
      if (!text) throw new CrewFileError(`${role}.md has no texts.${name}`);
      return renderTemplate(text, values);
    },
  };
}

/** The rules more than one prompt shares, for the crew files that say `{{scratchRule}}` and so on. */
export const CREW_RULES = { publicWordsRule: PUBLIC_WORDS_RULE, scratchRule: SCRATCH_RULE, waitRule: WAIT_RULE };

/** The core's crew, in .focus/crew/. */
const CREW = crewFolder(CREW_DIR, CREW_ROLES);

/** Reads and checks the core's crew files now, as Focus starts: throws a `CrewFileError` on the first that's wrong. */
export const readCrew = (): void => CREW.check();

export const crewFile = (role: CrewRoleName): CrewFile => CREW.file(role);
export const crewPrompt: CrewFolder<typeof CREW_ROLES>['prompt'] = (role, values) => CREW.prompt(role, values);
export const crewText: CrewFolder<typeof CREW_ROLES>['text'] = (role, name, values) => CREW.text(role, name, values);
