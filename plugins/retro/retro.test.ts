import { describe, expect, it } from 'vitest';
import type { FrictionGroup } from '../../plugin-api/shared';
import { parseDrafts, renderFrictions } from './retro';
import { draftDecision, fileInChoices, freshRetro, type Retro, retroAfterRestart, retroCardLine, type RetroDraft, retroPage, retroStanding, startReading, stationLine, windowInput } from './shared';

const DAY = 24 * 60 * 60 * 1000;
const group = (key: string, sessions: number): FrictionGroup => {
  const [kind, signature] = key.split(': ') as [FrictionGroup['kind'], string];
  return { key, kind, signature, sessions, moments: [{ agent: 'Ens. A', at: 3 * DAY, quote: `${signature}, again` }] };
};
const groups = [group('demo-env: demo port in use', 5), group('shell: zsh glob no matches', 3), group('guard-block: dcg blocks rm -rf', 3)];

describe('renderFrictions', () => {
  it('lists each group under the id drafts cite, with its moments quoted', () => {
    const page = renderFrictions(groups, 14);
    expect(page).toContain('## G1: demo-env: demo port in use (5 sessions)\n- 1970-01-04 Ens. A: “demo port in use, again”');
    expect(page).toContain('## G3: guard-block: dcg blocks rm -rf (3 sessions)');
  });
});

describe('parseDrafts', () => {
  let n = 0;
  const id = () => `d${++n}`;
  const draft = (groupIds: string[], title = 'Give each workspace its own demo port') => ({ groups: groupIds, title, body: 'It keeps happening.\n\n## What to build\nA port each.\n\n## Done when\nNo clash.', kind: 'check', measure: 'Sessions with it: 5' });

  it('keeps drafts resting on real groups, with the quoted evidence added by code', () => {
    const out = parseDrafts({ summary: 'Ports.', drafts: [draft(['G1']), draft(['g2', 'G3'], 'Stop shell commands tripping')] }, groups, id);
    expect(out?.drafts.map((d) => [d.title, d.signatures, d.sessions])).toEqual([
      ['Give each workspace its own demo port', ['demo-env: demo port in use'], 5],
      ['Stop shell commands tripping', ['shell: zsh glob no matches', 'guard-block: dcg blocks rm -rf'], 3],
    ]);
    expect(out?.drafts[0].body).toBe('It keeps happening.\n\n## What to build\nA port each.\n\n## Done when\nNo clash.\n\n## Evidence\n**demo-env: demo port in use**, in 5 sessions:\n- 1970-01-04 Ens. A: “demo port in use, again”\n');
  });

  it('drops a draft citing no real group, or a group another draft already took', () => {
    const out = parseDrafts({ summary: 's', drafts: [draft(['G1']), draft(['G1'], 'Again'), draft(['G9'], 'Made up'), { ...draft(['G2']), body: '' }] }, groups, id);
    expect(out?.drafts.map((d) => d.title)).toEqual(['Give each workspace its own demo port']);
  });

  it('falls back to a pointer for an unknown kind, and gives up on nothing at all', () => {
    expect(parseDrafts({ summary: 's', drafts: [{ ...draft(['G1']), kind: 'essay' }] }, groups, id)?.drafts[0].kind).toBe('pointer');
    expect(parseDrafts(undefined, groups, id)).toBeUndefined();
    expect(parseDrafts([{ summary: 's', drafts: [draft(['G1'])] }], groups, id)).toBeUndefined();
    expect(parseDrafts({ summary: 's', drafts: [null, 'G1', [draft(['G1'])], draft(['G1'])] }, groups, id)?.drafts.map((d) => d.signatures)).toEqual([[groups[0].key]]);
    expect(parseDrafts({ drafts: [] }, groups, id)).toBeUndefined();
  });
});

