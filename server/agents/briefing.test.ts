import { describe, expect, it, vi } from 'vitest';
import { qaOfficerFor } from '../../shared/crew';
import { type Board, type Breakdown, type Brief, type Briefing, EMPTY_BRIEF, type EngineeringReport, type Issue, type Project, type PullRequest, type QaReview } from '../../shared/types';
import { Hub } from '../hub';
import { afterRestart, Store, type StoredBriefing } from '../store';
import {
  acceptanceChanged,
  asOfficerReply,
  asQaNote,
  type BriefingOfficer,
  type BriefingQa,
  type IssueFiler,
  briefingPrompt,
  briefingQaPrompt,
  briefingQaSystemPrompt,
  Briefings,
  briefingSystemPrompt,
  mergeBrief,
  type OfficerTurn,
  STEP_FORMAT,
} from './briefing';
import type { BriefingEngineer } from './engineering';
import type { IssuePlanner } from './planner';

const req = { planner: { name: 'Ensign Ro' }, projectId: 'p1', projectName: 'Shop', repos: ['acme/shop'] } as Parameters<typeof briefingSystemPrompt>[0];

describe('briefingSystemPrompt', () => {
  it('tells the officer they can search and read the web', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toContain('WebSearch');
    expect(prompt).toContain('WebFetch');
    expect(prompt).toMatch(/source/);
  });

  it('still points them at the code first', () => {
    expect(briefingSystemPrompt(req)).toContain('Read, Glob, Grep');
  });

  it('asks for diagrams on complex changes only: Today, one per option, then the chosen one', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toMatch(/complex changes only/);
    expect(prompt).toContain('"Today"');
    expect(prompt).toContain('"Option A: …"');
    expect(prompt).toContain('"Chosen: …"');
    expect(prompt).toMatch(/choose in the conversation/);
  });

  it('limits diagrams to types that parse, with quoted labels', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toContain('flowchart, classDiagram or sequenceDiagram');
    expect(prompt).toMatch(/label in double quotes/);
  });

  it('tells the officer QA sits in and the manager decides on their notes', () => {
    const prompt = briefingSystemPrompt(req);
    expect(prompt).toContain(qaOfficerFor('p1').name);
    expect(prompt).toMatch(/what the manager agrees to into the acceptance criteria/);
  });
});

