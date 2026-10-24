import { isNode, LineCounter, parseDocument } from 'yaml';

// Reading a config file's YAML (a benchmark's, a scorer's frontmatter) for checks that say where they fail: what it
// holds, and `fail`, which names the file and the line of the field at fault the way an editor would.

/** Throws an error naming the file and the line of the field at `at` (a path of keys and indexes; none for the file). */
export type Fail = (message: string, at?: (string | number)[]) => never;

/**
 * `source` read as YAML: its fields, and `fail` for its checks. `firstLine` is the line `source` starts on in its file
 * (a frontmatter's 2, after its `---`). YAML that isn't YAML fails at once.
 */
export function yamlFields(source: string, file: string, error: (message: string) => Error, firstLine = 1): { fields: unknown; fail: Fail } {
  const lines = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lines });
  const fail: Fail = (message, at = []) => {
    const node = at.length ? doc.getIn(at, true) : doc.contents;
    const start = isNode(node) ? node.range?.[0] : undefined;
    const line = start === undefined ? undefined : lines.linePos(start).line + firstLine - 1;
    throw error(`${file}${line ? `:${line}` : ''}: ${message}`);
  };
  const [wrong] = doc.errors;
  if (wrong) fail(`isn't YAML: ${wrong.message.split('\n')[0]}`);
  return { fields: doc.toJS(), fail };
}
