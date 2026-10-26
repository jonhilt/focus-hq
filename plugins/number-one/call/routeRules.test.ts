import { describe, expect, it } from 'vitest';
import type { JevAnswers } from './jev';
import { topics } from './brief';
import { type Act, APPROVE_PROBABILITY, callNotes, type CallScene, decide, dictated, nextGoal, routingQuestions, routingState, type StartGoal } from './routeRules';
import { clip, spokenStatus } from './status';
import { type Agent, type Project, type QueuedGoal, type Snapshot } from '../../../plugin-api/server';

const queued = (text: string, id = 'q1'): QueuedGoal => ({ id, text, at: 0 });
const shop = { id: 'p1', name: 'Shop', repos: ['acme/shop'] } as Project;
const blog = { id: 'p2', name: 'Blog', repos: ['acme/blog'] } as Project;
const agent = (patch: Partial<Agent>): Agent =>
  ({ id: 'a1', name: 'Ensign Reyes', projectId: 'p1', repo: 'acme/shop', task: 'issue', issue: { number: 12, title: 'Add a wishlist', url: '' }, status: 'working', startedAt: 1, ...patch }) as Agent;
const lead = (station: number, patch: Partial<Agent> = {}): Agent =>
  agent({ id: `lead_${station}`, name: `Lt. Station${station}`, task: 'lead', ...patch, lead: { station, title: `Goal ${station}`, prs: [], ...patch.lead } as Agent['lead'] });

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    info: { github: { ok: true, login: 'captain' } },
    projects: [shop],
    agents: [],
    boards: [],
    reviews: [],
    ...patch,
  } as unknown as Snapshot;
}

const choice = (choice: string, confidence = 0.95) => ({ type: 'choice', choice, confidence });
const start: StartGoal = { projectId: 'p1', projectName: 'Shop', queueId: 'q1', title: 'Voice mode', station: 1 };
const startAct: Act = { kind: 'start-queued', start };

describe('spokenStatus', () => {
  it('says when nothing is going on', () => {
    expect(spokenStatus(snapshot())).toBe('Shop has no goals under way. Nothing is waiting on you. No goals are queued.');
  });

  it('names the goals under way, who is at work on what, what waits on the captain, and the next queued goal', () => {
    const ship = snapshot({
      projects: [{ ...shop, goalQueue: [queued('Voice mode for Focus\nwith more detail'), queued('Another', 'q2')] }],
      agents: [
        lead(1, { lead: { station: 1, title: 'Chart the voyage' } as Agent['lead'] }),
        lead(2, { status: 'done', lead: { station: 2, title: 'Faster boards', readTurn: 5 } as Agent['lead'], finishedAt: 5 }),
        agent({ id: 'a2', permission: { summary: 'Run rm' } as Agent['permission'], status: 'waiting' }),
      ],
    });
    expect(spokenStatus(ship)).toBe(
      'Shop has 2 goals under way: Lt. Station1 on "Chart the voyage", at work; Lt. Station2 on "Faster boards". One crew member at work on issues: Ensign Reyes is on "Add a wishlist". Waiting on you: Ensign Reyes has a hand up. 2 goals queued; next is "Voice mode for Focus".',
    );
  });

  it('says what each one waiting on the captain wants', () => {
    const asked = { id: 'q', question: 'Which?', options: [], at: 1 };
    const ship = snapshot({
      agents: [
        agent({ id: 'a2', name: 'Ensign Broke', status: 'error' }),
        lead(0, { status: 'done', finishedAt: 5, lead: { station: 0, title: 'Done?', closing: { reason: 'All in', at: 5 } } as Agent['lead'] }),
        lead(1, { status: 'done', finishedAt: 5, lead: { station: 1, title: 'Turn' } as Agent['lead'] }),
        lead(2, { status: 'done', finishedAt: 5, lead: { station: 2, title: 'Asks', questions: [asked] } as unknown as Agent['lead'] }),
      ],
      boards: [{ projectId: 'p1', issues: [], prs: [{ repo: 'acme/shop', number: 40, title: 'Wishlist', url: '', branch: 'b', headSha: 'a', baseBranch: 'main', isDraft: false, mergeable: 'CONFLICTING', checks: 'passing', failedChecks: [], closes: [], createdAt: '', author: 'captain' }], updatedAt: 0 }],
    });
    const said = spokenStatus(ship);
    expect(said).toContain('Ensign Broke hit a problem');
    expect(said).toContain('Lt. Station0 thinks their goal is done');
    expect(said).toContain('Lt. Station1 is waiting for your reply');
    expect(said).toContain('Lt. Station2 asked you a question');
    expect(said).toContain('pull request 40 conflicts with its base branch');
  });

  it('cuts a long status at a sentence, short enough to be said', () => {
    expect(clip('One. Two. Three.', 10)).toBe("One. Two. There's more on the screens.");
    expect(clip('Short.', 10)).toBe('Short.');
  });

  it('keeps to the project asked about, and leaves hidden ones out', () => {
    const ship = snapshot({ projects: [shop, blog, { id: 'p3', name: 'Secret', repos: ['acme/secret'], hidden: true } as Project] });
    expect(spokenStatus(ship, 'p2')).toBe('Blog has no goals under way. Nothing is waiting on you. No goals are queued.');
    expect(spokenStatus(ship)).not.toContain('Secret');
  });
});