describe('briefingPrompt', () => {
  const turn = (kind: Parameters<typeof briefingPrompt>[0]['kind']) =>
    briefingPrompt({ kind, idea: 'a wishlist', brief: EMPTY_BRIEF, messages: [{ from: 'manager', text: 'a wishlist', at: 0 }], resumeSessionId: 's1' });

  it('asks the wrap-up for an Approach in Context, with a mermaid block, only when an option was chosen', () => {
    const prompt = turn('wrap-up');
    expect(prompt).toMatch(/end Context with an "### Approach" subsection/);
    expect(prompt).toContain('```mermaid');
    expect(prompt).toMatch(/If no option was chosen, leave that section out/);
  });

  it('leaves Approach out of the other turns', () => {
    expect(turn('open')).not.toContain('Approach');
    expect(turn('reply')).not.toContain('Approach');
  });

  it('keeps only the suggestions the manager agreed to in the wrapped-up criteria', () => {
    expect(turn('wrap-up')).toMatch(/QA officer's suggestions the manager agreed to, and only those/);
  });

  it('passes QA’s note since the officer’s last reply on with the manager’s answer', () => {
    const prompt = briefingPrompt({
      kind: 'reply',
      idea: 'a wishlist',
      brief: EMPTY_BRIEF,
      resumeSessionId: 's1',
      messages: [
        { from: 'manager', text: 'a wishlist', at: 0 },
        { from: 'officer', text: 'Added the criteria.', at: 1 },
        { from: 'qa', text: 'Say what “fast” means.', at: 2 },
        { from: 'manager', text: 'Agreed, under a second.', at: 3 },
      ],
    });
    expect(prompt).toContain('Say what “fast” means.');
    expect(prompt).toContain('Agreed, under a second.');
  });

  it('sends just the manager’s answer when QA had nothing to say', () => {
    const messages = [
      { from: 'officer' as const, text: 'Added the criteria.', at: 1 },
      { from: 'qa' as const, text: 'An old note.', at: 2 },
      { from: 'officer' as const, text: 'Taken on board.', at: 3 },
      { from: 'manager' as const, text: 'Next.', at: 4 },
    ];
    expect(briefingPrompt({ kind: 'reply', idea: '', brief: EMPTY_BRIEF, resumeSessionId: 's1', messages })).toBe('Next.');
  });
});

describe('briefing QA prompts', () => {
  const qaReq = { qa: { name: 'Lt. Varga' }, planner: { name: 'Ensign Ro' }, projectName: 'Shop', repos: ['acme/shop'], qaBrief: '' } as Parameters<typeof briefingQaSystemPrompt>[0];

  it('checks the criteria against the project’s QA brief', () => {
    expect(briefingQaSystemPrompt({ ...qaReq, qaBrief: 'Every page works with the keyboard alone' })).toContain('Every page works with the keyboard alone');
    expect(briefingQaSystemPrompt(qaReq)).toMatch(/no QA brief/);
  });

  it('asks for one note at most: an untestable criterion with a rewrite, a missing edge case, or the QA brief', () => {
    const prompt = briefingQaSystemPrompt(qaReq);
    expect(prompt).toMatch(/One note at most/);
    expect(prompt).toMatch(/testable rewrite/);
    expect(prompt).toMatch(/missing edge case/);
    expect(prompt).toMatch(/QA brief requires/);
    expect(prompt).toMatch(/leave the note empty/);
  });

  it('shows the criteria before and after the change', () => {
    const prompt = briefingQaPrompt({ previous: ['Saves items'], brief: { ...EMPTY_BRIEF, acceptance: ['Saves items', 'Works well on mobile'] }, messages: [] });
    expect(prompt).toMatch(/Before:\n- Saves items\n\nNow:\n- Saves items\n- Works well on mobile/);
  });

  it('reads an empty note as nothing to say, and keeps a note short', () => {
    expect(asQaNote({ note: '   ' })).toBeUndefined();
    expect(asQaNote(undefined)).toBeUndefined();
    expect(asQaNote({ note: ' Say what “fast” means. ' })).toBe('Say what “fast” means.');
    expect(asQaNote({ note: 'x'.repeat(1000) })!.length).toBe(400);
  });
});

describe('asOfficerReply', () => {
  it('reads the written reply and the line to say aloud', () => {
    expect(asOfficerReply({ reply: ' Read `a.ts`. Who is it for? ', spoken: ' Who is it for? ' }, 'raw')).toEqual({ text: 'Read `a.ts`. Who is it for?', spoken: 'Who is it for?' });
  });

  it('falls back to the session’s text when the structure is missing', () => {
    expect(asOfficerReply(undefined, 'Who is it for?')).toEqual({ text: 'Who is it for?', spoken: undefined });
    expect(asOfficerReply({ reply: '', spoken: 1 }, 'Who is it for?')).toEqual({ text: 'Who is it for?', spoken: undefined });
  });
});

describe('acceptanceChanged', () => {
  it('is true when a criterion is added, removed or reworded', () => {
    expect(acceptanceChanged([], ['a'])).toBe(true);
    expect(acceptanceChanged(['a', 'b'], ['a'])).toBe(true);
    expect(acceptanceChanged(['a'], ['A'])).toBe(true);
  });

  it('is false when the criteria are as they were', () => {
    expect(acceptanceChanged(['a', 'b'], ['a', 'b'])).toBe(false);
  });
});

describe('Briefings with QA sitting in', () => {
  const project: Project = { id: 'p1', name: 'Shop', repos: ['acme/shop'], qaBrief: 'Keyboard only' } as Project;

  /** A briefing whose officer applies `patches` to the brief, one per turn. */
  function setup(patches: Partial<Brief>[], note = 'Say what “well” means.') {
    const store = new Store(false);
    store.projects = [project];
    let turn = 0;
    const officer: BriefingOfficer = {
      turn: async (r, hooks) => {
        hooks.brief({ ...r.brief, ...patches[turn++] });
        return { text: `Reply ${turn}`, spoken: `\`a.ts\` Said ${turn}.`, sessionId: 'officer-1', costUsd: 0.1 };
      },
    };
    const check = vi.fn<BriefingQa['check']>(async () => ({ note, sessionId: 'qa-1', costUsd: 0.01 }));
    const briefings = new Briefings(store, new Hub(), {} as IssuePlanner, officer, { check }, {} as IssueFiler, {} as BriefingEngineer);
    const settled = () => vi.waitFor(() => expect(briefings.current()?.status).toBe('waiting'));
    return { store, briefings, check, settled };
  }
  const from = (b: Briefing | null) => b!.messages.map((m) => m.from);

  it('adds QA’s note under the officer’s reply when the criteria change, checked against the QA brief', async () => {
    const { briefings, check, settled } = setup([{ acceptance: ['Works well on mobile'] }]);
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(from(briefings.current())).toEqual(['manager', 'officer', 'qa']);
    expect(briefings.current()!.messages[2].text).toBe('Say what “well” means.');
    expect(check.mock.calls[0][0]).toMatchObject({ qaBrief: 'Keyboard only', previous: [], brief: { acceptance: ['Works well on mobile'] } });
  });

  it('leaves QA out, at no cost, when the criteria didn’t change', async () => {
    const { briefings, check, settled } = setup([{ summary: 'A wishlist' }]);
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(check).not.toHaveBeenCalled();
    expect(from(briefings.current())).toEqual(['manager', 'officer']);
    expect(briefings.current()!.costUsd).toBeCloseTo(0.1);
  });

  it('keeps the officer’s spoken line with the reply, made speakable', async () => {
    const { briefings, settled } = setup([{}]);
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(briefings.current()!.messages[1]).toMatchObject({ from: 'officer', text: 'Reply 1', spoken: 'Said 1.' });
  });

  it('adds nothing when QA finds the criteria fine', async () => {
    const { briefings, check, settled } = setup([{ acceptance: ['Saves in under a second'] }], '');
    check.mockResolvedValue({ sessionId: 'qa-1' });
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(check).toHaveBeenCalledOnce();
    expect(from(briefings.current())).toEqual(['manager', 'officer']);
  });

  it('waits for QA to finish a review before they join', async () => {
    const { store, briefings, check, settled } = setup([{ acceptance: ['Works well on mobile'] }]);
    store.agents.set('qa_p1', { id: 'qa_p1', projectId: 'p1', task: 'review', status: 'testing' } as never);
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(check).not.toHaveBeenCalled();
  });

  it('keeps the officer’s reply when QA stumbles', async () => {
    const { briefings, check, settled } = setup([{ acceptance: ['Works well on mobile'] }]);
    check.mockRejectedValue(new Error('rate limited'));
    briefings.call('p1', 'a wishlist');
    await settled();
    const messages = briefings.current()!.messages;
    expect(messages.map((m) => m.from)).toEqual(['manager', 'officer', 'system']);
    expect(messages[2].text).toContain('rate limited');
  });
});

describe('mergeBrief', () => {
  const today = { title: 'Today', mermaid: 'flowchart LR\n  A["Panel"] --> B["Store"]' };
  const option = { title: 'Option A: a cache', mermaid: 'flowchart LR\n  A["Panel"] --> C["Cache"]' };
  const withDiagrams = { ...EMPTY_BRIEF, diagrams: [today] };

  it('replaces the whole list when diagrams are passed', () => {
    expect(mergeBrief(withDiagrams, { diagrams: [option] }).diagrams).toEqual([option]);
  });

  it('keeps the current diagrams when the field is left out', () => {
    expect(mergeBrief(withDiagrams, { summary: 'A wishlist' }).diagrams).toEqual([today]);
  });

  it('trims titles and sources, and drops diagrams with no source', () => {
    const merged = mergeBrief(EMPTY_BRIEF, { diagrams: [{ title: '  Today ', mermaid: `\n${today.mermaid}\n  ` }, { title: 'Option B', mermaid: '   ' }] });
    expect(merged.diagrams).toEqual([today]);
  });

  it('keeps at most four diagrams', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `Option ${i}`, mermaid: 'flowchart LR\n  A --> B' }));
    expect(mergeBrief(EMPTY_BRIEF, { diagrams: many }).diagrams.map((d) => d.title)).toEqual(['Option 0', 'Option 1', 'Option 2', 'Option 3']);
  });

  it('clears the list when passed an empty one', () => {
    expect(mergeBrief(withDiagrams, { diagrams: [] }).diagrams).toEqual([]);
  });
});

