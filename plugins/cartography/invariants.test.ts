import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import type { PluginHost, PluginState } from '../../plugin-api/server';
import { type Action, checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../../plugin-api/testing';
import type { KeptDiagram } from './diagrams';
import { DiagramKeeper } from './keeper';
import type { CartographyState } from './shared';

// The diagrams Ops keeps, under its two rules (docs/invariants.md): a restart is atomic, and two things done to
// them at once end as one after the other would. Described here (what can be done, what must survive), not told what
// to expect.

const cite = { file: path.join(process.cwd(), 'plugins/cartography/keeper.ts'), line: 1 };
const model = { question: 'Q?', nodes: [{ id: 'k', label: 'K', kind: 'store' as const, layer: 'L', cite }], edges: [], trace: [], simplified: [] };
const kept = (id: string): KeptDiagram => ({ id, title: `Diagram ${id}`, question: 'Q?', by: 'Lt. Lead', goal: 'G', at: 1, image: false, files: [] });

/** What must survive of a kept diagram: not when it was drawn, or which files it cites. */
const survives = (d: KeptDiagram) => ({ id: d.id, title: d.title, by: d.by, ...(d.redrawing && { redrawing: true }), ...(d.failed && { failed: d.failed }) });

const keeper: Subject<Record<string, unknown>[]> = {
  name: 'diagrams',
  start: (later) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cartography-'));
    fs.mkdirSync(path.join(data, 'diagrams'));
    fs.writeFileSync(path.join(data, 'diagrams', 'index.json'), JSON.stringify({ shop: [kept('a'), kept('b')] }));
    for (const id of ['a', 'b']) fs.writeFileSync(path.join(data, 'diagrams', `${id}.html`), '<p>first</p>');
    // a life of Focus: its plugin state isn't kept between lives (the keeper's own files are)
    const life = (draw: Later): Running<Record<string, unknown>[]> => {
      let saved: CartographyState = { maps: {}, mapping: [], slices: {}, crossRepo: {}, crossCalls: {}, diagrams: {} };
      const state = { get: () => saved, set: (patch) => (saved = { ...saved, ...patch }) } as PluginState<CartographyState>;
      const host = {
        dataDir: () => data,
        projects: () => [{ id: 'shop', name: 'Shop', repos: ['o/shop'] }],
        drawModel: ({ title }: { title: string }) => draw('drawn', () => Promise.resolve({ id: title, title, html: '<p>again</p>', problems: [], model })),
      } as unknown as PluginHost;
      const k = new DiagramKeeper(host, state, () => Promise.resolve(process.cwd()));
      state.set({ diagrams: k.load() });
      return {
        actions: () =>
          (saved.diagrams.shop ?? []).flatMap((d): Action[] => [
            { name: `draw ${d.id} again`, run: () => k.redraw('shop', d.id) },
            { name: `forget ${d.id}`, run: () => k.forget('shop', d.id) },
          ]),
        durable: () => (saved.diagrams.shop ?? []).map(survives),
        settle: () => Promise.resolve(),
        restart: (l) => life(l),
      };
    };
    return life(later);
  },
};

describe('the kept diagrams, under Focus’s two rules', () => {
  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(keeper, { runs: 30 });
  });

  it('end two things done at once as one after the other would', async () => {
    await checkAtOnce(keeper, { runs: 30 });
  });
});
