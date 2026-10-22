// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { phoneHails, type PhoneHost, type PhonePlugin, phoneSections } from './phonePlugins';

// The plugins' sections at the top of the phone's home screen (docs/plugins.md, on the phone).

const host = {} as PhoneHost;

describe('the plugins’ sections on the phone', () => {
  it('leaves out a plugin whose home throws, and keeps the rest’s, without their empty ones', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const section = document.createElement('section');
    const plugins: PhonePlugin[] = [
      { id: 'broken', home: () => { throw new Error('no state'); } },
      { id: 'fine', home: () => [section, null] },
      { id: 'bare' },
    ];
    expect(phoneSections(host, plugins)).toEqual([section]);
    expect(error).toHaveBeenCalledWith('The broken plugin\'s part of the phone failed', expect.any(Error));
    error.mockRestore();
  });

  it('says whether one shows what waits on the captain itself, so the core’s Needs you steps aside', () => {
    expect(phoneHails([{ id: 'bare' }])).toBe(false);
    expect(phoneHails([{ id: 'bare' }, { id: 'inbox', hails: true }])).toBe(true);
  });
});
