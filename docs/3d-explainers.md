# Getting Claude Code to visualise ideas as 3D animations: what works

_Research from October 2026: five parallel web research angles, a source-checking pass and a synthesis. Most measured agent results are on Manim, so applying them to three.js is inference._

## 1. TL;DR: highest-leverage strategies, ranked

1. **Write a storyboard before any code** (strong). List the beats, what is on screen in each, the one change per beat, the camera per beat, units and timing. Code it only after the plan is reviewed.
2. **Make the scene a pure function of time** (strong as an enabler). `render(t)` sets everything from `t`. No `Date.now()`, no rAF deltas, no `useFrame`, and randomness is seeded. This is what lets anything else be checked.
3. **Gate on a blank canvas and console errors before any vision review** (strong as a precondition). Headless WebGL fails silently with a black canvas, so solve that first.
4. **Run the renderer in a loop with error retries** (strong). Feed the error back to the agent and allow about 5 retries. Use small curated docs, not generic retrieval, which can make results worse.
5. **Check screenshots of several beats with a separate evaluator, gated by a Stop hook or /goal** (strong as general practice, moderate for 3D). Vision critique catches layout problems but misreads frames, so treat it as polish.
6. **Start from a pinned scaffold and a small version-checked reference** (moderate). The model edits only the scene. The setup code and the library version are fixed.
7. **Expose scene state and assert on it for correctness** (moderate). Screenshot and VLM judges barely correlate with correctness, but evidence that agent-written assertions help is inferred, not measured.

## 2. Recommended pipeline

**Storyboard (pass 1, no code).** The output is a plan file or JSON containing:
- a one-sentence thesis, the misconception it corrects and the "aha" beat;
- 3–6 beats, each with: start and end time, the single change, which objects are focused and which are context, the camera position and target, and the caption;
- a scale convention (for example, 1 unit = 1 m and everything fits in a 10-unit cube), camera near/far, and a palette where each colour has one fixed meaning.

A human or reviewer approves this plan, and the critic checks against it later. In the Code2Video ablation, removing the planner cost about 41 points on both aesthetics and learning transfer, the largest effect of any component.

**Scaffold.** Use a known-good template with:
- a pinned three.js version;
- a sized renderer, `outputColorSpace = SRGBColorSpace`, ACES tone mapping, and a RoomEnvironment PMREM;
- a home camera and a ground grid;
- a screen-space label layer;
- an empty `buildScene()` and `render(t)`.

The setup block is marked as off-limits to the model.

**Generate.** Code one beat at a time against the plan. `render(t)` interpolates between beat keyframes with easing and calls `renderer.render()` itself. Publish `window.__scene = { t, beat, camera, objects }` with a fixed schema.

**See-and-fix loop.** Run it in this order, cheapest first:
1. Load the page headless with WebGL flags. Fail on page errors, shader errors or a lost context.
2. Seek to the start, middle and end of each beat.
3. Run the pixel gate: fail if the canvas is a single colour or near-black.
4. Run state assertions: the focus object is inside the frustum, labels' screen boxes don't overlap, and the scale is in range.
5. Save the PNGs plus a contact sheet. A separate evaluator subagent scores them against a short legibility rubric: subject framed, labels readable, nothing clipped or occluded, and the beat's change visible.
6. Fix only the beat that failed. Code2Video's scoped repair took about 2.8× less time.
7. Put steps 1–4 in a Stop hook so the turn can't end while they fail.

## 3. Tool choice

| Tool | Wins when | Watch out for |
|---|---|---|
| **three.js (vanilla, single HTML)** | Live, interactive or browser-embedded explainers; no build step | Version drift in training data (r150–r160 removals, r152 colour management); headless capture is fragile. Best measured three.js correctness is only 27.8% (WorldCoder-Bench) |
| **R3F + drei** | You already have a React app | `useFrame` and drei's built-in animation (Float, damped controls) break determinism |
| **Remotion + @remotion/three** | Rendered video output, frame-exact, `remotion still --frame=N` checks | Video, not interactive; must key everything off `useCurrentFrame()` |
| **Manim CE (ThreeDScene)** | Maths explainers; the best-measured agent tool (90%+ render success with retries) | Slow Cairo 3D, no PBR, weak depth sorting; ManimGL vs CE confusion (145 incompatibilities) |
| **Motion Canvas** | 2D/2.5D explainers with a timeline editor | No real 3D; no agent evals |
| **Blender (blender-mcp)** | Photoreal stills or video of hard-surface scenes | One review found a 2-hour session used 60% of a Max plan's token allowance and still ended with clipping, wrong scale and a wrong camera; poor at precise placement; runs unauthenticated code over a socket |

