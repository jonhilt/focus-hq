import { describe, expect, it } from 'vitest';
import type { GoalNote, LeadAgent, LeadWork, QaReport, Waypoint } from '../../shared/types';
import { goalRecord, reopenedWork } from './lead';
import { committedWaypoint, endedProbe, evidenceFile, landedWaypoint, launchedProbe, nextWaypoints, notedSlice, notedWaypoint, opening, shieldedWaypoint, shippedWaypoint, taskedWaypoint, tickedSpotCheck, WAYPOINT_LIMITS, withWaypoint } from './waypoints';

const note = (done: string, learned: string[] = []): GoalNote => ({ done, learned, next: [] });

describe('waypoints', () => {
  it('adds this slice’s waypoint the first time anything happens in it, starting then', () => {
    expect(withWaypoint({ slice: 2, waypoints: undefined }, 50, (w) => w)).toEqual([{ slice: 2, startedAt: 50 }]);
    const course = [{ slice: 1, startedAt: 10, landedAt: 40 }, { slice: 2, startedAt: 40 }];
    expect(withWaypoint({ slice: 2, waypoints: course }, 50, (w) => ({ ...w, title: 'Header' }))).toEqual([course[0], { slice: 2, startedAt: 40, title: 'Header' }]);
  });

  it('keeps the latest ones when a goal runs long', () => {
    const course = Array.from({ length: WAYPOINT_LIMITS.kept }, (_, i) => ({ slice: i + 1, startedAt: i }));
    const after = withWaypoint({ slice: WAYPOINT_LIMITS.kept + 1, waypoints: course }, 99, (w) => w);
    expect(after).toHaveLength(WAYPOINT_LIMITS.kept);
    expect(after[0].slice).toBe(2);
    expect(after.at(-1)).toEqual({ slice: WAYPOINT_LIMITS.kept + 1, startedAt: 99 });
  });

  it('takes the slice’s intent from what it first shipped with', () => {
    const first = shippedWaypoint({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] }, { title: 'Saved items  survive a reload', summary: '## What\n\nSaves **items** to [the store](http://x).\n\nTested by hand.' }, 5);
    expect(first).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items survive a reload', summary: 'Saves items to the store.' }]);
    // shipping again (to fix what QA found) leaves it, as it leaves what the pull requests say
    expect(shippedWaypoint({ slice: 1, waypoints: first }, { title: 'Fix what QA found', summary: 'Handles the empty case.' }, 9)).toEqual(first);
    expect(shippedWaypoint({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] }, { title: 'Saved items', summary: '' }, 9)).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items' }]);
  });

  it('cuts a long description at a word', () => {
    const text = 'word '.repeat(100);
    const cut = opening(text, 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut).toMatch(/word…$/);
    expect(opening('- one\n- two')).toBe('one two');
    expect(opening('')).toBe('');
  });

  it('puts a lesson the lead adds on this slice’s waypoint, keeping its last few', () => {
    const work = { slice: 2, waypoints: [{ slice: 1, startedAt: 0, landedAt: 5 }, { slice: 2, startedAt: 5, title: 'Header' }], note: note('Saved items work') };
    let after = notedWaypoint(work, { learned: ' The store  is fine ' }, note('Saved items work', ['The store is fine']), 9);
    expect(after?.[1]).toEqual({ slice: 2, startedAt: 5, title: 'Header', learned: ['The store is fine'] });
    for (const line of ['b', 'c', 'd']) after = notedWaypoint({ ...work, waypoints: after }, { learned: line }, note('Saved items work'), 9);
    expect(after?.[1].learned).toEqual(['b', 'c', 'd']);
    // merging old lessons, or a note that changes nothing on the course, leaves the waypoints as they were
    expect(notedWaypoint(work, { allLearned: ['merged'] }, note('Saved items work', ['merged']), 9)).toBe(work.waypoints);
    expect(notedWaypoint(work, { next: ['Header'] }, note('Saved items work'), 9)).toBe(work.waypoints);
  });

  it('puts what the lead notes after a landing on the slice that landed, until the next one ships', () => {
    const landed = { slice: 1, startedAt: 0, landedAt: 5, title: 'Saved items' };
    const work = { slice: 2, waypoints: [landed, { slice: 2, startedAt: 5 }], note: note('Saved items work') };
    expect(notedSlice(work)).toBe(1);
    const after = notedWaypoint(work, { learned: 'The store holds up', done: 'Saved items, in the header' }, note('Saved items, in the header'), 9);
    expect(after).toEqual([{ ...landed, learned: ['The store holds up'], turnedFrom: 'Saved items work' }, { slice: 2, startedAt: 5 }]);
    // once this slice ships, what's noted is about it
    expect(notedSlice({ slice: 2, waypoints: [landed, { slice: 2, startedAt: 5, title: 'Header' }] })).toBe(2);
    // with nothing shipped yet, it's the slice under way
    expect(notedSlice({ slice: 1, waypoints: [{ slice: 1, startedAt: 0 }] })).toBe(1);
    expect(notedSlice({ slice: 3, waypoints: undefined })).toBe(3);
  });

  it('marks a course correction when done changes, from what it was as the slice began', () => {
    const work = { slice: 2, waypoints: [{ slice: 2, startedAt: 5 }], note: note('Push notifications') };
    const turned = notedWaypoint(work, { done: 'A badge' }, note('A badge'), 9);
    expect(turned).toEqual([{ slice: 2, startedAt: 5, turnedFrom: 'Push notifications' }]);
    // changing it again keeps where the slice started from; changing it back is no correction at all
    expect(notedWaypoint({ ...work, waypoints: turned, note: note('A badge') }, { done: 'A badge and a sound' }, note('A badge and a sound'), 9)?.[0].turnedFrom).toBe('Push notifications');
    expect(notedWaypoint({ ...work, waypoints: turned, note: note('A badge') }, { done: 'Push notifications' }, note('Push notifications'), 9)).toEqual([{ slice: 2, startedAt: 5 }]);
    // agreeing done for the first time isn't a correction
    expect(notedWaypoint({ ...work, note: undefined }, { done: 'A badge' }, note('A badge'), 9)).toBe(work.waypoints);
  });

  it('lands the slice when its last pull request does, and starts the next when the lead moves on', () => {
    const work = { slice: 1, waypoints: [{ slice: 1, startedAt: 0, title: 'Saved items' }] };
    const landed = landedWaypoint(work, 20);
    expect(landed).toEqual([{ slice: 1, startedAt: 0, title: 'Saved items', landedAt: 20 }]);
    expect(nextWaypoints({ slice: 1, waypoints: landed }, 30)).toEqual([landed[0], { slice: 2, startedAt: 30 }]);
    // a goal started before waypoints were kept still gets its course from here on
    expect(nextWaypoints({ slice: 3, waypoints: undefined }, 30)).toEqual([{ slice: 3, startedAt: 30, landedAt: 30 }, { slice: 4, startedAt: 30 }]);
  });

  it('travel with a closed goal and come back when it reopens', () => {
    const waypoints = [{ slice: 1, startedAt: 0, landedAt: 5, title: 'Saved items' }, { slice: 2, startedAt: 5 }];
    const work: LeadWork = { station: 1, title: 'Saved items', repos: [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }], slice: 2, prs: [], waypoints };
    const lead = { id: 'lead_p_1', name: 'Lt. Varga', branch: 'focus/saved-2-ab12', startedAt: 0, lead: work } as LeadAgent;
    const record = goalRecord(lead, 99);
    expect(record.waypoints).toEqual(waypoints);
    expect(reopenedWork(record, 3).waypoints).toEqual(waypoints);
    expect(goalRecord({ ...lead, lead: { ...work, waypoints: undefined } }, 99)).not.toHaveProperty('waypoints');
  });
});

