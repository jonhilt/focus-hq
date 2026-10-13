import { describe, expect, it } from 'vitest';
import { updateBlocked } from './updater';

describe('updateBlocked', () => {
  it('lets a clean checkout behind its upstream fast-forward', () => {
    expect(updateBlocked({ ahead: 0, behind: 3, dirty: false, upstream: 'origin/main' })).toBeNull();
  });

  it('explains local commits and how to clear them', () => {
    const why = updateBlocked({ ahead: 1, behind: 2, dirty: false, upstream: 'origin/main' });
    expect(why).toContain('1 commit that origin/main');
    expect(why).toContain('2 commits behind');
    expect(why).toContain('git pull --rebase');
  });

  it('explains uncommitted changes', () => {
    expect(updateBlocked({ ahead: 0, behind: 1, dirty: true, upstream: 'origin/main' })).toContain('uncommitted changes');
  });
});
