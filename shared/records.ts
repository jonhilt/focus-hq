// Records keyed by a union of strings, read and built without a cast at each place (lint forbids casting what
// Object.keys/entries/fromEntries return): what each claims is here, with a test beside it.

/**
 * A record's keys, as its key type. Only for a record written out with exactly its keys (a table of labels, say):
 * `Object.keys` returns whatever an object has, so it's a string[] in TypeScript.
 */
export function keysOf<K extends string>(record: Readonly<Record<K, unknown>>): K[] {
  return Object.keys(record).filter((k): k is K => k in record);
}

/** A record with a value for each of `keys`, in their order. Total when `keys` lists every key of `K`. */
export function recordOf<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
  const record: Partial<Record<K, V>> = {};
  for (const k of keys) record[k] = value(k);
  if (!hasEvery(record, keys)) throw new Error('A key went missing from a record just built from it');
  return record;
}

/** Whether `record` has a value for each of `keys`: for all of `K`, when `keys` lists every key of `K`. */
export function hasEvery<K extends string, V>(record: Partial<Record<K, V>>, keys: readonly K[]): record is Record<K, V> {
  return keys.every((k) => k in record);
}