describe('shields and spot-checks', () => {
  const qa = (r: Partial<QaReport> = {}): QaReport => ({ verdict: 'pass', summary: 'ok', checks: [{ name: 'Works', result: 'pass', details: '' }, { name: 'Empty state', result: 'pass', details: '' }], commands: [], captions: [], ...r });
  const work = { slice: 2, waypoints: [{ slice: 2, startedAt: 5 }] };

  it('takes each pull request’s latest QA verdict as its shield, with how CI stood', () => {
    const failed = shieldedWaypoint(work, { repo: 'acme/web', pr: 9, report: qa({ verdict: 'fail', checks: [{ name: 'Works', result: 'pass', details: '' }, { name: 'Empty state', result: 'fail', details: '' }] }), failedRounds: 1, ci: 'passing' }, 10);
    expect(failed[0].shields).toEqual([{ repo: 'acme/web', pr: 9, verdict: 'fail', checks: { pass: 1, fail: 1, skip: 0 }, failing: ['Empty state'], failedRounds: 1, ci: 'passing', at: 10 }]);
    // fixed and passed: one shield for the pull request, which remembers the round it failed
    const fixed = shieldedWaypoint({ ...work, waypoints: failed }, { repo: 'acme/web', pr: 9, report: qa(), failedRounds: 1 }, 20);
    expect(fixed[0].shields).toEqual([{ repo: 'acme/web', pr: 9, verdict: 'pass', checks: { pass: 2, fail: 0, skip: 0 }, failedRounds: 1, at: 20 }]);
    // another repo's pull request in the same slice has a shield of its own
    expect(shieldedWaypoint({ ...work, waypoints: fixed }, { repo: 'acme/api', pr: 3, report: qa(), failedRounds: 0 }, 30)[0].shields?.map((s) => s.repo)).toEqual(['acme/web', 'acme/api']);
  });

  it('keeps this round’s spot-checks, and the captain’s tick on any picked again', () => {
    const first = shieldedWaypoint(work, { repo: 'acme/web', pr: 9, report: qa({ spotChecks: [{ file: 'a.ts', line: 4, why: 'Gate' }, { file: 'b.ts', why: 'Route' }] }), failedRounds: 0 }, 10);
    const ticked = tickedSpotCheck({ waypoints: first }, 2, 0, true, 15);
    if ('error' in ticked) throw new Error(ticked.error);
    expect(ticked[0].spotChecks?.[0]).toEqual({ file: 'a.ts', line: 4, why: 'Gate', repo: 'acme/web', pr: 9, checked: 15 });
    const again = shieldedWaypoint({ ...work, waypoints: ticked }, { repo: 'acme/web', pr: 9, report: qa({ spotChecks: [{ file: 'a.ts', line: 4, why: 'Gate, still' }, { file: 'c.ts', why: 'New' }] }), failedRounds: 0 }, 20);
    expect(again[0].spotChecks).toEqual([{ file: 'a.ts', line: 4, why: 'Gate, still', repo: 'acme/web', pr: 9, checked: 15 }, { file: 'c.ts', why: 'New', repo: 'acme/web', pr: 9 }]);
  });

  it('lets the captain un-tick one, and refuses one that isn’t there', () => {
    const picked = shieldedWaypoint(work, { repo: 'acme/web', pr: 9, report: qa({ spotChecks: [{ file: 'a.ts', why: 'Gate' }] }), failedRounds: 0 }, 10);
    const on = tickedSpotCheck({ waypoints: picked }, 2, 0, true, 15);
    if ('error' in on) throw new Error(on.error);
    const off = tickedSpotCheck({ waypoints: on }, 2, 0, false, 16);
    if ('error' in off) throw new Error(off.error);
    expect(off[0].spotChecks?.[0]).not.toHaveProperty('checked');
    expect(tickedSpotCheck({ waypoints: picked }, 2, 5, true, 15)).toEqual({ error: 'There\'s no spot-check 6 on waypoint 2' });
    expect(tickedSpotCheck({ waypoints: picked }, 7, 0, true, 15)).toHaveProperty('error');
  });
});