describe('routingQuestions', () => {
  it('asks only the action with one project aboard and nothing to talk about, and the yes only while an act waits on it', () => {
    expect(Object.keys(routingQuestions([shop], []))).toEqual(['action']);
    const options = topics(snapshot({ projects: [shop, blog] }));
    expect(Object.keys(routingQuestions([shop, blog], options, { pending: startAct }))).toEqual(['action', 'project', 'topic', 'approve']);
  });

  it('offers every project and topic, and none of them', () => {
    const questions = routingQuestions([shop, blog], topics(snapshot({ projects: [shop, blog] })));
    expect(questions.project.type === 'choice' && Object.keys(questions.project.criteria)).toEqual(['p1', 'p2', 'none']);
    expect(questions.topic.type === 'choice' && Object.keys(questions.topic.criteria)).toEqual(['project:p1', 'project:p2', 'none']);
  });

  it('puts the exact question the captain is answering to Jev', () => {
    expect(routingQuestions([shop], [], { pending: startAct }).approve.instructions).toContain('Start "Voice mode" in Shop, at station 2?');
  });

  it('only asks whether the captain called it off, while waiting for their words', () => {
    expect(Object.keys(routingQuestions([shop, blog], [], { capture: { kind: 'tell-lead', leadId: 'l', leadName: 'Lt. Data' } }))).toEqual(['cancel']);
  });
});

describe('routingState', () => {
  it('gives Jev the projects, the topic, what waits, the call so far and what the captain just said', () => {
    const [topic] = topics(snapshot());
    const state = routingState([shop, blog], 'yes please', [{ who: 'ship', text: 'Start it?', at: 0 }], { pending: startAct, topic });
    expect(state).toContain('Projects aboard: Shop, Blog.');
    expect(state).toContain(`They are talking through: ${topic.label}.`);
    expect(state).toContain('waiting for the captain\'s answer to: Start "Voice mode" in Shop, at station 2?');
    expect(state).toContain('Ship: Start it?');
    expect(state.endsWith('What the captain just said: "yes please"')).toBe(true);
  });
});

describe('nextGoal', () => {
  it('asks to start the next queued goal at the first free station', () => {
    const ship = snapshot({ projects: [{ ...shop, goalQueue: [queued('Voice mode')] }], agents: [lead(0), lead(1)] });
    expect(nextGoal(ship, ship.projects[0])).toEqual({
      kind: 'confirm',
      act: { kind: 'start-queued', start: { projectId: 'p1', projectName: 'Shop', queueId: 'q1', title: 'Voice mode', station: 2 } },
      ask: 'Start "Voice mode" in Shop, at station 3?',
    });
  });

  it('says so when nothing is queued, or every station has a goal', () => {
    expect(nextGoal(snapshot(), shop)).toEqual({ kind: 'say', text: 'There are no goals queued in Shop.' });
    const full = snapshot({ projects: [{ ...shop, goalQueue: [queued('Voice mode')] }], agents: [0, 1, 2, 3].map((s) => lead(s)) });
    expect(nextGoal(full, full.projects[0])).toEqual({ kind: 'say', text: 'Every team station in Shop has a goal, so "Voice mode" has to wait for one to close.' });
  });

  it('without a project, takes the only one with a queue, or asks which', () => {
    const one = snapshot({ projects: [shop, { ...blog, goalQueue: [queued('Posts')] }] });
    expect(nextGoal(one, undefined)).toMatchObject({ kind: 'confirm', act: { start: { projectId: 'p2', title: 'Posts' } } });
    const two = snapshot({ projects: [{ ...shop, goalQueue: [queued('Cart')] }, { ...blog, goalQueue: [queued('Posts')] }] });
    expect(nextGoal(two, undefined)).toEqual({ kind: 'say', text: 'Goals are queued in Shop and Blog. Which project?' });
    expect(nextGoal(snapshot({ projects: [shop, blog] }), undefined)).toEqual({ kind: 'say', text: 'There are no goals queued in any project.' });
  });
});

