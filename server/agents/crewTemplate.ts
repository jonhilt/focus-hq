// The templates a crew file's prompt is written in (.focus/crew/README.md): logic-less, like Mustache's, so a prompt
// reads as the words the agent gets. `{{name}}` is a piece of text the code fills in; `{{#flag}}…{{/flag}}` keeps
// what's between when the flag is on, `{{^flag}}…{{/flag}}` when it's off. A section's tag alone on its line takes its
// line with it, so sections can sit between a prompt's lines without leaving blank ones.

/** What a role's prompt may refer to: each name a piece of text, or a flag a section turns on. */
export type TemplateVars = Readonly<Record<string, 'text' | 'flag'>>;

/** What the code fills a template in with: text for each text, true or false for each flag. */
export type TemplateValues<V extends TemplateVars> = { readonly [K in keyof V]: V[K] extends 'text' ? string : boolean };

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string; line: number }
  | { kind: 'section'; name: string; inverted: boolean; line: number; children: Node[] };

export type Template = readonly Node[];

/** A template that doesn't parse, or refers to what its role hasn't got: `line` is 1-based, in the file it came from. */
export class TemplateError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

const TAG = /\{\{\s*([#^/]?)\s*([A-Za-z][\w.]*)\s*\}\}/g;

/** Whether the tag at [start, end) of `src` has its line to itself, and where that line starts and ends (past its newline). */
function standalone(src: string, start: number, end: number): { from: number; to: number } | undefined {
  const from = src.lastIndexOf('\n', start - 1) + 1;
  const newline = src.indexOf('\n', end);
  const to = newline === -1 ? src.length : newline + 1;
  const blank = (s: string) => /^[ \t]*$/.test(s);
  return blank(src.slice(from, start)) && blank(src.slice(end, newline === -1 ? src.length : newline).replace(/\r$/, '')) ? { from, to } : undefined;
}

/** `src` parsed, its first line being line `firstLine` of its file; a `{{` that isn't a tag is an error, not text. */
export function parseTemplate(src: string, firstLine = 1): Template {
  const root: Node[] = [];
  const open: { name: string; line: number; children: Node[] }[] = [];
  const into = () => open.at(-1)?.children ?? root;
  const lineAt = (i: number) => firstLine + (src.slice(0, i).match(/\n/g)?.length ?? 0);
  const text = (from: number, to: number) => {
    const chunk = src.slice(from, to);
    const stray = chunk.indexOf('{{');
    if (stray !== -1) throw new TemplateError(lineAt(from + stray), `"${chunk.slice(stray, stray + 20).split('\n')[0]}" isn't a tag: write {{name}}, {{#flag}}, {{^flag}} or {{/flag}}`);
    if (chunk) into().push({ kind: 'text', text: chunk });
  };
  let cursor = 0;
  for (const m of src.matchAll(TAG)) {
    const [whole, sigil, name] = m;
    const start = m.index;
    const end = start + whole.length;
    const line = lineAt(start);
    const alone = sigil ? standalone(src, start, end) : undefined;
    text(cursor, alone?.from ?? start);
    cursor = alone?.to ?? end;
    if (!sigil) into().push({ kind: 'var', name, line });
    else if (sigil === '/') {
      const section = open.pop();
      if (!section) throw new TemplateError(line, `{{/${name}}} closes a section that was never opened`);
      if (section.name !== name) throw new TemplateError(line, `{{/${name}}} closes {{#${section.name}}} (line ${section.line}): close it with {{/${section.name}}}`);
    } else {
      const section = { kind: 'section' as const, name, inverted: sigil === '^', line, children: [] };
      into().push(section);
      open.push(section);
    }
  }
  text(cursor, src.length);
  const unclosed = open.at(-1);
  if (unclosed) throw new TemplateError(unclosed.line, `{{#${unclosed.name}}} is never closed: end it with {{/${unclosed.name}}}`);
  return root;
}

/** Every name `template` refers to that `vars` hasn't got, or has as the other kind, as an error naming its line. */
export function checkTemplate(template: Template, vars: TemplateVars): TemplateError | undefined {
  const known = Object.keys(vars).join(', ');
  for (const node of template) {
    if (node.kind === 'text') continue;
    const kind = vars[node.name];
    const tag = node.kind === 'var' ? `{{${node.name}}}` : `{{${node.inverted ? '^' : '#'}${node.name}}}`;
    if (!kind) return new TemplateError(node.line, `${tag} isn't something this role's prompt can refer to: it has ${known}`);
    if (node.kind === 'var' && kind === 'flag') return new TemplateError(node.line, `${node.name} is a flag: use it as a section, {{#${node.name}}}…{{/${node.name}}}`);
    if (node.kind === 'section' && kind === 'text') return new TemplateError(node.line, `${node.name} is text: write {{${node.name}}}`);
    if (node.kind === 'section') {
      const inner = checkTemplate(node.children, vars);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** `template` filled in from `values`: checked against its role when it loaded, so every name it refers to is there. */
export function renderTemplate(template: Template, values: Readonly<Record<string, string | boolean>>): string {
  return template
    .map((node) => {
      if (node.kind === 'text') return node.text;
      const value = values[node.name];
      if (node.kind === 'var') return String(value);
      return Boolean(value) !== node.inverted ? renderTemplate(node.children, values) : '';
    })
    .join('');
}
