import { describe, expect, it } from 'vitest';
import { callerOf, chainOf, FlowCounter, handlerOf, repoPath, TraceCounter } from './flows';

describe('repoPath', () => {
  it('reads a file on disk from the root, and the dev server’s URLs', () => {
    expect(repoPath('/repo/server/agents/manager/core.ts', '/repo')).toBe('server/agents/manager/core.ts');
    expect(repoPath('file:///repo/server/hub.ts', '/repo')).toBe('server/hub.ts');
    expect(repoPath('http://127.0.0.1:5173/src/ui/goalsPanel.ts?t=1712')).toBe('client/src/ui/goalsPanel.ts');
    expect(repoPath('http://127.0.0.1:5173/@fs/Users/me/focus/plugins/climber/client.ts?v=1')).toBe('plugins/climber/client.ts');
  });

  it('leaves out packages and Node’s own', () => {
    expect(repoPath('/repo/node_modules/ws/lib/websocket.js', '/repo')).toBeUndefined();
    expect(repoPath('http://127.0.0.1:5173/node_modules/.vite/deps/three.js?v=1')).toBeUndefined();
    expect(repoPath('node:internal/process/task_queues')).toBeUndefined();
  });
});

describe('callerOf', () => {
  it('finds the first frame in the repo that isn’t the recorder’s own', () => {
    const stack = [
      'Error',
      '    at FlowRecorder.ws (/repo/server/flows.ts:20:11)',
      '    at Hub.send (/repo/server/hub.ts:28:5)',
      '    at Hub.toast (/repo/server/hub.ts:37:10)',
      '    at Reviews.report (/repo/server/agents/manager/reviews.ts:88:14)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    expect(callerOf(stack, ['server/flows.ts', 'server/hub.ts'], '/repo')).toBe('server/agents/manager/reviews.ts');
  });

  it('reads a browser’s frames, Chrome’s and Firefox’s', () => {
    const chrome = 'Error\n    at send (http://h/src/net/api.ts:12:3)\n    at onclick (http://h/src/ui/boardPanel.ts?t=9:40:7)';
    expect(callerOf(chrome, ['client/src/net/api.ts'])).toBe('client/src/ui/boardPanel.ts');
    expect(callerOf('send@http://h/src/net/api.ts:12:3\nclick@http://h/src/ui/x.ts:4:1', ['client/src/net/api.ts'])).toBe('client/src/ui/x.ts');
  });

  it('is undefined with nothing of the repo’s in it', () => {
    expect(callerOf('Error\n    at node:internal/x:1:1', [], '/repo')).toBeUndefined();
    expect(callerOf(undefined, [])).toBeUndefined();
  });
});

describe('FlowCounter', () => {
  it('counts each kind of message from file to file, the busiest first', () => {
    const c = new FlowCounter();
    c.add('ws', 'agent', 'server/a.ts', 'client/src/net/state.ts');
    c.add('http', 'POST /api/goals', 'client/src/ui/g.ts', 'server/routes.ts');
    c.add('ws', 'agent', 'server/a.ts', 'client/src/net/state.ts');
    expect(c.list()).toEqual([
      { via: 'ws', name: 'agent', from: 'server/a.ts', to: 'client/src/net/state.ts', count: 2 },
      { via: 'http', name: 'POST /api/goals', from: 'client/src/ui/g.ts', to: 'server/routes.ts', count: 1 },
    ]);
  });
});

describe('handlerOf', () => {
  it('names the file that handled a request', () => {
    expect(handlerOf('/api/plugins/cartography/map', true)).toBe('plugins/cartography/server.ts');
    expect(handlerOf('/api/agents/:id/message', true)).toBe('server/routes.ts');
    expect(handlerOf('/api/demo/speed', false)).toBe('server/index.ts');
  });
});

describe('chainOf', () => {
  it('lists the repo’s frames outermost first, with their functions, but the recorder’s own and each repeat once', () => {
    const stack = [
      'Error',
      '    at FlowRecorder.ws (/repo/server/flows.ts:20:11)',
      '    at Hub.send (/repo/server/hub.ts:28:5)',
      '    at GoalTools.update (/repo/server/agents/manager/core.ts:88:14)',
      '    at GoalTools.update (/repo/server/agents/manager/core.ts:90:3)',
      '    at /repo/server/agents/manager/goalTools.ts:51:9',
      '    at async Leads.note (/repo/server/agents/manager/leads.ts:12:1)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    expect(chainOf(stack, ['server/flows.ts', 'server/hub.ts'], '/repo')).toEqual([
      { file: 'server/agents/manager/leads.ts', fn: 'Leads.note' },
      { file: 'server/agents/manager/goalTools.ts' },
      { file: 'server/agents/manager/core.ts', fn: 'GoalTools.update' },
    ]);
    expect(chainOf(undefined, [])).toEqual([]);
  });
});

describe('TraceCounter', () => {
  it('counts each chain a kind of message went by, the busiest first, and skips an empty one', () => {
    const traces = new TraceCounter();
    const a = [{ file: 'a.ts', fn: 'go' }];
    traces.add('ws', 'agent', a);
    traces.add('ws', 'agent', [{ file: 'b.ts' }]);
    traces.add('ws', 'agent', a);
    traces.add('ws', 'agent', []);
    expect(traces.list()).toEqual([
      { via: 'ws', name: 'agent', chain: a, count: 2 },
      { via: 'ws', name: 'agent', chain: [{ file: 'b.ts' }], count: 1 },
    ]);
  });
});
