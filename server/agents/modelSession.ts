// A system model drawn afresh, not by a lead: a read-only session reads the code in some folders and answers a question
// about how it works with a model in the model tool's own shape (modelSchema.ts), which the office then checks and draws
// as it does a lead's (goalTools.ts `drawn`). For the plugins (`PluginHost.drawModel`): cartography draws a kept
// diagram again once the code it cites has moved on. The demo's stand-in answers without a session.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Settings, SystemModel } from '../../shared/types';
import { CODE_TOOLS, type ReadOnlyResult, type ReadOnlyRun } from './claudeCrew';
import { MODEL_SCHEMA } from './modelSchema';

/** What a plugin asks for: the question, the folders the code's in (each a repo's checkout), and a line on what it's doing. */
export interface ModelAsk {
  question: string;
  dirs: string[];
  activity?: (text: string) => void;
}

const SCHEMA = z.toJSONSchema(MODEL_SCHEMA) as Record<string, unknown>;

export function modelSystemPrompt(): string {
  return [
    "You're the office's cartographer. Read the code in the folders you're given and answer the question with a system model of how it works, as it stands now:",
    "its parts (8 to 12 on the scenario's path, at one level of detail), how they connect, and one concrete scenario as steps along the connections, in order.",
    'Cite every part where it is defined, and every connection at the line where one part reaches the other: the absolute path of the file, as you read it, and the line.',
    "The office checks each cite against the code and flags what doesn't hold, so read the lines you cite. It's a model of how the code works: mark nothing added, changed or removed.",
  ].join(' ');
}

export const modelPrompt = (ask: ModelAsk): string => `The question: ${ask.question}\n\nThe code, one folder a repo: ${ask.dirs.join(', ')}`;

/** The model a read-only session answers `ask` with, or why it couldn't. */
export async function sessionModel(ask: ModelAsk, settings: Settings, session: (run: ReadOnlyRun) => Promise<ReadOnlyResult>): Promise<SystemModel> {
  const [cwd, ...others] = ask.dirs;
  if (!cwd) throw new Error('There’s no code to read');
  const result = await session({
    cwd,
    readable: others,
    systemAppend: modelSystemPrompt(),
    prompt: modelPrompt(ask),
    settings,
    signal: AbortSignal.timeout(20 * 60_000),
    activity: ask.activity ?? (() => undefined),
    builtins: CODE_TOOLS,
    schema: SCHEMA,
    maxTurns: 80,
    timeoutMs: 20 * 60_000,
  });
  const parsed = MODEL_SCHEMA.safeParse(result.structured);
  if (!parsed.success) throw new Error('The session didn’t answer with a model');
  return parsed.data;
}

/**
 * The demo's stand-in: a model of how the office keeps a lead's diagram, cited in the office's own code (the demo's
 * repos are made up, and its checkouts are the office's), under the question asked.
 */
export function demoModel(ask: ModelAsk): SystemModel {
  const root = ask.dirs.find((d) => fs.existsSync(path.join(d, 'server/agents/manager/goalTools.ts'))) ?? ask.dirs[0] ?? '';
  const at = (file: string, find: string) => {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    return { file: path.join(root, file), line: Math.max(1, lines.findIndex((l) => l.includes(find)) + 1) };
  };
  return {
    question: ask.question,
    nodes: [
      { id: 'tool', label: "Lead's model tool", kind: 'handler', layer: 'Office', symbol: 'showModel', cite: at('server/agents/manager/goalTools.ts', 'showModel(agent') },
      { id: 'plugins', label: 'Plugin registry', kind: 'service', layer: 'Office', symbol: 'modelShown', cite: at('server/plugins/registry.ts', 'modelShown(agent') },
      { id: 'keeper', label: 'Diagram keeper', kind: 'store', layer: 'Cartography', symbol: 'keep', cite: at('plugins/cartography/keeper.ts', '  keep(agent') },
    ],
    edges: [
      { from: 'tool', to: 'plugins', kind: 'calls', label: 'tells the plugins', cite: at('server/agents/manager/goalTools.ts', 'plugins.modelShown') },
      { from: 'plugins', to: 'keeper', kind: 'calls', label: 'cartography keeps it', cite: at('plugins/cartography/server.ts', 'diagrams.keep(') },
    ],
    trace: [
      { from: 'tool', to: 'plugins', label: 'the drawn model', payload: 'ModelShown { model, html, image }' },
      { from: 'plugins', to: 'keeper', label: 'a copy of it' },
    ],
    simplified: ['the demo draws this one model whatever is asked'],
  };
}
