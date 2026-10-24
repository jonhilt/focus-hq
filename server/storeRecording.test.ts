import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { QaRecording, QaReport } from '../shared/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-store-proof-'));
process.env.FOCUS_DATA_DIR = dir;
const { Store } = await import('./store');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('a passed review whose precheck finds nothing to test', () => {
  it('still shows a recording that can be served', async () => {
    const store = new Store(false);
    const key = 'acme/shop#7';
    const recording: QaRecording = { mp4Url: 'https://x/r.mp4', gifUrl: 'https://x/r.gif', realSeconds: 10, shownSeconds: 5, actions: 2, mp4File: 'acme-shop-7-1-recording.mp4', gifFile: 'acme-shop-7-1-recording.gif' };
    store.saveShot(recording.mp4File!, Buffer.from('mp4'));
    store.saveShot(recording.gifFile!, Buffer.from('gif'));
    const report: QaReport = { verdict: 'pass', summary: 's', checks: [], commands: [], captions: [] };
    store.reviewJournal(key, { kind: 'requested', projectId: 'p1', repo: 'acme/shop', number: 7, title: 'PR' });
    store.reviewJournal(key, { kind: 'seated', agent: 'qa_p' });
    store.reviewJournal(key, { kind: 'testing', sha: 'abc' });
    store.reviewJournal(key, { kind: 'reported', verdict: 'pass', officer: 'H', body: 'b', failedRounds: 0, report, screenshots: [], recording, sha: 'abc' });
    store.reviewJournal(key, { kind: 'posted' });
    store.reviewJournal(key, { kind: 'announced' });
    expect(store.reviews.get(key)?.recording).toEqual(recording);
    store.reviewJournal(key, { kind: 'requested', projectId: 'p1', repo: 'acme/shop', number: 7, title: 'PR' });
    store.reviewJournal(key, { kind: 'prechecking' });
    store.reviewJournal(key, { kind: 'precheck-skipped' });
    const shown = store.reviews.get(key);
    expect(shown?.status).toBe('passed');
    expect(shown?.recording?.gifFile).toBe(recording.gifFile);
    expect(await store.readShot(shown!.recording!.gifFile!)).toBeDefined();
    expect(await store.readShot(shown!.recording!.mp4File!)).toBeDefined();
  });
});
