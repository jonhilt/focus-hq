import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocks, field, isRecord, messageFrom, resultText, transcriptFolders, transcriptLines, transcriptReader } from './transcript';

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

// Claude Code's projects folder: one folder per cwd, every character but letters and digits turned into -
function projects() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-transcripts-'));
  const workspaces = '/home/me/.focus/data/workspaces';
  const folder = (name: string) => {
    const dir = path.join(root, `-home-me--focus-data-workspaces-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const write = (dir: string, file: string, text: string, mtime = new Date(2026, 9, 19)) => {
    fs.writeFileSync(path.join(dir, file), text);
    fs.utimesSync(path.join(dir, file), mtime, mtime);
  };
  return { root, workspaces, folder, write };
}

describe('transcriptFolders', () => {
  it('finds the office’s agents’ sessions, each with its kind, its id and a name to tell it by', async () => {
    const { root, workspaces, folder, write } = projects();
    write(folder('lead-proj-1'), '0123456789ab-lead.jsonl', 'lead');
    write(folder('qa-proj-1'), 'qa-session.jsonl', 'qa');
    write(folder('agent-1'), 'dev-session.jsonl', 'dev');
    const found = await transcriptFolders(root, workspaces)(0);
    expect(found.map(({ name, kind, sessionId }) => ({ name, kind, sessionId })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'agent-1__dev-sess', kind: 'agent', sessionId: 'dev-session' },
      { name: 'lead-proj-1__01234567', kind: 'lead', sessionId: '0123456789ab-lead' },
      { name: 'qa-proj-1__qa-sessi', kind: 'qa', sessionId: 'qa-session' },
    ]);
    expect(await Promise.all(found.map((t) => t.read())).then((texts) => texts.sort())).toEqual(['dev', 'lead', 'qa']);
  });

  it('leaves out other folders, other kinds, files that aren’t transcripts, and sessions untouched since', async () => {
    const { root, workspaces, folder, write } = projects();
    const mine = path.join(root, '-home-me-code-shop');
    fs.mkdirSync(mine);
    write(mine, 'mine.jsonl', 'not the office’s');
    write(folder('planner-proj-1'), 'p.jsonl', 'no such kind');
    write(folder('lead-proj-1'), 'notes.txt', 'not a transcript');
    write(folder('lead-proj-1'), 'old.jsonl', 'too old', new Date(2026, 0, 1));
    write(folder('lead-proj-1'), 'new.jsonl', 'new');
    const found = await transcriptFolders(root, workspaces)(new Date(2026, 5, 1).getTime());
    expect(found.map((t) => t.sessionId)).toEqual(['new']);
  });

  it('finds nothing when Claude Code has no projects folder yet', async () => {
    expect(await transcriptFolders(path.join(os.tmpdir(), 'focus-no-such-projects'), '/w')(0)).toEqual([]);
  });
});

describe('transcriptReader', () => {
  it('reads a session’s transcript by its id, from whichever of the agents’ folders has it', async () => {
    const { root, workspaces, folder, write } = projects();
    folder('agent-1');
    write(folder('lead-proj-1'), 's1.jsonl', 'the lead’s');
    const read = transcriptReader(root, workspaces);
    expect(await read('s1')).toBe('the lead’s');
    write(folder('lead-proj-1'), 's1.jsonl', 'grown');
    expect(await read('s1')).toBe('grown');
  });

  it('reads nothing for a session that isn’t in the agents’ folders (a cloud session’s, or someone else’s)', async () => {
    const { root, workspaces, write } = projects();
    const mine = path.join(root, '-home-me-code-shop');
    fs.mkdirSync(mine);
    write(mine, 's2.jsonl', 'not the office’s');
    expect(await transcriptReader(root, workspaces)('s2')).toBeUndefined();
    expect(await transcriptReader(path.join(os.tmpdir(), 'focus-no-such-projects'), workspaces)('s2')).toBeUndefined();
  });

  it('reads nothing once the transcript it found has gone', async () => {
    const { root, workspaces, folder, write } = projects();
    const dir = folder('qa-proj-1');
    write(dir, 's3.jsonl', 'there');
    const read = transcriptReader(root, workspaces);
    expect(await read('s3')).toBe('there');
    fs.rmSync(path.join(dir, 's3.jsonl'));
    expect(await read('s3')).toBeUndefined();
  });
});
