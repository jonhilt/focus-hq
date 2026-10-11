import { shellCommands } from './shell';

/**
 * A Bash command that makes a commit (`git commit -m "…"`, `git -C focus commit …`, after a `git add … &&`), and the
 * first line of its message when it's given there (`-m "$(cat <<'EOF' … EOF)"` included): the slice under way gets
 * one more commit on the star chart once it succeeds. Amending, or a commit inside a heredoc's body, isn't one; a
 * message the shell would only work out as it runs (another command substitution, a variable) is left out.
 */
export function gitCommit(command: string): { message?: string } | undefined {
  for (const words of shellCommands(command)) {
    let i = 0;
    while (i < words.length && /^\w+=/.test(words[i])) i++;
    if (words[i] !== 'git') continue;
    i++;
    // git's own options before the subcommand: -C <dir>, -c <name=value>
    while (i < words.length && words[i].startsWith('-')) i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
    if (words[i] !== 'commit') continue;
    const args = words.slice(i + 1);
    if (args.includes('--amend')) return undefined;
    const m = args.findIndex((w) => w === '-m' || w === '--message' || /^-[a-zA-Z]*m$/.test(w));
    const raw = m >= 0 ? args[m + 1] : args.find((w) => w.startsWith('--message='))?.slice('--message='.length);
    const first = raw?.split('\n').map((l) => l.trim()).find(Boolean);
    return first && !/^\$|^`/.test(first) ? { message: first } : {};
  }
  return undefined;
}
