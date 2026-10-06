import { describe, expect, it } from 'vitest';
import { downloadProgress } from './speech';

describe('downloadProgress', () => {
  it('adds up every file being fetched', () => {
    const files = new Map([['config.json', { loaded: 10, total: 10 }], ['onnx/model_quantized.onnx', { loaded: 40, total: 90 }]]);
    expect(downloadProgress(files)).toEqual({ bytes: 50, total: 100 });
  });

  it('leaves the total out when no file knows its size', () => {
    expect(downloadProgress(new Map([['tokenizer.json', { loaded: 5, total: 0 }]]))).toEqual({ bytes: 5, total: undefined });
  });
});
