// A repo's architecture model from its parsed YAML (MODEL_FILE), or an error saying what's wrong with it. Pure.
import { type Flow, type FlowRecording, type Frame, MODEL_KINDS, type ModelKind, type Trace } from '../../plugin-api/shared';
import type { ArchitectureModel, MapPart, MapView, ViewStep, ViewTrace } from './shared';

const ID = /^[a-z][a-z0-9-]{0,31}$/;

const record = (raw: unknown, what: string): Record<string, unknown> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${what} is a mapping`);
  return raw as Record<string, unknown>;
};

const text = (raw: unknown, what: string): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${what} needs some text`);
  return raw.trim();
};

const texts = (raw: unknown, what: string): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string' || !p.trim())) throw new Error(`${what} is a list of paths`);
  return raw.map((p: string) => p.trim());
};

/** A path as the map compares them: from the repo's root, without a leading `./` or `/`. */
export const normalPath = (p: string): string => p.replace(/^\.?\//, '');

function part(id: string, raw: unknown): MapPart {
  if (!ID.test(id)) throw new Error(`Part "${id}" needs an id in lowercase letters, digits and dashes`);
  const r = record(raw, `Part ${id}`);
  const kind = r.kind ?? 'service';
  if (!MODEL_KINDS.includes(kind as ModelKind)) throw new Error(`Part ${id}'s kind is one of ${MODEL_KINDS.join(', ')}`);
  const paths = texts(r.paths, `Part ${id}'s paths`).map(normalPath);
  if (!paths.length) throw new Error(`Part ${id} needs the paths of its code`);
  const does = r.does === undefined ? undefined : text(r.does, `Part ${id}'s does`);
  return { id, label: text(r.label, `Part ${id}'s label`), layer: text(r.layer, `Part ${id}'s layer`), kind: kind as ModelKind, paths, ...(does ? { does } : {}) };
}

function step(raw: unknown, what: string): ViewStep {
  const r = record(raw, what);
  return { from: text(r.from, `${what}'s from`), to: text(r.to, `${what}'s to`), says: text(r.says, `${what}'s says`) };
}

function traced(raw: unknown, what: string, parts: ReadonlySet<string>): ViewTrace {
  const r = record(raw, what);
  const through = r.through === undefined ? undefined : text(r.through, `${what}'s through`);
  if (through && !parts.has(through)) throw new Error(`${what} goes through a part the model doesn't have: ${through}`);
  return { message: text(r.message, `${what}'s message`), ...(through ? { through } : {}) };
}

function view(id: string, raw: unknown, parts: ReadonlySet<string>): MapView {
  if (!ID.test(id)) throw new Error(`View "${id}" needs an id in lowercase letters, digits and dashes`);
  const r = record(raw, `View ${id}`);
  if (r.steps !== undefined && !Array.isArray(r.steps)) throw new Error(`View ${id}'s steps are a list`);
  const steps = ((r.steps ?? []) as unknown[]).map((s, i) => step(s, `View ${id}'s step ${i + 1}`));
  // a scenario's parts are the ones its steps go through, in order, unless it names them
  const named = r.parts === undefined && steps.length ? [...new Set(steps.flatMap((s) => [s.from, s.to]))] : texts(r.parts, `View ${id}'s parts`);
  if (!named.length) throw new Error(`View ${id} needs the parts it shows, or its steps`);
  const unknown = [...new Set([...named, ...steps.flatMap((s) => [s.from, s.to])])].filter((p) => !parts.has(p));
  if (unknown.length) throw new Error(`View ${id} shows parts the model doesn't have: ${unknown.join(', ')}`);
  const answer = r.answer === undefined ? undefined : text(r.answer, `View ${id}'s answer`);
  const trace = r.trace === undefined ? undefined : traced(r.trace, `View ${id}'s trace`, parts);
  return { id, question: text(r.question, `View ${id}'s question`), parts: named, ...(answer ? { answer } : {}), ...(steps.length ? { steps } : {}), ...(trace ? { trace } : {}) };
}

export function readModel(raw: unknown): ArchitectureModel {
  const r = record(raw, 'The model');
  const parts = Object.entries(record(r.parts, 'Its parts')).map(([id, p]) => part(id, p));
  if (!parts.length) throw new Error('The model needs some parts');
  const ids = new Set(parts.map((p) => p.id));
  const views = Object.entries(record(r.views, 'Its views')).map(([id, v]) => view(id, v, ids));
  return { parts, views, ignore: texts(r.ignore, 'Its ignore').map(normalPath) };
}

/** A recorded run's flows from its parsed JSON (FLOWS_FILE), or an error saying what's wrong with it. */
export function readRecording(raw: unknown): FlowRecording {
  const r = record(raw, 'The recording');
  if (!Array.isArray(r.flows)) throw new Error('The recording needs its flows');
  const flows = r.flows.map((f: unknown, i): Flow => {
    const x = record(f, `Flow ${i + 1}`);
    if (x.via !== 'http' && x.via !== 'ws') throw new Error(`Flow ${i + 1} goes by http or ws`);
    if (typeof x.count !== 'number' || x.count < 1) throw new Error(`Flow ${i + 1} needs a count`);
    return { via: x.via, name: text(x.name, `Flow ${i + 1}'s name`), from: text(x.from, `Flow ${i + 1}'s from`), to: text(x.to, `Flow ${i + 1}'s to`), count: x.count };
  });
  // older recordings have no traces; a trace that doesn't read is left out rather than losing the run's flows
  const traces = (Array.isArray(r.traces) ? r.traces : []).flatMap((t: unknown): Trace[] => {
    const x = record(t, 'A trace');
    const chain = Array.isArray(x.chain) ? x.chain.filter((f: unknown): f is Frame => typeof (f as Frame | null)?.file === 'string') : [];
    return (x.via === 'ws' || x.via === 'http') && typeof x.name === 'string' && typeof x.count === 'number' && chain.length ? [{ via: x.via, name: x.name, count: x.count, chain }] : [];
  });
  return { run: typeof r.run === 'string' ? r.run : 'a recorded run', ...(typeof r.commit === 'string' ? { commit: r.commit } : {}), flows, ...(traces.length ? { traces } : {}) };
}
