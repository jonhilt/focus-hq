import { describe, expect, it } from 'vitest';
import { cloudSessionId, safeDescription, shQuote, terminalLaunchers, terminalScript } from './terminal';

const script = { cwd: "/work/it's here", claude: '/sdk/claude', description: 'Focus HQ: Ada on acme/shop#12.', agentName: 'Ada', log: '/data/ct/a1/terminal.log' };

describe('shQuote', () => {
  it('quotes anything for a POSIX shell, single quotes included', () => {
    expect(shQuote('plain')).toBe("'plain'");
    expect(shQuote("it's")).toBe("'it'\\''s'");
    expect(shQuote('$HOME `x` "y"')).toBe("'$HOME `x` \"y\"'");
  });
});

describe('safeDescription', () => {
  it('keeps plain words and punctuation, and drops what a shell or cmd.exe would read', () => {
    expect(safeDescription('Focus HQ: Ada on acme/shop#12 (dark mode).')).toBe('Focus HQ: Ada on acme/shop#12 (dark mode).');
    expect(safeDescription('a "quoted" 100% & | <b> $x `y` ^z it\'s')).toBe('a quoted 100 b x y z it s');
  });

  it('is cut to length', () => {
    expect(safeDescription('word '.repeat(100), 20)).toBe('word word word word');
  });
});

describe('terminalScript', () => {
  it('records the terminal with BSD script on macOS, as a .command file Terminal opens', () => {
    const { name, text } = terminalScript('darwin', script);
    expect(name).toBe('cloud.command');
    expect(text).toContain("cd '/work/it'\\''s here' || exit 1");
    expect(text).toContain("script -q '/data/ct/a1/terminal.log' '/sdk/claude' '--cloud' 'Focus HQ: Ada on acme/shop#12.'");
    // without script, claude still runs, unrecorded
    expect(text).toContain("else '/sdk/claude' '--cloud' 'Focus HQ: Ada on acme/shop#12.'; fi");
  });

  it('passes the command to util-linux script as one argument on Linux', () => {
    const { name, text } = terminalScript('linux', script);
    expect(name).toBe('cloud.sh');
    expect(text).toContain(`script -q -c ${shQuote("'/sdk/claude' '--cloud' 'Focus HQ: Ada on acme/shop#12.'")} '/data/ct/a1/terminal.log'`);
  });

  it('just runs claude where nothing records it (Windows)', () => {
    const { name, text } = terminalScript('win32', { ...script, cwd: 'C:\\work\\a1', claude: 'C:\\sdk\\claude.exe', log: undefined });
    expect(name).toBe('cloud.cmd');
    expect(text).toContain('cd /d "C:\\work\\a1"');
    expect(text).toContain('"C:\\sdk\\claude.exe" --cloud "Focus HQ: Ada on acme/shop#12."');
    expect(text).not.toContain('script');
  });
});

describe('terminalLaunchers', () => {
  it('tries the captain’s own terminal first, then the platform’s', () => {
    expect(terminalLaunchers('darwin', '/s/cloud.command')).toEqual([['open', ['/s/cloud.command']]]);
    expect(terminalLaunchers('linux', '/s/cloud.sh', 'kitty -e')[0]).toEqual(['kitty', ['-e', '/s/cloud.sh']]);
    expect(terminalLaunchers('linux', '/s/cloud.sh').map(([cmd]) => cmd)).toEqual(['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'xterm']);
    expect(terminalLaunchers('win32', 'C:\\s\\cloud.cmd')).toEqual([['cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', 'C:\\s\\cloud.cmd']]]);
  });
});

describe('cloudSessionId', () => {
  it('finds the session in a link or on its own', () => {
    expect(cloudSessionId('https://claude.ai/code/session_01VxUFjkke4M7ei2KqXXk6wA')).toBe('session_01VxUFjkke4M7ei2KqXXk6wA');
    expect(cloudSessionId('  cse_0123456789abcdef ')).toBe('cse_0123456789abcdef');
  });

  it('reads it through what the terminal drew around it', () => {
    const shown = 'Starting…\r\n\x1b[2K\x1b[1G\x1b[38;5;246m☁ Watch it at \x1b[4mhttps://claude.ai/code/session_01ABCdef234\x1b[24m\x1b[39m';
    expect(cloudSessionId(shown)).toBe('session_01ABCdef234');
  });

  it('finds nothing in anything else', () => {
    expect(cloudSessionId('https://claude.ai/code')).toBeUndefined();
    expect(cloudSessionId('session_')).toBeUndefined();
    expect(cloudSessionId('')).toBeUndefined();
  });
});
