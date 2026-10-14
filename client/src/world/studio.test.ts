import { describe, expect, it } from 'vitest';
import { ENTRANCE_X } from './hallLayout';
import { cardTurn, keepsHallCollider, SCENE_HOLD, SHELF, shelfMove, shelfSpots, SCENE_STAGE, ScenePlayback, sheetMoments, SPIN_RATE, STUDIO_HALL, STUDIO_SPAN, studioWalls } from './studio';

describe('the studio hall', () => {
  it('walls in its round wall and its entrance wall out to it, leaving the doorway clear', () => {
    const walls = studioWalls();
    const r = walls.map((w) => Math.hypot(w.x, w.z));
    expect(Math.max(...r)).toBeLessThan(STUDIO_HALL.radius + 0.6);
    // nothing in the middle of the floor, and nothing in the doorway
    expect(walls.filter((w) => Math.hypot(w.x, w.z) < STUDIO_HALL.radius - 0.5 && w.x > ENTRANCE_X + 0.5)).toEqual([]);
    expect(walls.filter((w) => w.x < ENTRANCE_X + 1 && Math.abs(w.z) < 2.3)).toEqual([]);
    // the entrance wall reaches the round wall on both sides
    const wide = STUDIO_HALL.radius * Math.sin(STUDIO_SPAN);
    for (const side of [-1, 1]) expect(walls.some((w) => w.x < ENTRANCE_X && side * w.z > wide - 0.3)).toBe(true);
  });

  it('keeps only the hall\'s own colliders round its doorway', () => {
    expect(keepsHallCollider(ENTRANCE_X - 0.2, 1.5)).toBe(true);
    expect(keepsHallCollider(1.3, -1.5)).toBe(false); // the moving boxes
    expect(keepsHallCollider(10.9, 0)).toBe(false); // the hall's round wall
    expect(keepsHallCollider(ENTRANCE_X + 0.2, 4)).toBe(false);
  });
});

describe('sheetMoments', () => {
  it('shows a take without phases at even steps through it, and its last moment', () => {
    expect(sheetMoments(12).map((m) => m.t)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('shows each phase under way and as it lands, filling out with even steps clear of them', () => {
    expect(sheetMoments(10, { fan: [1, 3], fold: [6, 8] })).toEqual([
      { t: 2, label: 'fan under way' },
      { t: 3, label: 'fan lands' },
      { t: 5, label: '' },
      { t: 7, label: 'fold under way' },
      { t: 8, label: 'fold lands' },
      { t: 10, label: 'the end' },
    ]);
  });

  it('spreads its picks over many phases, and doesn’t show a phase that lands with the take twice', () => {
    const many = sheetMoments(24, { a: [0, 4], b: [4, 8], c: [8, 12], d: [12, 16], e: [16, 24] });
    expect(many).toHaveLength(6);
    expect(many[0].label).toBe('a under way');
    expect(many.at(-1)).toEqual({ t: 24, label: 'the end' });
    expect(many.filter((m) => m.label === 'e lands')).toHaveLength(0);
  });
});

describe('the scene\'s stage', () => {
  it('stands clear of the hall\'s walls and its doorway, with room to walk round it', () => {
    expect(SCENE_STAGE.radius + 3).toBeLessThan(STUDIO_HALL.radius);
    expect(SCENE_STAGE.radius + 3).toBeLessThan(-ENTRANCE_X);
  });
});

describe('ScenePlayback', () => {
  it('plays the scene on, holds its last frame a moment, then loops', () => {
    const play = new ScenePlayback();
    play.advance(4, 10);
    expect(play.at(10)).toBe(4);
    play.advance(6.5, 10);
    expect(play.at(10)).toBe(10);
    play.advance(SCENE_HOLD, 10);
    expect(play.at(10)).toBeCloseTo(0.5);
  });

  it('stands still while paused, but still spins while a key is held', () => {
    const play = new ScenePlayback();
    play.advance(2, 10);
    play.paused = true;
    play.turning = 1;
    play.advance(1, 10);
    expect(play.at(10)).toBe(2);
    expect(play.spin).toBeCloseTo(SPIN_RATE);
  });

  it('scrubs paused, within the scene, from where it shows', () => {
    const play = new ScenePlayback();
    play.advance(10.6, 10); // holding its last frame
    play.scrub(-0.5, 10);
    expect(play.paused).toBe(true);
    expect(play.at(10)).toBe(9.5);
    play.scrub(-20, 10);
    expect(play.at(10)).toBe(0);
    play.scrub(30, 10);
    expect(play.at(10)).toBe(10);
  });

  it('steps its speed up and down within its range, and plays at it', () => {
    const play = new ScenePlayback();
    play.stepSpeed(-1);
    expect(play.speed).toBe(0.5);
    play.advance(2, 10);
    expect(play.at(10)).toBe(1);
    for (let i = 0; i < 9; i++) play.stepSpeed(1);
    expect(play.speed).toBe(2);
    for (let i = 0; i < 9; i++) play.stepSpeed(-1);
    expect(play.speed).toBe(0.25);
  });

  it('starts a new scene from the top, playing, its spin and speed kept', () => {
    const play = new ScenePlayback();
    play.spin = 1;
    play.speed = 2;
    play.scrub(3, 10);
    play.restart();
    expect(play).toMatchObject({ t: 0, paused: false, spin: 1, speed: 2 });
  });
});

describe('the scene shelf', () => {
  it('puts the picked card in front, bigger, later ones to the right, and fades those far round', () => {
    const spots = shelfSpots(6, 1);
    expect(spots[1]).toEqual({ angle: -0, scale: 1.35, opacity: 1 });
    expect(spots[2].angle).toBeCloseTo(-SHELF.step);
    expect(spots[0].angle).toBeCloseTo(SHELF.step);
    expect(spots[5].opacity).toBe(0);
    expect(spots[4].opacity).toBe(0.5);
  });

  it('glides between two cards while the pick eases over', () => {
    const [a, b] = shelfSpots(2, 0.5);
    expect(a.scale).toBeCloseTo(1.175);
    expect(b.scale).toBeCloseTo(1.175);
    expect(a.angle).toBeCloseTo(-b.angle);
  });

  it('turns every card to face you squarely, wherever round you it hangs', () => {
    for (const a of [0, 0.6, -1.2, 2.5]) {
      const turn = cardTurn(a);
      // the card's face (+Z turned by `turn` about Y) against the way back from the card to you
      const face = [Math.sin(turn), Math.cos(turn)];
      const back = [-Math.sin(a), -Math.cos(a)];
      expect(face[0] * back[0] + face[1] * back[1]).toBeCloseTo(1);
    }
  });

  it('keeps the pick on the shelf', () => {
    expect(shelfMove(0, -1, 4)).toBe(0);
    expect(shelfMove(2, 1, 4)).toBe(3);
    expect(shelfMove(3, 1, 4)).toBe(3);
  });
});