describe('Briefings breaking down into an epic and sub-issues', () => {
  const project: Project = { id: 'p1', name: 'Shop', repos: ['acme/shop'] } as Project;
  const breakdown: Breakdown = {
    repo: 'acme/shop',
    epic: { title: 'Wishlists', body: '## Why' },
    subIssues: [
      { key: 's1', title: 'Wishlist API', body: 'api', dependsOn: [] },
      { key: 's2', title: 'Wishlist page', body: 'page', dependsOn: ['s1'] },
      { key: 's3', title: 'Share a wishlist', body: 'share', dependsOn: ['s2'] },
    ],
  };
  const all = { epic: breakdown.epic, subIssues: breakdown.subIssues.map(({ key, title, body }) => ({ key, title, body })) };

  function setup() {
    const store = new Store(false);
    store.projects = [project];
    const turns: string[] = [];
    const officer: BriefingOfficer = {
      turn: async (r) => {
        turns.push(r.kind);
        return {
          text: 'Who is it for?',
          sessionId: 'officer-1',
          breakdown: r.kind === 'break-down' ? structuredClone(breakdown) : undefined,
          draft: r.kind === 'wrap-up' ? { repo: 'acme/shop', title: 'Wishlists', body: 'one' } : undefined,
        };
      },
    };
    let next = 40;
    const filed: { title: string; body: string }[] = [];
    const filer = {
      file: vi.fn<IssueFiler['file']>(async (_p, repo, title, body) => {
        filed.push({ title, body });
        return { repo, number: next++, title, body } as Issue;
      }),
      addSubIssue: vi.fn<IssueFiler['addSubIssue']>(async () => {}),
      pullRequestBody: vi.fn<IssueFiler['pullRequestBody']>(async () => ''),
      pullRequestState: vi.fn<IssueFiler['pullRequestState']>(async () => 'OPEN'),
    };
    const planner = { deliver: vi.fn(() => ({ title: 'Wishlists' })) };
    const briefings = new Briefings(store, new Hub(), planner as unknown as IssuePlanner, officer, { check: async () => ({}) }, filer, {} as BriefingEngineer);
    const status = (s: Briefing['status']) => vi.waitFor(() => expect(briefings.current()?.status).toBe(s));
    return { store, briefings, turns, filer, filed, planner, status };
  }

  async function reviewing() {
    const s = setup();
    s.briefings.call('p1', 'wishlists');
    await s.status('waiting');
    s.briefings.wrapUp('breakdown');
    await s.status('reviewing');
    return s;
  }

  it('waits for the manager with the breakdown, filing nothing', async () => {
    const { briefings, turns, filer } = await reviewing();
    expect(turns).toEqual(['open', 'break-down']);
    expect(briefings.current()!.breakdown).toEqual(breakdown);
    expect(filer.file).not.toHaveBeenCalled();
    expect(() => briefings.say('more')).toThrow(/breakdown is waiting for you/);
  });

  it('files the epic first, then the sub-issues linked to it, with the real numbers in Depends on', async () => {
    const { briefings, filer, filed, status } = await reviewing();
    briefings.file(all);
    await status('done');
    expect(filed.map((f) => f.title)).toEqual(['Wishlists', 'Wishlist API', 'Wishlist page', 'Share a wishlist']);
    expect(filed.map((f) => f.body)).toEqual(['## Why', 'api', 'Depends on #41\n\npage', 'Depends on #42\n\nshare']);
    expect(filer.addSubIssue.mock.calls).toEqual([['acme/shop', 40, 41], ['acme/shop', 40, 42], ['acme/shop', 40, 43]]);
    expect(briefings.current()!.messages.at(-1)!.text).toContain('#40');
  });

  it('files the manager’s edits, without the sub-issues they dropped', async () => {
    const { briefings, filed, status } = await reviewing();
    briefings.file({ epic: { title: 'Saved for later', body: 'Why' }, subIssues: [all.subIssues[1], { ...all.subIssues[2], title: 'Share it' }] });
    await status('done');
    expect(filed).toEqual([
      { title: 'Saved for later', body: 'Why' },
      { title: 'Wishlist page', body: 'page' },
      { title: 'Share it', body: 'Depends on #41\n\nshare' },
    ]);
  });

  it('can switch back to one issue before filing', async () => {
    const { briefings, turns, filer, planner, status } = await reviewing();
    briefings.wrapUp('one');
    expect(briefings.current()!.breakdown).toBeUndefined();
    await status('done');
    expect(turns.at(-1)).toBe('wrap-up');
    expect(planner.deliver).toHaveBeenCalledOnce();
    expect(filer.file).not.toHaveBeenCalled();
  });

  it('carries on where it stopped after a failure, without filing anything twice', async () => {
    const { briefings, filer, filed, status } = await reviewing();
    filer.file.mockImplementationOnce(async (_p, repo, title, body) => {
      filed.push({ title, body });
      return { repo, number: 40, title, body } as Issue;
    });
    filer.file.mockImplementationOnce(async () => {
      throw new Error('rate limited');
    });
    briefings.file(all);
    await status('reviewing');
    expect(briefings.current()!.error).toContain('rate limited');
    expect(briefings.current()!.breakdown!.epic.number).toBe(40);
    expect(() => briefings.wrapUp('one')).toThrow(/filed already/);
    briefings.file(all);
    await status('done');
    expect(filed.map((f) => f.title)).toEqual(['Wishlists', 'Wishlist API', 'Wishlist page', 'Share a wishlist']);
  });

  it('notes a sub-issue that wouldn’t link, and files the rest', async () => {
    const { briefings, filer, status } = await reviewing();
    filer.addSubIssue.mockRejectedValueOnce(new Error('sub-issues are off'));
    briefings.file(all);
    await status('done');
    expect(filer.file).toHaveBeenCalledTimes(4);
    expect(briefings.current()!.messages.some((m) => m.from === 'system' && m.text.includes('sub-issues are off'))).toBe(true);
  });

  it('survives a restart, picking filing back up from what was filed', async () => {
    const { store } = await reviewing();
    const saved = JSON.parse(JSON.stringify(store.briefing)) as StoredBriefing;
    expect(afterRestart(saved)).toMatchObject({ status: 'reviewing', breakdown });
    saved.breakdown!.epic.number = 40;
    expect(afterRestart({ ...saved, status: 'filing' })).toMatchObject({ status: 'reviewing', error: expect.stringContaining('File all again') as unknown, breakdown: { epic: { number: 40 } } });
  });
});

