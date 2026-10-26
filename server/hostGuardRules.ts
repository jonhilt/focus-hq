// Which hosts, pages and tailnet devices Focus answers: it has no login, so it only answers the captain's own browser
// (and, on its own routes, their bot). Pure, so it's unit tested (hostGuardRules.test.ts); index.ts reads the machine's
// name and addresses and refuses the requests.

/**
 * The names a browser may reach Focus by. `names` are exact hostnames, `suffixes` (starting with a dot) match any
 * hostname under them, like a Tailscale Serve address under `.ts.net`.
 */
export interface AllowedHosts {
  names: Set<string>;
  suffixes: string[];
}

const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** Listening on every interface, so Focus is reachable by any of the machine's addresses. */
const isWildcard = (host: string) => host === '0.0.0.0' || host === '::';

/**
 * Where Focus may be reached from: loopback, `HOST` itself, `.ts.net` (the Tricorder through Tailscale Serve)
 * and anything in `FOCUS_ALLOWED_HOSTS` (comma-separated, `.example.com` for a suffix). A Focus
 * listening on every interface adds the machine's own name and addresses (`machine`).
 */
export function allowedHosts(host: string, extra: string, machine: { hostname: string; addresses: string[] }): AllowedHosts {
  const names = new Set(LOOPBACK);
  const suffixes = ['.ts.net'];
  if (isWildcard(host)) {
    for (const name of [machine.hostname, `${machine.hostname}.local`, ...machine.addresses]) names.add(name.toLowerCase());
  } else names.add(host.toLowerCase());
  for (const entry of extra.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)) {
    if (entry.startsWith('.')) suffixes.push(entry);
    else names.add(entry);
  }
  return { names, suffixes };
}

/** A `Host` header's or URL's hostname without its port or an IPv6 address's brackets, lower case. */
export function hostname(hostHeader: string): string {
  const bracketed = /^\[([^\]]+)\]/.exec(hostHeader);
  if (bracketed) return bracketed[1].toLowerCase();
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

const allowed = (name: string, hosts: AllowedHosts) => hosts.names.has(name) || hosts.suffixes.some((s) => name.endsWith(s));

/**
 * Why a request to Focus is refused, or undefined to let it through. Focus has no login, so it only answers
 * the captain's own browser: a `Host` it doesn't know is another site's name pointed at this machine (DNS rebinding),
 * and a page from anywhere but Focus itself, the very name and port the request came to, is another site's (another
 * app on a localhost port, another machine under `.ts.net`, or a sandboxed page, `null`, like a lead's artifact) trying
 * to drive it. Requests with no `Origin` (same-origin page loads, curl, scripts) need only the `Host`.
 */
export function refusal(headers: { host?: string; origin?: string }, hosts: AllowedHosts): string | undefined {
  if (!headers.host || !allowed(hostname(headers.host), hosts)) return `Focus doesn't answer to the host ${headers.host ?? '(none)'}`;
  if (headers.origin === undefined) return undefined;
  let origin: string;
  try {
    origin = new URL(headers.origin).host.toLowerCase();
  } catch {
    return `Focus doesn't answer pages from ${headers.origin}`;
  }
  if (origin !== headers.host.toLowerCase()) return `Focus doesn't answer pages from ${headers.origin}`;
  return undefined;
}

/** What a request says about who sent it, as `tailnetRefusal` reads it: its headers, its peer's address and its path. */
export interface Caller {
  /** `Tailscale-User-Login`, which Tailscale Serve sets for a device a person owns (and strips from what's sent). */
  login?: string;
  /** `X-Forwarded-For`, which Tailscale Serve sets to the tailnet address it took the request from. */
  forwardedFor?: string;
  /** `Tailscale-Funnel-Request`, which Tailscale Serve sets on a request from the internet through Funnel. */
  funnel?: string;
  /** The socket's peer, Tailscale Serve itself (loopback) for a request it proxies. */
  remoteAddress?: string;
  host?: string;
  /** The request's URL, path and query. */
  url?: string;
}

/** A Tailscale address: 100.64.0.0/10, or fd7a:115c:a1e0::/48 (either maybe IPv4-mapped, `::ffff:100.x.y.z`). */
export function isTailnetAddress(address: string): boolean {
  const a = address.trim().toLowerCase().replace(/^::ffff:/, '');
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (v4) return Number(v4[1]) === 100 && Number(v4[2]) >= 64 && Number(v4[2]) <= 127;
  return a.startsWith('fd7a:115c:a1e0:');
}

/**
 * True for a request from another device on the tailnet (or the internet, through Funnel): through Tailscale Serve
 * (its address in `X-Forwarded-For`, Funnel's header), straight to a tailnet address, or by the `.ts.net` name. Not
 * the `Host` alone: Serve picks the site by TLS name and passes the `Host` on as sent, so a device can send `localhost`.
 */
function fromTailnet(caller: Caller): boolean {
  if (caller.funnel !== undefined) return true;
  if (caller.remoteAddress && isTailnetAddress(caller.remoteAddress)) return true;
  if ((caller.forwardedFor ?? '').split(',').some(isTailnetAddress)) return true;
  return hostname(caller.host ?? '').endsWith('.ts.net');
}

/** The bot's routes, which check the bot's own token (server/bot.ts). Dot segments resolved, so `/api/bot/..` isn't one. */
function isBotRoute(url: string | undefined): boolean {
  let path: string;
  try {
    path = new URL(url ?? '/', 'http://focus').pathname;
  } catch {
    return false;
  }
  return path === '/api/bot' || path.startsWith('/api/bot/');
}

/** `FOCUS_ALLOWED_LOGINS`, comma-separated Tailscale logins, lower case; undefined (any login) when it's empty. */
export function allowedLogins(extra: string): Set<string> | undefined {
  const logins = extra.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return logins.length ? new Set(logins) : undefined;
}

/**
 * Why a request from the tailnet is refused, or undefined to let it through. A device a person owns comes with their
 * login (any, or one of `logins`); a tagged device (a sandboxed bot's box) or a request through Funnel comes with
 * none, so it may only reach the bot's routes, which want the bot's token. Nothing from this machine, or from a
 * `FOCUS_ALLOWED_HOSTS` name off the tailnet, is the tailnet's: those need only the host guard (`refusal`).
 */
export function tailnetRefusal(caller: Caller, logins: Set<string> | undefined): string | undefined {
  if (!fromTailnet(caller)) return undefined;
  const login = caller.login?.trim().toLowerCase();
  if (login) return !logins || logins.has(login) ? undefined : `Focus doesn't answer the Tailscale login ${login}`;
  if (isBotRoute(caller.url)) return undefined;
  return "Focus answers a tagged Tailscale device (or Funnel) only on /api/bot, with the bot's token";
}

/** True when Focus listens beyond this machine, where anyone who can reach the port can drive it. */
export const listensBeyondLoopback = (host: string) => !LOOPBACK.includes(hostname(host));
