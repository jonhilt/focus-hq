// Claude Code's own question tool, AskUserQuestion, as Focus reads it: a lead's question goes on their station's screen
// like one asked with mcp__office__ask, and the user's answers go back as the tool's result, into the same turn.

/** One question AskUserQuestion puts to the user: 2–4 options, each with what it means and, maybe, an HTML preview. */
export interface AskedQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string; preview?: string }[];
}

/** The user's answers, by each question's text, as Claude Code reads them back (several picks of one comma-separated). */
export type Answers = Record<string, string>;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const field = (v: unknown, key: string): unknown => (typeof v === 'object' && v !== null ? Reflect.get(v, key) : undefined);

function option(v: unknown): AskedQuestion['options'][number] | undefined {
  const label = field(v, 'label');
  const description = field(v, 'description');
  const preview = field(v, 'preview');
  if (!isText(label)) return undefined;
  return { label, description: typeof description === 'string' ? description : '', ...(isText(preview) && { preview }) };
}

function question(v: unknown): AskedQuestion | undefined {
  const text = field(v, 'question');
  const header = field(v, 'header');
  const listed = field(v, 'options');
  const options = Array.isArray(listed) ? listed.map(option) : [];
  if (!isText(text) || options.length < 2 || options.some((o) => !o)) return undefined;
  return { question: text, header: typeof header === 'string' ? header : '', multiSelect: field(v, 'multiSelect') === true, options: options.filter((o) => !!o) };
}

/** The questions in AskUserQuestion's input, or undefined when it isn't that shape (Claude Code checks it first; this is the boundary). */
export function askedQuestions(input: Record<string, unknown>): AskedQuestion[] | undefined {
  const questions = Array.isArray(input.questions) ? input.questions.map(question) : [];
  return questions.length && questions.every((q) => !!q) ? questions.filter((q) => !!q) : undefined;
}

/** The page an option without a preview shows on the station's screen: what it is, and what it means. */
export function optionPage(o: AskedQuestion['options'][number]): string {
  const escape = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  return `<!doctype html><meta charset="utf-8"><style>body{font:28px/1.4 system-ui,sans-serif;margin:64px;color:#111}h1{font-size:56px;margin:0 0 24px}</style><h1>${escape(o.label)}</h1><p>${escape(o.description)}</p>`;
}
