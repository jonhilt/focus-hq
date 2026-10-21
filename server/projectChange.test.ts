import { describe, expect, it } from 'vitest';
import type { Project } from '../shared/types';
import { changeProject, projectChangeFollowUps } from './projectChange';

const project: Project = {
  id: 'proj_1',
  name: 'Sock Shop',
  color: '#ff8a5b',
  theme: 'beach',
  repos: ['o/a', 'o/b'],
  mergeMethods: { 'o/b': 'merge' },
  maxAgents: 2,
  autoAssign: false,
  autoLabel: '',
  onlyMyPrs: false,
  preview: { command: 'npm run dev' },
  autoQa: true,
  autoSendBack: true,
  autoMerge: false,
  qaBrief: 'Check the basket.',
  hidden: false,
  qaEffort: 'high',
  plugins: ['flow'],
  createdAt: 1,
};

describe('changeProject', () => {
  it('takes each field the change gets right, trimming the text', () => {
    const changed = changeProject(project, {
      name: ' Sock Shop 2 ',
      color: '#00ff00',
      theme: 'moon',
      maxAgents: 1,
      autoAssign: true,
      autoLabel: ' auto ',
      onlyMyPrs: true,
      autoQa: false,
      autoSendBack: false,
      autoMerge: true,
      cosAutoSend: true,
      qaProof: false,
      qaBrief: 'Check checkout.',
      hidden: true,
      qaEffort: 'max',
    });
    expect(changed).toEqual({
      ...project,
      name: 'Sock Shop 2',
      color: '#00ff00',
      theme: 'moon',
      maxAgents: 1,
      autoAssign: true,
      autoLabel: 'auto',
      onlyMyPrs: true,
      autoQa: false,
      autoSendBack: false,
      autoMerge: true,
      cosAutoSend: true,
      qaProof: false,
      qaBrief: 'Check checkout.',
      hidden: true,
      qaEffort: 'max',
    });
  });

  it('leaves what the change doesn’t mention, and the project it was given, as they were', () => {
    const before = structuredClone(project);
    expect(changeProject(project, {})).toEqual(project);
    expect(changeProject(project, null)).toEqual(project);
    expect(changeProject(project, 'rename')).toEqual(project);
    expect(changeProject(project, { name: 'Renamed', plugin: { id: 'cartography', on: true } })).not.toEqual(project);
    expect(project).toEqual(before);
  });

  it('ignores a field of the wrong kind, rather than saving it', () => {
    const wrong = {
      name: 5,
      color: { x: 1 },
      maxAgents: 'lots',
      autoAssign: 'no',
      autoLabel: null,
      onlyMyPrs: 1,
      autoQa: 'yes',
      autoSendBack: 0,
      autoMerge: 'true',
      qaBrief: ['a'],
      hidden: 'yes',
      preview: 'npm start',
    };
    expect(changeProject(project, wrong)).toEqual(project);
    expect(changeProject(project, { maxAgents: Number.NaN }).maxAgents).toBe(2);
    expect(changeProject(project, { maxAgents: Number.POSITIVE_INFINITY }).maxAgents).toBe(2);
  });

  it('keeps the name when the new one is blank', () => {
    expect(changeProject(project, { name: '   ' }).name).toBe('Sock Shop');
    expect(changeProject(project, { color: '' }).color).toBe('#ff8a5b');
  });

  it('keeps the limit on agents a whole number from 1 to the room’s desks', () => {
    expect(changeProject(project, { maxAgents: 0 }).maxAgents).toBe(1);
    expect(changeProject(project, { maxAgents: 99 }).maxAgents).toBe(2);
    expect(changeProject(project, { maxAgents: 1.4 }).maxAgents).toBe(1);
  });

  it('keeps QA’s brief to 4000 characters, and an empty or unknown effort goes back to the model’s default', () => {
    expect(changeProject(project, { qaBrief: 'x'.repeat(5000) }).qaBrief).toHaveLength(4000);
    expect(changeProject(project, { qaEffort: '' }).qaEffort).toBeUndefined();
    expect(changeProject(project, { qaEffort: 'huge' }).qaEffort).toBeUndefined();
  });

  it('refuses an unknown theme', () => {
    expect(() => changeProject(project, { theme: 'volcano' })).toThrow('Unknown room theme volcano');
  });

  it('switches one plugin at a time, and refuses a bad id', () => {
    expect(changeProject(project, { plugin: { id: 'cartography', on: true } }).plugins).toEqual(['flow', 'cartography']);
    expect(changeProject(project, { plugin: { id: 'flow', on: false } }).plugins).toEqual([]);
    expect(changeProject(project, { plugin: { id: 'flow', on: 'no' } }).plugins).toEqual([]);
    expect(() => changeProject(project, { plugin: { id: 'No Such', on: true } })).toThrow('isn’t a plugin’s id');
    expect(() => changeProject(project, { plugin: true })).toThrow('isn’t a plugin’s id');
  });

  it('sets or clears a connected repo’s merge method, and refuses one for a repo it hasn’t connected', () => {
    expect(changeProject(project, { mergeMethod: { repo: 'o/a', method: 'rebase' } }).mergeMethods).toEqual({ 'o/a': 'rebase', 'o/b': 'merge' });
    expect(changeProject(project, { mergeMethod: { repo: 'o/b', method: '' } }).mergeMethods).toEqual({});
    expect(changeProject(project, { mergeMethod: { repo: 'o/b', method: 'fast' } }).mergeMethods).toEqual({});
    expect(() => changeProject(project, { mergeMethod: { repo: 'o/c', method: 'squash' } })).toThrow('o/c isn’t connected to Sock Shop');
    expect(() => changeProject(project, { mergeMethod: 'squash' })).toThrow('isn’t connected');
  });

  it('takes the preview’s commands trimmed, an empty one going back to the default, and null clearing them', () => {
    expect(changeProject(project, { preview: { command: ' ./stack up ', stopCommand: ' ', statusCommand: 3 } }).preview).toEqual({
      command: './stack up',
      stopCommand: undefined,
      statusCommand: undefined,
    });
    expect(changeProject(project, { preview: null }).preview).toEqual({ command: undefined, stopCommand: undefined, statusCommand: undefined });
  });
});

