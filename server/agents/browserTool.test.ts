import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVALUATE_TIMEOUT_MS, evaluateBody, evaluateHint, focusHQShape, machineLoad, withTimeout } from './browserTool';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;
const run = (src: string) => new AsyncFunction(evaluateBody(src))();

describe('evaluateBody', () => {
  it('returns a single expression', async () => {
    expect(evaluateBody('1 + 2')).toBe('return (1 + 2\n);');
    expect(await run('({ a: 1 })')).toEqual({ a: 1 });
  });

  it('allows await in an expression', async () => {
    expect(await run('await Promise.resolve(4)')).toBe(4);
  });

  it('keeps a trailing line comment from swallowing the paren', async () => {
    expect(await run('5 // five')).toBe(5);
  });

  it('runs statements as an async body', async () => {
    expect(evaluateBody('const x = 2; return x * 3;')).toBe('const x = 2; return x * 3;');
    expect(await run('const x = 2; return x * 3;')).toBe(6);
    expect(await run('const x = await Promise.resolve(1);\nreturn x + 1;')).toBe(2);
  });

  it('returns an expression with a trailing semicolon', async () => {
    expect(await run(' 1 + 1; ')).toBe(2);
  });

  it('returns the last expression statement after other statements', async () => {
    const calls: string[] = [];
    (globalThis as { probe?: (s: string) => void }).probe = (s) => calls.push(s);
    expect(await run("probe('a'); 'ok'")).toBe('ok');
    expect(calls).toEqual(['a']);
    expect(await run('const x = await Promise.resolve(2);\nconst y = 3;\nx * y;')).toBe(6);
    expect(await run('let n = 0\nfor (const i of [1, 2, 3]) n += i\nn')).toBe(6);
    expect(await run('const xs = [1, 2];\nxs.map((x) => {\n  return x * 2;\n})')).toEqual([2, 4]);
  });

  it('keeps a line that carries on the one before it as one expression', async () => {
    expect(await run('const f = (x) => x + 1;\nf\n(2)')).toBe(3);
    expect(await run('const a = [1, 2];\na\n.length')).toBe(2);
  });

  it('returns nothing when the code ends in a declaration or an operand of it', async () => {
    expect(await run('const v = 1\n+ 2')).toBeUndefined();
    expect(await run('const v = 1; // last; v')).toBeUndefined();
    expect(await run('if (true) { 1 }')).toBeUndefined();
  });

  it('leaves an explicit return alone', async () => {
    expect(await run('const x = 2;\nif (x > 1) return "big";\nreturn "small";')).toBe('big');
  });

  it('leaves code that does not parse for the page to report', () => {
    expect(evaluateBody('const = ;')).toBe('const = ;');
  });
});

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('fails a hung evaluate after 30 s', async () => {
    vi.useFakeTimers();
    const hung = withTimeout(new Promise(() => undefined), EVALUATE_TIMEOUT_MS, 'Evaluation');
    const caught = hung.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(EVALUATE_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await caught).toBe('Evaluation timed out after 30 s');
  });

  it('passes a result through in time', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1000, 'x')).toBe('ok');
  });
});

describe('evaluateHint', () => {
  const shape = 'world: root, rooms, room()';

  it('says to run it again once the page has loaded when a navigation cut it off', () => {
    const hint = evaluateHint('page.evaluate: Execution context was destroyed, most likely because of a navigation.', shape);
    expect(hint).toMatch(/navigated or reloaded/);
    expect(hint).not.toContain(shape);
  });

  it('says what the page offers when the code reached for something that is not there', () => {
    for (const message of [
      "page.evaluate: TypeError: Cannot read properties of undefined (reading 'traverse')",
      "page.evaluate: TypeError: Cannot set properties of undefined (setting 'length')",
      "page.evaluate: TypeError: Cannot read properties of null (reading 'click')",
      'page.evaluate: TypeError: u.panels.isOpen is not a function',
    ]) {
      const hint = evaluateHint(message, shape);
      expect(hint, message).toContain(shape);
    }
  });

  it('says to check each step of the path on a page without Focus’s hooks', () => {
    const hint = evaluateHint("page.evaluate: TypeError: Cannot read properties of undefined (reading 'id')", null);
    expect(hint).toMatch(/one step at a time/);
  });

  it('says that only what the page puts on window is in scope', () => {
    expect(evaluateHint('page.evaluate: ReferenceError: THREE is not defined', shape)).toMatch(/`THREE` isn't a global/);
  });

  it("says to reach the running app through its hooks rather than importing its source", () => {
    const hint = evaluateHint('page.evaluate: TypeError: Failed to fetch dynamically imported module: http://127.0.0.1:4597/shared/crew.ts', shape);
    expect(hint).toMatch(/window\.focusHQ/);
    expect(hint).not.toContain(shape);
  });

  it('adds nothing to a failure it has no advice for', () => {
    expect(evaluateHint('Evaluation timed out after 30 s', shape)).toBeUndefined();
    expect(evaluateHint("page.evaluate: Error: boom", shape)).toBeUndefined();
  });
});

describe('focusHQShape', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists what each of the hooks has: fields, methods (own and inherited) and getters', () => {
    class World {
      root = {};
      rooms = new Map();
      room() {}
    }
    const player = { teleport() {}, _velocity: 0, get locked() { return false; } };
    vi.stubGlobal('window', { focusHQ: { world: new World(), player, mode: 'demo' } });
    expect(focusHQShape()).toBe('window.focusHQ.world: root, rooms, room()\nwindow.focusHQ.player: teleport(), locked (getter)');
  });

  it('is null on a page without the hooks', () => {
    vi.stubGlobal('window', {});
    expect(focusHQShape()).toBeNull();
  });
});

describe('machineLoad', () => {
  it('says the machine was busy when more work was waiting than it has CPUs', () => {
    expect(machineLoad({ oneMinute: 23.4, cpus: 10 })).toBe('Machine load when it failed: 23.4 (1-minute average) on 10 CPUs: busy, more work waiting than CPUs.');
  });

  it('says it was not busy at or under one per CPU', () => {
    expect(machineLoad({ oneMinute: 10, cpus: 10 })).toBe('Machine load when it failed: 10.0 (1-minute average) on 10 CPUs: not busy.');
    expect(machineLoad({ oneMinute: 0.21, cpus: 8 })).toBe('Machine load when it failed: 0.2 (1-minute average) on 8 CPUs: not busy.');
  });

  it('says nothing where the system has no load average', () => {
    expect(machineLoad(null)).toBeUndefined();
  });
});
