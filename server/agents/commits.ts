/**
 * A Bash command that makes a commit (`git commit -m "…"`, `git -C focus commit …`, after a `git add … &&`), and what
 * its message says when it's given there: the slice under way gets one more commit on the star chart once it succeeds.
 * Amending, or a commit inside a heredoc's body, isn't one.
 */
export function gitCommit(command: string): { message?: string } | undefined {
  const body = command.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1[ \t]*(?=\n|$)/g, '');
  for (const segment of body.split(/&&|\|\||[;\n]/)) {
    const words = segment.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
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
    const message = raw?.replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\"/g, '"');
    return message ? { message } : {};
  }
  return undefined;
}