## 4. Prompt and skill snippets

Put something like this in a skill or CLAUDE.md:

```
3D EXPLAINERS
- Plan first: write plan.json (thesis, misconception, 3-6 beats: t-range, single change,
  focus objects, camera pos+target, caption). Units: 1 unit = 1 m, scene fits a 10-unit cube.
  Stop for review before code.
- Justify 3D: use it only if the concept is spatial. Flat data stays 2D.
- three.js r<PINNED>, ES modules only, addons from "three/addons/". NEVER: build/three.min.js,
  examples/js, outputEncoding, sRGBEncoding, Geometry, @latest, mixing CDNs.
- Do not edit the SETUP block. Fill buildScene() and render(t) only.
- render(t) sets ALL state from t and calls renderer.render(). No requestAnimationFrame
  state, Date.now(), Clock, unseeded Math.random(), OrbitControls damping.
- Camera: fixed home view; move between beats, never while content changes. No idle spin.
- Labels: screen-space overlay, min 18px, >= 24px from edges, max ~6 visible at once.
  Focus at opacity 1, context 0.4, scaffolding 0.15. Each colour has one meaning.
- Publish window.__scene = {t, beat, camera, objects:[{id, pos, visible}]}. Do not rename keys.
- Done = verify script passes (no console errors, non-blank canvas at every beat sample,
  state asserts) AND screenshots saved to ./shots. Show them; don't claim success without them.
```

Add a pre-flight checklist for self-audit before the verify script runs:
- every lit material has a light or an environment map;
- the renderer is sized;
- the near/far ratio is sane, with `polygonOffset` on coplanar surfaces;
- textures use `colorSpace = SRGBColorSpace`;
- geometries and materials are disposed when swapped out.

## 5. Pitfalls and how to catch them

