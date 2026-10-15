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

  it('leaves state saved since alone', () => {
    const raw: SavedBeforePlugins = { plugins: {}, agents: [{ task: 'lead' }] };
    fromBeforePlugins(raw);
    expect(raw).toEqual({ plugins: {}, agents: [{ task: 'lead' }] });
  });
});
