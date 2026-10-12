// Reading a Claude Code transcript (its session's JSONL, one line per message or event), shared by the ledger's
// session digests (sessionDigest.ts), the retro's friction reader (frictions.ts) and the studio's session timelines
// (sessionTimeline.ts). A transcript can be mid-write, so a line that doesn't parse is skipped.

export type Block = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: unknown; is_error?: boolean; content?: unknown };
export type Line = { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; message?: { id?: string; content?: unknown } };

/** A line's content as blocks: a plain string is one text block. */
export const blocks = (line: Line): Block[] => {
  const content = line.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
};

/** A tool result's text, however it came. */
export const resultText = (content: unknown) => (typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => b.text ?? '').join(' ') : '');

/** Each line of a transcript that parses, in order. */
export function* transcriptLines(jsonl: string): Generator<Line> {
  for (const text of jsonl.split('\n')) {
    if (!text.trim()) continue;
    try {
      yield JSON.parse(text) as Line;
    } catch {
      // mid-write, or not a transcript line
    }
  }
}
