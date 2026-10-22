import { describe, expect, it } from 'vitest';
import { downloadBody, expectedBytes, shortfall } from './modelDownload';

describe('downloading the model', () => {
  it('streams a response that came back with a body, and fails with the status of one that didn\'t', () => {
    expect(downloadBody(new Response('model'))).toBeInstanceOf(ReadableStream);
    expect(() => downloadBody(new Response('gone', { status: 404, statusText: 'Not Found' }))).toThrow('404 Not Found');
    expect(() => downloadBody(new Response(null, { status: 200, statusText: 'OK' }))).toThrow('200 OK');
  });

  it('expects the bytes Content-Length says, and none when it says nothing usable', () => {
    expect(expectedBytes('1024')).toBe(1024);
    expect(expectedBytes(null)).toBeUndefined();
    expect(expectedBytes('0')).toBeUndefined();
    expect(expectedBytes('lots')).toBeUndefined();
  });

  it('fails a download that stopped short of what it said, and passes one that said nothing', () => {
    expect(shortfall(512, 1024)).toBe('got 512 of 1024 bytes');
    expect(shortfall(1024, 1024)).toBeUndefined();
    expect(shortfall(512, undefined)).toBeUndefined();
  });
});
