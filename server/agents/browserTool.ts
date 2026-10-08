import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright';
import { z } from 'zod';
import { ARTIFACT_SIZE } from '../../shared/artifacts';
import type { BrowserFrame } from '../../shared/types';
import { errorMessage, truncate } from '../util';
import type { RunHooks } from './types';

type CallResult = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };

interface Tab {
  context: BrowserContext;
  page: Page;
  console: string[];
}

/**
 * One headless Chromium shared by every agent, with a separate context (cookies, storage) per agent.
 * Uses Playwright's own Chromium if installed (`npx playwright install chromium`), else your Chrome or Edge.
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private tabs = new Map<string, Promise<Tab>>();

  private async launch(): Promise<Browser> {
    const { chromium } = await import('playwright');
    const attempts: LaunchOptions[] = [];
    if (process.env.FOCUS_BROWSER_PATH) attempts.push({ executablePath: process.env.FOCUS_BROWSER_PATH });
    attempts.push({}, { channel: 'chrome' }, { channel: 'msedge' });
    let lastError: unknown;
    for (const opts of attempts) {
      try {
        return await chromium.launch({ headless: true, ...opts });
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `No browser available for agents (${truncate(errorMessage(lastError), 200)}). Run "npx playwright install chromium" or set FOCUS_BROWSER_PATH.`,
    );
  }

  /** The shared Chromium, launched the first time anyone needs it (and again after a launch that failed). */
  private async shared(): Promise<Browser> {
    this.browser ??= this.launch();
    try {
      return await this.browser;
    } catch (err) {
      this.browser = null;
      throw err;
    }
  }

  tab(agentId: string): Promise<Tab> {
    let tab = this.tabs.get(agentId);
    if (!tab) {
      tab = (async () => {
        const browser = await this.shared();
        const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
        const page = await context.newPage();
        const t: Tab = { context, page, console: [] };
        page.on('console', (msg) => {
          if (['error', 'warning', 'log'].includes(msg.type())) t.console.push(`[${msg.type()}] ${msg.text()}`);
          if (t.console.length > 200) t.console.splice(0, 100);
        });
        page.on('pageerror', (err) => t.console.push(`[pageerror] ${err.message}`));
        return t;
      })();
      tab.catch(() => this.tabs.delete(agentId));
      this.tabs.set(agentId, tab);
    }
    return tab;
  }

  /**
   * A picture of a self-contained HTML page, as a JPEG `width` × `height`: in a context of its own, so the page sees no
   * agent's cookies. Waits for what it loads from the network (a diagram library from a CDN, say), within reason. Says
   * what its scripts threw or logged as errors meanwhile, so whoever made the page hears it's broken.
   */
  async render(html: string, width = ARTIFACT_SIZE.w, height = ARTIFACT_SIZE.h): Promise<{ image: Buffer; errors: string[] }> {
    const browser = await this.shared();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => undefined);
      // scripts that draw after loading (mermaid, charts) get a moment to finish
      await page.waitForTimeout(400);
      return { image: await page.screenshot({ type: 'jpeg', quality: 85 }), errors };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(agentId: string): Promise<void> {
    const tab = this.tabs.get(agentId);
    this.tabs.delete(agentId);
    if (tab) await tab.then((t) => t.context.close()).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.tabs.keys()].map((id) => this.close(id)));
    if (this.browser) await this.browser.then((b) => b.close()).catch(() => undefined);
  }
}

/**
 * In-process MCP server exposing a real browser. Every action streams a screenshot to the agent's laptop; the ones the
 * agent asks for are kept as evidence too.
 */
