// What a download of whisper's model makes of the response and the bytes that came: pure, so it's unit tested
// (modelDownload.test.ts); Voice.fetchModel does the streaming.

/** A model download's body to stream, or the HTTP status it failed with. */
export function downloadBody(res: Response): ReadableStream<Uint8Array> {
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
  return res.body;
}

/** The bytes a download says it will send (its Content-Length), or undefined when it doesn't say. */
export function expectedBytes(contentLength: string | null): number | undefined {
  return Number(contentLength) || undefined;
}

/** What's missing from a download that stopped short of the bytes it said it would send, or undefined when it's whole. */
export function shortfall(bytes: number, total: number | undefined): string | undefined {
  return total !== undefined && bytes !== total ? `got ${bytes} of ${total} bytes` : undefined;
}
