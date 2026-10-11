import { describe, expect, it } from 'vitest';
import { gitCommit } from './commits';

describe('gitCommit', () => {
  it('spots a commit and what its message says', () => {
    expect(gitCommit('git commit -m "Star chart labels never overlap"')).toEqual({ message: 'Star chart labels never overlap' });
    expect(gitCommit('cd focus && git add -A && git commit -q -m "Probes: helpers fly out"')).toEqual({ message: 'Probes: helpers fly out' });
    expect(gitCommit("git -C focus commit -am 'Fix the wall chart'")).toEqual({ message: 'Fix the wall chart' });
    expect(gitCommit('git commit --message="Tidy"')).toEqual({ message: 'Tidy' });
    expect(gitCommit('git commit -F msg.txt')).toEqual({});
  });

  it('keeps a quoted ; && or || in the message', () => {
    expect(gitCommit('git commit -m "Fix: a; b && c || d" && git log -1')).toEqual({ message: 'Fix: a; b && c || d' });
  });

  it('takes the first line of a message written in a heredoc, as sessions usually commit', () => {
    const command = `git add -A && git commit -q -m "$(cat <<'EOF'\nHeading on the chart (contact c1)\n\nBody: a; b && c\nEOF\n)"`;
    expect(gitCommit(command)).toEqual({ message: 'Heading on the chart (contact c1)' });
  });

  it('leaves out a message only the shell could work out, rather than showing half of it', () => {
    expect(gitCommit('git commit -m "$(git log -1 --format=%s)"')).toEqual({});
    expect(gitCommit('git commit -m "$MSG"')).toEqual({});
  });

  it('leaves alone amending, other git commands, and one written into a heredoc', () => {
    expect(gitCommit('git commit --amend --no-edit')).toBeUndefined();
    expect(gitCommit('git log --oneline -1 && git status --short')).toBeUndefined();
    expect(gitCommit(`cat > notes.md <<'EOF'\ngit commit -m "x"\nEOF`)).toBeUndefined();
    expect(gitCommit('echo git commit')).toBeUndefined();
  });
});
