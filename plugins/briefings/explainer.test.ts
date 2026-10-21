import { describe, expect, it } from 'vitest';
import { beatLabel, beatMoments, beatNarration, EXPLAINER_LIMITS, explainerCheck, type ExplainerInput, explainerPage, momentNotes, type StageMoment, stageSeen } from './explainer';

const L = EXPLAINER_LIMITS;
const input = (over: Partial<ExplainerInput> = {}): ExplainerInput => ({
  id: 'ledger',
  title: 'Ledger v2',
  beats: [
    { title: 'Append, never rewrite', text: 'Each event becomes one line.', seconds: 7 },
    { title: 'One writer', text: 'A lock file keeps a second Focus out.', seconds: 5, label: 'Lock' },
  ],
  stage: { html: '<div id="file" class="panel"></div>', css: '#file { left: 0 }', script: 'function render(t) { $("#file").style.opacity = p(t, 0, 1); }' },
  ...over,
});
const page = (over: Partial<ExplainerInput> = {}) => {
  const built = explainerPage(input(over));
  if ('error' in built) throw new Error(built.error);
  return built;
};
const refusal = (over: Partial<ExplainerInput>) => {
  const built = explainerPage(input(over));
  return 'error' in built ? built.error : undefined;
};
const beatsIn = (html: string) => JSON.parse(/window\.KIT_BEATS = (.*?); window\.KIT_DUR = (\d+(?:\.\d+)?);/.exec(html)![1]) as { at: number; title: string; text: string; label: string; colour: string; say: string }[];

