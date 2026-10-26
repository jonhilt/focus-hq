// Small pure text helpers, shared by the server, the client and decision files (which can't import server/util.ts:
// it starts processes and rolls dice).

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function slugify(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}