describe('the break-down prompt', () => {
  const prompt = briefingPrompt({ kind: 'break-down', idea: 'wishlists', brief: EMPTY_BRIEF, messages: [], resumeSessionId: 's1' });

  it('asks for an epic and two to five sub-issues in the issue format', () => {
    expect(prompt).toMatch(/an epic, and 2 to 5 sub-issues/);
    expect(prompt).toContain('## Acceptance criteria');
    expect(prompt).toContain('## Out of scope');
  });

  it('gives the stand’s sizing rules', () => {
    expect(prompt).toMatch(/one sub-issue per whole piece of the feature/);
    expect(prompt).toMatch(/independent and touch different files, or where a risky foundation should land first/);
  });

  it('keeps dependencies to what must merge first, two steps deep at most, and leaves the numbers to the office', () => {
    expect(prompt).toMatch(/only where the work truly can't start before the other merges/);
    expect(prompt).toMatch(/Never more than two steps deep/);
    expect(prompt).toMatch(/Don't write "Depends on" lines/);
  });
});

const option = (title: string) => ({ title, approach: `Do it via ${title}`, touches: ['src/store.ts'], tradeoffs: ['Quick'], risks: ['Grows the file'], size: 'one agent' as const });
const report: EngineeringReport = { options: [option('the store'), option('a new module')], recommended: 1, why: 'it keeps the store small.' };

describe('briefingPrompt with engineering', () => {
  const base = { idea: 'a wishlist', engineering: report, resumeSessionId: 's1' };
  const messages = [
    { from: 'officer' as const, text: 'Shall we ask engineering?', at: 1 },
    { from: 'system' as const, text: 'The captain asked Lt. Brennan for options.', at: 2 },
    { from: 'engineer' as const, text: '2 options on the screen.', at: 3 },
    { from: 'manager' as const, text: 'Let’s talk scope.', at: 4 },
  ];

  it('passes the engineer’s options on with the manager’s next message', () => {
    const prompt = briefingPrompt({ ...base, kind: 'reply', brief: EMPTY_BRIEF, messages });
    expect(prompt).toContain('Engineer: 2 options on the screen.');
    expect(prompt).toContain('Option B: **a new module** (one agent)');
    expect(prompt).toContain('Recommended: Option B. it keeps the store small.');
    expect(prompt).toContain('Let’s talk scope.');
  });

  it('tells the officer the picked approach is settled', () => {
    const prompt = briefingPrompt({ ...base, kind: 'reply', brief: { ...EMPTY_BRIEF, approach: report.options[0] }, messages });
    expect(prompt).toMatch(/approach the manager picked .*don't reopen it/);
    expect(prompt).toContain('**the store**');
    expect(prompt).not.toContain('Option B');
  });

  it('hands the picked approach to a resumed wrap-up, which never heard the pick', () => {
    const prompt = briefingPrompt({ ...base, kind: 'wrap-up', brief: { ...EMPTY_BRIEF, approach: report.options[0] }, messages });
    expect(prompt).toContain('Do it via the store');
    expect(prompt).toContain('Touches:\n- src/store.ts');
  });

  it('leaves engineering out of a wrap-up when nothing was picked', () => {
    expect(briefingPrompt({ ...base, kind: 'wrap-up', brief: EMPTY_BRIEF, messages })).not.toContain('a new module');
  });

  it('keeps the approach out of the brief JSON in a recap, and gives it once', () => {
    const prompt = briefingPrompt({ ...base, resumeSessionId: undefined, kind: 'wrap-up', brief: { ...EMPTY_BRIEF, approach: report.options[0] }, messages });
    expect(prompt.match(/Do it via the store/g)).toHaveLength(1);
  });
});

describe('the picked approach in a breakdown', () => {
  it('hands the pick to a resumed break-down for the epic’s Approach', () => {
    const prompt = briefingPrompt({ kind: 'break-down', idea: 'a wishlist', brief: { ...EMPTY_BRIEF, approach: report.options[1] }, messages: [], resumeSessionId: 's1' });
    expect(prompt).toContain('Do it via a new module');
    expect(prompt).toMatch(/If the manager picked an approach .*add an `## Approach` section/);
  });

  it('turns engineering interrupted by a restart back into the manager’s turn, with a note', () => {
    const saved = { id: 'b', projectId: 'p1', idea: '', status: 'engineering', activity: '', messages: [], brief: EMPTY_BRIEF, startedAt: 0, updatedAt: 0, costUsd: 0 } as StoredBriefing;
    const after = afterRestart(saved);
    expect(after.status).toBe('waiting');
    expect(after.messages.at(-1)).toMatchObject({ from: 'system', text: expect.stringContaining('Ask again') });
  });
});

describe('Briefings asking engineering', () => {
  const project: Project = { id: 'p1', name: 'Shop', repos: ['acme/shop'] } as Project;

  function setup() {
    const store = new Store(false);
    store.projects = [project];
    const officer: BriefingOfficer = { turn: async () => ({ text: 'Reply', sessionId: 'officer-1' }) };
    const propose = vi.fn<BriefingEngineer['propose']>(async () => ({ report, sessionId: 'eng-1', costUsd: 0.2 }));
    const briefings = new Briefings(store, new Hub(), {} as IssuePlanner, officer, { check: vi.fn() }, {} as IssueFiler, { propose });
    const settled = () => vi.waitFor(() => expect(briefings.current()?.status).toBe('waiting'));
    return { store, briefings, propose, settled };
  }

  async function withOptions() {
    const s = setup();
    s.briefings.call('p1', 'a wishlist');
    await s.settled();
    s.briefings.askEngineering('');
    await s.settled();
    return s;
  }

  it('brings the engineer to the table, then puts their options and recommendation in the briefing', async () => {
    const { briefings, propose, settled } = setup();
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(briefings.askEngineering('').status).toBe('engineering');
    await settled();
    const b = briefings.current()!;
    expect(b.engineering).toEqual(report);
    expect(b.messages.at(-1)).toMatchObject({ from: 'engineer', text: expect.stringContaining('Option B, a new module') });
    expect(b.costUsd).toBeCloseTo(0.2);
    expect(propose.mock.calls[0][0]).toMatchObject({ request: '', previous: undefined, projectName: 'Shop' });
  });

  it('puts the picked option into the brief as the approach', async () => {
    const { briefings } = await withOptions();
    const b = briefings.pickApproach(0);
    expect(b.brief.approach).toEqual(report.options[0]);
    expect(b.messages.at(-1)).toMatchObject({ from: 'system', text: expect.stringContaining('Option A, the store') });
  });

  it('won’t pick before there are options, or one that isn’t there', async () => {
    const { briefings, settled } = setup();
    briefings.call('p1', 'a wishlist');
    await settled();
    expect(() => briefings.pickApproach(0)).toThrow(/Ask engineering/);
    briefings.askEngineering('');
    await settled();
    expect(() => briefings.pickApproach(5)).toThrow(/no such option/);
  });

  it('sends the options back with the manager’s note, resuming the engineer, and clears the old pick', async () => {
    const { briefings, propose, settled } = await withOptions();
    briefings.pickApproach(0);
    briefings.askEngineering('Keep it to one file');
    await settled();
    expect(propose.mock.calls[1][0]).toMatchObject({ request: 'Keep it to one file', previous: report, resumeSessionId: 'eng-1' });
    expect(briefings.current()!.brief.approach).toBeUndefined();
  });

  it('keeps the briefing going when engineering stumbles', async () => {
    const { briefings, propose, settled } = setup();
    propose.mockRejectedValue(new Error('rate limited'));
    briefings.call('p1', 'a wishlist');
    await settled();
    briefings.askEngineering('');
    await settled();
    const b = briefings.current()!;
    expect(b.engineering).toBeUndefined();
    expect(b.messages.at(-1)).toMatchObject({ from: 'system', text: expect.stringContaining('rate limited') });
  });

  it('won’t take a message while the engineer is working', async () => {
    const { briefings, settled } = setup();
    briefings.call('p1', 'a wishlist');
    await settled();
    briefings.askEngineering('');
    expect(() => briefings.say('hello')).toThrow(/still working on the options/);
  });

  it('keeps the approach when the officer updates the brief', () => {
    const merged = mergeBrief({ ...EMPTY_BRIEF, approach: report.options[0] }, { summary: 'A wishlist' });
    expect(merged.approach).toEqual(report.options[0]);
    expect(mergeBrief(EMPTY_BRIEF, { summary: 'x' })).not.toHaveProperty('approach');
  });
});

describe('Briefings about a goal, one step at a time', () => {
  const project: Project = { id: 'p1', name: 'Shop', repos: ['acme/shop', 'acme/api'] } as Project;
  const proposal = { repo: 'acme/shop', title: 'Save an item, thinly', body: '## Testing\n\nWhether the cart can hold it' };

  function setup() {
    const store = new Store(false);
    store.projects = [project];
    const turns: OfficerTurn[] = [];
    const officer: BriefingOfficer = {
      turn: async (r, hooks) => {
        turns.push(r);
        if (r.kind === 'open') hooks.brief({ ...r.brief, summary: 'Shoppers save items for later', acceptance: ['A saved item is there next visit'], openQuestions: ['Can the cart hold it?'] });
        return { text: `Reply to ${r.kind}`, sessionId: 'officer-1', step: r.kind === 'step' ? structuredClone(proposal) : undefined };
      },
    };
    let next = 40;
    const filed: { repo: string; title: string; body: string }[] = [];
    const filer = {
      file: vi.fn<IssueFiler['file']>(async (_p, repo, title, body) => {
        filed.push({ repo, title, body });
        const number = next++;
        return { repo, number, title, body, url: `https://github.com/${repo}/issues/${number}` } as Issue;
      }),
      addSubIssue: vi.fn<IssueFiler['addSubIssue']>(async () => {}),
      pullRequestBody: vi.fn<IssueFiler['pullRequestBody']>(async () => 'Stored saved items on the cart. Totals skip them.'),
      pullRequestState: vi.fn<IssueFiler['pullRequestState']>(async () => 'MERGED'),
    };
    const hub = new Hub();
    const toasts: string[] = [];
    hub.toast = (_level, text) => void toasts.push(text);
    const briefings = new Briefings(store, hub, {} as IssuePlanner, officer, { check: async () => ({}) }, filer, {} as BriefingEngineer);
    const status = (s: Briefing['status']) => vi.waitFor(() => expect(briefings.current()?.status).toBe(s));
    const parked = () => vi.waitFor(() => expect(briefings.goals()[0]?.status).toBe('parked'));
    return { store, briefings, turns, filer, filed, toasts, status, parked };
  }

  async function proposed() {
    const s = setup();
    s.briefings.call('p1', 'save for later', true);
    await s.status('waiting');
    s.briefings.wrapUp('step');
    await vi.waitFor(() => expect(s.briefings.current()?.goal?.proposal).toBeDefined());
    return s;
  }

  async function firstStepFiled() {
    const s = await proposed();
    s.briefings.fileStep(proposal);
    await s.parked();
    return s;
  }

  const board = (prs: Partial<PullRequest>[]): Board => ({ projectId: 'p1', issues: [], prs: prs.map((p) => ({ repo: 'acme/shop', branch: 'x', closes: [], url: `pr${p.number}`, ...p }) as PullRequest), updatedAt: 0 });

  it('proposes one step for the manager to edit and file, filing nothing yet', async () => {
    const { briefings, turns, filer } = await proposed();
    expect(turns.map((t) => t.kind)).toEqual(['open', 'step']);
    expect(turns[0].goal?.steps).toEqual([]);
    expect(briefings.current()).toMatchObject({ status: 'waiting', goal: { proposal } });
    expect(filer.file).not.toHaveBeenCalled();
  });

  it('only takes steps: no wrapping a goal up, and no steps outside one', async () => {
    const { briefings, status } = setup();
    briefings.call('p1', 'save for later', true);
    await status('waiting');
    expect(() => briefings.wrapUp('one')).toThrow(/one step at a time: take a step/);
    briefings.end();
    briefings.call('p1', 'a wishlist');
    await status('waiting');
    expect(() => briefings.wrapUp('step')).toThrow(/Only a goal/);
    expect(() => briefings.fileStep(proposal)).toThrow(/no step to file/);
  });

  it('files the goal, then the step as its sub-issue with the manager’s edits, and parks the goal', async () => {
    const { briefings, filed, filer, toasts } = await proposed();
    briefings.fileStep({ title: 'Save one item', body: 'edited' });
    await vi.waitFor(() => expect(briefings.goals()).toHaveLength(1));
    expect(filed.map((f) => f.title)).toEqual(['Shoppers save items for later', 'Save one item']);
    expect(filed[0].body).toContain('## Unknowns\n\n- Can the cart hold it?');
    expect(filed[1].body).toBe('Step 1 toward #40: Shoppers save items for later\n\nedited');
    expect(filer.addSubIssue).toHaveBeenCalledWith('acme/shop', 40, 41);
    expect(briefings.current()).toBeNull();
    expect(briefings.goals()[0]).toMatchObject({ status: 'parked', goal: { epic: { number: 40 }, steps: [{ number: 41, title: 'Save one item' }] } });
    expect(briefings.goals()[0].goal!.proposal).toBeUndefined();
    expect(toasts.at(-1)).toContain('acme/shop#41');
  });

  it('frees the lounge for another briefing while the goal is parked', async () => {
    const { briefings, status } = await firstStepFiled();
    briefings.call('p1', 'a wishlist');
    await status('waiting');
    expect(() => briefings.reconvene(briefings.goals()[0].id)).toThrow(/still in the lounge with a briefing/);
  });

  it('keeps track of the step’s PR, QA’s verdict on it, and its merge', async () => {
    const { briefings, store, filer, toasts } = await firstStepFiled();
    await briefings.track('p1', board([{ number: 42, closes: [41] }]));
    expect(briefings.goals()[0].goal!.steps[0].pr).toEqual({ number: 42, url: 'pr42' });
    store.reviews.set('acme/shop#42', { report: { verdict: 'pass', summary: 'Saved items survive a reload' } } as QaReview);
    await briefings.track('p1', board([{ number: 42 }]));
    expect(briefings.goals()[0].goal!.steps[0].qa).toEqual({ verdict: 'pass', summary: 'Saved items survive a reload' });
    expect(filer.pullRequestState).not.toHaveBeenCalled();
    await briefings.track('p1', board([]));
    expect(filer.pullRequestState).toHaveBeenCalledWith('acme/shop', 42);
    expect(briefings.goals()[0].goal!.steps[0].outcome).toBe('merged');
    expect(toasts.at(-1)).toMatch(/Step 1 toward “Shoppers save items for later” merged: reconvene/);
  });

  it('leaves a step alone while its repo didn’t load', async () => {
    const { briefings } = await firstStepFiled();
    await briefings.track('p1', { ...board([{ number: 42, closes: [41] }]), error: 'acme/shop: rate limited' });
    expect(briefings.goals()[0].goal!.steps[0].pr).toBeUndefined();
  });

  it('reconvenes with how the step went, its PR’s description included, then takes the next step without filing the goal again', async () => {
    const { briefings, turns, filed, filer, status } = await firstStepFiled();
    await briefings.track('p1', board([{ number: 42, closes: [41] }]));
    await briefings.track('p1', board([]));
    briefings.reconvene(briefings.goals()[0].id);
    expect(briefings.goals()).toEqual([]);
    await status('waiting');
    const reconvened = turns.at(-1)!;
    expect(reconvened.kind).toBe('reconvene');
    expect(reconvened.report).toContain('Step 1: acme/shop#41 “Save an item, thinly”, PR #42 merged');
    expect(reconvened.report).toContain('Stored saved items on the cart. Totals skip them.');
    expect(filer.pullRequestBody).toHaveBeenCalledWith('acme/shop', 42);
    expect(briefings.current()!.messages.at(-1)).toMatchObject({ from: 'officer', text: 'Reply to reconvene' });

    briefings.wrapUp('step');
    await vi.waitFor(() => expect(briefings.current()?.goal?.proposal).toBeDefined());
    briefings.fileStep({ ...proposal, title: 'Show saved items' });
    await vi.waitFor(() => expect(briefings.goals()[0]?.goal?.steps).toHaveLength(2));
    expect(filed.map((f) => f.title)).toEqual(['Shoppers save items for later', 'Save an item, thinly', 'Show saved items']);
    expect(filed[2].body).toMatch(/^Step 2 toward #40/);
  });

  it('files a step in another repo without linking it as a sub-issue, which GitHub can’t across repos', async () => {
    const { briefings, store, filer, filed, status } = await firstStepFiled();
    briefings.reconvene(briefings.goals()[0].id);
    await status('waiting');
    briefings.wrapUp('step');
    await vi.waitFor(() => expect(briefings.current()?.goal?.proposal).toBeDefined());
    store.briefing!.goal!.proposal!.repo = 'acme/api';
    briefings.fileStep({ title: 'Store saved items', body: 'api' });
    await vi.waitFor(() => expect(briefings.goals()[0]?.goal?.steps).toHaveLength(2));
    expect(filed.at(-1)).toMatchObject({ repo: 'acme/api', body: 'Step 2 toward acme/shop#40: Shoppers save items for later\n\napi' });
    expect(filer.addSubIssue).toHaveBeenCalledOnce();
  });

  it('keeps the filed goal when the step fails to file, so filing again files only the step', async () => {
    const { briefings, filer, filed, status } = await proposed();
    filer.file.mockImplementationOnce(async (_p, repo, title, body) => {
      filed.push({ repo, title, body });
      return { repo, number: 40, title, body, url: 'e' } as Issue;
    });
    filer.file.mockImplementationOnce(async () => {
      throw new Error('rate limited');
    });
    briefings.fileStep(proposal);
    await status('failed');
    expect(briefings.current()!.error).toMatch(/rate limited.*File it again/);
    expect(briefings.current()!.goal!.epic!.number).toBe(40);
    briefings.fileStep(proposal);
    await vi.waitFor(() => expect(briefings.goals()).toHaveLength(1));
    expect(filed.map((f) => f.title)).toEqual(['Shoppers save items for later', 'Save an item, thinly']);
  });

  it('parks a goal without a step, and reconvenes it with nothing to report', async () => {
    const { briefings, turns, status } = setup();
    briefings.call('p1', 'save for later', true);
    await status('waiting');
    briefings.park();
    expect(briefings.goals()[0]).toMatchObject({ status: 'parked', activity: 'Parked before the first step' });
    briefings.reconvene(briefings.goals()[0].id);
    await status('waiting');
    expect(turns.at(-1)).toMatchObject({ kind: 'reconvene', report: 'No step has been filed yet.' });
  });

  it('only parks a goal', async () => {
    const { briefings, status } = setup();
    briefings.call('p1', 'a wishlist');
    await status('waiting');
    expect(() => briefings.park()).toThrow(/Only a goal can be parked/);
  });

  it('forgets a dropped goal, and the goals of a deleted project', async () => {
    const { briefings } = await firstStepFiled();
    briefings.projectRemoved('p1');
    expect(briefings.goals()).toEqual([]);
    const again = await firstStepFiled();
    again.briefings.dropGoal(again.briefings.goals()[0].id);
    expect(again.briefings.goals()).toEqual([]);
  });

  it('picks up after a restart mid-filing as the manager’s turn, to file the step again', () => {
    const saved = { id: 'b', status: 'filing', goal: { steps: [], epic: { repo: 'acme/shop', number: 40, title: 'g', url: '' } }, brief: EMPTY_BRIEF, messages: [] } as unknown as StoredBriefing;
    expect(afterRestart(saved)).toMatchObject({ status: 'failed', error: expect.stringContaining('File it again') as unknown, goal: { epic: { number: 40 } } });
  });
});

describe('goal prompts', () => {
  const goal = { steps: [{ repo: 'acme/shop', number: 41, title: 'Save one item', url: '', filedAt: 0, pr: { number: 42, url: '' }, outcome: 'merged' as const }] };

  it('agrees the destination and the unknowns, with no plan up front', () => {
    const prompt = briefingSystemPrompt({ ...req, goal: { steps: [] } });
    expect(prompt).toMatch(/not a spec/);
    expect(prompt).toMatch(/Name the unknowns/);
    expect(prompt).toMatch(/Don't design the solution, list tasks or map the route/);
    expect(prompt).toMatch(/Never plan past the next step/);
    expect(prompt).toContain(qaOfficerFor('p1').name);
    expect(prompt).not.toContain('Diagrams');
  });

  it('asks for one step in the step format, knowing the steps so far', () => {
    const prompt = briefingPrompt({ kind: 'step', idea: 'save for later', brief: EMPTY_BRIEF, messages: [], resumeSessionId: 's1', goal });
    expect(prompt).toContain(STEP_FORMAT);
    expect(prompt).toContain('Step 1: acme/shop#41 “Save one item”, PR #42 merged');
    expect(prompt).toMatch(/the next step .*one step, not a plan/);
  });

  it('opens a goal on where we’re going', () => {
    expect(briefingPrompt({ kind: 'open', idea: 'save for later', brief: EMPTY_BRIEF, messages: [], goal: { steps: [] } })).toMatch(/The manager has a goal/);
  });

  it('reconvenes on the report, asking what the step taught us', () => {
    const prompt = briefingPrompt({ kind: 'reconvene', idea: 'x', brief: EMPTY_BRIEF, messages: [], resumeSessionId: 's1', goal, report: 'Steps so far: …' });
    expect(prompt).toContain('Steps so far: …');
    expect(prompt).toMatch(/what it taught you/);
    expect(prompt).toMatch(/goal is met/);
  });
});
