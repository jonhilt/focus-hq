import { describe, expect, it } from 'vitest';
import { pullRequestBody } from './prompts';

const agent = { name: 'Ada', issue: { number: 7 } };

describe('pullRequestBody', () => {
  it('closes the issue and signs the work by default', () => {
    const body = pullRequestBody(agent, 'Adds a cart.', true);
    expect(body).toContain('Adds a cart.\n\nCloses #7');
    expect(body).toContain('_Built by **Ada** in the Focus office with Claude Code._');
  });

  it('leaves out the agent and Focus when attribution is off', () => {
    expect(pullRequestBody(agent, 'Adds a cart.', false)).toBe('Adds a cart.\n\nCloses #7');
  });
});
