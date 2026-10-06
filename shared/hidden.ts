import type { Project } from './types';

// Hidden projects (Project.hidden): out of sight while you demo the office, without closing them or moving any other
// holodeck. Pure, so it's unit tested (shared/hidden.test.ts).

export const isHidden = (project: Pick<Project, 'hidden'> | undefined): boolean => project?.hidden === true;

/** The projects that show aboard, in holodeck order. */
export const shownProjects = <P extends Pick<Project, 'hidden'>>(projects: P[]): P[] => projects.filter((p) => !isHidden(p));

/** What a holodeck down the corridor holds: a project's room, a hidden project behind locked doors, or nothing yet. */
export type Holodeck = { kind: 'project'; project: Project } | { kind: 'in-use' } | { kind: 'vacant' };

/**
 * The corridor's `slots` holodecks, in order. A hidden project keeps its slot (in use, with nothing to say whose), so
 * hiding or showing one never moves another room, and no new project takes its place.
 */
export function holodecks(projects: Project[], slots: number): Holodeck[] {
  return Array.from({ length: Math.max(slots, projects.length) }, (_, i): Holodeck => {
    const project = projects[i];
    if (!project) return { kind: 'vacant' };
    return isHidden(project) ? { kind: 'in-use' } : { kind: 'project', project };
  });
}

/** Whether a toast may show: not when it's about a hidden project, named by the toast or through its agent's project. */
export function toastShows(toast: { agentId?: string; projectId?: string }, projects: Project[], agentProject: (agentId: string) => string | undefined): boolean {
  const projectId = toast.projectId ?? (toast.agentId ? agentProject(toast.agentId) : undefined);
  return !isHidden(projects.find((p) => p.id === projectId));
}
