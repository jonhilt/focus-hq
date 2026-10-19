// Whether the office takes up what the captain asks of it from a room's board: filing an issue, previewing a PR. Pure, so
// each is tested next to it; the Office only does the I/O.
import type { Board, Project, PullRequest } from '../shared/types';

/** Why the captain can't file this issue in the project, or undefined when they can. */
export function issueRefusal(project: Pick<Project, 'name' | 'repos'>, repo: string, title: string): string | undefined {
  if (!project.repos.includes(repo)) return `${repo} is not part of ${project.name}`;
  return title.trim() ? undefined : 'An issue needs a title';
}

/** The open PR on the project's board the captain asked to preview, with its board; or why there's none to preview. */
export function previewTarget(project: Pick<Project, 'name' | 'repos'>, board: Board | undefined, repo: string, number: number): { board: Board; pr: PullRequest } | string {
  if (!project.repos.includes(repo)) return `${repo} is not part of ${project.name}`;
  const pr = board?.prs.find((p) => p.repo === repo && p.number === number);
  return board && pr ? { board, pr } : `${repo}#${number} is not an open pull request`;
}
