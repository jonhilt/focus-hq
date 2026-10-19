// A repo's architecture model from its parsed YAML (MODEL_FILE), or an error saying what's wrong with it. Pure.
import { type Flow, type FlowRecording, isOneOf, MODEL_KINDS } from '../../plugin-api/shared';
import type { ArchitectureModel, MapPart, MapView } from './shared';

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
  if (!isOneOf(MODEL_KINDS, kind)) throw new Error(`Part ${id}'s kind is one of ${MODEL_KINDS.join(', ')}`);
  const paths = texts(r.paths, `Part ${id}'s paths`).map(normalPath);
  if (!paths.length) throw new Error(`Part ${id} needs the paths of its code`);
  const does = r.does === undefined ? undefined : text(r.does, `Part ${id}'s does`);
  return { id, label: text(r.label, `Part ${id}'s label`), layer: text(r.layer, `Part ${id}'s layer`), kind, paths, ...(does ? { does } : {}) };
}

function view(id: string, raw: unknown, parts: ReadonlySet<string>): MapView {
  if (!ID.test(id)) throw new Error(`View "${id}" needs an id in lowercase letters, digits and dashes`);
  const r = record(raw, `View ${id}`);
  const named = texts(r.parts, `View ${id}'s parts`);
  if (!named.length) throw new Error(`View ${id} needs the parts it shows`);
  const unknown = named.filter((p) => !parts.has(p));
  if (unknown.length) throw new Error(`View ${id} shows parts the model doesn't have: ${unknown.join(', ')}`);
  return { id, question: text(r.question, `View ${id}'s question`), parts: named };
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
  return { run: typeof r.run === 'string' ? r.run : 'a recorded run', ...(typeof r.commit === 'string' ? { commit: r.commit } : {}), flows };
}
