/** `owner/repo` from a git remote's URL (`https://github.com/o/r.git`, `git@github.com:o/r.git`), or nothing for another host. */
export function githubRepo(remoteUrl: string): string | undefined {
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())?.[1];
}