describe('retroAfterRestart', () => {
  it('ends a retro that was under way when Focus shut down', () => {
    expect(retroAfterRestart({ ...freshRetro(), status: 'thinking' })).toMatchObject({ status: 'failed', activity: 'Interrupted' });
    expect(retroAfterRestart({ ...freshRetro(), status: 'done' }).status).toBe('done');
  });

  it('gives a retro saved before drafts none', () => {
    const { drafts: _d, ...old } = freshRetro();
    expect(retroAfterRestart({ ...old, status: 'done' } as never).drafts).toEqual([]);
  });
});

describe('stationLine', () => {
  const draft = (decided: boolean): RetroDraft => ({ id: 'd', title: 't', body: 'b', kind: 'check', measure: 'm', signatures: [], sessions: 3, ...(decided && { decision: { accepted: true, at: 1 } }) });

  it('leaves the engineer keeping the ship running while no retro has run', () => {
    expect(stationLine(undefined)).toBeNull();
    expect(stationLine(freshRetro())).toBeNull();
  });

  it('says what the retro is doing, how it failed, or what waits on the captain', () => {
    expect(stationLine({ ...freshRetro(), status: 'thinking', activity: 'Reading frictions.md' })).toEqual({ status: 'working', line: 'Retro: Reading frictions.md' });
    expect(stationLine({ ...freshRetro(), status: 'failed', error: 'Stopped by the captain' })).toEqual({ status: 'error', line: 'Retro: Stopped by the captain' });
    expect(stationLine({ ...freshRetro(), status: 'done', drafts: [draft(false), draft(false), draft(true)] })?.line).toBe('Retro: 2 drafts waiting');
    expect(stationLine({ ...freshRetro(), status: 'done', drafts: [draft(true)] })?.line).toBe('Retro: all drafts decided');
    expect(stationLine({ ...freshRetro(), status: 'done' })).toEqual({ status: 'done', line: 'Retro: nothing keeps coming back' });
  });
});

