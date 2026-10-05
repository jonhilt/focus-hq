import { describe, expect, it } from 'vitest';
import { appUrl, screenshotFrame } from './render';

const png = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } };

describe('appUrl', () => {
  it('takes a browser tool’s url', () => {
    expect(appUrl({ name: 'mcp__playwright__browser_navigate', input: { url: 'http://localhost:5173/cart' } })).toBe('http://localhost:5173/cart');
  });

  it('finds the last local address in a command or script', () => {
    const command = 'npm run dev & sleep 3 && node shot.mjs http://localhost:5173/ http://127.0.0.1:5173/cart';
    expect(appUrl({ name: 'Bash', input: { command } })).toBe('http://127.0.0.1:5173/cart');
    expect(appUrl({ name: 'Write', input: { file_path: '/tmp/shot.mjs', content: "await page.goto('http://localhost:3000/login');" } }))
      .toBe('http://localhost:3000/login');
  });

  it('ignores pages read for research and commands without a local address', () => {
    expect(appUrl({ name: 'WebFetch', input: { url: 'https://vitejs.dev/config' } })).toBeUndefined();
    expect(appUrl({ name: 'Bash', input: { command: 'curl https://registry.npmjs.org/vite' } })).toBeUndefined();
  });
});

describe('screenshotFrame', () => {
  it('turns an image the agent read into a frame, labelled with the page it last opened', () => {
    const frame = screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'Read', input: { file_path: '/tmp/shots/cart.png' } }, 'http://localhost:5173/cart', 42);
    expect(frame).toEqual({ url: 'http://localhost:5173/cart', title: 'cart.png', image: 'data:image/png;base64,iVBORw0KGgo', at: 42 });
  });

  it('falls back to the file it read', () => {
    const frame = screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'Read', input: { file_path: '/tmp/cart.png' } }, undefined, 1);
    expect(frame?.url).toBe('/tmp/cart.png');
  });

  it('reads MCP-shaped images and keeps the last one', () => {
    const content = [
      { type: 'text', text: 'Took 2 screenshots' },
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ];
    const frame = screenshotFrame({ type: 'tool_result', content }, { name: 'mcp__playwright__browser_take_screenshot', input: {} }, undefined, 1);
    expect(frame?.image).toBe('data:image/jpeg;base64,BBBB');
    expect(frame?.url).toBe('mcp__playwright__browser_take_screenshot');
  });

  it('leaves our own browser tool and plain results alone', () => {
    expect(screenshotFrame({ type: 'tool_result', content: [png] }, { name: 'mcp__browser__open', input: { url: 'http://localhost:5173' } }, undefined, 1)).toBeNull();
    expect(screenshotFrame({ type: 'tool_result', content: 'ok' }, { name: 'Bash', input: {} }, undefined, 1)).toBeNull();
    expect(screenshotFrame({ type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }, undefined, undefined, 1)).toBeNull();
  });
});