describe('explainerPage', () => {
  it('wraps the stage in the player, under the id and title it was given', () => {
    const built = page({ title: '  Ledger   v2 ' });
    expect(built.id).toBe('ledger');
    expect(built.title).toBe('Ledger v2');
    expect(built.html).toContain('<div id="file" class="panel"></div>');
    expect(built.html).toContain('#file { left: 0 }');
    expect(built.html).toContain('function render(t)');
    expect(built.html).toContain('<body class="rest">');
  });

  it('starts each beat where the last one ended, and plays to the end of the last', () => {
    const { html } = page();
    expect(beatsIn(html).map((b) => b.at)).toEqual([0, 7]);
    expect(html).toContain('window.KIT_DUR = 12;');
  });

  it('labels each beat with its own label, or the start of its title', () => {
    expect(beatsIn(page().html).map((b) => b.label)).toEqual(['Append', 'Lock']);
    expect(beatLabel({ title: 'Damage in the middle is reported', text: '', seconds: 1 })).toBe('Damage in the');
    expect(beatLabel({ title: 'Checked whole on load', text: '', seconds: 1 })).toBe('Checked whole on');
    expect(beatLabel({ title: 'Supercalifragilisticexpialidocious', text: '', seconds: 1 })).toBe('Supercalifragili');
  });

  it("gives the voice each beat's narration, or its title and caption read out", () => {
    const beats = [
      { title: 'Append, never rewrite', text: 'Each event becomes one line.', seconds: 7, narration: '  On the left   is the file. ' },
      { title: 'One writer?', text: 'A lock file keeps a second Focus out.', seconds: 5 },
    ];
    expect(beatsIn(page({ beats }).html).map((b) => b.say)).toEqual(['On the left is the file.', 'One writer? A lock file keeps a second Focus out.']);
    expect(beatNarration({ title: 'One writer', text: 'Only one.', seconds: 1, narration: ' ' })).toBe('One writer. Only one.');
  });

  it('refuses a narration too long to say over a beat', () => {
    const beat = { title: 'A beat', text: 'Its caption', seconds: 3 };
    expect(refusal({ beats: [beat, { ...beat, narration: 'x'.repeat(L.narration + 1) }] })).toMatch(/narration is 601 characters/);
    expect(refusal({ beats: [beat, { ...beat, narration: 'x'.repeat(L.narration) }] })).toBeUndefined();
  });

  it('never colours a beat red, which the stage keeps for alerts', () => {
    const beats = Array.from({ length: L.maxBeats }, (_, i) => ({ title: `Beat ${i}`, text: 'x', seconds: 1 }));
    expect(beatsIn(page({ beats }).html).map((b) => b.colour)).not.toContain('red');
  });

  it("keeps the lead's words from breaking out of the page", () => {
    const { html } = page({
      title: '<img src=x onerror=alert(1)>',
      beats: [
        { title: 'Ends </script><script>alert(1)</script>', text: 'a <b>bold</b> claim', seconds: 2 },
        { title: 'Two', text: 'two', seconds: 2 },
      ],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(beatsIn(html)[0].title).toBe('Ends </script><script>alert(1)</script>');
  });

  it('refuses too few or too many beats, and beats that are empty, long or out of time', () => {
    const beat = { title: 'A beat', text: 'Its caption', seconds: 3 };
    expect(refusal({ beats: [beat] })).toMatch(/2 to 8 beats/);
    expect(refusal({ beats: Array.from({ length: L.maxBeats + 1 }, () => beat) })).toMatch(/2 to 8 beats/);
    expect(refusal({ beats: [beat, { ...beat, title: ' ' }] })).toMatch(/Beat 2 needs a title/);
    expect(refusal({ beats: [beat, { ...beat, text: '' }] })).toMatch(/Beat 2 needs a caption/);
    expect(refusal({ beats: [beat, { ...beat, title: 'x'.repeat(L.beatTitle + 1) }] })).toMatch(/title is 61 characters/);
    expect(refusal({ beats: [beat, { ...beat, text: 'x'.repeat(L.text + 1) }] })).toMatch(/split it into two beats/);
    expect(refusal({ beats: [beat, { ...beat, label: 'x'.repeat(L.label + 1) }] })).toMatch(/label is 17 characters/);
    expect(refusal({ beats: [beat, { ...beat, seconds: 0 }] })).toMatch(/1 to 30/);
    expect(refusal({ beats: [beat, { ...beat, seconds: L.maxSeconds + 1 }] })).toMatch(/1 to 30/);
    expect(refusal({ beats: [beat, { ...beat, seconds: Number.NaN }] })).toMatch(/1 to 30/);
    expect(refusal({ beats: [beat, { ...beat, title: 'x'.repeat(L.beatTitle), text: 'x'.repeat(L.text), label: 'x'.repeat(L.label), seconds: L.maxSeconds }] })).toBeUndefined();
  });

  it("refuses a stage without a script, or one whose script or CSS would close its own element", () => {
    const stage = input().stage;
    expect(refusal({ stage: { ...stage, script: '  ' } })).toMatch(/render\(t\)/);
    expect(refusal({ stage: { ...stage, script: 'const s = "</script>"; function render() {}' } })).toMatch(/<\/script>/);
    expect(refusal({ stage: { ...stage, css: '</style><script>' } })).toMatch(/<\/style>/);
    expect(refusal({ stage: { ...stage, html: 'x'.repeat(L.stageBytes) } })).toMatch(/MB/);
  });
});

describe('checking an explainer', () => {
  const moment = (over: Partial<StageMoment> = {}): StageMoment => ({ at: 1, flat: 0.8, ...over });

  it('looks at the middle of each beat', () => {
    expect(beatMoments([{ seconds: 4 }, { seconds: 6 }, { seconds: 2 }])).toEqual([2, 7, 11]);
  });

  it('says nothing about beats that look well, and calls out an empty stage', () => {
    expect(momentNotes([moment(), moment({ flat: 0.99 })])).toEqual([]);
    expect(momentNotes([moment(), moment({ flat: 0.999 })])).toEqual([expect.stringMatching(/^Beat 2 looks empty/)]);
  });

  it('reads what the player says it saw on its stage, and nothing it shouldn’t', () => {
    expect(stageSeen(2, { flat: 0.8 })).toEqual({ at: 2, flat: 0.8 });
    expect(stageSeen(2, null)).toBeNull();
    expect(stageSeen(2, { flat: '0.8' })).toBeNull();
  });

  it('asks the lead to look either way', () => {
    expect(explainerCheck([])).toMatch(/look at each.*found nothing/);
    expect(explainerCheck(['Beat 2 looks empty.'])).toMatch(/look at each.*found: Beat 2 looks empty\.$/);
  });
});
