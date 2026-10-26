import path from 'node:path';

// Whether a scratch `rm` stays inside the session's scratch dir: the command shape dcg is told to allow, the paths it
// removes, and whether each is really inside the dir (`realpath` is the caller's: it reads the disk). Pure, so it's
// unit tested (scratchRules.test.ts); scratch.ts's hook refuses what `scratchRmDenial` says.

/** The env var that names a local session's scratch dir. */
export const SCRATCH_VAR = 'FOCUS_SCRATCH';

// $FOCUS_SCRATCH or ${FOCUS_SCRATCH}, a slash, then a path with no quoting, globbing, expansion or command in it.
// Written once for both JavaScript and dcg's Rust regexes: plain classes and groups, no lookarounds.
const VAR = String.raw`(?:\$FOCUS_SCRATCH|\$\{FOCUS_SCRATCH\})/`;
const QUOTED = String.raw`"${VAR}([^"$` + '`' + String.raw`\\*?\[\]{}~]+)"`;
const BARE = VAR + String.raw`([^\s"'$` + '`' + String.raw`\\*?\[\]{}~;&|<>()!#]+)`;
const TARGET = `(?:${QUOTED}|${BARE})`;

/** A whole command that's only `rm` (any short flags) of paths in the scratch dir. Nothing chained before or after. */
export const SCRATCH_RM = String.raw`^\s*rm(?:\s+-[a-zA-Z]+)*(?:\s+${TARGET})+\s*$`;

/** The paths (relative to the scratch dir) a scratch `rm` removes, or null when `command` isn't one. */
export function scratchRmTargets(command: string): string[] | null {
  if (!new RegExp(SCRATCH_RM).test(command)) return null;
  return [...command.matchAll(new RegExp(TARGET, 'g'))].map((m) => m[1] ?? m[2]);
}

/** Where `p` really is: symlinks followed as far as it exists, the rest appended as written. */
function resolveReal(p: string, realpath: (p: string) => string): string {
  const rest: string[] = [];
  for (let dir = p; ; dir = path.dirname(dir)) {
    try {
      return path.join(realpath(dir), ...rest);
    } catch {
      if (path.dirname(dir) === dir) return p;
      rest.unshift(path.basename(dir));
    }
  }
}

/**
 * Whether `rel` (as written after `$FOCUS_SCRATCH/`) is inside `scratch` and not the dir itself. Any `..` is refused
 * outright (the shell resolves it after symlinks, not as written), and so is a path whose symlinks lead outside.
 */
export function insideScratch(rel: string, scratch: string, realpath: (p: string) => string): boolean {
  if (rel.split('/').includes('..')) return false;
  let root: string;
  try {
    root = realpath(scratch);
  } catch {
    return false;
  }
  const real = resolveReal(path.join(scratch, rel), realpath);
  return real.startsWith(root + path.sep) && real !== root;
}

/** Why Ops refuses a scratch `rm` that reaches outside the scratch dir; null for any other command, or a safe one. */
export function scratchRmDenial(command: string, scratch: string, realpath: (p: string) => string): string | null {
  const targets = scratchRmTargets(command);
  const outside = targets?.filter((t) => !insideScratch(t, scratch, realpath)) ?? [];
  if (!outside.length) return null;
  return `Refused by Ops: ${outside.map((t) => `$${SCRATCH_VAR}/${t}`).join(', ')} isn't inside your scratch dir (no "..", and no symlinks leading out of it). Delete only what's in $${SCRATCH_VAR}, and leave anything else where it is.`;
}