- **Black headless canvas.** Chromium without GPU flags, WebGPU off in headless, or `WebGPURenderer` silently falling back to WebGL2. Catch it with: launch flags (`--use-angle=swiftshader` or `--enable-unsafe-swiftshader`; on Linux `--use-angle=gl` plus Xvfb is about 2–4× faster), a pixel-uniformity gate, logging which backend actually ran, and waiting for a "ready" flag instead of a fixed sleep.
- **Plausible but blank scene.** Causes: no lights, a zero-size renderer, render never called, deprecated APIs. Catch it with the scaffold, the checklist and the console gate.
- **Hidden time sources.** OrbitControls damping, `THREE.Clock`, physics. Catch it by rendering the same `t` twice and diffing the pixels.
- **Self-approval.** Agents praise their own mediocre work (Anthropic's harness post). Use a separate evaluator and limit it to legibility and correctness.
- **VLM critics misread frames.** In PhysicsSolutionAgent, a vision pass moved the layout score only from 3.64 to 3.66 out of 5. Use geometry and state asserts for spatial bugs and keep a human glance at the end.
- **One still can't show motion.** Sample several times per beat. Small contact-sheet tiles lose label legibility, so check text in full-size frames.
- **Stale references.** Skill packs pinned to a different release cause the very errors they are meant to prevent. Grep for the version string.
- **Schema drift.** This was the top WorldCoder failure (42.8%). Define the `__scene` schema in the scaffold, not in the prompt.
- **Slide-deck output.** Agents state teaching principles in the plan and then ignore them. The critic should check that the first beats are concrete before any formula appears.

## 6. Fit for Focus

The `explain` tool already has the right core shape. The stage is a pure `render(t)`, beats are discrete and viewer-paced with captions, and the resting frame `render(DUR)` sums the explainer up. A lead can ship a three.js stage today. The gaps are in how three.js loads and in how the screen's picture is captured:

1. **`render` is captured synchronously.** `KIT_PLAYER` reads `render` once, at load. A `type=module` script runs too late. A dynamic `import()` of `three.module.js` inside the classic script works only with a guard: `render(t)` stores `t`, does nothing until three has loaded, then redraws the last `t`. Nothing in the kit triggers that redraw, and if the lead forgets, the resting frame and snapshot stay blank.
   - An importmap placed in the stage **html** should work, since it is parsed before the lead's script, but this is untested. It would be needed for any addons that import the bare `three` specifier.
   - The classic `three.min.js` route pins three to 0.159 or older, which conflicts with the office's own 0.186.
2. **The snapshot browser has no GPU flags and only a 400 ms settle.** `BrowserPool.launch` has none of the flags that `studio.ts`/`perf.ts` use. Newer Chrome may refuse SwiftShader without `--enable-unsafe-swiftshader`. Untested, but if it fails, the JPEG on the 3D screen is blank: the exact silent failure described above.
3. **Dry-run cost.** About 4×`DUR` calls of `render` at load, each doing a GL draw under software rendering. Scenes must stay cheap. Otherwise the kit could expose a dry-run flag so `render` can skip `renderer.render()` during the dry run.
4. **Leads don't know 3D is an option.** The tool text in `officeTool.ts` and `docs/goals.md` describes DOM/SVG stages only.

**First small slice: "3D stages that snapshot reliably."**
- In `browserTool.ts`, add WebGL launch args (`--enable-unsafe-swiftshader`, plus `--use-angle=metal` on macOS as studio does). For pages containing a canvas, settle until a `window.kitReady` flag is set or 3 s pass.
- In `explainer.ts`, add `window.kitRedraw()`, which re-calls `draw` at the current `t` (or at `DUR` when resting). Add opt-in `stage.libs: ['three']` that injects a pinned importmap (three@0.186.1 from jsdelivr, matching the client) and preloads three before the lead's script runs. Expose it as `window.THREE`, then call `kitRedraw` and set `kitReady`.
- In `explainer.test.ts`, check that the importmap is injected and that `kitRedraw` exists. Add a Playwright fixture that renders a tiny rotating-cube explainer and asserts the snapshot JPEG is not uniform.
- Add one paragraph to the `explain` description: when to use 3D (only for spatial concepts), the render(t) rules, and the camera and label rules from section 4.

Later slices: inject the scaffold (renderer, lighting, label overlay, `__scene`); make the pixel gate and `__scene` asserts feed back through `pageErrorsNote`; capture frames at beat midpoints as a contact sheet for the lead to review.

## 7. Sources and evidence strength

**Strong (peer-reviewed, preprint or first-party, verified)**
- Code2Video (planner/critic/anchor ablations, TeachQuiz): https://arxiv.org/html/2510.01174 · https://proceedings.mlr.press/v306/chen26bx.html
- TheoremExplainAgent (planning, 7%→93% with retries, RAG 93.8%→82.1%): https://arxiv.org/html/2502.19400v2
- WorldCoder-Bench (three.js; VLM judge τ_b −0.068): https://www.emergentmind.com/papers/2606.01869
- Claude Code best practices (screenshot verify, Stop hook, /goal): https://code.claude.com/docs/en/best-practices
- Anthropic harness design (separate evaluator): https://www.anthropic.com/engineering/harness-design-long-running-apps
- HeyGen HyperFrames (seek-then-screenshot, no `Date.now()`): https://www.heygen.com/research/html-to-video
- Headless WebGL/WebGPU failures: https://agent-browser.dev/webgpu · https://microlink.io/blog/faster-webgl-screenshots

**Moderate**
- ManimAgent / RITL-DOC: https://arxiv.org/pdf/2606.30296 · https://deeplearn.org/arxiv/815516/training-and-agentic-inference-strategies-for-llm-based-manim-animation-generation
- PhysicsSolutionAgent (VLM limits): https://arxiv.org/pdf/2601.13453
- OmniManim: https://arxiv.org/abs/2605.15585
- SGA (Manim): https://www.alphaxiv.org/abs/2607.18116
- ManiBench (a 12-problem pilot): https://arxiv.org/html/2603.13251v1
- Remotion 3D rule: https://cdn.jsdelivr.net/npm/ecc-universal@2.0.0/skills/remotion-video-creation/rules/3d.md
- threejs-game-skills (pixel and console gates): https://github.com/majidmanzarpour/threejs-game-skills
- three.js migration guide and RoomEnvironment: https://github.com/mrdoob/three.js/wiki/Migration-Guide · https://threejs.org/docs/pages/RoomEnvironment.html
- Dream Loop ladder: https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/creative/creative-dream-loop
- Blender MCP review: https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance
- Munzner and Tversky on when 3D and animation help human viewers (not tested on agents): https://www.cs.ubc.ca/~tmm/courses/436V-20/slides/rulesofthumb.pdf · https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf

**Anecdotal (adoption or practitioner, no evals)**
- cloudai-x/threejs-skills: https://github.com/cloudai-x/threejs-skills
- OpenAEC skill package: https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package
- Hermes manim-video skill: https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/manim-video/SKILL.md
- SceneProof (42 stars): https://github.com/ReyJ94/SceneProof
- Willison's single-file HTML tools (says nothing about pinning or three.js): https://simonwillison.net/2025/Dec/10/html-tools/
- Anthropic frontend-design skill (no 3D content): https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Contact-sheet tooling: https://glama.ai/mcp/servers/gulkoa/vidshaper/tools/sample_frames
- Union Square case study (body blocked; key figures confirmed only via search snippets): https://thenewstack.io/ai-agents-3d-playwright/

**Dead or unverified links:** docs.creem.io Remotion rule (404); medium.com/@rotbart (403); the Amazon vision-refinement PDF (unreadable, so its +17.8% is unverified).

**Caveat:** nearly all measured agent results are on Manim and mostly 2D. Carrying them over to three.js is inference.

## Appendix: how explain and show handle a three.js stage today

A lead can already put a three.js animated explainer on its screen with today's code. Nothing in the pipeline blocks WebGL or CDN scripts. The real constraints are how the stage script runs and whether the office's headless screenshot can draw WebGL.

**Where the tools live** (all under ``)
- **Tool definitions:** `server/agents/officeTool.ts` declares `show`, `explain` and `ask` as an in-process MCP server (zod schemas). `explainShape` takes the limits from `EXPLAINER_LIMITS` and `STAGE_SIZE`.
- **Handlers:** `server/agents/manager/goalTools.ts`.
  - `showArtifact` checks the page with `showArtifact()` in `server/agents/lead.ts` (`ARTIFACT_LIMITS`: 2 MB, 12 artifacts, id ≤40, title ≤80).
  - It saves `<id>.html`, then gets a JPEG from the `Renderer` service and saves `<id>.jpg`.
  - It passes page errors back to the lead (`pageErrorsNote` in `lead.ts`).
  - `explain` calls `explainerPage(input)` in `server/agents/explainer.ts`, then `showArtifact`.
- **Player page:** `server/agents/explainer.ts` builds one 1280×800 HTML page from the LCARS frame, the beats column, the caption, the controls and the lead's stage.
  - The stage is a `div#stage` at left 200, top 58, 1050×500.
  - Order in the page: the stage's html, then `KIT_BEATS`/`KIT_DUR`, then `KIT_HELPERS`, then the lead's script as a plain inline `<script>` (not a module), then `KIT_PLAYER`.
  - Validation: the script can't contain `</script>`, the CSS can't contain `</style>`, html+css+script ≤1.5 MB, 2–8 beats of 1–30 s each. The stage **html** is not checked, so it can hold `<script src>` or `<canvas>` tags.
- **Helpers on `window`:** `B`, `DUR`, `clamp`, `ease`, `p(t,a,b)`, `stage`, `$`, `$$`, `tag()`, `kitFault`. Colours are CSS variables, plus the `.panel/.pill/.lbl/.tag/.mono` classes. Fonts (Antonio, JetBrains Mono) come from Google Fonts. No libraries are injected; there is no three.js in the page.
- **Player behaviour that matters:**
  - It reads `render` once, at load: `var draw = typeof render === 'function' ? render : null`. If `render` isn't defined synchronously by then, the page shows "must define render(t)".
  - It dry-runs `render(s)` every 0.25 s from 0 to `DUR`. Any throw shows a "Stage fault" panel.
  - It then rests on `render(DUR)`, dimmed. That resting frame is what the screen's picture shows.
  - `window.kitPlay` and `window.kitDone` are only used by the studio filming script.

**Serving and sandbox**
- `server/routes.ts` (`/artifacts/:lead/:file`) serves the html with `Content-Security-Policy: sandbox allow-scripts allow-popups`. That gives an opaque origin but sets no `script-src` or `connect-src` limit, so CDN scripts and ES-module imports load (jsdelivr and unpkg send CORS headers).
- `client/src/ui/screenPanel.ts` shows it up close in an `<iframe sandbox="allow-scripts allow-popups">`, scaled to fit. No same-origin, so no localStorage and no reaching the office; the voice talks through `postMessage` (`client/src/ui/narrator.ts`).
- WebGL works there, as a second WebGL context next to the office's own.

**How the screen's picture is made**
- `BrowserPool.render` in `server/agents/browserTool.ts` (around line 119), wrapped by `Renderer.fromBrowser` in `server/agents/services.ts`, makes the picture:
  - a new context at 1280×800, deviceScaleFactor 1
  - `setContent(html, {waitUntil:'networkidle', timeout:15s})`, errors swallowed
  - a 400 ms wait, then a JPEG screenshot at quality 85
- The 3D screen in the briefing room only ever shows that JPEG as a texture. Live animation happens only when the captain opens it up close.
- The Chromium is launched `headless: true` with **no GPU flags**, trying in order: `FOCUS_BROWSER_PATH`, Playwright's own Chromium, then Chrome, then Edge.
  - By contrast, `scripts/studio.ts` and `scripts/perf.ts` pass `--enable-gpu --ignore-gpu-blocklist`, plus `--use-angle=metal` on macOS.
  - So for leads, WebGL in the snapshot depends on Chromium's software fallback (SwiftShader). Newer Chrome builds may refuse that unless given `--enable-unsafe-swiftshader`. **I haven't tested this.** If it fails, the JPEG shows a blank canvas, or a page error that comes back to the lead.

**three.js as a dependency**
- three.js is a client dependency (`package.json`: `"three": "^0.186.1"`, `@types/three`), bundled by Vite into the office app.
- Nothing serves it to artifact pages; they are standalone HTML. A stage would load it from a CDN, or the office would have to serve or inline a copy.

**What a lead can do today, without code changes**
- **Classic script tag:** put `<script src="…three.min.js">` in the stage html. It blocks parsing, so `THREE` exists before the stage script. But r160 and later no longer ship `build/three.min.js`, so this pins an older version (≤0.159).
- **Modern module build:** use a dynamic `import('https://cdn.jsdelivr.net/npm/three@0.18x/build/three.module.js')` inside the classic stage script. Then `render(t)` has to be defined synchronously, no-op until three has loaded, remember the last `t`, and redraw itself once loaded. Otherwise the resting frame and the snapshot stay blank. The import counts towards `networkidle`, so it's probably done before the screenshot.
- An importmap or `type=module` script in the stage html would run after `KIT_PLAYER`, which has already captured `render`. That doesn't work unless `render` is a classic stub that hands off.
- `render(t)` should set the camera and objects from `t` and call `renderer.render()` itself (no `requestAnimationFrame` loop). The canvas has to be sized to 1050×500. `preserveDrawingBuffer: true` is a sensible choice for screenshots (my suggestion, not checked).

**Changes worth considering**
1. **GPU flags for the snapshot browser:** add WebGL-friendly launch args in `BrowserPool.launch` (`--enable-unsafe-swiftshader`, or the GPU flags from studio and perf), and a longer settle wait than 400 ms for WebGL pages. Otherwise the screen's picture of a 3D stage may be blank.
2. **Make three.js a stage option:** have `explainerPage` inject three.js as an opt-in, e.g. `stage.libs: ['three']`, loaded before the lead's script, or the office serves its bundled copy. Add a hook so `render` can be called again once async loading finishes (e.g. `window.kitRedraw()`, which calls `draw(t)` at the current `t`).
3. **Update the tool text:** the descriptions in `officeTool.ts` and `docs/goals.md` (the "Explaining things" bullet) mention only DOM and SVG stages, so leads won't think to use 3D. They need wording, and tests in `server/agents/explainer.test.ts`.

**Constraints that shape the approach**
- The dry run calls `render` about 4×`DUR` times at load (up to 240 s of beats, so up to about 960 calls). Each call has to be cheap and deterministic in `t`.
- The resting frame (`render(DUR)`) has to sum the explainer up, because it is what the 3D screen shows.
- The stage is capped at 1.5 MB, so models have to be built in code or fetched from a CDN.
- The page has to stay self-contained; it can't fetch anything from the office.
