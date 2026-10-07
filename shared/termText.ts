import type { TermLine } from './types';

/** What the server puts before the first line of each of Claude's replies (`renderText`); the rest are indented two. */
export const REPLY = '⏺ ';

/**
 * Where a terminal line stands in Claude's replies, which the server sends a line at a time: the start of one, a line
 * carrying the last one on, or (null) neither, like a tool call or its output.
 */
export function replyPart(line: TermLine): { start: boolean; text: string } | null {
  if (line.kind !== 'text') return null;
  if (line.text.startsWith(REPLY)) return { start: true, text: line.text.slice(REPLY.length) };
  return { start: false, text: line.text.replace(/^ {2}/, '') };
}

/**
 * A line of a reply's markdown as plain text, for screens drawn on a canvas a line at a time: no emphasis marks,
 * backticks or link targets, headings without their hashes, bullets as bullets, and a table's rule as a plain rule.
 */
export function plainMarkdown(text: string): string {
  const indent = /^\s*/.exec(text)?.[0] ?? '';
  let rest = text.slice(indent.length);
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(rest)) return `${indent}${'─'.repeat(Math.min(rest.length, 40))}`;
  if (/^```/.test(rest)) return indent;
  rest = rest
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+(?!\[[ xX]\])/, '• ')
    .replace(/^[-*+]\s+\[[xX]\]\s+/, '☑ ')
    .replace(/^[-*+]\s+\[ \]\s+/, '☐ ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
  return `${indent}${rest}`;
}

/** A terminal line as a canvas draws it: a reply's line without its markdown, anything else as it came. */
export function plainTermLine(line: TermLine): string {
  const part = replyPart(line);
  return part ? `${part.start ? REPLY : '  '}${plainMarkdown(part.text)}` : line.text;
}
