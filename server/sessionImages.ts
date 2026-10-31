import { createHash } from 'node:crypto';
import type { TermEntry } from '../shared/types';

// The images a session's tool results give back (a screenshot it read, a page it captured) are kept whole, as files
// named by their content, rather than as data URLs in its transcript: the transcript is sent to every browser
// watching, and an image is most of a step's size. The step keeps Focus's URL for it.

/** Where Focus serves a saved session image. */
export const SESSION_IMAGES_URL = '/api/session-images/';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** A data URL's image as a file: its name (its content's hash and its type's extension) and its bytes. Undefined for anything else. */
export function imageFile(src: string): { file: string; bytes: Buffer } | undefined {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(src);
  const ext = m && EXT[m[1].toLowerCase()];
  if (!m || !ext) return undefined;
  const bytes = Buffer.from(m[2], 'base64');
  return { file: `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`, bytes };
}

/** Entries with each result's images saved (`save`) and pointing at Focus's URL for them; what isn't a data URL stays as it is. */
export function savingImages(entries: TermEntry[], save: (file: string, bytes: Buffer) => void): TermEntry[] {
  return entries.map((e) => {
    if (e.kind !== 'result' || !e.images?.length) return e;
    const images = e.images.map((image) => {
      const found = imageFile(image.src);
      if (!found) return image;
      save(found.file, found.bytes);
      return { src: `${SESSION_IMAGES_URL}${found.file}` };
    });
    return { ...e, images };
  });
}

/** Whether Focus serves a session image by this name: one `imageFile` named. */
export const sessionImageName = (file: string): string | undefined => /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/.exec(file)?.[1];