describe('evidence', () => {
  const qa: QaReport = { verdict: 'pass', summary: 'ok', checks: [], commands: [], captions: [] };
  const shot = (pr: number, caption: string) => ({ repo: 'acme/web', pr, caption, file: `shot-acme-web-${pr}-1.jpg` });

  it('keeps each pull request’s latest round of screenshots on the slice’s waypoint', () => {
    const work = { slice: 2, waypoints: [{ slice: 2, startedAt: 5 }] };
    const first = shieldedWaypoint(work, { repo: 'acme/web', pr: 9, report: qa, failedRounds: 0, evidence: [shot(9, 'Empty list')] }, 10);
    const other = shieldedWaypoint({ ...work, waypoints: first }, { repo: 'acme/web', pr: 10, report: qa, failedRounds: 0, evidence: [shot(10, 'Header')] }, 11);
    const again = shieldedWaypoint({ ...work, waypoints: other }, { repo: 'acme/web', pr: 9, report: qa, failedRounds: 1, evidence: [shot(9, 'Fixed list')] }, 12);
    expect(again[0].evidence?.map((e) => e.caption)).toEqual(['Header', 'Fixed list']);
    // a round with no screenshots leaves none for that pull request
    expect(shieldedWaypoint({ ...work, waypoints: again }, { repo: 'acme/web', pr: 10, report: qa, failedRounds: 0 }, 13)[0].evidence?.map((e) => e.caption)).toEqual(['Fixed list']);
  });

  it('names its own copy of each screenshot after the repo, pull request and place', () => {
    expect(evidenceFile('Acme/Web.App', 9, 0, 'acme-web-9-123-1.png')).toBe('shot-acme-web-app-9-1.png');
    expect(evidenceFile('acme/web', 12, 2, 'x.jpg')).toBe('shot-acme-web-12-3.jpg');
    // the demo's QA screenshots are drawn as SVG: a copy keeps its type, so the browser can show it
    expect(evidenceFile('demo/webshop-frontend', 9, 0, 'demo-webshop-frontend-9-1791-1.svg')).toBe('shot-demo-webshop-frontend-9-1.svg');
  });
});