describe('changeProject: merge checks', () => {
  it('takes the merge check’s scripts as a list or a line, leaving out what isn’t a script’s name', () => {
    expect(changeProject(project, { mergeChecks: ['typecheck', ' test ', 'rm -rf /', 3, 'test'] }).mergeChecks).toEqual(['typecheck', 'test']);
    expect(changeProject(project, { mergeChecks: 'lint, test:unit' }).mergeChecks).toEqual(['lint', 'test:unit']);
  });

  it('runs none for an empty list, goes back to the default for null, and ignores anything else', () => {
    expect(changeProject(project, { mergeChecks: [] }).mergeChecks).toEqual([]);
    expect(changeProject({ ...project, mergeChecks: ['lint'] }, { mergeChecks: null }).mergeChecks).toBeUndefined();
    expect(changeProject({ ...project, mergeChecks: ['lint'] }, { mergeChecks: 7 }).mergeChecks).toEqual(['lint']);
  });
});

describe('projectChangeFollowUps', () => {
  it('tells the office’s plugins when one is switched', () => {
    expect(projectChangeFollowUps({ plugin: { id: 'flow', on: true } }).plugins).toBe(true);
    expect(projectChangeFollowUps({ name: 'x' }).plugins).toBe(false);
  });

  it('seats agents again when auto-assign or auto-merge goes on, or the limit on agents changes', () => {
    expect(projectChangeFollowUps({ autoAssign: true }).schedule).toBe(true);
    expect(projectChangeFollowUps({ autoMerge: true }).schedule).toBe(true);
    expect(projectChangeFollowUps({ maxAgents: 1 }).schedule).toBe(true);
    expect(projectChangeFollowUps({ autoAssign: false, autoMerge: false }).schedule).toBe(false);
    expect(projectChangeFollowUps({ autoAssign: 'no' }).schedule).toBe(false);
    expect(projectChangeFollowUps(null)).toEqual({ plugins: false, schedule: false, holdSends: false });
  });

  it('holds the chief of staff’s words counting down to go by themselves once auto-send goes off', () => {
    expect(projectChangeFollowUps({ cosAutoSend: false }).holdSends).toBe(true);
    expect(projectChangeFollowUps({ cosAutoSend: true }).holdSends).toBe(false);
    expect(projectChangeFollowUps({ name: 'x' }).holdSends).toBe(false);
  });
});
