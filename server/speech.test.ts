import { describe, expect, it } from 'vitest';
import { downloadProgress, Speech, type ToSpeechWorker } from './speech';
import type { SpeechHelper, SpeechListener } from './speechHelpers';

describe('downloadProgress', () => {
  it('adds up every file being fetched', () => {
    const files = new Map([['config.json', { loaded: 10, total: 10 }], ['onnx/model_quantized.onnx', { loaded: 40, total: 90 }]]);
    expect(downloadProgress(files)).toEqual({ bytes: 50, total: 100 });
  });

  it('leaves the total out when no file knows its size', () => {
    expect(downloadProgress(new Map([['tokenizer.json', { loaded: 5, total: 0 }]]))).toEqual({ bytes: 5, total: undefined });
  });
});

/** A helper that does what the test tells it: `script` says what it answers to a load. */
function fakeHelper(on: 'gpu' | 'cpu', load: 'ready' | 'fail' | 'crash') {
  const sent: ToSpeechWorker[] = [];
  let listener: SpeechListener | undefined;
  let killed = false;
  const helper: SpeechHelper = {
    on,
    start(l) {
      listener = l;
      return {
        send(message) {
          sent.push(message);
          if (message.type !== 'load') return;
          queueMicrotask(() => (load === 'ready' ? l.message({ type: 'ready' }) : load === 'fail' ? l.message({ type: 'failed', error: 'no' }) : l.gone('crashed')));
        },
        kill: () => (killed = true),
      };
    },
  };
  const speak = (id: number) => listener?.message({ type: 'spoken', id, wav: new Uint8Array([id]) });
  return { helper, sent, speak, killed: () => killed, spoken: () => sent.filter((m) => m.type === 'speak').map((m) => (m.type === 'speak' ? m.text : '')) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Speech', () => {
  it('runs on the GPU when it loads there', async () => {
    const gpu = fakeHelper('gpu', 'ready');
    const speech = new Speech(() => undefined, () => [gpu.helper, fakeHelper('cpu', 'ready').helper]);
    speech.load();
    await settle();
    expect(speech.status().engine).toEqual({ state: 'ready', on: 'gpu' });
  });

  it('hands over to the CPU when the GPU can’t load, or its process dies first', async () => {
    for (const load of ['fail', 'crash'] as const) {
      const gpu = fakeHelper('gpu', load);
      const speech = new Speech(() => undefined, () => [gpu.helper, fakeHelper('cpu', 'ready').helper]);
      speech.load();
      await settle();
      await settle();
      expect(speech.status().engine).toEqual({ state: 'ready', on: 'cpu' });
      expect(gpu.killed()).toBe(true);
    }
  });

  it('loads again on the helpers as they are now, once it’s loaded, and not before', async () => {
    const [gpu, cpu] = [fakeHelper('gpu', 'ready'), fakeHelper('cpu', 'ready')];
    let helpers = [gpu.helper, cpu.helper];
    const speech = new Speech(() => undefined, () => helpers);
    speech.reload();
    expect(speech.status().engine.state).toBe('idle');
    speech.load();
    await settle();
    expect(speech.status().engine).toEqual({ state: 'ready', on: 'gpu' });
    helpers = [cpu.helper];
    speech.reload();
    await settle();
    expect(gpu.killed()).toBe(true);
    expect(speech.status().engine).toEqual({ state: 'ready', on: 'cpu' });
  });

  it('fails once the last helper can’t load', async () => {
    const speech = new Speech(() => undefined, () => [fakeHelper('cpu', 'fail').helper]);
    speech.load();
    await settle();
    expect(speech.status().engine.state).toBe('failed');
  });

  it('says one line at a time, a line wanted now before lines fetched ahead, and drops one nobody wants', async () => {
    const cpu = fakeHelper('cpu', 'ready');
    const speech = new Speech(() => undefined, () => [cpu.helper]);
    speech.load();
    await settle();
    const first = speech.speak('first', 'af_heart', 'ahead');
    const gone = new AbortController();
    const dropped = speech.speak('dropped', 'af_heart', 'ahead', gone.signal);
    void speech.speak('later', 'af_heart', 'ahead');
    const answer = speech.speak('answer', 'af_heart', 'now');
    gone.abort();
    await expect(dropped).rejects.toThrow('No longer wanted');
    expect(cpu.spoken()).toEqual(['first']);
    cpu.speak(0);
    expect((await first)[0]).toBe(0);
    expect(cpu.spoken()).toEqual(['first', 'answer']);
    cpu.speak(3);
    expect((await answer)[0]).toBe(3);
    expect(cpu.spoken()).toEqual(['first', 'answer', 'later']);
  });
});
