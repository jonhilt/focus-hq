# How the 3D view runs

## Frame stats (`?stats=1`)

Open the office with `?stats=1` (`http://<office>:4477/?stats=1`) to see how the 3D view is running, top left: frames a second and how long each takes, the GPU's time per frame where the browser can measure it, the pixel ratio it's drawn at, draw calls, and the GPU's name.

It's logged too. The browser sends the office a sample of its frames each second, and each hitch (a frame slower than 50 ms) with what came with it. The office keeps them in its data folder, a file per page load: `~/.focus/frame-stats/<when it opened>-<id>.jsonl`. The overlay's last line shows the file. A browser on another machine (a laptop over Tailscale) logs to the office it's looking at, so a run there can be read where the office is: walk round the rooms that feel slow, then point whoever's looking into it at the file.

Each line is JSON (`shared/types/frameStats.ts`):

- **`session`**, first: the GPU, the browser, the screen and window sizes, the query string, and whether shaders compile off the main thread (`parallelCompile`) and passes can be timed on the GPU (`gpuTimer`).
- **`sample`**, a second's frames: where you were, frame times and main-thread time (median, 95th percentile, slowest), pixel ratio and size, draw calls and triangles, how many frames also drew an open doorway's far side (`door`), shader programs and textures on the GPU, pictures sent to the GPU (`uploads`, `uploadMB`), and GPU time per frame by pass (`gpu`: `screen.scene`, `screen.outlines`, `door.scene`…; `screen.final`, the pass to the screen, can include waiting for the screen).
- **`hitch`**, a slow frame: how long it took, how much of that the main thread was busy, and the shader programs, textures and pictures the frame before it added (the slow frame is the one before's doing).

`?adapt=0` holds the pixel ratio where it starts, rather than letting it drop while frames run slow (`client/src/resolution.ts`), so runs compare.

## `pnpm run perf`

Walks a busy demo office on the GPU in headless Chromium, from the bridge into a holodeck's hall and on into a briefing room, twice, and prints each step's frame times, main-thread time, shader programs linked and textures sent to the GPU. The first walk shows what walking in for the first time costs, the second what it costs every time. Run it before and after a change you expect to cost or save frame time.

## What keeps it quick

- Only the part of the ship you're in is drawn (`world/regions.ts`); an open doorway draws its far side as well (`world/portal.ts`).
- Before you come aboard, `world/warmUp.ts` compiles every shader and sends the baked lighting to the GPU, so walking into a room for the first time doesn't stall.
- A station's screen is drawn again only when there's something new to see from where you are (`world/screenRedraw.ts`).
- The pixel ratio drops while frames wait on the GPU (`client/src/resolution.ts`).
