// A repo's architecture model from its parsed YAML (MODEL_FILE), or an error saying what's wrong with it. Pure.
import { MODEL_KINDS, type ModelKind } from '../../shared/types';
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
  if (!MODEL_KINDS.includes(kind as ModelKind)) throw new Error(`Part ${id}'s kind is one of ${MODEL_KINDS.join(', ')}`);
  const paths = texts(r.paths, `Part ${id}'s paths`).map(normalPath);
  if (!paths.length) throw new Error(`Part ${id} needs the paths of its code`);
  return { id, label: text(r.label, `Part ${id}'s label`), layer: text(r.layer, `Part ${id}'s layer`), kind: kind as ModelKind, paths };
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