describe('probes', () => {
  const course = [{ slice: 1, startedAt: 10, landedAt: 40 }, { slice: 2, startedAt: 40 }];

  it('launches one from the slice under way for each helper the lead sends out', () => {
    const after = launchedProbe({ slice: 2, waypoints: course }, { id: 'toolu_1', description: '  Find how\nthe office sees  tool calls ', type: 'Explore' }, 50);
    expect(after[1].probes).toEqual([{ id: 'toolu_1', description: 'Find how the office sees tool calls', type: 'Explore', launchedAt: 50 }]);
    expect(after[0]).toEqual(course[0]);
    // the same helper again is the same probe
    expect(launchedProbe({ slice: 2, waypoints: after }, { id: 'toolu_1', description: 'Again' }, 60)).toBe(after);
  });

  it('keeps the latest few on a slice', () => {
    let waypoints: Waypoint[] = course;
    for (let i = 0; i < WAYPOINT_LIMITS.probes + 2; i++) waypoints = launchedProbe({ slice: 2, waypoints }, { id: `h${i}`, description: `Probe ${i}` }, 50 + i);
    expect(waypoints[1].probes!.map((p) => p.id)).toEqual(Array.from({ length: WAYPOINT_LIMITS.probes }, (_, i) => `h${i + 2}`));
  });

  it('keeps scripts from crowding out the helpers', () => {
    let waypoints: Waypoint[] = launchedProbe({ slice: 2, waypoints: course }, { id: 'helper', description: 'Map the repo', type: 'Explore' }, 50);
    for (let i = 0; i < WAYPOINT_LIMITS.probes + 3; i++) waypoints = launchedProbe({ slice: 2, waypoints }, { id: `s${i}`, description: `Script p${i}.ts`, type: 'script' }, 60 + i);
    const ids = waypoints[1].probes!.map((p) => p.id);
    expect(ids[0]).toBe('helper');
    expect(ids).toHaveLength(WAYPOINT_LIMITS.probes + 1);
  });

  it('ends one with how it went and the opening of what it reported, on the slice that launched it', () => {
    const out = launchedProbe({ slice: 1, waypoints: [{ slice: 1, startedAt: 10 }] }, { id: 'h1', description: 'Map the flaky test' }, 20);
    // the next slice has begun by the time it reports
    const later = { slice: 2, waypoints: [...out, { slice: 2, startedAt: 30 }] };
    const after = endedProbe(later, { id: 'h1', ok: true, summary: '## Found\n\nThe **reopen** test races the store.\n\nMore detail.' }, 90)!;
    expect(after[0].probes).toEqual([{ id: 'h1', description: 'Map the flaky test', launchedAt: 20, endedAt: 90, ok: true, summary: 'The reopen test races the store.' }]);
    expect(after[1]).toEqual({ slice: 2, startedAt: 30 });
    // one it never launched, or that has already reported, changes nothing
    expect(endedProbe(later, { id: 'h9', ok: true }, 90)).toBeUndefined();
    expect(endedProbe({ slice: 2, waypoints: after }, { id: 'h1', ok: false }, 95)).toBeUndefined();
  });
});

