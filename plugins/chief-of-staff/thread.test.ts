import { describe, expect, it } from 'vitest';
import type { LedgerEvent, TermLine } from '../../plugin-api/shared';
import { goalThread, leadEntries, ledgerEntries, messageEntries, THREAD_LIMITS } from './thread';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const iso = (t: number) => new Date(t).toISOString();
const said = (t: number, text: string) => ({ type: 'assistant', uuid: `a${t}`, timestamp: iso(t), message: { content: [{ type: 'text', text }] } });
const tool = (t: number) => ({ type: 'assistant', uuid: `t${t}`, timestamp: iso(t), message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash' }] } });
const to = (t: number, text: string, isMeta = false) => ({ type: 'user', uuid: `u${t}`, timestamp: iso(t), isMeta, message: { content: text } });
const msg = (t: number, text: string): TermLine => ({ t, kind: 'manager', text });

let seq = 0;
const line = (e: Record<string, unknown>): LedgerEvent => ({ projectId: 'p', seq: ++seq, ...e }) as LedgerEvent;

describe('messageEntries', () => {
  it('keeps the captain’s messages whole and everyone else’s in brief, each from its log line', () => {
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
      { kind: 'ops', at: 4, from: 'Ops', text: 'Slice 1 has landed.' },
      { kind: 'ops', at: 5, from: 'QA officer Lt. Okafor', text: 'QA passed acme/shop#3' },
      { kind: 'you', at: 6, text: 'Ship it', via: 'phone' },
    ]);
    // the first message stays when it isn't the goal as first put
    expect(messageEntries(lines.slice(0, 1))).toEqual([{ kind: 'you', at: 1, text: 'Build saved items' }]);
  });

  it('clips what it keeps', () => {
    const [you] = messageEntries([msg(1, `▶ Captain: ${'x'.repeat(THREAD_LIMITS.you + 5)}`)]);
    expect(you).toMatchObject({ text: `${'x'.repeat(THREAD_LIMITS.you)} …[+5]` });
  });
});

describe('leadEntries', () => {
  it('keeps what the lead said last before each message to them, and at the end', () => {
    const t = jsonl([to(1, 'Build saved items'), said(2, 'Reading the code.'), tool(3), said(4, 'Plan: a list. OK?'), to(5, '<system-reminder>x</system-reminder>'), to(6, 'Yes'), said(7, 'Done.'), to(8, 'meta', true)]);
    expect(leadEntries(t)).toEqual([
      { kind: 'lead', at: 4, text: 'Plan: a list. OK?' },
      { kind: 'lead', at: 7, text: 'Done.' },
    ]);
  });
});

describe('ledgerEntries', () => {
  it('keeps the goal’s decisions where they were made, its merges and the verdicts on its turns', () => {
    const lead = { id: 'g1', sessionId: 's1' };
    const decision = (at: number, o: Record<string, unknown>) => line({ kind: 'decision', at, id: 'd1', goalId: 'g1', goal: 'G', owner: 'L', by: 'L', question: 'List or grid?', options: ['List', 'Grid'], status: 'open', ...o });
    const ledger = [
      decision(1, {}),
      decision(2, { status: 'decided', chosen: 'List' }),
      decision(3, { status: 'decided', chosen: 'List', rationale: 'again' }),
      line({ kind: 'decision', at: 4, id: 'd2', goalId: 'other', goal: 'O', owner: 'L', by: 'L', question: 'q', options: ['a', 'b'], status: 'decided', chosen: 'a' }),
      line({ kind: 'merged', at: 5, repo: 'acme/shop', pr: 3, by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead: 'g1' }),
      line({ kind: 'merged', at: 6, repo: 'acme/shop', pr: 4, by: 'office', qa: 'passed', failedRounds: 0, triages: 0, lead: 'g2' }),
      line({ kind: 'cos-verdict', at: 7, sessionId: 's1', agent: 'L', turnUuid: 'u', route: 4, check: 'evidence', why: 'No test.', message: 'Test it.', model: 'm', version: 'v' }),
      line({ kind: 'cos-verdict', at: 8, sessionId: 's2', agent: 'L', turnUuid: 'u', route: 2, why: 'w', model: 'm', version: 'v' }),
    ];
    expect(ledgerEntries(lead, ledger)).toEqual([
      { kind: 'merged', at: 5, repo: 'acme/shop', number: 3 },
      { kind: 'cos', at: 7, route: 4, why: 'No test.', message: 'Test it.', check: 'evidence' },
      { kind: 'decided', at: 2, question: 'List or grid?', chosen: 'List' },
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
