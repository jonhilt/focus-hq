// The map tool in every goal lead's office (mcp__office__map): a view of the project's architecture map on their
// station's screen, mapped from their own checkout, so a view they add to the model in their slice shows at once, and
// every later goal reuses it once it merges. With no view, it lists them.
import { z } from 'zod';
import type { LeadTool, LeadToolContext } from '../../server/plugins/contract';
import { mapRepo } from './map';
import { mapPage } from './page';
import { MODEL_FILE, type RepoMap } from './shared';
import { pickView, viewList } from './views';

const DESCRIPTION = `Put a view of the project's architecture map on your station's screen, like show's visuals: the parts a question takes, the imports between them and what they send each other at runtime (from a recorded run), drawn the one way, every arrow numbered and said in a sentence. It's mapped from the model in your checkout's ${MODEL_FILE} and your code as it stands. Reach for it before drawing a diagram of how the system fits together: with no view it lists the views there are. When none answers your question, add one to the model (a question and the parts it takes) in your slice and show it: once it merges, it's there for every goal after.`;

async function maps(lead: LeadToolContext, repo?: string): Promise<RepoMap[]> {
  const checkouts = lead.checkouts.filter((c) => !repo || c.repo === repo);
  if (!checkouts.length) throw new Error(repo ? `${repo} isn't one of your checkouts: ${lead.checkouts.map((c) => c.repo).join(', ')}` : 'You have no checkouts to map yet');
  return Promise.all(checkouts.map((c) => mapRepo(c.repo, c.dir)));
}

export const mapTool: LeadTool = {
  name: 'map',
  description: DESCRIPTION,
  input: {
    view: z.string().optional().describe('The view to show, by its id (like "show-to-screen"), or "whole" for every part as a dependency matrix. Leave it out to list the views.'),
    repo: z.string().optional().describe('Which repo\'s map ("owner/name"), when more than one has a view of that id.'),
  },
  async run(lead, input) {
    const view = typeof input.view === 'string' ? input.view : undefined;
    const found = await maps(lead, typeof input.repo === 'string' ? input.repo : undefined);
    if (!view) return viewList(found);
    const picked = pickView(found, view);
    if ('error' in picked) throw new Error(`${picked.error}\n\n${viewList(found)}`);
    const { map, view: shown } = picked;
    const where = await lead.show({ id: `map-${shown.id}`, title: shown.question, html: mapPage(map, shown) });
    const drift = map.problems.length ? ` The map and the code disagree: ${map.problems.join('; ')}.` : '';
    return `${where} It's ${map.repo}'s ${shown.id === 'whole' ? 'whole map' : `view "${shown.id}"`}: ${shown.parts.length} parts.${drift}`;
  },
};
