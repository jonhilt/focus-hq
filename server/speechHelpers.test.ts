import { describe, expect, it } from 'vitest';
import { fromHelperLine, speechHelpers } from './speechHelpers';

describe('speechHelpers', () => {
  it('tries the Apple GPU first on Apple Silicon with uv, then the CPU', () => {
    expect(speechHelpers({ platform: 'darwin', arch: 'arm64', uv: true })).toEqual(['gpu', 'cpu']);
  });

  it('keeps to the CPU without uv, off Apple Silicon, or when FOCUS_KOKORO_GPU is 0', () => {
    expect(speechHelpers({ platform: 'darwin', arch: 'arm64', uv: false })).toEqual(['cpu']);
    expect(speechHelpers({ platform: 'darwin', arch: 'x64', uv: true })).toEqual(['cpu']);
    expect(speechHelpers({ platform: 'linux', arch: 'arm64', uv: true })).toEqual(['cpu']);
    expect(speechHelpers({ platform: 'darwin', arch: 'arm64', uv: true, gpu: false })).toEqual(['cpu']);
  });
});

describe('fromHelperLine', () => {
  it('reads the GPU helper’s messages, its WAVs from base64', () => {
    expect(fromHelperLine('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(fromHelperLine('{"type":"spoken","id":3,"wav":"UklGRg=="}')).toEqual({ type: 'spoken', id: 3, wav: new Uint8Array(Buffer.from('RIFF')) });
    expect(fromHelperLine('{"type":"unspoken","id":4,"error":"no"}')).toEqual({ type: 'unspoken', id: 4, error: 'no' });
    expect(fromHelperLine('{"type":"failed","error":"no GPU"}')).toEqual({ type: 'failed', error: 'no GPU' });
  });

  it('ignores whatever else it prints', () => {
    expect(fromHelperLine('Creating new KokoroPipeline for language: b')).toBeUndefined();
    expect(fromHelperLine('{not json')).toBeUndefined();
    expect(fromHelperLine('{"type":"chatter"}')).toBeUndefined();
  });
});
