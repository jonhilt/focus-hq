// The chief of staff (README.md): what its server part and the browser share.
import type { Agent, Project, VerdictRoute } from '../../plugin-api/shared';
import { isOneOf, isRecord } from '../../plugin-api/shared';

/** The plugin's id: in FOCUS_PLUGINS, and the switch in a project's settings. */
export const CHIEF_OF_STAFF = 'chief-of-staff';

/** Who its words come from, as the lead hears them (`[Chief of Staff] …`). */
export const SENDER = 'Chief of Staff';

/** What a `captain-decision` line says was decided when its words for a lead were sent (by the captain, or itself). */
export const SENT_WORDS = 'Sent the chief of staff’s words';

/** Where it sends a turn: 1 carry on, 2 a card for the captain, 3 interrupt the captain, 4 back to the lead. */
export type CosRoute = VerdictRoute;

export const ROUTES: readonly CosRoute[] = [1, 2, 3, 4];

/** How long a lead's ended turn waits for its read before it hails the captain unjudged. */
export const JUDGING_MS = 60_000;

/** How long its words for a lead wait for the captain to hold them, in a project where it sends them itself. */
export const AUTO_SEND_MS = 120_000;

/** How often its server part sends the words whose time has come. */
export const AUTO_SEND_EVERY = 5000;

/** A turn as it judged it: its route, the line on what's decided, why, and its words. */
export interface Verdict {
  route: CosRoute;
  /** What's being decided, in a line: the captain's inbox leads with it. */
  ask: string;
  /** Why the turn goes where it does. */
  why: string;
  /** The words it would send: to the lead on routes 1 and 4, to the captain on 2 and 3. */
  message: string;
}

/**
 * Its read of a goal lead's latest turn, its mark on it (`lead.marks[CHIEF_OF_STAFF]`, `PluginGoals.mark`): from the
 * turn's end (`at`) until it's `judged`. The core clears it as the lead's next turn starts.
 */
export interface CosRead {
  /** When the turn ended. */
  at: number;
  judged?: Verdict;
  /**
   * When it sends its words to the lead itself, unless the captain holds them first: set as it judges a turn it would
   * carry on or send back, in a project that lets it (`autoSendFor`); cleared by Hold.
   */
  sendsAt?: number;
}

/** A verdict, if `v` is one. */
export function verdictOf(v: unknown): Verdict | undefined {
  if (!isRecord(v) || !isOneOf(ROUTES, v.route) || typeof v.ask !== 'string' || typeof v.why !== 'string' || typeof v.message !== 'string') return undefined;
  return { route: v.route, ask: v.ask, why: v.why, message: v.message };
}

/** A read, if `v` is one: what the lead's mark holds, from this plugin (or an older one of it). */
export function cosReadOf(v: unknown): CosRead | undefined {
  if (!isRecord(v) || typeof v.at !== 'number') return undefined;
  const judged = verdictOf(v.judged);
  return { at: v.at, ...(judged && { judged }), ...(judged && typeof v.sendsAt === 'number' && { sendsAt: v.sendsAt }) };
}

/** Its read of a lead's latest turn, from the lead's marks. */
export const readOf = (agent: Pick<Agent, 'lead'> | undefined): CosRead | undefined => cosReadOf(agent?.lead?.marks?.[CHIEF_OF_STAFF]);

/** Whether a verdict's words are for the lead (carry on, back to the lead): ready for the captain to send. */
export const forLead = (v: Pick<Verdict, 'route'>): boolean => v.route === 1 || v.route === 4;

/** What it keeps across a restart: whether it sends its words by itself, by project (`autoSendFor`). */
export interface CosState {
  autoSend: Record<string, boolean>;
}

export const freshState = (): CosState => ({ autoSend: {} });

/** Its state as the browser has it (`state.plugins[CHIEF_OF_STAFF]`): fresh where it isn't one. */
export function cosStateOf(v: unknown): CosState {
  const said = isRecord(v) && isRecord(v.autoSend) ? v.autoSend : {};
  return { autoSend: Object.fromEntries(Object.entries(said).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) };
}

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
