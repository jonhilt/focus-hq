import type { Agent, Settings } from '../../shared/types';

/**
 * The model and effort a new agent seated to resolve a pull request's merge conflicts works at, stamped on them so a
 * resumed session keeps them: the office's conflicts model, else its `model` setting, and the conflicts effort, if any.
 */
export function conflictsAgentModel(settings: Pick<Settings, 'model' | 'conflictsModel' | 'conflictsEffort'>): Pick<Agent, 'model' | 'effort'> {
  const model = settings.conflictsModel.trim() || settings.model.trim();
  return { model: model || undefined, effort: settings.conflictsEffort };
}
