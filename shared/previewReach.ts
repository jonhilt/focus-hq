import type { PreviewMirror } from './types';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Where this browser opens a preview's link. The links are local to Focus's machine: a browser elsewhere (on the
 * tailnet, say) opens Focus's mirror of the link's port instead, at the mirror's scheme and certificate name, or
 * else at the name it reached Focus by.
 */
export function reachableUrl(url: string, mirrors: readonly PreviewMirror[] | undefined, page: { hostname: string }): string {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return url;
  }
  if (!LOOPBACK.has(link.hostname) || LOOPBACK.has(page.hostname)) return url;
  const port = Number(link.port || (link.protocol === 'https:' ? 443 : 80));
  const mirror = mirrors?.find((m) => m.port === port);
  if (!mirror) return url;
  link.protocol = `${mirror.scheme}:`;
  link.hostname = mirror.host ?? page.hostname;
  return link.href;
}
