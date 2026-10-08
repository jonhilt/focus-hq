import { FRICTION_KINDS, type Friction, type FrictionKind, type LedgerEvent } from '../../shared/ledger';
import { clip, messageFrom } from './retro';

// What Haiku reads of a session's span, and what's kept of its answer. Code supplies the facts (sessionDigest.ts);
// Haiku only finds the moments of friction, the work redone and a lesson someone said out loud, and quotes them. A
// quote that isn't in the text it was given doesn't survive: Haiku never judges, ranks or gives verdicts.

/** About 10k tokens: a session's span, trimmed to who said what, what failed and the agent's own words. */
const BUDGET = 40_000;

type Block = { type?: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: unknown; is_error?: boolean; content?: unknown };
type Line = { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown } };

const blocks = (line: Line): Block[] => {
  const content = line.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
};
const resultText = (content: unknown) => (typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).map((b) => b.text ?? '').join(' ') : '');
const minute = (at?: string) => (at ? at.slice(11, 16) : '--:--');

/** What a call did, in a line: a Bash command, or the tool and its input. */
function callLine(b: Block): string {
  const input = (b.input ?? {}) as Record<string, unknown>;
  return typeof input.command === 'string' ? `Bash: ${input.command}` : `${b.name}: ${JSON.stringify(input)}`;
}

/**
 * The span after `afterUuid` as Haiku reads it: each message to the agent (the captain's in full, with what the agent
 * had just said), each failed call with its error, and the agent's own words; then the ledger's lines on its pull
 * requests. When it runs long, the agent's own words go first, oldest first.
 */
export function extractionInput(jsonl: string, afterUuid: string | undefined, prLines: LedgerEvent[]): string {
  const lines: { text: string; spare: boolean }[] = [];
  const calls = new Map<string, string>();
  let inSpan = !afterUuid;
  let lastSaid = '';
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
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
          lines.push({ text: `[${at}] CAPTAIN: ${clip(b.text, 1500)}${lastSaid ? `\n  (the agent had just said: ${JSON.stringify(clip(lastSaid, 300))})` : ''}`, spare: false });
        } else lines.push({ text: `[${at}] ${from.toUpperCase()}: ${clip(b.text, from === 'compacted' ? 120 : 600)}`, spare: false });
      }
    }
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

export function extractorSystemPrompt(): string {
  return `
You read a span of a coding agent's session in an office of Claude Code agents, and pick out moments, quoting them. You don't judge the work, rank anything, or say whether it was good: you only find and quote.

The text shows, in order: messages to the agent (CAPTAIN is the human in charge; OFFICE and QA are the office's own), calls that FAILED with their error, the AGENT's own words, and LEDGER lines on the agent's pull requests.

Find:
- frictions: moments where the office, its tools, the environment or the way of working got in the agent's way and cost time. Not the work itself: a bug the agent or QA found in the code being changed, or a check in that code doing its job, isn't friction. Give each a kind from this list, and a signature: a few lowercase words naming the trouble so the same trouble gets the same words in any session (e.g. "zsh glob no matches", "dcg blocks rm -rf", "demo port in use"). One friction per distinct trouble in the span, however often it repeats.
${KINDS.map((k) => `  - ${k}: ${FRICTION_KINDS[k]}`).join('\n')}
- rework: work done again (a QA fail fixed, conflicts resolved, something the captain asked to be redone), each with a few words on what.
- lesson: only if someone in the span says in so many words what they learned or will do differently. Quote it. Otherwise leave it out: never write one.

Every quote must be copied exactly from the text, a short stretch of one line (up to about 200 characters). Leave out anything you can't quote. An empty answer is fine.
`.trim();
}

export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['frictions', 'rework'],
  properties: {
    frictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'signature', 'quote'],
        properties: { kind: { type: 'string', enum: KINDS }, signature: { type: 'string' }, quote: { type: 'string' } },
      },
    },
    rework: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['what', 'quote'], properties: { what: { type: 'string' }, quote: { type: 'string' } } },
    },
    lesson: { type: 'string' },
  },
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A signature as it's grouped by: lowercase words, no punctuation, at most eight. */
export function signatureOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
}

/**
 * Haiku's answer, checked against the text it read: a quote that isn't in it word for word (spacing aside) is dropped
 * with its friction, rework or lesson, and so is anything left empty.
 */
export function parseExtraction(out: unknown, input: string): { frictions: Friction[]; rework: { what: string; quote: string }[]; lesson?: string } {
  const o = (out ?? {}) as Record<string, unknown>;
  const text = squash(input);
  const quoted = (q: unknown) => {
    const quote = squash(str(q));
    return quote.length >= 3 && text.includes(quote) ? quote : undefined;
  };
  const frictions = (Array.isArray(o.frictions) ? o.frictions : []).flatMap((f): Friction[] => {
    const r = (f ?? {}) as Record<string, unknown>;
    const quote = quoted(r.quote);
    const kind = KINDS.find((k) => k === r.kind);
    const signature = signatureOf(str(r.signature));
    return quote && kind && signature ? [{ kind, signature, quote }] : [];
  });
  const rework = (Array.isArray(o.rework) ? o.rework : []).flatMap((w) => {
    const r = (w ?? {}) as Record<string, unknown>;
    const quote = quoted(r.quote);
    const what = clip(str(r.what), 120);
    return quote && what ? [{ what, quote }] : [];
  });
  const lesson = quoted(o.lesson);
  return { frictions, rework, ...(lesson && { lesson }) };
}
