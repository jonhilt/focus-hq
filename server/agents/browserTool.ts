import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright';
import { z } from 'zod';
import { ARTIFACT_SIZE } from '../../shared/artifacts';
import type { BrowserFrame } from '../../shared/types';
import { errorMessage, truncate } from '../util';
import { STAGE_AT, STAGE_SIZE, type StageMoment } from './explainer';
import type { RunHooks } from './types';

/** How long an evaluate may run before the tool gives up on it. */
export const EVALUATE_TIMEOUT_MS = 30_000;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;

/** Whether `body` parses as the body of an async function (only parsed here, never called: the page runs it). */
function parses(body: string): boolean {
  try {
    new AsyncFunction(body);
    return true;
  } catch {
    return false;
  }
}

const returning = (expression: string) => `return (${expression.replace(/[\s;]+$/, '')}\n);`;

/** Where a line break can end a statement before `tail`: not when `tail` would carry the line on (`(`, `[`, `.`, an operator…). */
const startsStatement = (tail: string) => /^\s*[\p{L}\p{Nl}_$0-9'"!~]/u.test(tail);

/**
 * The body of an async function that runs the agent's code: a single expression (`await` allowed) is returned as it
 * is (a trailing `;` or two dropped); statements run as the body, returning the value of the last one when it's an
 * expression (`a(); 'ok'` gives `'ok'`), and an explicit `return` still works. Code that doesn't parse is left as it
 * is, for the page to report.
 */
export function evaluateBody(src: string): string {
  const expression = returning(src.trim());
  if (parses(expression)) return expression;
  if (!parses(src)) return src;
  // Take the earliest split where the rest is one expression, so the last statement comes whole even if a split
  // inside it got past the checks below.
  for (let at = 0; at < src.length; at++) {
    const ch = src[at];
    if (ch !== ';' && ch !== '\n') continue;
    const head = src.slice(0, at + 1);
    const tail = src.slice(at + 1);
    if (!tail.replace(/[\s;]+/g, '')) break;
    if (ch === '\n' && !startsStatement(tail)) continue;
    // a head ending inside a line comment would swallow the ` (` and still parse
    if (!parses(head) || parses(`${head} (`)) continue;
    const body = `${head}\n${returning(tail)}`;
    if (parses(body)) return body;
  }
  return src;
}

/** `work`, or a clear error once `ms` have gone by without it settling. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The test hooks the office's own page exposes, for agents working on it (see `client/src/main.ts`). */
const FOCUS_HQ_HOOKS =
  ' On the Focus office page, `window.focusHQ` is `{ state, world, player, ui }`: ' +
  '`ui.places(): { label, position, lookAt, projectId? }[]`, `ui.goTo(place)` teleports there, `ui.goToAgent(id)`, ' +
  '`ui.openAgent(id)`, `ui.openBoard(projectId)`, `ui.openQa(projectId)`, `ui.openGoals(projectId)`, `ui.openChart(leadId)`, `ui.openComms()`, ' +
  '`ui.panels.isOpen` (a getter, not a function) and `ui.panels.close()`; ' +
  '`state` mirrors the server: `projects[]`, `agents`/`boards`/`previews`/`reviews` (Maps by id), `project(id)`, `agentsIn(projectId)`; ' +
  '`world.root` is the THREE.Group to `traverse()` (world itself has no traverse), `world.rooms` (Map), `world.room(projectId)`, `world.places()`; ' +
  '`player.teleport(feet, lookAt)` (THREE.Vector3s), `player.locked`.';

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
        // WebGL (a 3D explainer's stage) falls back to drawing in software where there's no GPU, as Chrome no longer does by itself
        return await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...opts });
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
   * what its scripts threw or logged as errors meanwhile, so whoever made the page hears it's broken. For an explainer,
   * `moments` asks for its stage at those times too, in the same visit (a 3D stage loads three.js once).
   */
  async render(html: string, moments: readonly number[] = []): Promise<{ image: Buffer; errors: string[]; moments?: (StageMoment & { image: Buffer })[] }> {
    const browser = await this.shared();
    const context = await browser.newContext({ viewport: { width: ARTIFACT_SIZE.w, height: ARTIFACT_SIZE.h }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => undefined);
      // an explainer says when it has drawn its resting frame (a 3D stage only starts once three.js has loaded)
      await page.waitForFunction(() => (window as { kitReady?: boolean }).kitReady !== false, undefined, { timeout: 5000 }).catch(() => undefined);
      // scripts that draw after loading (mermaid, charts) get a moment to finish
      await page.waitForTimeout(400);
      const image = await page.screenshot({ type: 'jpeg', quality: 85 });
      if (!moments.length) return { image, errors };
      const stage: (StageMoment & { image: Buffer })[] = [];
      for (const at of moments) {
        await page.evaluate((t) => (window as { kitSeek?: (t: number) => void }).kitSeek?.(t), at);
        const shot = await page.screenshot({ type: 'jpeg', quality: 70, clip: { ...STAGE_AT, width: STAGE_SIZE.w, height: STAGE_SIZE.h } });
        stage.push({ at, image: shot, ...(await page.evaluate(seeStage, shot.toString('base64'))) });
      }
      return { image, errors, moments: stage };
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
 * Runs in the page: what's on its stage, from a picture of it (as base64 JPEG). How much of it is its commonest colour
 * (counted in coarse steps, so a JPEG's noise doesn't split one colour into many), and the kit3d labels showing.
 */
async function seeStage(jpeg: string): Promise<Omit<StageMoment, 'at'>> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${jpeg}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('The page has no 2D canvas to read its stage with');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  const counts = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < px.length; i += 8) {
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    n++;
  }
  const flat = Math.max(...counts.values()) / n;
  const stage = document.getElementById('stage')?.getBoundingClientRect() ?? new DOMRect();
  const kit = (window as { __scene?: { labels: { text: string; onScreen: boolean }[] } }).__scene;
  const labels = [...document.querySelectorAll<HTMLElement>('#stage .kit3d-label')]
    .filter((el) => el.style.display !== 'none' && Number(el.style.opacity || 1) > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const text = el.textContent ?? '';
      return { text, x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height, onScreen: kit?.labels.find((l) => l.text === text)?.onScreen ?? true };
    });
  return { flat, labels };
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
        'Run JavaScript in the page and return its JSON result. A single expression is returned as is (`await` allowed); ' +
          "statements run as the body of an async function, returning the last one's value when it's an expression " +
          "(`a(); 'ok'` gives 'ok'), or what you `return`. Gives up after 30 s." +
          FOCUS_HQ_HOOKS,
        { expression: z.string() },
        async ({ expression }) => {
          try {
            const { page } = await pool.tab(agentId);
            const result = await withTimeout(
              page.evaluate((body) => {
                const Async = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;
                return new Async(body)().then((v) => JSON.stringify(v, null, 2));
              }, evaluateBody(expression)),
              EVALUATE_TIMEOUT_MS,
              'Evaluation',
            );
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
