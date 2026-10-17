import { describe, expect, it } from 'vitest';
import { CODE_TOOLS, type Settings, type ShipSessionRun, type ShipStatus, WEB_TOOLS } from '../../plugin-api/server';
import { ClaudeNumberOne } from './officer';

describe('ClaudeNumberOne', () => {
  it('talks in the session with the run of the ship that the office lends it, resuming the conversation', async () => {
    const runs: ShipSessionRun[] = [];
    const officer = new ClaudeNumberOne((run) => {
      runs.push(run);
      return Promise.resolve({ text: 'Aye.', structured: { text: 'Aye.' }, sessionId: 'sess-2', costUsd: 0.1 });
    });
    const projects = [{ id: 'p1', name: 'Shop', repos: ['o/shop'] }];
    const shipStatus = (): Promise<ShipStatus> => Promise.resolve({ projects: [] } as unknown as ShipStatus);
    const reply = await officer.turn({ projects, messages: [{ from: 'manager', text: 'Status?', at: 1 }], resumeSessionId: 'sess-1', shipStatus, personalLog: '- A video about briefings (today)', settings: {} as Settings, signal: new AbortController().signal }, () => undefined);
    expect(reply).toMatchObject({ sessionId: 'sess-2', costUsd: 0.1 });
    const [run] = runs;
    expect([run.projects, run.shipStatus, run.resume, run.builtins]).toEqual([projects, shipStatus, 'sess-1', [...CODE_TOOLS, ...WEB_TOOLS]]);
    expect(run.systemAppend({ workspaces: '/ws' })).toContain('/ws');
    expect(run.prompt).toContain('- A video about briefings (today)');
  });
});
