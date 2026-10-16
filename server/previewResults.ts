import type { Preview, PreviewLink } from '../shared/types';

/** The most links a preview shows. */
export const MAX_LINKS = 8;
/** Named links like these go after the ones a person opens first (web before api). */
const BACKSTAGE = /api|backend|server|db|database|postgres|swagger|docs|health|metrics/i;

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}(?:\/[^\s'"<>`]*)?/gi;

/** Something a browser can open: 0.0.0.0 and [::] become localhost. */
function browsable(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (['0.0.0.0', '[::]', '[::1]'].includes(url.hostname)) url.hostname = 'localhost';
    return url.href;
  } catch {
    return null;
  }
}

/** Local http(s) URLs in a line of output. */
export function localUrls(line: string): string[] {
  return (line.match(LOCAL_URL) ?? []).map((m) => browsable(m.replace(/[.,;:!?)\]]+$/, ''))).filter((u): u is string => !!u);
}

/** Links from a JSON result: {"urls": {"web": "http://…"}}, {"urls": ["http://…"]} or {"url": "http://…"}. */
export function jsonLinks(result: Record<string, unknown>): PreviewLink[] {
  const raw = result.urls ?? result.url;
  const entries: [string | undefined, unknown][] =
    typeof raw === 'string' ? [[undefined, raw]]
      : Array.isArray(raw) ? raw.map((u): [undefined, unknown] => [undefined, u])
        : raw && typeof raw === 'object' ? Object.entries(raw)
          : [];
  const links = entries.flatMap(([name, value]): PreviewLink[] => {
    const url = typeof value === 'string' ? browsable(value) : null;
    return url ? [name ? { name, url } : { url }] : [];
  });
  // stable: people open the web front ends, so APIs, databases and docs go last
  const rank = (l: PreviewLink) => (l.name && BACKSTAGE.test(l.name) ? 1 : 0);
  return links.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_LINKS);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether any string in the JSON value is one of the paths (ignoring a trailing separator). */
export function mentions(value: unknown, dirs: string[]): boolean {
  if (typeof value === 'string') return dirs.includes(value.replace(/[\\/]+$/, ''));
  if (Array.isArray(value)) return value.some((v) => mentions(v, dirs));
  return isObject(value) && Object.values(value).some((v) => mentions(v, dirs));
}

/** The last JSON object a command printed: all of stdout, a pretty-printed object at the end, or the last JSON line. */
export function lastJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.endsWith('}')) return null;
  const candidates = [t];
  const lines = t.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0 && candidates.length < 40; i--) {
    if (lines[i].startsWith('{')) candidates.push(lines.slice(i).join('\n'));
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isObject(value)) return value;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Our stack's place in the progress command's list of stacks: it showed up there, and how many polls since it went missing. */
export interface Listing {
  listed: boolean;
  unlisted: number;
}

/**
 * Finds our stack in the progress command's JSON (its exit code means nothing: a CLI may exit 1 for "still
 * starting"). That's either our stack, or a list of stacks ({"sessions": [...]}) where ours is the one mentioning our
 * checkouts. A list is the more reliable view: when a stack that was listed drops out twice in a row, whatever ran it
 * has died ("gone").
 */
export function ourStack(stdout: string, paths: string[], seen: Listing): { stack: Record<string, unknown> | 'gone' | undefined; seen: Listing } {
  const result = lastJson(stdout);
  if (!result) return { stack: undefined, seen };
  const single = typeof result.status === 'string' || typeof result.phase === 'string';
  const list = single ? undefined : Object.values(result).find((v): v is Record<string, unknown>[] => Array.isArray(v) && v.every(isObject));
  if (!list) return { stack: result, seen };
  const ours = list.find((stack) => mentions(stack, paths));
  if (ours) return { stack: ours, seen: { listed: true, unlisted: 0 } };
  if (!seen.listed) return { stack: undefined, seen };
  const unlisted = seen.unlisted + 1;
  return { stack: unlisted >= 2 ? 'gone' : undefined, seen: { listed: true, unlisted } };
}

/** What a preview has already taken from its commands' JSON. */
export interface ResultSeen {
  status: Preview['status'];
  /** The phase last shown while starting. */
  phase?: string;
  links: PreviewLink[];
  logs?: string;
}

/**
 * What a command's JSON result (e.g. {"urls": {"web": "http://…"}}) changes about a preview: a new phase to show while
 * it starts, its named links and its logs folder. `progressOnly` takes just the phase (the progress command's view while
 * starting). Only what changed is there.
 */
export function resultChanges(result: Record<string, unknown>, seen: ResultSeen, progressOnly: boolean): { phase?: string; links?: PreviewLink[]; logs?: string } {
  const ready = result.status === 'ready' || result.status === 'running';
  const phase = typeof result.phase === 'string' && result.phase !== seen.phase && !ready && seen.status === 'starting' ? result.phase : undefined;
  const changes = phase === undefined ? {} : { phase };
  if (progressOnly) return changes;
  const links = jsonLinks(result);
  const logs = typeof result.logs === 'string' && result.logs !== seen.logs ? result.logs : undefined;
  return {
    ...changes,
    ...(links.length && JSON.stringify(links) !== JSON.stringify(seen.links) && { links }),
    ...(logs !== undefined && { logs }),
  };
}
