/// <reference types="vite/client" />
// The plugins' parts on the phone (the Tricorder, docs/plugins.md): each plugin folder's phone.ts, found as the
// Tricorder's built. Only the plugins Focus has switched on (`info.plugins`) show. A phone.ts reaches Focus through
// plugin-api/phone.ts alone, so nothing of three.js comes with it.
import type { Agent, PullRequest } from '../../../shared/types';
import { state } from '../net/state';

export interface PhonePlugin {
  /** The plugin's id, as the server knows it. */
  id: string;
  /**
   * Sections it puts at the top of the home screen, above the projects, or null for none just now. The screen is drawn
   * afresh whenever Focus's state changes, and every few seconds besides, so a time in one moves on.
   */
  home?(host: PhoneHost): (HTMLElement | null)[];
  /**
   * Its sections show what waits on the captain, its own way: while it's on, the core's plain Needs you (`needsYou`)
   * steps aside.
   */
  hails?: true;
}

/** What the home screen lends a plugin's sections. */
export interface PhoneHost {
  /**
   * A button that calls Focus: its in-flight state and its error are kept by `key` (`<scope>:<verb>`) across redraws,
   * so a redraw mid-call keeps it disabled and the error in view.
   */
  button(key: string, label: string, run: () => Promise<unknown>, opts?: { class?: string; disabled?: boolean; confirm?: string }): HTMLButtonElement;
  /** What went wrong with the buttons of `scope`, tap to dismiss; null when nothing did. */
  errors(scope: string): HTMLElement | null;
  /** The link to an agent's own screen. */
  agentHref(id: string): string;
  /** What an agent is on, in a line: a goal, a brief, an issue or a pull request. */
  workLabel(agent: Agent): string;
  /** Shows a pull request's card in its project, opened and lit up a moment. */
  showPr(projectId: string, pr: PullRequest): void;
}

const found = import.meta.glob<{ default: PhonePlugin }>('../../../plugins/*/phone.ts', { eager: true });

/** The plugins switched on that have a part on the phone. */
export function phonePlugins(): PhonePlugin[] {
  const on = new Set(state.info?.plugins ?? []);
  return Object.values(found).map((module) => module.default).filter((plugin) => on.has(plugin.id));
}

/** Whether a plugin switched on shows what waits on the captain itself (`PhonePlugin.hails`). */
export const phoneHails = (plugins = phonePlugins()): boolean => plugins.some((plugin) => plugin.hails);

/** The plugins' sections at the top of the home screen. A plugin whose `home` throws is logged and left out. */
export function phoneSections(host: PhoneHost, plugins = phonePlugins()): HTMLElement[] {
  return plugins.flatMap((plugin) => {
    try {
      return (plugin.home?.(host) ?? []).filter((el): el is HTMLElement => el !== null);
    } catch (err) {
      console.error(`The ${plugin.id} plugin's part of the phone failed`, err);
      return [];
    }
  });
}