describe('decide', () => {
  const ship = snapshot({ projects: [{ ...shop, goalQueue: [queued('Voice mode')] }, blog], agents: [lead(0, { lead: { station: 0, title: 'Wishlist' } as Agent['lead'] })] });
  const d = (scene: CallScene = {}) => ({ snapshot: ship, ledger: [], now: 0, scene });

  it('answers a status question from the board, for the project named', () => {
    expect(decide(d(), { action: choice('status'), project: choice('p2') })).toEqual({ kind: 'say', text: spokenStatus(ship, 'p2') });
    expect(decide(d(), { action: choice('status'), project: choice('none') })).toEqual({ kind: 'say', text: spokenStatus(ship) });
  });

  it('asks before starting the next goal', () => {
    expect(decide(d(), { action: choice('start_next_goal'), project: choice('p1') })).toMatchObject({ kind: 'confirm', act: { start: { queueId: 'q1', station: 1 } } });
  });

  it("doesn't act on an unsure pick of action or project", () => {
    expect(decide(d(), { action: choice('start_next_goal', 0.5) })).toEqual({ kind: 'say', text: 'By voice I can tell you how things stand, start the next queued goal, or talk something through with you.' });
    // an unsure project pick falls back to the only project with a queue
    expect(decide(d(), { action: choice('start_next_goal'), project: choice('p2', 0.4) })).toMatchObject({ kind: 'confirm', act: { start: { projectId: 'p1' } } });
  });

  it('goes ahead only on a clear yes to the act waiting on it', () => {
    const yes: JevAnswers = { action: choice('other'), approve: { noul: APPROVE_PROBABILITY } };
    expect(decide(d({ pending: startAct }), yes)).toEqual({ kind: 'go' });
    // the same yes with nothing waiting does nothing
    expect(decide(d(), yes)).toMatchObject({ kind: 'say' });
    expect(decide(d({ pending: startAct }), { action: choice('other'), approve: { noul: 0.89 } })).toMatchObject({ kind: 'say', text: 'Okay, I\'ve left "Voice mode" queued. By voice I can tell you how things stand, start the next queued goal, or talk something through with you.' });
  });

  it('answers something else said instead of a yes, having dropped the act', () => {
    const routing = decide(d({ pending: startAct }), { action: choice('status'), project: choice('p2'), approve: { noul: 0.02 } });
    expect(routing).toEqual({ kind: 'say', text: `Okay, I've left "Voice mode" queued. ${spokenStatus(ship, 'p2')}` });
    const tell: Act = { kind: 'tell-lead', leadId: 'lead_0', leadName: 'Lt. Station0', said: 'Go', text: 'Go' };
    expect(decide(d({ pending: tell }), { action: choice('status'), project: choice('p2') })).toMatchObject({ text: expect.stringMatching(/^Okay, I haven't done that\. Blog/) as string });
  });

  it('reads a choice confidence from its probabilities when Jev leaves it out', () => {
    expect(decide(d(), { action: { choice: 'status', probabilities: { status: 0.8 } } })).toMatchObject({ kind: 'say', text: spokenStatus(ship) });
  });

  it('briefs the voice model on the topic named, or asks which', () => {
    const routing = decide(d(), { action: choice('talk'), topic: choice('goal:lead_0') });
    expect(routing).toMatchObject({ kind: 'brief', topic: { kind: 'goal', leadId: 'lead_0', title: 'Wishlist' } });
    expect(routing.kind === 'brief' && routing.pieces.join('\n')).toContain('Topic: the goal "Wishlist" in Shop.');
    expect(decide(d(), { action: choice('talk'), topic: choice('none') })).toEqual({ kind: 'say', text: 'What would you like to talk through? Goals under way: "Wishlist". Or a project as a whole.' });
  });

  it('while talking something through, leaves chat to the voice model with a quiet note', () => {
    const [topic] = topics(ship);
    expect(decide(d({ topic }), { action: choice('other') })).toMatchObject({ kind: 'say', quiet: true });
  });

  it("asks for the words of a new goal, in the topic's project", () => {
    const topic = topics(ship).find((t) => t.kind === 'project' && t.projectId === 'p2')!;
    expect(decide(d({ topic }), { action: choice('capture_goal') })).toEqual({
      kind: 'dictate',
      capture: { kind: 'new-goal', projectId: 'p2', projectName: 'Blog' },
      ask: 'What should the goal be? A sentence or two will do.',
    });
    expect(decide(d(), { action: choice('capture_goal') })).toEqual({ kind: 'say', text: 'Which project should the goal go in?' });
  });

  it("asks what to tell the goal's lead: the one named, or the topic's", () => {
    const dictate = { kind: 'dictate', capture: { kind: 'tell-lead', leadId: 'lead_0', leadName: 'Lt. Station0' }, ask: 'What should I tell Lt. Station0?' };
    expect(decide(d(), { action: choice('tell_lead'), topic: choice('goal:lead_0') })).toEqual(dictate);
    expect(decide(d({ topic: topics(ship)[0] }), { action: choice('tell_lead') })).toEqual(dictate);
    expect(decide(d(), { action: choice('tell_lead') })).toEqual({ kind: 'say', text: 'Which goal’s lead should I pass it to?' });
  });
});

describe('dictated', () => {
  const [topic] = topics(snapshot({ agents: [lead(0, { lead: { station: 0, title: 'Wishlist' } as Agent['lead'] })] }));

  it('reads a new goal back, carrying the call with it', () => {
    const words = 'Find out why pull requests fail QA in the shop, and stop it happening. Then tidy up.';
    const routing = dictated({ kind: 'new-goal', projectId: 'p1', projectName: 'Shop' }, words, {}, 'Captain: why?', topic);
    expect(routing).toEqual({
      kind: 'confirm',
      act: {
        kind: 'new-goal',
        projectId: 'p1',
        projectName: 'Shop',
        title: 'Find out why pull requests fail QA in the shop, and stop it…',
        said: 'Find out why pull requests fail QA in the shop, and stop it happening',
        text: `${words}\n\nFrom a call with the captain about Wishlist:\nCaptain: why?`,
      },
      ask: 'Start a new goal in Shop: "Find out why pull requests fail QA in the shop, and stop it happening"? It takes the notes from this call with it.',
    });
  });

  it("reads a lead's message back", () => {
    const routing = dictated({ kind: 'tell-lead', leadId: 'l', leadName: 'Lt. Data' }, 'Ship it', {}, 'Captain: hm');
    expect(routing).toMatchObject({ kind: 'confirm', act: { said: 'Ship it', text: 'Ship it\n\n(Said on a call with the captain. The conversation:\nCaptain: hm)' }, ask: 'Send Lt. Data: "Ship it"?' });
  });

  it('drops it when the captain calls it off', () => {
    expect(dictated({ kind: 'tell-lead', leadId: 'l', leadName: 'Lt. Data' }, 'Never mind', { cancel: { noul: 0.9 } }, '')).toEqual({ kind: 'say', text: 'Okay, dropped it.' });
  });
});

describe('callNotes', () => {
  it("keeps what the captain and the ship said, not Ops' notes, the latest when it's long", () => {
    expect(callNotes([{ who: 'captain', text: 'Hi', at: 0 }, { who: 'office', text: 'x', at: 0 }, { who: 'ship', text: 'Hello', at: 0 }])).toBe('Captain: Hi\nShip: Hello');
    const long = Array.from({ length: 200 }, (_, i) => ({ who: 'captain' as const, text: `line ${i} ${'x'.repeat(40)}`, at: 0 }));
    const notes = callNotes(long);
    expect(notes.length).toBeLessThanOrEqual(4_000);
    expect(notes.endsWith(`line 199 ${'x'.repeat(40)}`)).toBe(true);
  });
});
