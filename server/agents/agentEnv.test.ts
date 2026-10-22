import { afterEach, describe, expect, it } from 'vitest';
import { agentEnv } from './claudeRunner';

// docs/settings.md: "A secret is never put in Focus's environment, which every agent's session is handed a copy of",
// and one set there by hand (FOCUS_BOT_TOKEN in a shell profile, say) isn't handed on either.
describe('an agent’s environment', () => {
  const before = { ...process.env };
  afterEach(() => {
    for (const name of ['FOCUS_BOT_TOKEN', 'FOCUS_BOT_WEBHOOK', 'FOCUS_BOT_WEBHOOK_AUTH']) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  });

  it('leaves out the bot’s secrets set in Focus’s environment, and keeps the rest', () => {
    Object.assign(process.env, { FOCUS_BOT_TOKEN: 'tok', FOCUS_BOT_WEBHOOK: 'https://h/s3cret', FOCUS_BOT_WEBHOOK_AUTH: 'Bearer x' });
    const env = agentEnv(false);
    expect(env).not.toHaveProperty('FOCUS_BOT_TOKEN');
    expect(env).not.toHaveProperty('FOCUS_BOT_WEBHOOK');
    expect(env).not.toHaveProperty('FOCUS_BOT_WEBHOOK_AUTH');
    expect(env.PATH).toBe(process.env.PATH);
    expect(process.env.FOCUS_BOT_TOKEN).toBe('tok');
  });
});
