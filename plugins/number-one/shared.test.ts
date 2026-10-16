import { describe, expect, it } from 'vitest';
import { NUMBER_ONE_VOICE } from './shared';
import { crewVoice } from '../../plugin-api/shared';

describe('NUMBER_ONE_VOICE', () => {
  it('has a pitch of its own, so Number One never sounds like a room’s crew', () => {
    for (const p of Array.from({ length: 30 }, (_, i) => `p${i}`)) {
      const pitches = [crewVoice('officer', p), crewVoice('qa', p), crewVoice('engineer', p)].map((v) => v.pitch);
      expect(pitches).not.toContain(NUMBER_ONE_VOICE.pitch);
    }
  });
});
