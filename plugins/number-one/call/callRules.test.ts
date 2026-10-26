import { describe, expect, it } from 'vitest';
import { callsMissing, stepOf } from './callRules';

describe('callsMissing', () => {
  it('names each missing key, and needs none in the demo', () => {
    expect(callsMissing({}, false)).toBe('Calls need an OpenAI API key and a TypeSafe API key, set in the ready room\'s Plugins tab');
    expect(callsMissing({ openai: 'a', typesafe: 'b' }, false)).toBeUndefined();
    expect(callsMissing({}, true)).toBeUndefined();
  });
});

describe('stepOf', () => {
  it("shows the machine's state as the step, routing whichever part of it", () => {
    expect(stepOf('confirming')).toBe('confirming');
    expect(stepOf({ routing: 'asking' })).toBe('routing');
    expect(stepOf('ended')).toBe('ended');
    expect(stepOf('something new')).toBe('listening');
  });
});
