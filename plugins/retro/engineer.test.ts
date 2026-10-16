import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Issue, PluginHost } from '../../plugin-api/server';
import { office } from '../../plugin-api/testing';
import { ChiefEngineer, type RetroRequest } from './engineer';
import retroPlugin from './server';
import { freshRetro, RETRO, type Retro } from './shared';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const facts = { minutes: 1, turns: 1, toolCalls: 1, failedCalls: 0, refusedCalls: 0, repeatedCalls: 0, wastedCalls: 0, captainMessages: 0, nudges: 0, officeMessages: 0, compactions: 0, qaFails: 0, conflicts: 0 };

/**
 * The chief engineer in the pretend office, on the host it lends plugins. `unread`: the digests haven't been read for
 * frictions, and their transcripts say what the reader will find; `missing` sessions have no transcript.
 */
function engineer(structured: unknown, sessions: string[], opts: { unread?: boolean; missing?: string[] } = {}) {
  const o = office();
  for (const s of sessions) {
    o.store.record({
      kind: 'session-digest', key: `${s}:u`, sessionId: s, agentId: s, agent: `Ens. ${s}`, task: 'issue', prs: [], toUuid: 'u', facts,
      ...(!opts.unread && { frictions: [{ kind: 'demo-env' as const, signature: 'demo port in use', quote: `EADDRINUSE in ${s}` }] }),
      at: Date.now() - 60_000, projectId: o.project.id,
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retros-'));
  dirs.push(dir);
  const asked: RetroRequest[] = [];
  const prompts: string[] = [];
  const filed: { repo: string; title: string; body: string }[] = [];
  const officer = {
    read: ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      const spans = [...prompt.matchAll(/<span id="([^"]+)">\n([\s\S]*?)\n<\/span>/g)].map(([, id, text]) => ({ id, frictions: [{ kind: 'demo-env', signature: 'demo port in use', quote: /EADDRINUSE in \w+/.exec(text)![0] }] }));
      return Promise.resolve({ structured: { spans }, costUsd: 0.5 });
    },
    retro: (req: RetroRequest) => (asked.push(req), Promise.resolve({ structured, text: '', costUsd: 0.03 })),
  };
  const transcript = (s: string) => JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-08T12:00:00.000Z', message: { content: `[Office] Error: listen EADDRINUSE in ${s}` } });
  o.agents.readTranscript = (id) => Promise.resolve(opts.missing?.includes(id) ? undefined : transcript(id));
  let lent: PluginHost | undefined;
  o.agents.startPlugins([{ id: RETRO, start: (host) => ((lent = host), {}) }], {
    demo: false,
    ownRepo: () => undefined,
    fileIssue: (_projectId, repo, title, body) => {
      filed.push({ repo, title, body });
      return Promise.resolve<Issue>({ repo, number: 42, title, body, url: `https://github.com/${repo}/issues/42`, labels: [], createdAt: '' });
    },
  });
  const host = lent!;
  return { ...o, asked, prompts, filed, eng: new ChiefEngineer(host, host.state<Retro>(freshRetro), officer, dir, 0) };
}

async function finished(eng: ChiefEngineer) {
  for (let i = 0; i < 200 && (eng.current().status === 'gathering' || eng.current().status === 'thinking'); i++) await new Promise((r) => setTimeout(r, 5));
  return eng.current();
}

describe('ChiefEngineer', () => {
  const drafted = { summary: 'Ports.', drafts: [{ groups: ['G1'], title: 'Give each workspace its own demo port', body: 'It keeps happening.\n\n## What to build\nA port each.\n\n## Done when\nNo clash.', kind: 'check', measure: '3 sessions' }] };

  it('drafts from the frictions that came up in three sessions, and keeps the retro in its slot for the browser', async () => {
    const { eng, asked, agents } = engineer(drafted, ['a', 'b', 'c']);
    eng.start(14);
    const retro = await finished(eng);
    expect(retro).toMatchObject({ status: 'done', sessions: 3, costUsd: 0.03, drafts: [{ title: 'Give each workspace its own demo port', signatures: ['demo-env: demo port in use'], sessions: 3 }] });
    expect(retro.drafts[0].body).toContain('## Evidence\n**demo-env: demo port in use**, in 3 sessions:');
    expect(fs.readFileSync(path.join(asked[0].cwd, 'frictions.md'), 'utf8')).toContain('## G1: demo-env: demo port in use (3 sessions)');
    expect(agents.plugins.stateOf(RETRO)).toEqual(retro);
  });

  it('files an accepted draft where the captain picked, signed, and writes each decision in the ledger once', async () => {
    const { eng, store, project, filed } = engineer(drafted, ['a', 'b', 'c']);
    eng.start(14);
    const [draft] = (await finished(eng)).drafts;
    await expect(eng.decide(draft.id, true)).rejects.toThrow('Pick the repository');
    await expect(eng.decide(draft.id, true, project.id, 'someone/else')).rejects.toThrow('isn’t one of Shop’s repositories');
    const done = await eng.decide(draft.id, true, project.id, 'demo/webshop-api');
    expect(done.decision).toMatchObject({ accepted: true, issue: { repo: 'demo/webshop-api', number: 42 } });
    expect(filed).toHaveLength(1);
    expect(filed[0].body).toMatch(/_Drafted by .+, the Focus office's chief engineer, from frictions in 3 agent sessions; accepted by the captain._$/);
    expect(store.ledger.at(-1)).toMatchObject({ kind: 'retro-decision', projectId: project.id, accepted: true, signatures: ['demo-env: demo port in use'], issue: { repo: 'demo/webshop-api', number: 42 } });
    await expect(eng.decide(draft.id, false)).rejects.toThrow('already accepted');
    expect(eng.current().drafts[0].decision?.accepted).toBe(true);
  });

  it('files a draft accepted twice at once only once', async () => {
    const { eng, store, project, filed } = engineer(drafted, ['a', 'b', 'c']);
    eng.start(14);
    const [draft] = (await finished(eng)).drafts;
    const [first, second] = await Promise.allSettled([eng.decide(draft.id, true, project.id, 'demo/webshop-api'), eng.decide(draft.id, true, project.id, 'demo/webshop-api')]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { message: 'That draft is being decided on already' } });
    expect(filed).toHaveLength(1);
    expect(store.ledger.filter((e) => e.kind === 'retro-decision')).toHaveLength(1);
  });

  it('reads the sessions no one has read yet, once, and drafts from what it found', async () => {
    const { eng, store, prompts, asked } = engineer(drafted, ['a', 'b', 'c', 'd'], { unread: true, missing: ['d'] });
    expect(eng.preview(14)).toEqual({ unread: 4, costUsd: 0.1 });
    eng.start(14);
    const retro = await finished(eng);
    expect(prompts).toHaveLength(1);
    expect(retro).toMatchObject({ status: 'done', costUsd: 0.53, drafts: [{ signatures: ['demo-env: demo port in use'], sessions: 3 }] });
    expect(asked).toHaveLength(1);
    const read = store.ledger.filter((e) => e.kind === 'session-frictions');
    expect(read.map((e) => [e.sessionId, 'missing' in e && e.missing === true])).toEqual([['d', true], ['a', false], ['b', false], ['c', false]]);
    expect(eng.preview(14)).toEqual({ unread: 0, costUsd: 0 });
    eng.start(14);
    await finished(eng);
    expect(prompts).toHaveLength(1);
  });

  it('doesn’t trouble the engineer when nothing came up three times, and watches what came up twice', async () => {
    const { eng, asked } = engineer(drafted, ['a', 'b']);
    eng.start(14);
    const retro = await finished(eng);
    expect(retro).toMatchObject({ status: 'done', activity: 'Nothing keeps coming back', drafts: [], watch: ['demo-env: demo port in use (2 sessions)'] });
    expect(retro.summary).toBeDefined();
    expect(asked).toHaveLength(0);
  });

  it('starts each retro afresh, without the last one’s summary or error', async () => {
    const { eng } = engineer(drafted, ['a']);
    eng.start(14);
    expect((await finished(eng)).summary).toBeDefined();
    eng.start(14);
    expect(eng.current()).not.toHaveProperty('summary', expect.anything());
    expect(eng.stop()).toMatchObject({ status: 'failed', error: 'Stopped by the captain' });
  });
});

describe('the retro plugin', () => {
  it('ends a retro that was under way when Focus shut down, and answers on its routes', async () => {
    const o = office();
    o.store.plugins[RETRO] = { ...freshRetro(), status: 'thinking', activity: 'Drafting' };
    o.agents.startPlugins([retroPlugin], { demo: false, ownRepo: () => undefined });
    expect(o.agents.plugins.stateOf(RETRO)).toMatchObject({ status: 'failed', activity: 'Interrupted' });
    const route = (p: string) => o.agents.plugins.routes().find((r) => r.route.path === p)?.route;
    expect(o.agents.plugins.routes().map((r) => `${r.route.method} ${r.route.path}`)).toEqual(['post /preview', 'post /start', 'post /stop', 'post /decide']);
    expect(route('/preview')?.handle({ body: { days: 7 }, query: {} })).toEqual({ unread: 0, costUsd: 0 });
    await expect(route('/decide')?.handle({ body: { id: 'nope', accept: false }, query: {} })).rejects.toThrow('That draft isn’t in the latest retro');
  });
});
