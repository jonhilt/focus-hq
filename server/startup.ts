import type { KeyMode } from './agents/apiKey';
import { listensBeyondLoopback } from './hostGuard';

/** What Focus prints once it's listening: where to open it, its mode, how agents sign in, and a warning when anyone can reach it. */
export function openLines(s: { host: string; port: number; demo: boolean; keyMode: KeyMode; budgetUsd: number; apiKeySet: boolean }): string[] {
  const lines = [
    `\n  🖖  Focus is open: http://${s.host === '0.0.0.0' ? 'localhost' : s.host}:${s.port}`,
    `      mode: ${s.demo ? 'demo (fake GitHub, pretend agents)' : 'live (gh CLI + Claude Agent SDK)'}`,
  ];
  const signIn = s.demo ? undefined : signInLine(s.keyMode, s.budgetUsd, s.apiKeySet);
  if (signIn) lines.push(signIn);
  if (listensBeyondLoopback(s.host)) {
    lines.push(`      ⚠ HOST=${s.host}: anyone who can reach this port can drive your agents, which act with your GitHub and Claude logins.`);
  }
  return [...lines, ''];
}

/** How live agents sign in, when it's worth saying: on the key once the plan runs out, or a key set that they ignore. */
function signInLine(mode: KeyMode, budgetUsd: number, apiKeySet: boolean): string | undefined {
  if (mode === 'fallback') {
    return `      agents use your Claude login, and ANTHROPIC_API_KEY while your plan's usage limit is reached (up to $${budgetUsd} each time).`;
  }
  if (apiKeySet && mode === 'login') {
    return '      note: ANTHROPIC_API_KEY is set but agents ignore it and use your Claude login (set FOCUS_USE_API_KEY=1 to use the key, or =fallback to use it when your plan runs out).';
  }
  return undefined;
}
