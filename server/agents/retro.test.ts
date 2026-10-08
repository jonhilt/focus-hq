import { describe, expect, it } from 'vitest';
import type { FrictionGroup } from '../../shared/ledger';
import { freshRetro, retroAfterRestart } from '../store';
import { messageFrom, parseDrafts, renderFrictions } from './retro';

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
