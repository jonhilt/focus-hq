import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { Settings } from '../../shared/types';
import { checkModel } from '../../shared/systemModel';
import type { ReadOnlyRun } from './claudeCrew';
import { demoModel, modelPrompt, sessionModel } from './modelSession';
import { sourceReader } from './sourceReader';

/** The session's settings: a fake session never reads them. */
const DEFAULT_SETTINGS = {} as Settings;
const model = { question: 'How?', nodes: [{ id: 'a', label: 'A', kind: 'service', layer: 'L' }], edges: [], trace: [], simplified: [] };

describe('a model drawn afresh', () => {
  it('asks a read-only session over the folders, with the model tool’s own schema, and takes its answer', async () => {
    let asked: ReadOnlyRun | undefined;
    const got = await sessionModel({ question: 'How?', dirs: ['/w/shop', '/w/api'] }, DEFAULT_SETTINGS, (run) => {
      asked = run;
      return Promise.resolve({ text: '', structured: model });
    });
    expect(got).toEqual(model);
    expect(asked).toMatchObject({ cwd: '/w/shop', readable: ['/w/api'], builtins: ['Read', 'Glob', 'Grep'], prompt: modelPrompt({ question: 'How?', dirs: ['/w/shop', '/w/api'] }) });
    expect(asked?.schema).toMatchObject({ type: 'object' });
  });

  it('says so when the session answers with something else, or there is no code to read', async () => {
    await expect(sessionModel({ question: 'How?', dirs: ['/w'] }, DEFAULT_SETTINGS, () => Promise.resolve({ text: 'no', structured: { nodes: 'x' } }))).rejects.toThrow('didn’t answer with a model');
    await expect(sessionModel({ question: 'How?', dirs: [] }, DEFAULT_SETTINGS, () => Promise.reject(new Error('unasked')))).rejects.toThrow('no code to read');
  });

  it('draws the demo’s one model under the question asked, every cite holding in the office’s own code', () => {
    const demo = demoModel({ question: 'How is it kept?', dirs: [config.root] });
    expect(demo.question).toBe('How is it kept?');
    const { model: checked, problems } = checkModel(demo, sourceReader([config.root]));
    expect(problems).toEqual([]);
    expect(checked.edges.every((e) => e.backed)).toBe(true);
  });
});
