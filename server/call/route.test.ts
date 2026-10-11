import { describe, expect, it } from 'vitest';
import type { Agent, Project, QueuedGoal, Snapshot } from '../../shared/types';
import type { JevAnswers } from './jev';
import { APPROVE_PROBABILITY, decide, nextGoal, routingQuestions, routingState, type StartGoal } from './route';
import { spokenStatus } from './status';

const queued = (text: string, id = 'q1'): QueuedGoal => ({ id, text, at: 0 });
const shop = { id: 'p1', name: 'Shop', repos: ['acme/shop'] } as Project;
const blog = { id: 'p2', name: 'Blog', repos: ['acme/blog'] } as Project;
const agent = (patch: Partial<Agent>): Agent =>
  ({ id: 'a1', name: 'Ensign Reyes', projectId: 'p1', repo: 'acme/shop', task: 'issue', issue: { number: 12, title: 'Add a wishlist', url: '' }, status: 'working', startedAt: 1, ...patch }) as Agent;
const lead = (station: number, patch: Partial<Agent> = {}): Agent =>
  agent({ id: `lead_${station}`, name: `Lt. Station${station}`, task: 'lead', lead: { station, title: `Goal ${station}` } as Agent['lead'], ...patch });

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

describe('spokenStatus', () => {
  it('says when nothing is going on', () => {
    expect(spokenStatus(snapshot())).toBe("Shop: nobody's at work. Nothing is waiting on you. No goals are queued.");
  });

  it('names who is at work on what, what waits on the captain, and the next queued goal', () => {
    const ship = snapshot({
      projects: [{ ...shop, goalQueue: [queued('Voice mode for Focus\nwith more detail'), queued('Another', 'q2')] }],
      agents: [lead(1, { lead: { station: 1, title: 'Chart the voyage' } as Agent['lead'] }), agent({ id: 'a2', permission: { summary: 'Run rm' } as Agent['permission'], status: 'waiting' })],
    });
    expect(spokenStatus(ship)).toBe(
      'Shop: 2 crew members at work. Lt. Station1 is leading the goal "Chart the voyage". Ensign Reyes is on "Add a wishlist". Waiting on you: Ensign Reyes has a hand up. 2 goals queued; next is "Voice mode for Focus".',
    );
  });

  it('keeps to the project asked about, and leaves hidden ones out', () => {
    const ship = snapshot({ projects: [shop, blog, { id: 'p3', name: 'Secret', repos: ['acme/secret'], hidden: true } as Project] });
    expect(spokenStatus(ship, 'p2')).toBe("Blog: nobody's at work. Nothing is waiting on you. No goals are queued.");
    expect(spokenStatus(ship)).not.toContain('Secret');
  });
});

describe('routingQuestions', () => {
  it('asks only the action with one project aboard, and the yes only while a start waits on it', () => {
    expect(Object.keys(routingQuestions([shop]))).toEqual(['action']);
    expect(Object.keys(routingQuestions([shop, blog], start))).toEqual(['action', 'project', 'approve']);
  });

  it('offers every project, and none of them', () => {
    const question = routingQuestions([shop, blog]).project;
    expect(question.type === 'choice' && Object.keys(question.criteria)).toEqual(['p1', 'p2', 'none']);
  });

  it('puts the exact question the captain is answering to Jev', () => {
    const approve = routingQuestions([shop], start).approve;
    expect(approve.instructions).toContain('Start "Voice mode" in Shop, at station 2?');
  });
});

describe('routingState', () => {
  it('gives Jev the projects, what waits, the call so far and what the captain just said', () => {
    const state = routingState([shop, blog], 'yes please', [{ who: 'ship', text: 'Start it?', at: 0 }], start);
    expect(state).toContain('Projects aboard: Shop, Blog.');
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
      start: { projectId: 'p1', projectName: 'Shop', queueId: 'q1', title: 'Voice mode', station: 2 },
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
    expect(nextGoal(one, undefined)).toMatchObject({ kind: 'confirm', start: { projectId: 'p2', title: 'Posts' } });
    const two = snapshot({ projects: [{ ...shop, goalQueue: [queued('Cart')] }, { ...blog, goalQueue: [queued('Posts')] }] });
    expect(nextGoal(two, undefined)).toEqual({ kind: 'say', text: 'Goals are queued in Shop and Blog. Which project?' });
    expect(nextGoal(snapshot({ projects: [shop, blog] }), undefined)).toEqual({ kind: 'say', text: 'There are no goals queued in any project.' });
  });
});

describe('decide', () => {
  const ship = snapshot({ projects: [{ ...shop, goalQueue: [queued('Voice mode')] }, blog] });

  it('answers a status question from the board, for the project named', () => {
    expect(decide(ship, { action: choice('status'), project: choice('p2') })).toEqual({ kind: 'say', text: spokenStatus(ship, 'p2') });
    expect(decide(ship, { action: choice('status'), project: choice('none') })).toEqual({ kind: 'say', text: spokenStatus(ship) });
  });

  it('asks before starting the next goal', () => {
    expect(decide(ship, { action: choice('start_next_goal'), project: choice('p1') })).toMatchObject({ kind: 'confirm', start: { queueId: 'q1', station: 0 } });
  });

  it("doesn't act on an unsure pick of action or project", () => {
    expect(decide(ship, { action: choice('start_next_goal', 0.5) })).toEqual({ kind: 'say', text: 'By voice I can tell you how things stand and start the next queued goal, nothing else yet.' });
    // an unsure project pick falls back to the only project with a queue
    expect(decide(ship, { action: choice('start_next_goal'), project: choice('p2', 0.4) })).toMatchObject({ kind: 'confirm', start: { projectId: 'p1' } });
  });

  it('goes ahead only on a clear yes to the start waiting on it', () => {
    const yes: JevAnswers = { action: choice('other'), approve: { noul: APPROVE_PROBABILITY } };
    expect(decide(ship, yes, start)).toEqual({ kind: 'go' });
    // the same yes with nothing waiting starts nothing
    expect(decide(ship, yes)).toMatchObject({ kind: 'say' });
    expect(decide(ship, { action: choice('other'), approve: { noul: 0.89 } }, start)).toEqual({ kind: 'say', text: 'Okay, I\'ve left "Voice mode" queued.' });
  });

  it('answers something else said instead of a yes, having left the goal queued', () => {
    const routing = decide(ship, { action: choice('status'), project: choice('p2'), approve: { noul: 0.02 } }, start);
    expect(routing).toEqual({ kind: 'say', text: `Okay, I've left "Voice mode" queued. ${spokenStatus(ship, 'p2')}` });
  });

  it('reads a choice confidence from its probabilities when Jev leaves it out', () => {
    expect(decide(ship, { action: { choice: 'status', probabilities: { status: 0.8 } } })).toMatchObject({ kind: 'say', text: spokenStatus(ship) });
  });
});
