import { describe, expect, it } from 'vitest';
import { blocks, field, isRecord, messageFrom, resultText, transcriptLines } from './transcript';

describe('messageFrom', () => {
  it('knows the office’s and QA’s messages by how they open', () => {
    expect(messageFrom('[Office] Slice 1 has landed')).toBe('office');
    expect(messageFrom('[QA officer Ensign Halloran] QA failed jonhilt/focus#154')).toBe('qa');
    expect(messageFrom('Please QA pull request #12 in demo/shop')).toBe('office');
    expect(messageFrom('This session is being continued from a previous conversation')).toBe('compacted');
  });

  it('leaves out the harness’s own messages, and takes the rest as the captain’s', () => {
    expect(messageFrom('<system-reminder>…</system-reminder>')).toBeNull();
    expect(messageFrom('<task-notification>done</task-notification>')).toBeNull();
    expect(messageFrom('can we make the doors quieter?')).toBe('captain');
  });
});

describe('transcriptLines', () => {
  it('yields only the lines that are messages: one that parses to something else is skipped like one that doesn’t parse', () => {
    const lines = [...transcriptLines('null\n7\n"text"\n[1]\n{"type":"user","uuid":"u1"}\n{"type":5}\n{"message":"hi"}\n{"type":"assistant"')];
    expect(lines).toEqual([{ type: 'user', uuid: 'u1' }]);
  });
});

describe('blocks', () => {
  it('reads a message’s content as its blocks, leaving out what isn’t one', () => {
    const [line] = [...transcriptLines('{"type":"user","message":{"content":[null,"x",{"type":"text","text":"hi"},{"type":"text","text":3}]}}')];
    expect(blocks(line)).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('takes plain string content as one text block, and anything else as none', () => {
    expect(blocks({ message: { content: 'hello' } })).toEqual([{ type: 'text', text: 'hello' }]);
    expect(blocks({ message: { content: 7 } })).toEqual([]);
  });
});

describe('resultText', () => {
  it('joins a result’s blocks’ text, past anything that isn’t a block', () => {
    expect(resultText([null, { text: 'a' }, 4, { type: 'image' }, { text: 'b' }])).toBe('a  b');
    expect(resultText('plain')).toBe('plain');
    expect(resultText(undefined)).toBe('');
  });
});

describe('isRecord and field', () => {
  it('tells a JSON object from null, arrays and scalars, and reads a field only from an object', () => {
    expect([{}, { a: 1 }, null, [], 'x', 3].map(isRecord)).toEqual([true, true, false, false, false, false]);
    expect(field({ a: 1 }, 'a')).toBe(1);
    expect(field(null, 'a')).toBeUndefined();
    expect(field(['a'], '0')).toBeUndefined();
  });
});
