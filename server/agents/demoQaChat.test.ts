import { describe, expect, it } from 'vitest';
import { qaSettingsNow } from '../../shared/qaChat';
import { demoQaAnswer, DemoQaChat } from './demoQaChat';

const now = qaSettingsNow({ qaBrief: '- Works at phone width' });
const said = (text: string) => demoQaAnswer([{ who: 'captain', text }], now);

describe('the demo’s QA officer at the Playbook', () => {
  it('adds the e2e suite to the scripts it runs, once', () => {
    expect(said('Run the e2e suite too').change).toEqual({ mergeChecks: ['typecheck', 'lint', 'test', 'e2e'] });
    expect(demoQaAnswer([{ who: 'captain', text: 'and e2e' }], { ...now, mergeChecks: ['e2e', 'test'] }).change).toEqual({ mergeChecks: ['test', 'e2e'] });
  });

  it('switches sending failed PRs back off, or on', () => {
    expect(said('Stop sending failed PRs back').change).toEqual({ autoSendBack: false });
    expect(said('Send failed PRs back to the developer').change).toEqual({ autoSendBack: true });
  });

  it('puts what its steps can’t change in the brief', () => {
    expect(said('Skip the browser unless it touches checkout').change).toEqual({ qaBrief: '- Works at phone width\n- Skip the browser unless the pull request touches the checkout.' });
  });

  it('only answers a question', () => {
    expect(said('Why does it read every file?')).not.toHaveProperty('change');
    expect(said('Hello')).toEqual({ reply: expect.stringContaining('Tell me what you’d like') });
  });

  it('answers after a moment', async () => {
    const answer = await new DemoQaChat(0).answer({ now, turns: [{ who: 'captain', text: 'e2e please' }], signal: new AbortController().signal });
    expect(answer.change).toEqual({ mergeChecks: ['typecheck', 'lint', 'test', 'e2e'] });
    const stopped = new AbortController();
    stopped.abort();
    await expect(new DemoQaChat(0).answer({ now, turns: [], signal: stopped.signal })).rejects.toThrow('Stopped');
  });
});
