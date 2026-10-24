import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREW_DIR, CrewFileError, durationMs, loadCrew, parseCrewFile } from './crewFiles';
import { CREW_ROLES } from './crewRoles';

const lead = (front: string, body = '# You are {{name}}, a lead on {{project}}\n') => `---\n${front}\n---\n${body}`;
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof CrewFileError) return err.message;
    throw err;
  }
  return undefined;
};

describe('the crew’s files', () => {
  it('has every role’s, each of which loads', () => {
    const crew = loadCrew(CREW_DIR, CREW_ROLES);
    expect([...crew.keys()].sort()).toEqual(Object.keys(CREW_ROLES).sort());
    for (const file of crew.values()) expect(file.description).not.toBe('');
  });

  it('reads a file’s description, prompt and texts', () => {
    const file = parseCrewFile(CREW_ROLES.lead, 'lead', lead('description: A lead.'), 'lead.md');
    expect(file).toMatchObject({ role: 'lead', description: 'A lead.', settings: {} });
  });

  it('names the file and the line in the body where a prompt refers to what its role hasn’t got', () => {
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('description: A lead.\n# a comment', 'first\n\nthird {{nmae}}\n'), '.focus/crew/lead.md'))).toBe(
      ".focus/crew/lead.md:7: {{nmae}} isn't something this role's prompt can refer to: it has name, project, station, publicWordsRule, scratchRule, waitRule",
    );
  });

  it('wants its frontmatter, and a description in it', () => {
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', '# no frontmatter', 'lead.md'))).toBe('lead.md:1: starts with its frontmatter, between two --- lines');
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('model: x: y'), 'lead.md'))).toContain("lead.md: its frontmatter isn't YAML");
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('[1, 2]'), 'lead.md'))).toContain('its frontmatter is a map');
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('maxTurns: 3'), 'lead.md'))).toContain('description says, in a line, who this role is');
  });

  it('refuses a setting that isn’t one, or that nothing reads for the role', () => {
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('description: A lead.\nmodle: opus'), 'lead.md'))).toContain("modle isn't a crew file setting");
    expect(error(() => parseCrewFile(CREW_ROLES.lead, 'lead', lead('description: A lead.\nmodel: opus'), 'lead.md'))).toContain("model isn't read for this role yet");
  });

  it('wants every text its role picks between, and no others, each checked', () => {
    const worker = fs.readFileSync(path.join(CREW_DIR, 'worker.md'), 'utf8');
    expect(error(() => parseCrewFile(CREW_ROLES.worker, 'worker', worker.replace(/^ {4}fix: \|-\n.*\n/m, ''), 'worker.md'))).toBe('worker.md: texts is missing assignment.fix');
    expect(error(() => parseCrewFile(CREW_ROLES.worker, 'worker', worker.replace('  summary:\n', '  extra: hi\n  summary:\n'), 'worker.md'))).toContain("texts has extra, which this role doesn't use");
    expect(error(() => parseCrewFile(CREW_ROLES.worker, 'worker', worker.replace('GitHub issue #{{number}}', 'GitHub issue #{{name}}'), 'worker.md'))).toContain("worker.md: texts.assignment.issue: {{name}} isn't something");
  });

  it('gives the same words the same digest, and other words another, whatever the description says', () => {
    const digest = (front: string, body?: string) => parseCrewFile(CREW_ROLES.lead, 'lead', lead(front, body), 'lead.md').digest;
    expect(digest('description: A lead.')).toMatch(/^[0-9a-f]{8}$/);
    expect(digest('description: A lead.')).toBe(digest('description: Someone else.'));
    expect(digest('description: A lead.', '# You are {{name}}, a lead\n')).not.toBe(digest('description: A lead.'));
    const worker = fs.readFileSync(path.join(CREW_DIR, 'worker.md'), 'utf8');
    const workerDigest = (src: string) => parseCrewFile(CREW_ROLES.worker, 'worker', src, 'worker.md').digest;
    expect(workerDigest(worker.replace('it failed QA', 'QA failed it'))).not.toBe(workerDigest(worker));
  });

  it('reads a timeout as a time', () => {
    expect([durationMs('90s'), durationMs('8m'), durationMs(' 2h '), durationMs('1.5m')]).toEqual([90_000, 480_000, 7_200_000, 90_000]);
    expect([durationMs('8'), durationMs('m'), durationMs(8), durationMs('8 minutes')]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('refuses a folder with a file no role has, or missing a role’s', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
    for (const name of fs.readdirSync(CREW_DIR)) fs.copyFileSync(path.join(CREW_DIR, name), path.join(dir, name));
    fs.writeFileSync(path.join(dir, 'leed.md'), lead('description: A typo.'));
    expect(error(() => loadCrew(dir, CREW_ROLES))).toContain("leed.md: no crew role has that name: they're lead, worker");
    fs.rmSync(path.join(dir, 'leed.md'));
    fs.rmSync(path.join(dir, 'worker.md'));
    expect(error(() => loadCrew(dir, CREW_ROLES))).toContain('worker.md: missing: every crew role has its file');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
