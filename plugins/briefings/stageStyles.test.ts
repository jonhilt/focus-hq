import { type Browser, chromium, type LaunchOptions, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ExplainerInput, explainerPage } from './explainer';

// The player round a lead's stage in a real Chromium, as Ops' browser and the user's screen show it: the stage's css
// reaches none of the player, the player's none of the stage, and the stage kit and the lead's own css still work there.
// Skipped, saying why, on a machine without a browser.

let browser: Browser | undefined;
let why = 'no browser on this machine';
beforeAll(async () => {
  // as Ops' browser for agents finds one: the user's if set, Playwright's own, then Chrome or Edge
  const path = process.env.FOCUS_BROWSER_PATH;
  const attempts: LaunchOptions[] = [...(path ? [{ executablePath: path }] : []), {}, { channel: 'chrome' }, { channel: 'msedge' }];
  for (const opts of attempts) {
    try {
      browser = await chromium.launch({ headless: true, ...opts });
      return;
    } catch (err) {
      why = `no browser on this machine (${String(err).split('\n')[0]})`;
    }
  }
}, 60_000);
// closing it closes every page the tests opened
afterAll(() => browser?.close());

/** The player round this stage, resting on its last frame, with a receipt chip showing; it fetches nothing, so no web font arrives partway through. */
async function player(on: Browser, stage: Partial<ExplainerInput['stage']>): Promise<{ page: Page; html: string }> {
  const built = explainerPage(
    { id: 'x', title: 'X', beats: [{ title: 'One', text: 'First.', seconds: 2 }, { title: 'Two', text: 'Second.', seconds: 2 }], stage: { html: '', script: 'function render(t) {}', ...stage } },
    [[], [{ label: 'server/ledger.ts:2', quote: 'never rewrites' }]],
  );
  if ('error' in built) throw new Error(built.error);
  const page = await on.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', (route) => route.abort());
  await page.setContent(built.html, { waitUntil: 'load' });
  return { page, html: built.html };
}

/** Each element's whole computed style, keyed by its id or else its tag and its place among those the selector finds. */
const stylesOf = (page: Page, selector: string) =>
  page.evaluate((sel) => Array.from(document.querySelectorAll(sel), (el, i) => {
    const style = getComputedStyle(el);
    return [el.id || `${el.tagName}:${i}`, Object.fromEntries(Array.from(style, (p) => [p, style.getPropertyValue(p)]))] as const;
  }), selector);

describe('an explainer in a browser', () => {
  it("keeps the stage's css off the player, whatever it names", async (ctx) => {
    if (!browser) return ctx.skip(why);
    // everything of the player's, the stage's box too, but nothing in it
    const ofPlayer = 'body, body *:not(#kit-stage *)';
    const plain = await player(browser, { html: '<div class="rc">card</div>' });
    const loud = await player(browser, {
      html: '<div class="rc">card</div>',
      css: [
        '* { letter-spacing: 9px !important; } html, body, :root { background: red; --gold: red; --ui: serif; }',
        'button, div, span, b, i, svg { outline: 4px solid red; font: 40px serif !important; display: block !important; }',
        '.hd, .bd, .rc, .btn, .bar, .on, .title, .seg { color: red; height: 99px; }',
        // the player's own names: a stage that borrows them styles only its own elements
        '.kit-rc, .kit-btn, .kit-beat, #kit-run, #kit-stage { display: none !important; }',
      ].join('\n'),
    });
    const before = await stylesOf(plain.page, ofPlayer);
    expect(before.length).toBeGreaterThan(30);
    expect(await stylesOf(loud.page, ofPlayer)).toEqual(before);
  });

  it("keeps the player's styles off the stage, whatever its elements are called", async (ctx) => {
    if (!browser) return ctx.skip(why);
    const { html } = await player(browser, {});
    // each of the player's class names without its kit-: what a lead might well call their own
    const names = [...new Set(Array.from(html.matchAll(/\.kit-([\w-]+)/g), (m) => m[1]))];
    expect(names).toEqual(expect.arrayContaining(['rc', 'bar', 'btn', 'hd', 'bd', 'on', 'seg', 'beat']));
    const inside = '<b>x</b><i>x</i><span>x</span><button>x</button>';
    const { page } = await player(browser, {
      html: `<div id="plain">x</div>${names.map((n) => `<div class="${n}" id="as-${n}">x</div>`).join('')}<div class="seg beat bar" id="named">${inside}</div><div id="unnamed">${inside}</div>`,
    });
    const plain = (await stylesOf(page, '#plain'))[0][1];
    for (const [name, style] of await stylesOf(page, '[id^="as-"]')) expect([name, style]).toEqual([name, plain]);
    const named = await stylesOf(page, '#named > *');
    expect(named.map(([, s]) => s)).toEqual((await stylesOf(page, '#unnamed > *')).map(([, s]) => s));
  });

  it("styles the stage with the stage kit, which the lead's css overrides, and keeps the lead's at-rules working", async (ctx) => {
    if (!browser) return ctx.skip(why);
    const { page } = await player(browser, {
      html: '<div class="panel" id="p" style="--c:var(--gold)"><div class="hd" id="hd"><span>Head</span></div><div class="bd" id="bd"></div></div>'
        + '<div class="pill" id="pill">P</div><div class="pill own" id="own">O</div><span class="lbl" id="lbl">L</span><span class="mono" id="mono">M</span>'
        + '<div id="spin">S</div><div id="wide">W</div><div id="font">F</div><div id="imported">I</div>',
      css: [
        '@import url("data:text/css,%23imported%7Bcolor:rgb(1,2,3)%7D");',
        '#stage { color: rgb(4, 5, 6) }',
        '.own { height: 50px }',
        '@keyframes fade { from { opacity: .25 } to { opacity: .25 } }',
        '#spin { animation: fade 10s paused }',
        '@media (min-width: 100px) { #wide { color: rgb(7, 8, 9) } }',
        '@font-face { font-family: Own; src: local("Arial") }',
        '#font { font-family: Own }',
      ].join('\n'),
      script: 'function render(t) { $("#bd").innerHTML = tag("ok", "green"); }',
    });
    const seen = await page.evaluate(() => {
      const style = (sel: string) => getComputedStyle(document.querySelector(sel) ?? document.body);
      const box = document.getElementById('stage')?.getBoundingClientRect();
      return {
        stage: box && [box.x, box.y, box.width, box.height], stageColour: style('#stage').color,
        panel: [style('#p').position, style('#p').borderTopWidth], head: [style('#hd').backgroundColor, style('#hd').fontSize],
        pill: style('#pill').height, own: style('#own').height, lbl: style('#lbl').color, mono: style('#mono').fontSize, tag: style('#bd .tag').height,
        spin: style('#spin').opacity, wide: style('#wide').color, font: [style('#font').fontFamily, [...document.fonts].some((f) => f.family === 'Own')], imported: style('#imported').color,
      };
    });
    expect(seen).toEqual({
      stage: [200, 58, 1050, 500], stageColour: 'rgb(4, 5, 6)',
      panel: ['absolute', '3px'], head: ['rgb(255, 153, 0)', '21px'],
      pill: '40px', own: '50px', lbl: 'rgb(255, 204, 153)', mono: '13px', tag: '26px',
      spin: '0.25', wide: 'rgb(7, 8, 9)', font: ['Own', true], imported: 'rgb(1, 2, 3)',
    });
  });
});
