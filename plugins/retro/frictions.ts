import { type Block, blocks, clip, FRICTION_KINDS, type Friction, type FrictionKind, type LedgerEvent, messageFrom, resultText, transcriptLines } from '../../plugin-api/server';

// What the retro's reader reads of each session's span, and what's kept of its answer. Code supplies the facts
// (server/agents/sessionDigest.ts); at retro time a strong model reads the spans not read yet, a batch at a time, and only finds and
// quotes the moments of friction, reusing the signatures already in the ledger so the same trouble groups together.
// A quote that isn't in the text it was given doesn't survive: the reader never judges, ranks or gives verdicts.

/** About 10k tokens: a session's span, trimmed to who said what, what failed and the agent's own words. */
const BUDGET = 40_000;

const minute = (at?: string) => (at ? at.slice(11, 16) : '--:--');

/** What a call did, in a line: a Bash command, or the tool and its input. */
function callLine(b: Block): string {
  const input = (b.input ?? {}) as Record<string, unknown>;
  return typeof input.command === 'string' ? `Bash: ${input.command}` : `${b.name}: ${JSON.stringify(input)}`;
}

/**
 * The span after `afterUuid` (to `toUuid`, when given) as the reader reads it: each message to the agent (the
 * captain's in full, with what the agent had just said), each failed call with its error, and the agent's own words;
 * then the ledger's lines on its pull requests. When it runs long, the agent's own words go first, oldest first.
 */
export function extractionInput(jsonl: string, afterUuid: string | undefined, prLines: LedgerEvent[], toUuid?: string): string {
  const lines: { text: string; spare: boolean }[] = [];
  const calls = new Map<string, string>();
  let inSpan = !afterUuid;
  let lastSaid = '';
  for (const line of transcriptLines(jsonl)) {
    if (!inSpan) {
      // what the agent last said before the span, in case the captain's first message in it answers it
      if (line.type === 'assistant') for (const b of blocks(line)) if (b.type === 'text' && b.text?.trim()) lastSaid = b.text;
      inSpan = line.uuid === afterUuid;
      continue;
    }
    const at = minute(line.timestamp);
    if (line.type === 'assistant') {
      for (const b of blocks(line)) {
        if (b.type === 'tool_use' && b.id) calls.set(b.id, callLine(b));
        else if (b.type === 'text' && b.text?.trim()) {
          lastSaid = b.text;
          lines.push({ text: `[${at}] AGENT: ${clip(b.text, 400)}`, spare: true });
        }
      }
    } else if (line.type === 'user' && !line.isMeta) {
      for (const b of blocks(line)) {
        if (b.type === 'tool_result' && b.is_error) {
          const call = (b.tool_use_id && calls.get(b.tool_use_id)) || 'a call';
          lines.push({ text: `[${at}] FAILED ${clip(call, 200)} → ${clip(resultText(b.content).split('\n')[0] ?? '', 200)}`, spare: false });
        }
        if (b.type !== 'text' || !b.text?.trim()) continue;
        const from = messageFrom(b.text);
        if (!from) continue;
        if (from === 'captain') {
          lines.push({ text: `[${at}] CAPTAIN: ${clip(b.text, 1500)}${lastSaid ? `\n  (the agent had just said: “${clip(lastSaid, 300)}”)` : ''}`, spare: false });
        } else lines.push({ text: `[${at}] ${from.toUpperCase()}: ${clip(b.text, from === 'compacted' ? 120 : 600)}`, spare: false });
      }
    }
    if (toUuid && line.uuid === toUuid) break;
  }
  const ledger = prLines.map((e) => {
    const { at: _a, projectId: _p, seq: _s, kind, ...rest } = e;
    return `LEDGER ${kind}: ${JSON.stringify(rest)}`;
  });
  let size = [...lines, ...ledger.map((text) => ({ text }))].reduce((n, l) => n + l.text.length + 1, 0);
  for (let i = 0; size > BUDGET && i < lines.length; i++) {
    if (!lines[i].spare) continue;
    size -= lines[i].text.length + 1;
    lines.splice(i--, 1);
  }
  return clip([...lines.map((l) => l.text), ...(ledger.length ? ['', ...ledger] : [])].join('\n'), BUDGET);
}

