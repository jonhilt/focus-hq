import type { PluginRoute, PluginState } from '../../plugin-api/server';
import { resumeHow } from '../../plugin-api/server';
import { itemWithLinks } from './botHook';
import type { Inbox } from './captainsInbox';
import { decideOf } from './inbox';
import { landedAnswerOf } from './landed';
import type { CosState } from './shared';

// The chief of staff's routes (docs/ledger.md#the-captains-inbox-api): the captain's inbox under
// /api/plugins/chief-of-staff, the same for a bot speaking for the captain at /api/bot/inbox (its public contract, so
// the paths stay), and the switch for sending its words by itself.

/** A project's id and whether it's switched on, from a body: `{ projectId, on }`. */
function switchOf(body: Record<string, unknown>): { projectId: string; on: boolean } {
  if (typeof body.projectId !== 'string' || !body.projectId) throw new Error('Say which project: projectId');
  return { projectId: body.projectId, on: body.on === true };
}

/**
 * Its routes. `leadsIn` gives a project's leads, whose words are held once auto-send goes off there; `publicUrl` is
 * Focus as the bot reaches it now, to make its links whole.
 */
export function inboxRoutes(inbox: Inbox, settings: PluginState<CosState>, leadsIn: (projectId: string) => string[], publicUrl: () => string | undefined): PluginRoute[] {
  const id = (params: Record<string, string>) => params.id ?? '';
  return [
    { method: 'get', path: '/inbox', handle: () => inbox.view() },
    { method: 'post', path: '/inbox/:id/hold', handle: ({ params }) => inbox.hold(id(params)) },
    {
      method: 'post', path: '/inbox/:id/decide',
      handle: ({ params, body }) => inbox.decide(id(params), decideOf(body), body.via === 'office' ? 'office' : 'api', resumeHow(body.how)),
    },
    { method: 'post', path: '/landed/:id/decide', handle: ({ params, body }) => inbox.decideLanded(id(params), landedAnswerOf(body), body.via === 'office' ? 'office' : 'api') },
    // the same, for the bot, its answers recorded via the API
    {
      method: 'get', path: '/inbox', bot: true,
      handle: () => {
        const view = inbox.view();
        return { ...view, open: view.open.map((i) => itemWithLinks(i, publicUrl())) };
      },
    },
    { method: 'post', path: '/inbox/:id/hold', bot: true, handle: ({ params }) => inbox.hold(id(params)) },
    { method: 'post', path: '/inbox/:id/decide', bot: true, handle: ({ params, body }) => inbox.decide(id(params), decideOf(body), 'api', resumeHow(body.how)) },
    { method: 'post', path: '/landed/:id/decide', bot: true, handle: ({ params, body }) => inbox.decideLanded(id(params), landedAnswerOf(body), 'api') },
    {
      // the captain's say on whether it sends its words by itself in a project: words counting down are held once it's off
      method: 'post', path: '/auto-send',
      handle: ({ body }) => {
        const { projectId, on } = switchOf(body);
        settings.set({ autoSend: { ...settings.get().autoSend, [projectId]: on } });
        if (!on) for (const lead of leadsIn(projectId)) inbox.holdFor(lead);
        return settings.get();
      },
    },
  ];
}
