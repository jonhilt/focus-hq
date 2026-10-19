import { describe, expect, it } from 'vitest';
import { reachableUrl } from './previewReach';

const http = [{ port: 5173, scheme: 'http' as const }];
const https = [{ port: 5173, scheme: 'https' as const, host: 'vps.tail1234.ts.net' }];

describe('reachableUrl', () => {
  it('leaves the link alone in a browser on the office’s own machine', () => {
    expect(reachableUrl('http://localhost:5173/app', http, { hostname: 'localhost' })).toBe('http://localhost:5173/app');
    expect(reachableUrl('http://localhost:5173/app', http, { hostname: '127.0.0.1' })).toBe('http://localhost:5173/app');
  });

  it('opens the mirror at the name the browser reached the office by', () => {
    expect(reachableUrl('http://localhost:5173/app?x=1', http, { hostname: 'vps' })).toBe('http://vps:5173/app?x=1');
    expect(reachableUrl('http://127.0.0.1:5173/', http, { hostname: '100.64.1.2' })).toBe('http://100.64.1.2:5173/');
  });

  it('opens an https mirror at its certificate’s name', () => {
    expect(reachableUrl('http://localhost:5173/', https, { hostname: 'vps' })).toBe('https://vps.tail1234.ts.net:5173/');
  });

  it('leaves links with no mirror, or that aren’t local, as they are', () => {
    expect(reachableUrl('http://localhost:3000/', http, { hostname: 'vps' })).toBe('http://localhost:3000/');
    expect(reachableUrl('http://localhost:5173/', undefined, { hostname: 'vps' })).toBe('http://localhost:5173/');
    expect(reachableUrl('https://example.com:5173/', http, { hostname: 'vps' })).toBe('https://example.com:5173/');
    expect(reachableUrl('not a url', http, { hostname: 'vps' })).toBe('not a url');
  });
});
