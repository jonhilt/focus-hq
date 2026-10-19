// ▶ Preview: pull requests running on this machine.

/**
 * Shell commands for ▶ Preview, run in the PR's checkout. Placeholders: {dir} (the PR's checkout), {dir:<repo>} (that
 * repo's checkout, at the repo's chosen PR: the clicked one, a PR linked to it through a feature label, or one picked in
 * the preview panel; else its default branch), {port}, {pr}, {repo}.
 */
export interface PreviewConfig {
  /** Starts the site(s). Empty = install and run the package.json dev script of the PR's repo. */
  command?: string;
  /** Tears down what `command` left running (containers, background servers). Runs on stop and before every start. */
  stopCommand?: string;
  /**
   * Polled while starting. Its JSON is this stack's state or a list of stacks ({"sessions": [...]}, ours is the one
   * mentioning our checkouts); its "phase" shows as progress, and a listed stack dropping out fails the preview.
   */
  statusCommand?: string;
}

export type PreviewStatus = 'starting' | 'running' | 'failed' | 'stopping';

export interface PreviewLink {
  /** e.g. "web" when the command printed JSON like {"urls": {"web": "http://…"}}. */
  name?: string;
  url: string;
  /** Last check: answering, answering with a 5xx, or not answering at all. */
  health?: 'up' | 'error' | 'down';
  /** HTTP status of the last check. */
  code?: number;
}

/**
 * A local site's port, mirrored by the office on its tailnet addresses. `host` is the name on the office's TLS
 * certificate (https needs it); without one, the name the browser reached the office by.
 */
export interface PreviewMirror {
  port: number;
  scheme: 'http' | 'https';
  host?: string;
}

/** A log file in the folder a preview command reported as "logs". */
export interface PreviewLogFile {
  name: string;
  size: number;
  modified: number;
}

/** Which pull request each repository of a project runs in a preview: its number, or null for the default branch. */
export type PreviewSet = Record<string, number | null>;

export type PreviewRef = { pr: number } | { branch: string };

/** One repository a preview checked out (or is about to). */
export interface PreviewCheckout {
  repo: string;
  ref: PreviewRef;
  /** Missing until it's fetched. Differs from the PR's headSha once someone pushes again. */
  sha?: string;
}

/** Pull requests running on this machine so the manager can try them in their own browser. One per project at a time. */
export interface Preview {
  projectId: string;
  repo: string;
  /** The pull request being previewed: the one ▶ Preview was clicked on. */
  number: number;
  title: string;
  /** Commit of `number` that is checked out. */
  sha?: string;
  /** Every repository's choice, the clicked PR's included. Restart runs the same set again. */
  set: PreviewSet;
  /** The repositories the preview command uses, at their choice from `set`, filled in once the preview has worked them out. */
  checkouts: PreviewCheckout[];
  status: PreviewStatus;
  /** What it's doing right now ("Installing dependencies", "Up at http://localhost:5173/"…). */
  activity: string;
  /** The command line that runs the site(s). */
  command?: string;
  /** Free port offered to the command as {port} and $FOCUS_PREVIEW_PORT. */
  port?: number;
  /** Where other machines on the tailnet reach the local sites: the office mirrors their ports (server/previewMirrors.ts). */
  mirrors?: PreviewMirror[];
  /** Local sites the command brought up. The first one is the main link. */
  links: PreviewLink[];
  /** Where the command keeps its own logs, if it said so in its JSON output. */
  logs?: string;
  /** Up, but not happily: e.g. the command exited 1 reporting the stack as "unhealthy". */
  warning?: string;
  startedAt: number;
  error?: string;
}

/** A stretch of a preview's output. `first` numbers the first line since the preview started, so pieces can be stitched. */
export interface PreviewLog {
  startedAt: number;
  first: number;
  lines: string[];
}
