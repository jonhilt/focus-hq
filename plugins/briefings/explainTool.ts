// The briefings plugin's lead tool (README.md): mcp__office__explain, an animated explainer of a concept on the lead's
// station's screen, in the office's LCARS player, with a picture of its stage at the middle of each beat for the lead
// to look at and what the checks found there. Each beat's receipts are looked up in their sources first: an explainer
// whose quotes aren't there, or whose narration says what its quotes don't, goes back to the lead to fix.
import { z } from 'zod';
import type { LeadTool, LeadToolContext } from '../../plugin-api/server';
import { beatMoments, EXPLAINER_LIMITS as E, explainerCheck, type ExplainerInput, explainerPage, momentNotes, STAGE_CLIP, STAGE_SIZE, stageSeen } from './explainer';
import { demoExplainer } from './demo';
import { RECEIPT_LIMITS as R, type Receipt, receiptProblems, unbacked } from './receipts';
import { receiptFor, type Sources } from './sources';

/**
 * The explain tool's input, with the limits `explainerPage` enforces, so the lead sees them up front. The office still
 * checks it all (and refuses a script that would close its own element).
 */
export const explainShape = {
  id: z.string().describe('A short name for it, lowercase with dashes (like "ledger-crash"): it shares ids with show\'s visuals, and explaining the same id again replaces it.'),
  title: z.string().describe('What it explains, in a few words (at most 80 characters): it heads the player.'),
  beats: z.array(z.object({
    title: z.string().max(E.beatTitle).describe(`The beat's point, in a few words (at most ${E.beatTitle} characters): shown in gold over its caption.`),
    text: z.string().max(E.text).describe(`The caption while it plays: what's happening and why it matters, in a sentence or two (at most ${E.text} characters).`),
    seconds: z.number().min(E.minSeconds).max(E.maxSeconds).describe(`How long it plays (${E.minSeconds} to ${E.maxSeconds} seconds): long enough to read the caption and watch the change.`),
    label: z.string().max(E.label).optional().describe(`A word or two for its block down the left and on the timeline (at most ${E.label} characters); the title's first words if left out.`),
    refs: z.array(z.object({
      kind: z.enum(['file', 'said', 'ledger']).describe('file: a file in your checkout; said: your own words earlier in this session; ledger: a line of the ship\'s log.'),
      where: z.string().optional().describe('For file, its path (its repo\'s folder first when the goal has more than one); for ledger, the line\'s seq. Nothing for said.'),
      quote: z.string().max(R.quote).describe(`The source's words that back this beat, exactly as the source has them (at most ${R.quote} characters).`),
    })).max(R.refs).optional().describe(`Receipts: where this beat's facts come from, ${R.refs} at most. Every number and name its narration says must be in one of their quotes, or the office sends the explainer back. A beat with none shows as your interpretation. Explaining how Focus itself works, cite the code as it is (file), not the design you meant.`),
    narration: z.string().max(E.narration).optional().describe(`What a voice says over this beat when the captain plays it with the voice on (at most ${E.narration} characters): talk them through what they're looking at, as if sitting beside them pointing at the stage ("on the left is the queue; watch what happens when the worker goes down"), in plain spoken words with no code or file paths. The beat holds on its last frame until it's said. Its title and caption are read out if left out.`),
  })).min(E.minBeats).max(E.maxBeats).describe(`The beats in order (${E.minBeats} to ${E.maxBeats}), each one step of the explanation: they play one after another, and the captain can step through them one at a time.`),
  stage: z.object({
    html: z.string().describe(`The scene's elements, laid out in a ${STAGE_SIZE.w} × ${STAGE_SIZE.h} box (absolutely positioned).`),
    css: z.string().optional().describe('Styles for them.'),
    script: z.string().describe('Defines render(t), which sets the whole scene for t seconds from the start, and can build elements first.'),
  }).describe('What plays above the captions.'),
};