const KINDS = Object.keys(FRICTION_KINDS) as FrictionKind[];

export function readerSystemPrompt(): string {
  return `
You read spans of coding agents' sessions in an office of Claude Code agents, and pick out the moments of friction, quoting them. You don't judge the work, rank anything, or say whether it was good: you only find and quote.

Each span shows, in order: messages to the agent (CAPTAIN is the human in charge; OFFICE and QA are the office's own), calls that FAILED with their error, the AGENT's own words, and LEDGER lines on the agent's pull requests.

A friction is a moment where the office, its tools, the environment or the way of working got in the agent's way and cost time. Not the work itself: a bug the agent or QA found in the code being changed, or a check in that code doing its job, isn't friction. Give each a kind from this list, and a signature: a few lowercase words naming the trouble. When a signature you've been given fits, use it word for word, so the same trouble groups together across sessions; make a new one only for new trouble. One friction per distinct trouble in a span, however often it repeats.
${KINDS.map((k) => `- ${k}: ${FRICTION_KINDS[k]}`).join('\n')}

Every quote must be copied exactly from that span's text, a short stretch of one line (up to about 200 characters). Leave out anything you can't quote. A span with no friction gets none.
`.trim();
}

/** The spans of one batch, each under its label, with the signatures to reuse. */
export function readerPrompt(batch: { label: string; input: string }[], signatures: string[]): string {
  return [
    `Here are ${batch.length} spans, each between <span id="…"> tags. List the frictions of each span that has any, under its id.`,
    signatures.length ? `Signatures already in use (kind: signature): reuse one when it's the same trouble.\n${signatures.map((s) => `- ${s}`).join('\n')}` : '',
    ...batch.map((b) => `<span id="${b.label}">\n${b.input}\n</span>`),
  ].filter(Boolean).join('\n\n');
}

const FRICTION_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'signature', 'quote'],
  properties: { kind: { type: 'string', enum: KINDS }, signature: { type: 'string' }, quote: { type: 'string' } },
};

export const READ_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['spans'],
  properties: {
    spans: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'frictions'], properties: { id: { type: 'string' }, frictions: { type: 'array', items: FRICTION_ITEM } } },
    },
  },
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A signature as it's grouped by: lowercase words, no punctuation, at most eight. */
export function signatureOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
}

/**
 * Frictions as the reader gave them for one span, checked against its text: one whose quote isn't in it word for word
 * (spacing aside), with an unknown kind or an empty signature, is dropped.
 */
export function checkFrictions(found: unknown, input: string): Friction[] {
  const text = squash(input);
  return (Array.isArray(found) ? found : []).flatMap((f): Friction[] => {
    const r = (f ?? {}) as Record<string, unknown>;
    const quote = squash(str(r.quote));
    const kind = KINDS.find((k) => k === r.kind);
    const signature = signatureOf(str(r.signature));
    return quote.length >= 3 && text.includes(quote) && kind && signature ? [{ kind, signature, quote }] : [];
  });
}

/** The reader's answer for a batch: each span's checked frictions by its label (none for a span it didn't list). */
export function parseRead(out: unknown, batch: { label: string; input: string }[]): Map<string, Friction[]> {
  const spans = ((out ?? {}) as { spans?: unknown }).spans;
  const listed = Array.isArray(spans) ? (spans as { id?: unknown; frictions?: unknown }[]) : [];
  return new Map(batch.map((b) => [b.label, listed.filter((s) => s.id === b.label).flatMap((s) => checkFrictions(s.frictions, b.input))]));
}

/** About 90k tokens a batch: a fortnight of sessions is three or four. */
export const BATCH_CHARS = 350_000;

/** Items in order, a batch at a time, each batch as big as fits under `max` characters of input (always at least one). */
export function batchesOf<T extends { input: string }>(items: T[], max = BATCH_CHARS): T[][] {
  const out: T[][] = [];
  let size = 0;
  for (const item of items) {
    const last = out.at(-1);
    if (last && size + item.input.length <= max) {
      last.push(item);
      size += item.input.length;
    } else {
      out.push([item]);
      size = item.input.length;
    }
  }
  return out;
}
