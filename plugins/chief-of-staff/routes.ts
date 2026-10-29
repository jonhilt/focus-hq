import type { PluginHost, PluginRoute, PluginState } from '../../plugin-api/server';
import { resumeHow } from '../../plugin-api/server';
import { itemWithLinks } from './botHook';
import type { Inbox } from './captainsInbox';
import type { DirectLine } from './line';
import { decideOf } from './inbox';
import { landedAnswerOf } from './landed';
import type { CosState } from './shared';
import { stoodByKept } from './watchRules';
import { goalThread } from './thread';

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
        settings.set({ ...settings.get(), autoSend: { ...settings.get().autoSend, [projectId]: on } });
        if (!on) for (const lead of leadsIn(projectId)) inbox.holdFor(lead);
        return settings.get();
      },
    },
    {
      // the captain's say on whether Jev picks the route for a project's turns, Haiku only writing the words
      method: 'post', path: '/jev',
      handle: ({ body }) => {
        const { projectId, on } = switchOf(body);
        settings.set({ ...settings.get(), jev: { ...settings.get().jev, [projectId]: on } });
        return settings.get();
      },
    },
  ];
}

/**
 * The captain's watch (README.md#the-watch): taking the conn of a goal, by its lead's id, or standing down (`lead`
 * null), and telling a hail to stand by (`key`, its `hailKey`), into the muster. Hails stood by that no longer wait are
 * let go as another is.
 */
export function watchRoutes(inbox: Pick<Inbox, 'view'>, settings: PluginState<CosState>, isLead: (id: string) => boolean): PluginRoute[] {
  return [
    {
      method: 'post', path: '/conn',
      handle: ({ body }) => {
        const lead = body.lead;
        if (lead !== null && (typeof lead !== 'string' || !isLead(lead))) throw new Error('That goal isn’t aboard');
        // a patch: standing down sets the conn to nothing, which isn't kept
        settings.set({ conn: lead ?? undefined });
        return settings.get();
      },
    },
    {
      method: 'post', path: '/stand-by',
      handle: ({ body }) => {
        if (typeof body.key !== 'string' || !body.key) throw new Error('Say which hail: key');
        const waiting = new Set(inbox.view().open.map((i) => i.id));
        if (!waiting.has(body.key)) throw new Error('That hail isn’t waiting any more');
        const kept = stoodByKept(settings.get().stoodBy ?? [], waiting).filter((k) => k !== body.key);
        settings.set({ stoodBy: [...kept, body.key] });
        return settings.get();
      },
    },
  ];
}

/** A goal's thread (README.md#a-thread-per-goal), by its lead's id: its messages from their log, their words from their transcript, the rest from the ledger. */
export function threadRoute(host: Pick<PluginHost, 'agent' | 'transcript' | 'allLines' | 'ledger'>): PluginRoute {
  return {
    method: 'get', path: '/thread/:id',
    handle: async ({ params }) => {
      const lead = host.agent(params.id ?? '');
      if (lead?.task !== 'lead') throw new Error('That goal isn’t aboard');
      const [jsonl, lines] = await Promise.all([lead.sessionId ? host.transcript(lead.sessionId) : undefined, host.allLines(lead.id)]);
      return { entries: goalThread(lead, { ledger: host.ledger(), lines, jsonl: jsonl ?? '' }) };
    },
  };
}

/**
 * The direct line (README.md#the-direct-line): saying something to the chief of staff, starting the conversation
 * afresh, and closing a goal it started from the line (`key`, its `LineStart.key`; `force` past the warning).
 */
export function lineRoutes(line: Pick<DirectLine, 'say' | 'newConversation' | 'close'>): PluginRoute[] {
  return [
    { method: 'post', path: '/line/say', handle: ({ body }) => line.say(typeof body.text === 'string' ? body.text : '') },
    { method: 'post', path: '/line/new', handle: () => line.newConversation() },
    {
      method: 'post', path: '/line/close',
      handle: ({ body }) => {
        if (typeof body.key !== 'string' || !body.key) throw new Error('Say which goal: key');
        return line.close(body.key, body.force === true);
      },
    },
  ];
}
