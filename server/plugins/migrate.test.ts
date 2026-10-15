import { describe, expect, it } from 'vitest';
import { fromBeforePlugins, type SavedBeforePlugins } from './migrate';

describe('fromBeforePlugins', () => {
  it('moves the climber’s saved state into its plugin’s slot, and its climbs onto the brief task', () => {
    const raw: SavedBeforePlugins = {
      climb: { keepClimbing: true, cycles: 3 },
      agents: [{ task: 'climb' }, { task: 'issue' }],
    };
    fromBeforePlugins(raw);
    expect(raw).toEqual({
      plugins: { climber: { keepClimbing: true, cycles: 3 } },
      agents: [{ task: 'brief', brief: { plugin: 'climber', kind: 'climb', label: 'Climb', icon: '🧗' } }, { task: 'issue' }],
    });
  });

  it('keeps what the plugin saved since over anything left from before', () => {
    const raw: SavedBeforePlugins = { climb: { cycles: 1 }, plugins: { climber: { cycles: 5 } } };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: { climber: { cycles: 5 } } });
  });

  it('drops the flow saved on goals’ leads, which the flow plugin works out again as it starts', () => {
    const raw: SavedBeforePlugins = { agents: [{ task: 'lead', lead: { flow: { now: { state: 'qa' } } } }, { task: 'issue' }] };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: {}, agents: [{ task: 'lead', lead: {} }, { task: 'issue' }] });
  });

  it('moves a retro that ran into the retro plugin’s slot, and drops one that never did', () => {
    const ran = { status: 'thinking', activity: 'Drafting', days: 14, sessions: 3, drafts: [], watch: [], costUsd: 0.2 };
    const raw: SavedBeforePlugins = { retro: ran };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: { retro: ran } });

    const decided = { status: 'idle', drafts: [{ id: 'd1' }] };
    const old: SavedBeforePlugins = { retro: decided };
    fromBeforePlugins(old);
    expect(old).toEqual({ plugins: { retro: decided } });

    const untouched: SavedBeforePlugins = { retro: { status: 'idle', activity: '', days: 14, sessions: 0, drafts: [], watch: [], costUsd: 0 } };
    fromBeforePlugins(untouched);
    expect(untouched).toEqual({ plugins: {} });

    const since: SavedBeforePlugins = { retro: ran, plugins: { retro: { status: 'done' } } };
    fromBeforePlugins(since);
    expect(since).toEqual({ plugins: { retro: { status: 'done' } } });
  });

  it('moves a chat with Number One into the number-one plugin’s slot, session and all, and drops one never used', () => {
    const chat = { status: 'waiting', activity: 'Waiting for you', messages: [{ from: 'manager', text: 'Hi', at: 1 }], updatedAt: 1, costUsd: 0.1, sessionId: 's1' };
    const raw: SavedBeforePlugins = { numberOne: chat };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: { 'number-one': { chat } } });

    const cleared = { status: 'waiting', activity: '', messages: [], updatedAt: 1, costUsd: 0, sessionId: 's2' };
    const resumable: SavedBeforePlugins = { numberOne: cleared };
    fromBeforePlugins(resumable);
    expect(resumable).toEqual({ plugins: { 'number-one': { chat: cleared } } });

    const untouched: SavedBeforePlugins = { numberOne: { status: 'waiting', activity: '', messages: [], updatedAt: 1, costUsd: 0 } };
    fromBeforePlugins(untouched);
    expect(untouched).toEqual({ plugins: {} });

    const since: SavedBeforePlugins = { numberOne: chat, plugins: { 'number-one': { chat: { messages: [] } } } };
    fromBeforePlugins(since);
    expect(since).toEqual({ plugins: { 'number-one': { chat: { messages: [] } } } });
  });

  it('leaves state saved since alone', () => {
    const raw: SavedBeforePlugins = { plugins: {}, agents: [{ task: 'lead' }] };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: {}, agents: [{ task: 'lead' }] });
  });
});
