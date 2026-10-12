# How the 3D view runs

## Frame stats (`?stats=1`)

Open the office with `?stats=1` (`http://<office>:4477/?stats=1`) to see how the 3D view is running, top left: frames a second and how long each takes, the GPU's time per frame where the browser can measure it, the pixel ratio it's drawn at, draw calls, and the GPU's name.

It's logged too. The browser sends the office a sample of its frames each second, and each hitch (a frame slower than 50 ms) with what came with it. The office keeps them in its data folder, a file per page load: `~/.focus/frame-stats/<when it opened>-<id>.jsonl`. The overlay's last line shows the file. A browser on another machine (a laptop over Tailscale) logs to the office it's looking at, so a run there can be read where the office is: walk round the rooms that feel slow, then point whoever's looking into it at the file.

Each line is JSON (`shared/types/frameStats.ts`):

- **`session`**, first: the GPU, the browser, the screen and window sizes, the query string, and whether shaders compile off the main thread (`parallelCompile`) and passes can be timed on the GPU (`gpuTimer`).
- **`sample`**, a second's frames: where you were, frame times and main-thread time (median, 95th percentile, slowest), pixel ratio and size, draw calls and triangles, how many frames also drew an open doorway's far side (`door`), shader programs and textures on the GPU, pictures sent to the GPU (`uploads`, `uploadMB`), geometry sent to it (`bufferMB`), and GPU time per frame by pass (`gpu`: `screen.scene`, `screen.outlines`, `door.scene`…; `screen.final`, the pass to the screen, can include waiting for the screen).
- **`hitch`**, a slow frame: how long it took, how much of that the main thread was busy, and the shader programs, textures, pictures (`pictures`, by size, which tells you which screens they were) and geometry (`bufferKB`) the frame before it added (the slow frame is the one before's doing).
- **`bench`**, once, four seconds in: how long sending a canvas to the GPU takes in this browser, in ms per MB, the way the screens send theirs (`asNow`) and ways that might be cheaper (unflipped, premultiplied alpha, no mipmaps; `client/src/ui/uploadBench.ts`). On an Apple M4 it's a few hundredths of a ms, and on the AMD Renoir laptop whose log began this only 0.1 ms: sending is cheap, so a screen that holds a frame up as it's sent does so drawing what was drawn on it.
- **`longtask`**: each task that kept the main thread busy over 50 ms, a frame or work between frames that `busy` doesn't see (handling a burst of the office's messages, the garbage collector). A sample's `heapMB` (Chrome) is how much the page's JavaScript holds: a drop between samples is the garbage collector.

### Telling what holds frames up

Two switches, for a run on a machine that stutters, to compare with a run without:

- `?canvas=cpu`: every screen, board and sign is drawn in software, on the main thread, rather than by the GPU as it's sent. If hitches as screens are sent go, and `busy` rises less than they took, it's the GPU drawing them.
- `?screens=still`: screens, boards and signs are drawn once and then left as they are. If hitches go, it's redrawing the screens; if they stay, it's something else (check the `longtask` lines).

`?adapt=0` holds the pixel ratio where it starts, rather than letting it drop while frames run slow (`client/src/resolution.ts`), so runs compare.

## `pnpm run perf`

Walks a busy demo office on the GPU in headless Chromium, from the bridge into a holodeck's hall and on into a briefing room, twice, and prints each step's frame times, main-thread time, shader programs linked and textures sent to the GPU. The first walk shows what walking in for the first time costs, the second what it costs every time. Run it before and after a change you expect to cost or save frame time.

## What keeps it quick

- Only the part of the ship you're in is drawn (`world/regions.ts`); an open doorway draws its far side as well (`world/portal.ts`).
- Before you come aboard, `world/warmUp.ts` compiles every shader and sends the baked lighting to the GPU, so walking into a room for the first time doesn't stall.
- In a training hall, only that hall is drawn, not the other projects' halls beyond its walls.
- As you near a door (5 m; it opens at 1.75 m), what's through it is got ready: its screens are drawn, and its textures go to the GPU 2 MB a frame (`TextureFeed` in `world/warmUp.ts`), rather than all in the frame the doors open.
- A station's screen is drawn again only when there's something new to see from where you are (`world/screenRedraw.ts`); a briefing room's viewscreen at most once a second, since sending its 2400 × 1000 canvas holds a laptop's frame up for 70 ms. A busy terminal's blinking cursor sends only its own few pixels (`world/texturePatch.ts`). A station's sign, goal board, chart and the screen over its pod, and a hall's Kanban board, are drawn at most every 2 s close up (5 s further off, out of sight too, so coming into view only has to send them), though they change with every line the crew write. A frame draws at most two whole canvases (`DRAWS_PER_FRAME`): walking into a hall drew all of its screens in one 112 ms frame.
- The pixel ratio drops while frames wait on the GPU (`client/src/resolution.ts`).
