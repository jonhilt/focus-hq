import type { CallStep } from '../shared';

// What a call to Number One shows of itself (calls.ts runs them): whether Ops can take one on the keys it has, and the
// step the captain sees for the call's machine. Pure, so it's tested (callRules.test.ts).

/** The API keys a call runs on: OpenAI's for the voice, TypeSafe's for Jev. */
export interface CallKeys {
  openai?: string;
  typesafe?: string;
}

/** Why Ops can't take a call, worded for the Call button; undefined when it can. */
export function callsMissing(keys: CallKeys, demo: boolean): string | undefined {
  if (demo) return undefined;
  const missing = [!keys.openai && 'an OpenAI API key', !keys.typesafe && 'a TypeSafe API key'].filter(Boolean);
  return missing.length ? `Calls need ${missing.join(' and ')}, set in the ready room's Plugins tab` : undefined;
}

/** The step the captain sees for the machine's state (`routing` has steps of its own inside). */
export function stepOf(value: unknown): CallStep {
  const top = typeof value === 'string' ? value : Object.keys(value as object)[0];
  return top === 'routing' || top === 'confirming' || top === 'dictating' || top === 'acting' || top === 'ended' ? top : 'listening';
}
