import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { errorMessage } from '../util';
import { EXPLAINER_LIMITS as E, STAGE_SIZE } from './explainer';
import { NOTE_LIMITS as L } from './lead';
import type { OfficeTools } from './types';

/**
 * The note tool's input, with the limits `checkNote` enforces (`NOTE_LIMITS`), so the lead sees them up front rather
 * than learning them by being refused. The office still checks the whole note: learned adds to lines already there.
 */
export const noteShape = {
  title: z.string().max(L.title).optional().describe(`A better title for the goal, in a few words (at most ${L.title} characters).`),
  done: z.string().max(L.done).optional().describe(`What done looks like, as agreed with the captain: a few lines (at most ${L.done} characters).`),
  slice: z.array(z.object({
    text: z.string().max(L.item).describe(`One item (at most ${L.item} characters).`),
    done: z.boolean().optional(),
  })).max(L.slice).optional().describe(`This slice's checklist, all of it (at most ${L.slice} items of ${L.item} characters each): send it again with items ticked off as you go.`),
  learned: z.string().max(L.line).optional().describe(`One new line on what a slice taught you, or a decision and why (at most ${L.line} characters).`),
  allLearned: z.array(z.string().max(L.line)).max(L.learned).optional().describe(`Replaces every learned line: to merge older lessons when the list is full (at most ${L.learned} lines of ${L.line} characters each).`),
  next: z.array(z.string().max(L.item)).max(L.next).optional().describe(`Up to ${L.next} candidate next slices (at most ${L.item} characters each), replacing the last ones.`),
};

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
  })).min(E.minBeats).max(E.maxBeats).describe(`The beats in order (${E.minBeats} to ${E.maxBeats}), each one step of the explanation: they play one after another, and the captain can step through them one at a time.`),
  stage: z.object({
    html: z.string().describe(`The scene's elements, laid out in a ${STAGE_SIZE.w} × ${STAGE_SIZE.h} box (absolutely positioned).`),
    css: z.string().optional().describe('Styles for them.'),
    script: z.string().describe('Defines render(t), which sets the whole scene for t seconds from the start, and can build elements first.'),
  }).describe('What plays above the captions.'),
};

/** One tool's answer: what happened, in words, or (marked as an error) why it didn't. */
async function answer(run: () => Promise<string>, failed: string): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    return { content: [{ type: 'text', text: await run() }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `${failed}: ${errorMessage(err)}` }], isError: true };
  }
}

/** The office's tools for a goal's lead, as an in-process MCP server: mcp__office__ship, note, show, explain, ask and propose_close. */
export function officeMcpServer(tools: OfficeTools): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'office',
    version: '1.0.0',
    alwaysLoad: true,
    instructions: 'The Focus office: it pushes your work and opens pull requests for you, keeps your goal\'s note, puts what you show on your station\'s screen, and tells the captain when you think the goal is done. Never push or open pull requests yourself.',
    tools: [
      tool(
        'ship',
        'Ship the slice: the office pushes every repo in your workspace with new commits, and opens (or updates) a pull request in each. Commit everything first.',
        {
          title: z.string().describe('The pull requests’ title: imperative and specific, under 70 characters.'),
          summary: z.string().describe('The pull requests’ description in Markdown: what the slice does and why, and how you tested it.'),
        },
        ({ title, summary }) => answer(() => tools.ship({ title, summary }), "Couldn't ship"),
      ),
      tool(
        'note',
        'Update the goal\'s note, which survives when your conversation gets summarised and which the captain sees. Send only what changes: each field replaces what was there, except learned, which adds a line. Keep it short; the office refuses a note that grows into a spec.',
        noteShape,
        (input) => answer(() => tools.note(input), "Couldn't update the note"),
      ),
      tool(
        'show',
        "Put a visual on your station's big screen for the captain: a diagram, a mockup, options side by side. They see a picture of it on the screen, switch between what you've shown, and open each one up close, live. Showing an id again replaces it.",
        {
          id: z.string().describe('A short name for it, lowercase with dashes (like "data-flow"): show the same id again to update it.'),
          title: z.string().describe('What it is, in a few words (at most 80 characters).'),
          html: z.string().describe('A self-contained HTML page: inline CSS and SVG, or a script from a CDN (mermaid, say). The screen shows it at 1280 × 800, so make it read well at that size.'),
        },
        (input) => answer(() => tools.show(input), "Couldn't show it"),
      ),
      tool(
        'explain',
        `Walk the captain through a concept with an animated explainer on your station's screen: how a mechanism behaves, what happens when something fails, how data moves, why one design beats another. Text is hard to take in; an explainer plays it out a beat at a time, each with a caption, and the captain steps through at their own pace. The office wraps your stage in the ship's LCARS player (frame, beats down the left, captions, play and step), so you write only the stage, and shows it like show's visuals: a picture on the screen, live up close. Before the captain presses play it rests, dimmed, on its last frame, so make that frame sum it up.

The stage is a ${STAGE_SIZE.w} × ${STAGE_SIZE.h} box (#stage). Put your elements in html, style them in css, and in script define render(t): it sets the whole scene for t seconds from the start (0 to the beats' seconds added up), and is called every frame and for jumps back and forth, so work everything out from t, never from the frame before. Build repeated elements once in the script, before render. Helpers: p(t, a, b) eases from 0 to 1 between a and b seconds; clamp(x, lo, hi); B[i] is when beat i starts (B[0] = 0) and DUR when it ends; $(selector) and $$(selector) find things in the stage; tag(text, colour) is the HTML for a status capsule. Colours are CSS variables: --orange, --gold, --peach, --lilac, --peri, --sky, --green, --red (for alerts), --text, --muted, --line. Classes: .panel (style="--c:var(--sky)") with a .hd header and a .bd body, .pill (a capsule, coloured by --c), .lbl (a column label), .mono (code). The font is Antonio; JetBrains Mono for code.`,
        explainShape,
        (input) => answer(() => tools.explain(input), "Couldn't explain it"),
      ),
      tool(
        'ask',
        "Ask the captain a question best answered by looking: which layout, which diagram reads best, which of a few approaches. Each option is a page of its own, shown on your station's screen; up close, the captain steps through them one at a time, large, and picks one. Say why you're asking in context, and give each option a detail (what it means, what it trades off): they read it beside the page. Their pick comes back to you as a message from them, so end your turn after asking. Asking again replaces a question they haven't answered.",
        {
          question: z.string().describe('The question, in a sentence (at most 300 characters).'),
          context: z.string().optional().describe('Why you\'re asking and what matters in choosing, in a few sentences (at most 600 characters): the captain reads it above the options.'),
          options: z.array(z.object({
            label: z.string().describe('A few words naming this option (at most 60 characters).'),
            detail: z.string().optional().describe('What this option means and what it trades off, in a sentence or three (at most 500 characters): shown beside its page.'),
            html: z.string().describe('A self-contained HTML page showing it, laid out for 1280 × 800 like the show tool\'s.'),
          })).describe('2 to 4 options: the captain sees them lettered A, B, C, D in this order.'),
        },
        (input) => answer(() => tools.ask(input), "Couldn't ask"),
      ),
      tool(
        'propose_close',
        "Tell the captain you think the goal is done (what done looks like is met), or that nothing worthwhile is left. They close it or carry on. Then tell them why, and stop.",
        { reason: z.string().describe('Why, in a sentence or two.') },
        ({ reason }) => answer(() => tools.proposeClose({ reason }), "Couldn't propose closing"),
      ),
    ],
  });
}
