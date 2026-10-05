import { describe, expect, it, vi } from 'vitest';
import { qaOfficerFor } from '../../shared/crew';
import { type Brief, type Briefing, EMPTY_BRIEF, type Project } from '../../shared/types';
import { Hub } from '../hub';
import { Store } from '../store';
import {
  acceptanceChanged,
  asQaNote,
  type BriefingOfficer,
  type BriefingQa,
  briefingPrompt,
  briefingQaPrompt,
  briefingQaSystemPrompt,
  Briefings,
  briefingSystemPrompt,
  mergeBrief,
} from './briefing';
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

  it('asks the wrap-up for an Approach section with a mermaid block only when an option was chosen', () => {
    const prompt = turn('wrap-up');
    expect(prompt).toContain('## Approach');
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
        return { text: `Reply ${turn}`, sessionId: 'officer-1', costUsd: 0.1 };
      },
    };
    const check = vi.fn<BriefingQa['check']>(async () => ({ note, sessionId: 'qa-1', costUsd: 0.01 }));
    const briefings = new Briefings(store, new Hub(), {} as IssuePlanner, officer, { check });
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