describe('the slice under way', () => {
  const course = [{ slice: 1, startedAt: 10, landedAt: 40, title: 'Chart' }, { slice: 2, startedAt: 40 }];
  it('counts its commits, keeping the last one’s first line', () => {
    const once = committedWaypoint({ slice: 2, waypoints: course }, 'Heading on the chart\n\nMore detail', 50);
    const twice = committedWaypoint({ slice: 2, waypoints: once }, undefined, 60);
    expect(twice[1]).toEqual({ slice: 2, startedAt: 40, commits: 2, lastCommit: 'Heading on the chart' });
  });

  it('keeps the tasks the lead adds or moves on during it, as they now stand, and not ones carried over untouched', () => {
    const old = { id: '1', subject: 'From the last slice', status: 'pending' as const };
    const probe = { id: '2', subject: 'Probe the SDK', status: 'pending' as const, activeForm: 'Probing' };
    const added = taskedWaypoint({ slice: 2, waypoints: course }, [old], [old, probe], 50);
    expect(added?.[1]).toEqual({ slice: 2, startedAt: 40, tasks: [{ id: '2', subject: 'Probe the SDK', status: 'pending' }] });
    expect(added?.[0]).toBe(course[0]);

    const started = taskedWaypoint({ slice: 2, waypoints: added }, [old, probe], [{ ...old, status: 'in_progress' }, { ...probe, status: 'completed' }], 60);
    expect(started?.[1].tasks).toEqual([{ id: '2', subject: 'Probe the SDK', status: 'completed' }, { id: '1', subject: 'From the last slice', status: 'in_progress' }]);
  });

  it('drops a task the lead deletes, and is the same when nothing it keeps changed', () => {
    const a = { id: '1', subject: 'A', status: 'pending' as const };
    const b = { id: '2', subject: 'B', status: 'pending' as const };
    const both = taskedWaypoint({ slice: 2, waypoints: course }, [], [a, b], 50);
    expect(taskedWaypoint({ slice: 2, waypoints: both }, [a, b], [b], 60)?.[1].tasks).toEqual([b]);
    expect(taskedWaypoint({ slice: 2, waypoints: both }, [a, b], [a, b], 60)).toBe(both);
    // a new session starts its own list: what the slice did stays on its waypoint
    expect(taskedWaypoint({ slice: 2, waypoints: both }, [], [], 60)).toBe(both);
  });

  it('keeps a task from an earlier session when the next session’s list numbers one the same', () => {
    const a = { id: '1', subject: 'A', status: 'completed' as const };
    const earlier = taskedWaypoint({ slice: 2, waypoints: course }, [], [a], 50);
    // the new session's task 1 is another task altogether
    const fresh = { id: '1', subject: 'Fresh', status: 'pending' as const };
    const next = taskedWaypoint({ slice: 2, waypoints: earlier }, [], [fresh], 60);
    expect(next?.[1].tasks).toEqual([{ ...a, id: "1'" }, fresh]);
    // and it moves on as this list's from then on
    expect(taskedWaypoint({ slice: 2, waypoints: next }, [fresh], [{ ...fresh, status: 'completed' }], 70)?.[1].tasks).toEqual([{ ...a, id: "1'" }, { ...fresh, status: 'completed' }]);
  });
});