describe('the retro on the engineering panel', () => {
  const draft = (decided: boolean): RetroDraft => ({ id: 'd', title: 't', body: 'b', kind: 'check', measure: 'm', signatures: [], sessions: 3, ...(decided && { decision: { accepted: true, at: 1 } }) });
  const retro = (patch: Partial<Retro>): Retro => ({ ...freshRetro(), ...patch });

  it('says on its card what one under way is doing, what waits on the captain, or why the last one failed', () => {
    expect(retroCardLine(undefined)).toEqual({ line: 'Drafts an issue for each friction that keeps coming back', open: 'Open →' });
    expect(retroCardLine(retro({ status: 'gathering', activity: 'Reading 40 sessions' }))).toEqual({ line: 'Reading 40 sessions', open: 'Open →' });
    expect(retroCardLine(retro({ status: 'done', drafts: [draft(false), draft(true)] }))).toEqual({ line: '1 draft waits for you to accept or reject', open: 'Review drafts →' });
    expect(retroCardLine(retro({ status: 'done', drafts: [draft(false), draft(false)] })).line).toBe('2 drafts wait for you to accept or reject');
    expect(retroCardLine(retro({ status: 'failed', activity: 'Interrupted', error: 'Stopped by the captain' })).line).toBe('The last retro failed: Stopped by the captain');
    expect(retroCardLine(retro({ status: 'failed', activity: 'Interrupted' })).line).toBe('The last retro failed: Interrupted');
  });

  it('offers Stop while one runs, a new one once it’s done, and shows what it found', () => {
    expect(retroPage(undefined)).toEqual({ startLabel: 'Start a retro', running: false, cost: null, standing: null, found: null });
    expect(retroPage(retro({}))).toMatchObject({ standing: null, found: null });
    const thinking = retro({ status: 'thinking', costUsd: 1.234 });
    expect(retroPage(thinking)).toEqual({ startLabel: 'Start a retro', running: true, cost: '$1.23', standing: thinking, found: null });
    const done = retro({ status: 'done' });
    expect(retroPage(done)).toEqual({ startLabel: 'Start a new retro', running: false, cost: null, standing: done, found: done });
  });

  it('says how one stands: what it does, or why it failed, over which window and since when', () => {
    const ago = (at: number) => `${at} ago`;
    expect(retroStanding(retro({ status: 'gathering', activity: 'Reading 40 sessions', days: 7 }), ago)).toEqual({ tone: 'warn', headline: 'Reading 40 sessions', line: 'the last 7 days' });
    expect(retroStanding(retro({ status: 'done', activity: 'Drafted 2', sessions: 40, startedAt: 5 }), ago)).toEqual({ tone: 'ok', headline: 'Drafted 2', line: '40 sessions over 14 days · started 5 ago' });
    expect(retroStanding(retro({ status: 'failed', activity: 'Interrupted', error: 'Stopped by the captain' }), ago)).toMatchObject({ tone: 'bad', headline: 'Stopped by the captain' });
    expect(retroStanding(retro({ status: 'failed', activity: 'Interrupted' }), ago).headline).toBe('Interrupted');
  });

  it('keeps the window the captain typed across re-renders, and starts it again from a new retro’s', () => {
    const make = (n: number) => ({ days: n });
    const first = windowInput(undefined, undefined, make);
    expect(first).toEqual({ input: { days: 14 }, seededFrom: undefined });
    expect(windowInput(first, undefined, make)).toBe(first);
    const started = retro({ days: 7, startedAt: 5 });
    const seeded = windowInput(first, started, make);
    expect(seeded).toEqual({ input: { days: 7 }, seededFrom: 5 });
    expect(windowInput(seeded, started, make)).toBe(seeded);
  });

  it('says what starting one reads first, and what that costs', () => {
    expect(startReading('Lt. Cmdr. Okafor', 14, 40, 3.5)).toBe('Lt. Cmdr. Okafor first reads the 40 sessions of the last 14 days no one has read yet, for their frictions: roughly $3.50 of Claude usage, a batch at a time with a pause between. Sessions read before aren’t read again.');
    expect(startReading('Lt. Cmdr. Okafor', 7, 0, 0)).toBe('Every session of the last 7 days has been read already, so this only drafts.');
  });
});

describe('a draft on its card', () => {
  it('says a filed draft’s issue, linked, and an accepted one with none or a rejected one plainly', () => {
    expect(draftDecision({ accepted: true, at: 0, issue: { repo: 'jonhilt/focus', number: 227, url: 'https://x/227' } })).toEqual({ tone: 'ok', text: 'Filed jonhilt/focus#227', url: 'https://x/227' });
    expect(draftDecision({ accepted: true, at: 0 })).toEqual({ tone: 'ok', text: 'Accepted' });
    expect(draftDecision({ accepted: false, at: 0, issue: { repo: 'r', number: 1, url: 'u' } })).toEqual({ tone: 'off', text: 'Rejected' });
  });

  const projects = [{ id: 'p1', name: 'Focus', repos: ['jonhilt/focus', 'jonhilt/site'] }, { id: 'p2', name: 'Pets', repos: ['vets/pets'] }];

  it('offers every project’s repos, and picks the one picked last while it’s still on offer', () => {
    const { options, picked } = fileInChoices(projects, 'p2 vets/pets');
    expect(options.map((o) => o.label)).toEqual(['jonhilt/focus (Focus)', 'jonhilt/site (Focus)', 'vets/pets (Pets)']);
    expect(picked).toMatchObject({ projectId: 'p2', repo: 'vets/pets' });
  });

  it('picks the first repo when the last one’s gone or there wasn’t one, and none with no repos', () => {
    expect(fileInChoices(projects, 'p3 gone/repo').picked).toMatchObject({ projectId: 'p1', repo: 'jonhilt/focus' });
    expect(fileInChoices(projects, null).picked?.value).toBe('p1 jonhilt/focus');
    expect(fileInChoices([], 'p1 jonhilt/focus')).toEqual({ options: [], picked: undefined });
  });
});
