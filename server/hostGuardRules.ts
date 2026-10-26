// Which hosts and pages Focus answers: it has no login, so it only answers the captain's own browser. Pure, so it's
// unit tested (hostGuardRules.test.ts); index.ts reads the machine's name and addresses and refuses the requests.

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

/** True when Focus listens beyond this machine, where anyone who can reach the port can drive it. */
export const listensBeyondLoopback = (host: string) => !LOOPBACK.includes(hostname(host));
