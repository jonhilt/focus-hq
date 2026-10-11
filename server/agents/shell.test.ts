import { describe, expect, it } from 'vitest';
import { shellCommands } from './shell';

describe('shellCommands', () => {
  it('splits at the operators, keeping quoted ones in their words', () => {
    expect(shellCommands('cd focus && git add -A; git commit -m "Fix: a; b && c || d" | tail -2')).toEqual([
      ['cd', 'focus'],
      ['git', 'add', '-A'],
      ['git', 'commit', '-m', 'Fix: a; b && c || d'],
      ['tail', '-2'],
    ]);
    expect(shellCommands("echo 'it''s' \"say \\\"hi\\\"\"")).toEqual([['echo', 'its', 'say "hi"']]);
  });

  it('skips a heredoc’s body, carrying on after it', () => {
    expect(shellCommands(`cat > "$FOCUS_SCRATCH/a.ts" <<'EOF'\ngit commit -m "not one"\nEOF\nnpx tsx "$FOCUS_SCRATCH/a.ts"`)).toEqual([
      ['cat', '>', '$FOCUS_SCRATCH/a.ts'],
      ['npx', 'tsx', '$FOCUS_SCRATCH/a.ts'],
    ]);
    expect(shellCommands(`python3 - <<'PY' && echo done\nprint(1)\nPY`)).toEqual([['python3', '-'], ['echo', 'done']]);
  });

  it('reads a command substitution’s heredoc as its word', () => {
    const command = `git commit -q -m "$(cat <<'EOF'\nHeading on the chart (contact c1)\n\nBody: a; b && c\nEOF\n)" && git log -1`;
    expect(shellCommands(command)).toEqual([
      ['git', 'commit', '-q', '-m', 'Heading on the chart (contact c1)\n\nBody: a; b && c'],
      ['git', 'log', '-1'],
    ]);
  });
});
