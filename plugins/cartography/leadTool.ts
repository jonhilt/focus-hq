// The map tool in every goal lead's office (mcp__office__map): a view of the project's architecture map on their
// station's screen, mapped from their own checkout, so a view they add to the model in their slice shows at once, and
// every later goal reuses it once it merges. With no view, it lists them.
import { z } from 'zod';
import { ARTIFACT_LIMITS, type LeadTool, type LeadToolContext } from '../../plugin-api/server';
import { mapRepo } from './map';
import { mapPage } from './page';
import { MODEL_FILE, type RepoMap } from './shared';
import { checkSteps, pickTrace } from './steps';
import { pickView, screenTitle, viewList } from './views';

const DESCRIPTION = `Put a view of the project's architecture map on your station's screen, like show's visuals: the parts a question takes, the imports between them and what they send each other at runtime (from a recorded run), drawn the one way, every arrow numbered and said in a sentence. It's mapped from the model in your checkout's ${MODEL_FILE} and your code as it stands. Reach for it before drawing a diagram of how the system fits together: with no view it lists the views there are. When none answers your question, add one to the model in your slice and show it: once it merges, it's there for every goal after. For a question of how something happens, give the view an answer (the whole of it in a line) and steps (each { from, to, says }, a few words, in order, at most 8 through at most 7 parts) rather than parts: it's drawn as a sequence, and each step is checked against an import between its two parts, or a message or call the recorded run saw. Or give it a trace ({ message, through }: an event's type or a request's method and route, and a part it goes through) and its steps are found in the recorded run's call chains instead of written.`;

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
    // a question can run longer than a screen's title may: the page heads with all of it
    const where = await lead.show({ id: `map-${shown.id}`, title: screenTitle(shown.question, ARTIFACT_LIMITS.title), html: mapPage(map, shown) });
    const drift = map.problems.length ? ` The map and the code disagree: ${map.problems.join('; ')}.` : '';
    // a scenario's steps that nothing in the code backs, so the lead can fix them or say why
    const checked = checkSteps(map, shown);
    const unbacked = checked.flatMap((s, i) => (s.evidence.length ? [] : [`${i + 1} (${s.from} to ${s.to})`]));
    const discovered = !shown.steps?.length && checked.length ? ' found in the recorded run' : '';
    const steps = checked.length ? ` ${checked.length} steps${discovered}, ${unbacked.length ? `and nothing in the code backs step ${unbacked.join(', ')}: no import between the two, and no recorded message` : 'each backed by the code'}.` : '';
    // a trace the recorded run has no chain for
    const untraced = shown.trace && !shown.steps?.length && !pickTrace(map, shown) ? ` The recorded run has no chain that sent ${shown.trace.message}${shown.trace.through ? ` through ${shown.trace.through}` : ''}: record again (pnpm run record-flows) or write its steps.` : '';
    return `${where} It's ${map.repo}'s ${shown.id === 'whole' ? 'whole map' : `view "${shown.id}"`}: ${shown.parts.length} parts.${steps}${untraced}${drift}`;
  },
};
