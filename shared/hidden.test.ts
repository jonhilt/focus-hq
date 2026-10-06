import { describe, expect, it } from 'vitest';
import { holodecks, isHidden, shownProjects, toastShows } from './hidden';
import type { Project } from './types';

const project = (id: string, hidden?: boolean): Project => ({
  id,
  name: `Project ${id}`,
  color: '#fff',
  repos: [`acme/${id}`],
  maxAgents: 2,
  autoAssign: false,
  autoLabel: '',
  createdAt: 0,
  ...(hidden !== undefined && { hidden }),
});

describe('hidden projects', () => {
  it('shows projects unless they are hidden', () => {
    expect(isHidden(project('a'))).toBe(false);
    expect(isHidden(project('a', false))).toBe(false);
    expect(isHidden(project('a', true))).toBe(true);
    expect(isHidden(undefined)).toBe(false);
    expect(shownProjects([project('a'), project('b', true), project('c')]).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('keeps a hidden project’s holodeck in use, so no room moves and no new one takes its place', () => {
    const a = project('a');
    const c = project('c');
    expect(holodecks([a, project('b', true), c], 4)).toEqual([
      { kind: 'project', project: a },
      { kind: 'in-use' },
      { kind: 'project', project: c },
      { kind: 'vacant' },
    ]);
  });

  it('never drops a project for want of slots', () => {
    expect(holodecks([project('a', true)], 0)).toEqual([{ kind: 'in-use' }]);
  });

  it('drops toasts about a hidden project, named outright or through its agent', () => {
    const projects = [project('a'), project('b', true)];
    const agentProject = (id: string) => ({ ag: 'a', bg: 'b' })[id];
    expect(toastShows({ projectId: 'b' }, projects, agentProject)).toBe(false);
    expect(toastShows({ agentId: 'bg' }, projects, agentProject)).toBe(false);
    expect(toastShows({ projectId: 'a' }, projects, agentProject)).toBe(true);
    expect(toastShows({ agentId: 'ag' }, projects, agentProject)).toBe(true);
    // ship-wide toasts, and agents the browser hasn't heard of, still show
    expect(toastShows({}, projects, agentProject)).toBe(true);
    expect(toastShows({ agentId: 'gone' }, projects, agentProject)).toBe(true);
  });
});
