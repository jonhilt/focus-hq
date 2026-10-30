import { describe, expect, it } from 'vitest';
import type { LedgerEvent, TermLine } from '../../plugin-api/shared';
import { goalThread, leadEntries, ledgerEntries, messageEntries, THREAD_LIMITS } from './thread';
import { turnTail } from './turn';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const iso = (t: number) => new Date(t).toISOString();
const said = (t: number, text: string) => ({ type: 'assistant', uuid: `a${t}`, timestamp: iso(t), message: { content: [{ type: 'text', text }] } });
const tool = (t: number) => ({ type: 'assistant', uuid: `t${t}`, timestamp: iso(t), message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] } });
const to = (t: number, text: string, isMeta = false) => ({ type: 'user', uuid: `u${t}`, timestamp: iso(t), isMeta, message: { content: text } });
const msg = (t: number, text: string): TermLine => ({ t, kind: 'manager', text });

let seq = 0;
const line = (e: Record<string, unknown>): LedgerEvent => ({ projectId: 'p', seq: ++seq, ...e }) as LedgerEvent;

describe('messageEntries', () => {
  it('keeps every message whole, the user’s and everyone else’s, each from its log line', () => {
    const lines: TermLine[] = [
      msg(1, '▶ Captain: Build saved items'),
      { t: 2, kind: 'text', text: 'Looking.' },
      msg(3, '▶ Captain: Use a list.\nAnd keep it small.'),
      msg(4, '▶ Ops: Slice 1 has landed.\nMore detail.'),
      msg(5, '▶ QA officer Lt. Okafor: QA passed acme/shop#3'),
      msg(6, '▶ Captain, from phone: Ship it'),
      msg(7, '✔ Approved by the captain: Run the tests'),
    ];
    expect(messageEntries(lines, 'Build saved items')).toEqual([
      { kind: 'you', at: 3, text: 'Use a list.\nAnd keep it small.' },
      { kind: 'ops', at: 4, from: 'Ops', text: 'Slice 1 has landed.\nMore detail.' },
      { kind: 'ops', at: 5, from: 'QA officer Lt. Okafor', text: 'QA passed acme/shop#3' },
      { kind: 'you', at: 6, text: 'Ship it', via: 'phone' },
    ]);
    // the first message stays when it isn't the goal as first put
    expect(messageEntries(lines.slice(0, 1))).toEqual([{ kind: 'you', at: 1, text: 'Build saved items' }]);
  });

  it('keeps a card set aside as the lead carried on as a quiet line, and no other system line', () => {
    const lines: TermLine[] = [
      msg(1, '▶ Chief of Staff: QA passed it, carry on with the next slice'),
      { t: 2, kind: 'system', text: '✻ Close the goal? — set aside: Rhee carried on' },
      { t: 3, kind: 'system', text: '✻ Ops compacts the conversation, keeping what the goal needs' },
    ];
    expect(messageEntries(lines)).toEqual([
      { kind: 'ops', at: 1, from: 'Chief of Staff', text: 'QA passed it, carry on with the next slice' },
      { kind: 'set-aside', at: 2, text: 'Close the goal? — set aside: Rhee carried on' },
    ]);
  });

  it('clips what it keeps', () => {
    const [you] = messageEntries([msg(1, `▶ Captain: ${'x'.repeat(THREAD_LIMITS.you + 5)}`)]);
    expect(you).toMatchObject({ text: `${'x'.repeat(THREAD_LIMITS.you)} …[+5]` });
    const [told] = messageEntries([msg(1, `▶ Chief of Staff: ${'y'.repeat(THREAD_LIMITS.told + 5)}`)]);
    expect(told).toMatchObject({ kind: 'ops', text: `${'y'.repeat(THREAD_LIMITS.told)} …[+5]` });
  });

  it('keeps a long brief to the lead whole, every paragraph of it, past what a line shows', () => {
    const brief = ['Here is the plan for the saved list.', '', 'First, store the items per user.', '', 'Then, '.concat('show them on the page. '.repeat(30)).trim()].join('\n');
    expect(brief.length).toBeGreaterThan(240);
    expect(messageEntries([msg(1, `▶ Chief of Staff: ${brief}`)])).toEqual([{ kind: 'ops', at: 1, from: 'Chief of Staff', text: brief }]);
  });
});

