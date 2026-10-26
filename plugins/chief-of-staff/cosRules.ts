import type { Project } from '../../plugin-api/shared';
import type { CosState, Verdict } from './shared';

// The chief of staff's small decisions on a project and a verdict (README.md): whether its words are for the lead, and
// whether it routes with Jev or sends its words by itself where the captain left it. Pure, so it's tested
// (cosRules.test.ts).

/** Whether a verdict's words are for the lead (carry on, back to the lead): ready for the captain to send. */
export const forLead = (v: Pick<Verdict, 'route'>): boolean => v.route === 1 || v.route === 4;

/** Whether Jev picks the route for its turns in `project` (Haiku writing the words): only where the captain said so. */
export const jevFor = (state: CosState, projectId: string | undefined): boolean => projectId !== undefined && state.jev?.[projectId] === true;

/**
 * Whether it sends its words for a lead by itself in `project`: the captain's say on it here, or, before they've said,
 * what Focus kept on the project before the setting was the chief of staff's own (`cosAutoSend`), so it carries over.
 */
export function autoSendFor(state: CosState, project: Pick<Project, 'id'> | undefined): boolean {
  if (!project) return false;
  const said = state.autoSend[project.id];
  if (said !== undefined) return said;
  return 'cosAutoSend' in project && project.cosAutoSend === true;
}