/** Each beat's receipts, found in their sources; or what the lead must fix first, beat by beat. */
async function beatReceipts(input: ExplainerInput, lead: LeadToolContext, sources: Sources): Promise<{ receipts: Receipt[][]; problems: string[] }> {
  const receipts: Receipt[][] = [];
  const problems: string[] = [];
  for (const [i, beat] of input.beats.entries()) {
    const refs = beat.refs ?? [];
    const found = await Promise.all(refs.map((ref) => receiptFor(ref, lead, sources)));
    const good = found.filter((f): f is Receipt => typeof f !== 'string');
    receipts.push(good);
    const missing = refs.length ? unbacked(beat.narration ?? `${beat.title}. ${beat.text}`, good.map((r) => r.quote)) : [];
    problems.push(...receiptProblems(i, found.filter((f): f is string => typeof f === 'string'), missing));
  }
  return { receipts, problems };
}

/** The lead's explain tool: their beats and stage go in the office's player, which goes up like any of show's visuals. */
export const explainTool = (sources: Sources): LeadTool => ({
  name: 'explain',
  description: `Walk the captain through a concept with an animated explainer on your station's screen: how a mechanism behaves, what happens when something fails, how data moves, why one design beats another. Text is hard to take in; an explainer plays it out a beat at a time, each with a caption, and the captain steps through at their own pace. The office wraps your stage in the ship's LCARS player (frame, beats down the left, captions, play and step), so you write only the stage, and shows it like show's visuals: a picture on the screen, live up close. Before the captain presses play it rests, dimmed, on its last frame, so make that frame sum it up. Up close the captain can switch a voice on, which reads each beat's narration while it plays: write one for every beat.

The stage is a ${STAGE_SIZE.w} × ${STAGE_SIZE.h} box (#stage). Put your elements in html, style them in css, and in script define render(t): it sets the whole scene for t seconds from the start (0 to the beats' seconds added up), and is called every frame and for jumps back and forth, so work everything out from t, never from the frame before. Build repeated elements once in the script, before render. Helpers: p(t, a, b) eases from 0 to 1 between a and b seconds; clamp(x, lo, hi); B[i] is when beat i starts (B[0] = 0) and DUR when it ends; $(selector) and $$(selector) find things in the stage; tag(text, colour) is the HTML for a status capsule. Colours are CSS variables: --orange, --gold, --peach, --lilac, --peri, --sky, --green, --red (for alerts), --text, --muted, --line. Classes: .panel (style="--c:var(--sky)") with a .hd header and a .bd body, .pill (a capsule, coloured by --c), .lbl (a column label), .mono (code). The font is Antonio; JetBrains Mono for code.

Plan the beats first: one change per beat. Give each beat its receipts (refs): the file, your own earlier words or the ledger line its facts come from, quoted exactly. They show as chips under the caption, never read aloud, and the office checks them before the captain sees it. The office replies with a picture of the stage at the middle of each beat and what its check found (an empty stage): look at them, and fix what doesn't read.`,
  input: explainShape,
  async run(lead, raw) {
    const input: ExplainerInput = z.object(explainShape).parse(raw);
    const { receipts, problems } = await beatReceipts(input, lead, sources);
    if (problems.length) throw new Error(`The receipts don't hold up yet, so it isn't on the screen:\n${problems.join('\n')}`);
    const built = explainerPage(input, receipts);
    if ('error' in built) throw new Error(built.error);
    const shown = await lead.showFrames(built, { at: beatMoments(input.beats), clip: STAGE_CLIP });
    const seconds = input.beats.reduce((sum, b) => sum + b.seconds, 0);
    const text = `${shown.text} It's an explainer of ${input.beats.length} beats, ${Math.round(seconds)} seconds in all.`;
    if (!shown.frames.length) return { text, images: [] };
    const moments = shown.frames.flatMap((f) => stageSeen(f.at, f.seen) ?? []);
    return { text: `${text} ${explainerCheck(momentNotes(moments))}`, images: shown.frames.map((f) => f.image) };
  },
  demo: ({ folders, again }) => ({ ...demoExplainer(folders, again) }),
});