export function browserMcpServer(pool: BrowserPool, agentId: string, hooks: Pick<RunHooks, 'browser' | 'screenshot'>) {
  const snapshot = async (tab: Tab, note: string, keep?: (frame: BrowserFrame) => void): Promise<CallResult> => {
    const { page } = tab;
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 });
    const title = await page.title().catch(() => '');
    const base64 = jpeg.toString('base64');
    const frame: BrowserFrame = { url: page.url(), title, image: `data:image/jpeg;base64,${base64}`, at: Date.now() };
    hooks.browser(frame);
    keep?.(frame);
    const text = await page
      .evaluate(() => document.body?.innerText ?? '')
      .catch(() => '');
    return {
      content: [
        { type: 'text', text: `${note}\nURL: ${page.url()}\nTitle: ${title}\n\nVisible text:\n${truncate(text.trim(), 2500)}` },
        { type: 'image', data: base64, mimeType: 'image/jpeg' },
      ],
    };
  };

  const act = async (fn: (tab: Tab) => Promise<string>, keep?: (frame: BrowserFrame) => void): Promise<CallResult> => {
    try {
      const tab = await pool.tab(agentId);
      const note = await fn(tab);
      await tab.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
      return await snapshot(tab, note, keep);
    } catch (err) {
      return { content: [{ type: 'text', text: `Browser error: ${errorMessage(err)}` }], isError: true };
    }
  };

  return createSdkMcpServer({
    name: 'browser',
    version: '1.0.0',
    alwaysLoad: true,
    instructions:
      'A real headless Chromium for testing web UIs. Each call returns the visible text and a screenshot. ' +
      'Start dev servers in the background first, then open http://localhost:<port>.',
    tools: [
      tool('open', 'Open a URL (e.g. http://localhost:5173) and return a screenshot.', { url: z.string() }, ({ url }) =>
        act(async ({ page }) => {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(500);
          return `Opened ${url}`;
        }),
      ),
      tool(
        'click',
        'Click an element, by CSS selector or by its visible text.',
        { selector: z.string().optional(), text: z.string().optional() },
        ({ selector, text }) =>
          act(async ({ page }) => {
            if (selector) await page.click(selector, { timeout: 10_000 });
            else if (text) await page.getByText(text, { exact: false }).first().click({ timeout: 10_000 });
            else throw new Error('Pass a selector or text');
            await page.waitForTimeout(400);
            return `Clicked ${selector ?? `"${text}"`}`;
          }),
      ),
      tool(
        'type',
        'Fill an input (CSS selector) with text, optionally pressing Enter afterwards.',
        { selector: z.string(), text: z.string(), submit: z.boolean().optional() },
        ({ selector, text, submit }) =>
          act(async ({ page }) => {
            await page.fill(selector, text, { timeout: 10_000 });
            if (submit) await page.press(selector, 'Enter');
            await page.waitForTimeout(400);
            return `Typed into ${selector}`;
          }),
      ),
      tool('press', 'Press a keyboard key (e.g. Enter, Escape, ArrowDown).', { key: z.string() }, ({ key }) =>
        act(async ({ page }) => {
          await page.keyboard.press(key);
          await page.waitForTimeout(300);
          return `Pressed ${key}`;
        }),
      ),
      tool('screenshot', 'Screenshot the current page.', {}, () => act(async () => 'Screenshot', hooks.screenshot)),
      tool(
        'evaluate',
        'Run a JavaScript expression in the page and return its JSON result.',
        { expression: z.string() },
        async ({ expression }) => {
          try {
            const { page } = await pool.tab(agentId);
            const result = await page.evaluate((src) => {
              // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the agent's expression in the page is the tool's purpose
              const value = new Function(`return (${src});`)();
              return Promise.resolve(value).then((v) => JSON.stringify(v, null, 2));
            }, expression);
            return { content: [{ type: 'text', text: truncate(String(result), 8000) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: `Evaluation failed: ${errorMessage(err)}` }], isError: true };
          }
        },
      ),
      tool('console', 'Read console messages and page errors collected since the last call.', {}, async () => {
        const tab = await pool.tab(agentId);
        const messages = tab.console.splice(0);
        return { content: [{ type: 'text', text: messages.length ? messages.join('\n') : '(no console output)' }] };
      }),
    ],
  });
}
