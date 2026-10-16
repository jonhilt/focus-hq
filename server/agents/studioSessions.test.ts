import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// the transcripts folder comes from the environment when config.ts loads, so it's set before the sessions are imported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-studio-sessions-'));
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
const { loadSession } = await import('./studioSessions');

const projects = path.join(dir, 'claude', 'projects');
fs.mkdirSync(path.join(projects, 'p', 's1', 'subagents'), { recursive: true });
fs.writeFileSync(path.join(projects, 'p', 's1.jsonl'), '{"type":"user"}\n');
fs.writeFileSync(path.join(projects, 'p', 's1', 'subagents', 'agent-a1.jsonl'), '{"type":"assistant"}\n');
// a transcript outside the folder, and a link inside it that leads there
fs.writeFileSync(path.join(dir, 'secret.jsonl'), '{"secret":true}\n');
fs.symlinkSync(path.join(dir, 'secret.jsonl'), path.join(projects, 'p', 'escape.jsonl'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadSession', () => {
  it('loads a session by its id, with its agents', async () => {
    const session = await loadSession(' s1 ');
    expect(session).toMatchObject({ id: 's1', main: '{"type":"user"}\n', agents: [{ jsonl: '{"type":"assistant"}\n' }] });
  });

  it('loads a transcript by its path inside the folder', async () => {
    expect((await loadSession(path.join(projects, 'p', 's1.jsonl'))).id).toBe('s1');
  });

  it('refuses a transcript outside the folder, a link that leads out of it, and a file that isn’t there', async () => {
    await expect(loadSession(path.join(dir, 'secret.jsonl'))).rejects.toThrow(/can only read Claude Code's own session transcripts/);
    await expect(loadSession(path.join(projects, 'p', 'escape.jsonl'))).rejects.toThrow(/can only read/);
    await expect(loadSession(path.join(projects, 'p', 'gone.jsonl'))).rejects.toThrow(/can only read/);
  });

  it('refuses an id it has no session for, and a ref that’s neither', async () => {
    await expect(loadSession('s2')).rejects.toThrow(/There's no session s2/);
    await expect(loadSession('a b')).rejects.toThrow(/Give a session by its id/);
  });
});