describe('leadEntries', () => {
  it('keeps what the lead said last before each message to them, and at the end', () => {
    const t = jsonl([to(1, 'Build saved items'), said(2, 'Reading the code.'), tool(3), said(4, 'Plan: a list. OK?'), to(5, '<system-reminder>x</system-reminder>'), to(6, 'Yes'), said(7, 'Done.'), to(8, 'meta', true)]);
    expect(leadEntries(t)).toEqual([
      { kind: 'lead', at: 4, text: 'Plan: a list. OK?', turnUuid: 'a4' },
      { kind: 'lead', at: 7, text: 'Done.', turnUuid: 'a7' },
    ]);
  });

  it('names each turn by the line its verdict names it by: Claude Code’s stop hook after the lead’s words, not the next message', () => {
    const stop = (t: number) => ({ type: 'system', subtype: 'stop_hook_summary', uuid: `s${t}`, timestamp: iso(t) });
    const first = [to(1, 'Build saved items'), said(2, 'Plan: a list. OK?'), stop(3)];
    const t = jsonl([...first, to(4, 'Yes'), said(5, 'Done.'), stop(6)]);
    // as the chief of staff judged each turn, its transcript ended there
    expect(turnTail(jsonl(first))?.uuid).toBe('s3');
    expect(turnTail(t)?.uuid).toBe('s6');
    expect(leadEntries(t).map((e) => (e.kind === 'lead' ? e.turnUuid : undefined))).toEqual(['s3', 's6']);
  });
});

describe('ledgerEntries', () => {
  it('keeps the goal’s merges and the verdicts on its turns', () => {
    const lead = { id: 'g1', sessionId: 's1' };
    const ledger = [
      line({ kind: 'merged', at: 5, repo: 'acme/shop', pr: 3, by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead: 'g1' }),
      line({ kind: 'merged', at: 6, repo: 'acme/shop', pr: 4, by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead: 'g2' }),
      line({ kind: 'cos-verdict', at: 7, sessionId: 's1', agent: 'L', turnUuid: 'u', route: 4, check: 'evidence', why: 'No test.', says: 'I sent it back for a test.', message: 'Test it.', model: 'm', version: 'v' }),
      line({ kind: 'cos-verdict', at: 8, sessionId: 's2', agent: 'L', turnUuid: 'u', route: 2, why: 'w', model: 'm', version: 'v' }),
    ];
    expect(ledgerEntries(lead, ledger)).toEqual([
      { kind: 'merged', at: 5, repo: 'acme/shop', number: 3 },
      { kind: 'cos', at: 7, route: 4, why: 'No test.', says: 'I sent it back for a test.', message: 'Test it.', check: 'evidence' },
    ]);
  });
});

describe('goalThread', () => {
  it('puts it all in order, the conversation before what the ledger made of it at the same moment', () => {
    const thread = goalThread(
      { id: 'g1', sessionId: 's1', lead: { brief: 'Build saved items' } },
      {
        ledger: [line({ kind: 'cos-verdict', at: 4, sessionId: 's1', agent: 'L', turnUuid: 'u', route: 2, why: 'A pick.', model: 'm', version: 'v' })],
        lines: [msg(1, '▶ Captain: Build saved items'), msg(5, '▶ Captain: List.')],
        jsonl: jsonl([to(1, 'Build saved items'), said(4, 'List or grid?'), to(5, 'List.')]),
      },
    );
    expect(thread.map((e) => e.kind)).toEqual(['lead', 'cos', 'you']);
  });
});
