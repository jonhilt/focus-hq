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

/** The last of Claude's replies in a terminal, as plain text: what a lead last said, to quote it. */
export function lastReply(lines: readonly TermLine[]): string {
  const start = lines.findLastIndex((l) => replyPart(l)?.start);
  if (start < 0) return '';
  const said: string[] = [];
  for (const line of lines.slice(start)) {
    const part = replyPart(line);
    if (!part) break;
    said.push(plainMarkdown(part.text));
  }
  return said.join('\n').trim();
}

/** What a session said, which a terminal always shows: Claude's replies and the messages it was sent. */
export const saysLine = (line: TermLine): boolean => line.kind === 'text' || line.kind === 'manager';

/** A step's line: a tool call or a system line, as the server starts them. */
const STEP = /^[⏺✻] /;

/**
 * The one line a folded run of what a session did reads as, between what it said: how many steps (or lines, with no
 * tool call among them), how many failed, and the latest step, so a working session still shows what it's on.
 */
export function foldSummary(lines: readonly TermLine[]): string {
  const steps = lines.filter((l) => l.kind === 'tool' && l.text.startsWith(REPLY)).length;
  const failed = lines.filter((l) => l.kind === 'error').length;
  // the latest step, or with none among them the latest line, without its marker
  const latest = (lines.findLast((l) => STEP.test(l.text)) ?? lines.findLast((l) => l.text.trim()))?.text.replace(/^\s*[⏺✻⎿]?\s*/, '').trim() ?? '';
  const count = steps ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
  const clipped = latest.length > 90 ? `${latest.slice(0, 89)}…` : latest;
  return [count, failed ? `${failed} failed` : '', clipped].filter(Boolean).join(' · ');
}
