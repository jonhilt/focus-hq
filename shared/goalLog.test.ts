import { describe, expect, it } from 'vitest';
import { leftOn } from './goalLog';

describe('a closed goal in the log', () => {
  const repos = [{ repo: 'acme/web', folder: 'web', baseBranch: 'main' }, { repo: 'acme/api', folder: 'api', baseBranch: 'main' }];

  it('says which branch its repos were left on, as Ops renamed them, not the slice’s working name', () => {
    expect(leftOn({ branch: 'focus/saved-items-2-ab12', repos: repos.map((r) => ({ ...r, branch: 'focus/save-for-later-ab12' })) })).toBe('Left on focus/save-for-later-ab12');
    expect(leftOn({ branch: 'focus/saved-items-2-ab12', repos })).toBe('Left on focus/saved-items-2-ab12');
  });

  it('names each repo’s when they differ', () => {
    expect(leftOn({ branch: 'focus/saved-items-2-ab12', repos: [{ ...repos[0], branch: 'focus/save-for-later-ab12' }, repos[1]] }))
      .toBe('Left on focus/save-for-later-ab12 in web, focus/saved-items-2-ab12 in api');
  });

  it('says nothing for a goal closed before branches were kept', () => {
    expect(leftOn({})).toBeUndefined();
  });
});
