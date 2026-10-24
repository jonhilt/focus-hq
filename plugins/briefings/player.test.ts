import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { explainerPage } from './explainer';

// a stage that switches scene at a beat's start, as most do (set on window: happy-dom keeps each script's functions to itself)
const SWITCHES = 'window.render = function (t) { window.drawn = t; $("#scene").textContent = t >= B[1] ? "two" : "one"; }';
// one that fades each beat's scene out over its last 0.4 s, as many do, so a beat's very last frame shows nothing
const FADES = `window.render = function (t) {
  window.drawn = t;
  var next = t >= B[1] ? DUR : B[1];
  $("#scene").textContent = t >= B[1] ? "two" : "one";
  $("#scene").style.opacity = (1 - p(t, next - .4, next)).toFixed(3);
}`;

// The player itself, run in a page: frames are stepped by hand, and the screen round it (the voice) stands in for itself
function player(script = SWITCHES) {
  const built = explainerPage({
    id: 'x',
    title: 'X',
    beats: [
      { title: 'One', text: 'First.', seconds: 2 },
      { title: 'Two', text: 'Second.', seconds: 2 },
    ],
    stage: { html: '<div id="scene"></div>', script },
  });
  if ('error' in built) throw new Error(built.error);
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  const frames: ((now: number) => void)[] = [];
  let now = 0;
  const told: { kit: string; beat?: number }[] = [];
  const screen = { postMessage: (m: { kit: string }) => told.push(m) };
  Object.assign(window, { requestAnimationFrame: (f: (now: number) => void) => frames.push(f), cancelAnimationFrame: () => undefined });
  Object.defineProperty(window, 'parent', { value: screen });
  Object.defineProperty(window, 'performance', { value: { now: () => now } });
  window.document.write(built.html);
  const page = window as unknown as { drawn: number; document: Document };
  const tell = (data: unknown) => window.dispatchEvent(new window.MessageEvent('message', { data, source: screen as never }));
  /** Plays on for `seconds`, a frame every tenth of one. */
  const play = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) {
      now += 100;
      frames.splice(0).forEach((f) => f(now));
    }
  };
  const on = () => {
    const scene = page.document.getElementById('scene');
    return { caption: page.document.getElementById('kit-bt')?.textContent, scene: scene?.textContent, opacity: Number(scene?.style.opacity || 1), drawn: page.drawn };
  };
  return { told, tell, play, on, click: (id: string) => (page.document.getElementById(id) as HTMLElement).click() };
}

describe('the explainer player, with the voice on', () => {
  it('holds a beat on its own last frame until its line is said, then plays the next', () => {
    const p = player();
    p.tell({ kit: 'voice', on: true });
    p.click('kit-run');
    p.play(5);
    expect(p.told).toContainEqual({ kit: 'say', beat: 0 });
    expect(p.on()).toMatchObject({ caption: 'One', scene: 'one' });
    expect(p.on().drawn).toBeLessThan(2);
    p.tell({ kit: 'said', beat: 0 });
    p.play(1);
    expect(p.told).toContainEqual({ kit: 'say', beat: 1 });
    expect(p.on()).toMatchObject({ caption: 'Two', scene: 'two' });
  });

  it('holds a beat whose scene fades out before it ends on its last frame that still shows the scene', () => {
    const p = player(FADES);
    p.tell({ kit: 'voice', on: true });
    p.click('kit-run');
    // into the beat's last 0.4 s, its line still being said: the scene doesn't fade, only to come back while it's held
    p.play(1.8);
    expect(p.on().opacity).toBeGreaterThanOrEqual(0.9);
    p.play(3);
    expect(p.on()).toMatchObject({ caption: 'One', scene: 'one' });
    expect(p.on().opacity).toBeGreaterThanOrEqual(0.9);
    p.tell({ kit: 'said', beat: 0 });
    p.play(1);
    expect(p.on()).toMatchObject({ caption: 'Two', scene: 'two', opacity: 1 });
  });

  it('ends a step on the beat it stepped through, not the first frame of the next', () => {
    const p = player();
    p.click('kit-next');
    p.play(3);
    expect(p.on()).toMatchObject({ caption: 'One', scene: 'one' });
  });

  it('ends a step through a beat whose scene fades out on a frame that still shows the scene', () => {
    const p = player(FADES);
    p.click('kit-next');
    p.play(3);
    expect(p.on()).toMatchObject({ caption: 'One', scene: 'one' });
    expect(p.on().opacity).toBeGreaterThanOrEqual(0.9);
  });
});
