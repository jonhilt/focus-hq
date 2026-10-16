import { describe, expect, it } from 'vitest';
import { contextLevel, runLine } from './agentStatus';

describe('contextLevel', () => {
  it('reads how full a context is: fine, filling up, nearly full', () => {
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(59)).toBe('ok');
    expect(contextLevel(60)).toBe('filling');
    expect(contextLevel(79)).toBe('filling');
    expect(contextLevel(80)).toBe('full');
    expect(contextLevel(104)).toBe('full');
  });
});

describe('runLine', () => {
  it('says where a run is, with its turn and what followed it', () => {
    expect(runLine({ phase: 'turn.started', turns: 3, seq: 40 })).toBe('turn 3 running');
    expect(runLine({ phase: 'ended', turns: 3, target: 'deliver', seq: 44 })).toBe('turn 3 ended → deliver');
    expect(runLine({ phase: 'interrupted', turns: 1, seq: 9 })).toBe('turn 1 interrupted');
    expect(runLine({ phase: 'waiting', turns: 2, seq: 12 })).toBe('waiting for a slot');
    expect(runLine({ phase: 'idle', turns: 0, seq: 0 })).toBe('idle');
    expect(runLine({ phase: 'delivering.opening', turns: 2, target: 'deliver', seq: 20 })).toBe('turn 2 opening the PR');
    expect(runLine({ phase: 'delivered', turns: 2, target: 'deliver', pr: 412, seq: 22 })).toBe('turn 2 delivered → PR #412');
    expect(runLine({ phase: 'failed', turns: 2, target: 'deliver', seq: 21 })).toBe('turn 2 delivery failed');
    expect(runLine({ phase: 'turn.asking', turns: 4, seq: 30 })).toBe('turn 4 waiting for your approval');
    expect(runLine({ phase: 'held', turns: 4, seq: 31 })).toBe('on hold for your plan');
  });
});
