// What the office lends a plugin of its own state is a copy (docs/plugins.md): a plugin can read and keep it, but
// whatever it does to it never reaches the office's agents, projects, settings or ledger.

/** A copy of `value` for a plugin to keep: plain data, as the office saves and sends it. */
export const lend = <T>(value: T): T => structuredClone(value);

/**
 * A plugin's copy of an append-only log (the ledger): the lines it hasn't seen yet are copied as it asks, and the
 * whole of it again only when the office starts the log afresh (a new array, or a shorter one).
 */
export function lentLog<T>(log: () => readonly T[]): () => T[] {
  let source: readonly T[] | undefined;
  let copy: T[] = [];
  return () => {
    const now = log();
    if (now !== source || now.length < copy.length) {
      source = now;
      copy = [];
    }
    for (let i = copy.length; i < now.length; i++) copy.push(lend(now[i]));
    return copy.slice();
  };
}
