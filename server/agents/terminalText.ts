import type { Agent } from '../../shared/types';

// The words a cloud session's terminal starts with: safe on any command line, since the terminal runs them as an
// argument. Pure, so it's unit tested (terminalText.test.ts); terminal.ts writes and runs the script.

/**
 * A description that's safe on any command line: letters, digits and plain punctuation, nothing a shell or cmd.exe
 * reads as syntax (quotes, `%`, `^`, `&`, `|`, redirects, `$`, backticks).
 */
export function safeDescription(text: string, max = 300): string {
  return text.replace(/[^A-Za-z0-9 #/.,:()_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * The first message of the session a terminal starts, while Ops gets ready to attach and send the work: short,
 * and safe on any command line.
 */
export function terminalDescription(agent: Pick<Agent, 'name' | 'repo' | 'issue'>): string {
  return safeDescription(
    `Focus HQ: ${agent.name} on ${agent.repo}#${agent.issue.number}. Focus sends the task in its next message. ` +
    'Until then do nothing: reply only with the word Ready.',
  );
}
