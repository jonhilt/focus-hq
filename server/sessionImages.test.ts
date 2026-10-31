import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TermEntry } from '../shared/types';
import { imageFile, savingImages, SESSION_IMAGES_URL, sessionImageName } from './sessionImages';

const png = Buffer.from('a png, near enough');
const jpeg = Buffer.from('a jpeg, near enough');
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`;
const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);

describe('imageFile', () => {
  it('names an image by its content’s hash and its type’s extension, and gives back its bytes', () => {
    expect(imageFile(dataUrl('image/png', png))).toEqual({ file: `${hashOf(png)}.png`, bytes: png });
    expect(imageFile(dataUrl('image/jpeg', jpeg))?.file).toBe(`${hashOf(jpeg)}.jpg`);
    expect(imageFile(dataUrl('image/JPG', jpeg))?.file).toBe(`${hashOf(jpeg)}.jpg`);
    expect(imageFile(dataUrl('image/webp', png))?.file).toBe(`${hashOf(png)}.webp`);
    expect(imageFile(dataUrl('image/gif', png))?.file).toBe(`${hashOf(png)}.gif`);
  });

  it('names the same image the same, whatever step it came back in', () => {
    expect(imageFile(dataUrl('image/png', png))?.file).toBe(imageFile(dataUrl('image/png', Buffer.from(png)))?.file);
    expect(imageFile(dataUrl('image/png', png))?.file).not.toBe(imageFile(dataUrl('image/png', jpeg))?.file);
  });

  it('takes nothing that isn’t an image as a data URL', () => {
    expect(imageFile(dataUrl('image/svg+xml', png))).toBeUndefined();
    expect(imageFile(dataUrl('text/html', png))).toBeUndefined();
    expect(imageFile(`data:image/png,${png.toString('base64')}`)).toBeUndefined();
    expect(imageFile('https://example.com/a.png')).toBeUndefined();
    expect(imageFile(`${SESSION_IMAGES_URL}${hashOf(png)}.png`)).toBeUndefined();
  });
});

describe('savingImages', () => {
  it('saves each image a result gave back once, and points the step at Focus’s URL for it', () => {
    const saved: [string, Buffer][] = [];
    const entries: TermEntry[] = [
      { kind: 'call', id: 't1', tool: 'Read', input: { file_path: '/w/a.png' }, cwd: '/w' },
      { kind: 'result', id: 't1', ok: true, text: 'two shots', images: [{ src: dataUrl('image/png', png) }, { src: dataUrl('image/jpeg', jpeg) }] },
    ];
    const out = savingImages(entries, (file, bytes) => void saved.push([file, bytes]));
    expect(saved).toEqual([[`${hashOf(png)}.png`, png], [`${hashOf(jpeg)}.jpg`, jpeg]]);
    expect(out).toEqual([
      entries[0],
      { kind: 'result', id: 't1', ok: true, text: 'two shots', images: [{ src: `${SESSION_IMAGES_URL}${hashOf(png)}.png` }, { src: `${SESSION_IMAGES_URL}${hashOf(jpeg)}.jpg` }] },
    ]);
    // what it was given is left as it was
    expect(entries[1]).toMatchObject({ images: [{ src: dataUrl('image/png', png) }, { src: dataUrl('image/jpeg', jpeg) }] });
  });

  it('leaves lines of text, results without images, and images already saved as they are', () => {
    const saved: string[] = [];
    const entries: TermEntry[] = [
      { kind: 'system', text: '✻ Started' },
      { kind: 'reply', text: 'Looked at it' },
      { kind: 'result', id: 't1', ok: true, text: 'no images' },
      { kind: 'result', id: 't2', ok: true, text: '', images: [] },
      { kind: 'result', id: 't3', ok: true, text: '', images: [{ src: `${SESSION_IMAGES_URL}${hashOf(png)}.png` }, { src: 'https://example.com/a.png' }] },
    ];
    const out = savingImages(entries, (file) => void saved.push(file));
    expect(saved).toEqual([]);
    expect(out).toEqual(entries);
    expect(out[0]).toBe(entries[0]);
    expect(out[2]).toBe(entries[2]);
  });
});

describe('sessionImageName', () => {
  it('takes only a name imageFile gave', () => {
    const file = imageFile(dataUrl('image/png', png))?.file ?? '';
    expect(sessionImageName(file)).toBe('png');
    expect(sessionImageName(`${hashOf(jpeg)}.jpg`)).toBe('jpg');
  });

  it('turns away anything else: other paths, other types, the wrong length, upper case', () => {
    expect(sessionImageName(`../${hashOf(png)}.png`)).toBeUndefined();
    expect(sessionImageName(`${hashOf(png)}.png/..`)).toBeUndefined();
    expect(sessionImageName(`${hashOf(png)}.svg`)).toBeUndefined();
    expect(sessionImageName(`${hashOf(png).slice(1)}.png`)).toBeUndefined();
    expect(sessionImageName(`${hashOf(png).toUpperCase()}.png`)).toBeUndefined();
    expect(sessionImageName('')).toBeUndefined();
  });
});
