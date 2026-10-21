import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { errorMessage } from '../util';

// A terminal on the captain's screen that starts a Claude Code cloud session: the CLI starts a new one only from a
// terminal (`--cloud` without one can only attach to an existing session), so Ops opens one, and attaches to the
// session once the terminal shows its id. The pure parts (scripts, launchers, finding the id) are tested; opening the
// window is the I/O at the end.

/** What to start a cloud session with, from the agent's worktree. */
export interface TerminalScript {
  cwd: string;
  /** The Claude Code executable. */
  claude: string;
  /** The new session's first message (`claude --cloud <description>`). */
  description: string;
  /** Who it's for, for the lines the terminal shows first. */
  agentName: string;
  /** Where the terminal's output is recorded (`script`), for Ops to find the session's id in. None on Windows. */
  log?: string;
}

/** Quoted for a POSIX shell: everything in single quotes, any single quote closed, escaped and reopened. */
export function shQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * A description that's safe on any command line: letters, digits and plain punctuation, nothing a shell or cmd.exe
 * reads as syntax (quotes, `%`, `^`, `&`, `|`, redirects, `$`, backticks).
 */
export function safeDescription(text: string, max = 300): string {
  return text.replace(/[^A-Za-z0-9 #/.,:()_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** The script the terminal runs, and the file name it needs to run as one (`.command` opens in Terminal on macOS). */
export function terminalScript(platform: NodeJS.Platform, s: TerminalScript): { name: string; text: string } {
  const intro = [
    `Focus HQ is starting a Claude Code cloud session for ${s.agentName}.`,
    'Once the session has started, Focus picks it up and sends the work over. You can watch it here, or on claude.ai.',
  ];
  if (platform === 'win32') {
    return {
      name: 'cloud.cmd',
      text: ['@echo off', `cd /d "${s.cwd}"`, ...intro.map((l) => `echo ${l}`), `"${s.claude}" --cloud "${s.description}"`, ''].join('\r\n'),
    };
  }
  const claude = [s.claude, '--cloud', s.description].map(shQuote).join(' ');
  // `script` records what the terminal shows while keeping it a terminal, which `claude --cloud` needs
  const recorded = !s.log
    ? claude
    : platform === 'darwin'
      ? `script -q ${shQuote(s.log)} ${claude}`
      : `script -q -c ${shQuote(claude)} ${shQuote(s.log)}`;
  return {
    name: platform === 'darwin' ? 'cloud.command' : 'cloud.sh',
    text: [
      '#!/bin/sh',
      `cd ${shQuote(s.cwd)} || exit 1`,
      `printf '%s\\n' ${intro.map(shQuote).join(' ')}`,
      s.log ? `if command -v script >/dev/null 2>&1; then ${recorded}; else ${claude}; fi` : claude,
      '',
    ].join('\n'),
  };
}

/**
 * The commands that might open a terminal running `script`, to try in turn. `custom` (FOCUS_TERMINAL, e.g. "kitty -e")
 * goes first, with the script's path after it.
 */
export function terminalLaunchers(platform: NodeJS.Platform, script: string, custom?: string): [string, string[]][] {
  const own: [string, string[]][] = [];
  const words = custom?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length) own.push([words[0], [...words.slice(1), script]]);
  if (platform === 'darwin') return [...own, ['open', [script]]];
  if (platform === 'win32') return [...own, ['cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', script]]];
  return [
    ...own,
    ['x-terminal-emulator', ['-e', 'sh', script]],
    ['gnome-terminal', ['--', 'sh', script]],
    ['konsole', ['-e', 'sh', script]],
    ['xfce4-terminal', ['-x', 'sh', script]],
    ['kitty', ['sh', script]],
    ['alacritty', ['-e', 'sh', script]],
    ['wezterm', ['start', '--', 'sh', script]],
    ['xterm', ['-e', 'sh', script]],
  ];
}

/** A cloud session's id in what a terminal showed (its escape sequences and all), or in a pasted link. */
export function cloudSessionId(text: string): string | undefined {
  // colours and cursor moves come out first, so they can't split the id
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  return /\b((?:session|cse)_[A-Za-z0-9]{8,})\b/.exec(plain)?.[1];
}

/**
 * The Claude Code executable the Agent SDK bundles, the one Focus's agents run on (so the terminal starts the
 * same version that attaches afterwards), or else `claude` on the PATH.
 */
export function bundledClaude(): string {
  const require = createRequire(import.meta.url);
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  for (const pkg of process.platform === 'linux' ? [base, `${base}-musl`] : [base]) {
    try {
      return require.resolve(`${pkg}/${exe}`);
    } catch {
      // not installed for this platform: try the next
    }
  }
  return 'claude';
}

/**
 * Opens a terminal running `s`, from `dir`, where the script (and the terminal's recording) is kept. Each launcher is
 * tried in turn: one that isn't installed, or that exits with an error at once (no display, say), makes way for the
 * next. Terminals are started detached rather than through `run()`, which would wait for the window to close.
 */
export async function openTerminal(dir: string, s: TerminalScript, custom = process.env.FOCUS_TERMINAL): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const script = terminalScript(process.platform, s);
  const file = path.join(dir, script.name);
  await fs.writeFile(file, script.text, { mode: 0o755 });
  if (s.log) await fs.rm(s.log, { force: true });
  const tried: string[] = [];
  for (const [cmd, args] of terminalLaunchers(process.platform, file, custom)) {
    const failed = await launch(cmd, args);
    if (!failed) return;
    tried.push(`${cmd} (${failed})`);
  }
  throw new Error(`Couldn't open a terminal: tried ${tried.join(', ')}. Set FOCUS_TERMINAL to the command that opens one (e.g. "kitty -e"), or start the session on claude.ai and paste its link.`);
}

/** Starts a launcher; resolves with why it failed, or undefined once it has opened (or is still running after a moment). */
function launch(cmd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (why: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(why);
    };
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => settle((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : errorMessage(err)));
    child.on('exit', (code) => settle(code ? `exited with ${code}` : undefined));
    const timer = setTimeout(() => settle(undefined), 1500);
    child.unref();
  });
}

/** What the terminal has shown so far: '' until it's shown anything. */
export async function readTerminal(log: string): Promise<string> {
  return fs.readFile(log, 'utf8').catch(() => '');
}
