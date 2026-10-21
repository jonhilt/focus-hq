# How the 3D view runs

## Frame stats (`?stats=1`)

Open Focus with `?stats=1` to see how the 3D view is running, top left.

It's logged too: the browser sends Focus a sample of its frames each second, and each hitch with what came with it, and Focus keeps them in its data folder, a file per page load: `~/.focus/frame-stats/<when it opened>-<id>.jsonl`. The overlay's last line shows the file. A browser on another machine (a laptop over Tailscale) logs to the Focus it's looking at, so a run there can be read where that Focus runs: walk round the rooms that feel slow, then point whoever's looking into it at the file. Each line is JSON, typed in `shared/types/frameStats.ts`.

Reading it: a `hitch` lists what the frame before it added, since the slow frame is the one before's doing. A `longtask` is work that kept the main thread busy between frames, which a sample's `busy` doesn't see (a burst of Focus's messages, the garbage collector). The `bench` line showed sending a canvas to the GPU is cheap (a few hundredths of a ms per MB on an Apple M4, 0.1 ms on the AMD Renoir laptop whose log began this), so a screen that holds a frame up as it's sent does so drawing what was drawn on it.

### Telling what holds frames up

Two switches, for a run on a machine that stutters, to compare with a run without:

- `?canvas=cpu`: every screen, board and sign is drawn in software, on the main thread, rather than by the GPU as it's sent. If hitches as screens are sent go, and `busy` rises less than they took, it's the GPU drawing them.
- `?screens=still`: screens, boards and signs are drawn once and then left as they are. If hitches go, it's redrawing the screens; if they stay, it's something else (check the `longtask` lines).

`?adapt=0` holds the pixel ratio where it starts, rather than letting it drop while frames run slow, so runs compare.

## `pnpm run perf`

Walks a busy demo ship on the GPU in headless Chromium, from the bridge into a holodeck's hall and on into a briefing room, twice, and prints each step's frame times, main-thread time, shader programs linked and textures sent to the GPU. The first walk shows what walking in for the first time costs, the second what it costs every time. Run it before and after a change you expect to cost or save frame time.

## What keeps it quick

- Only the part of the ship you're in is drawn, and an open doorway's far side.
- Every shader is compiled and the baked lighting sent to the GPU before you come aboard, so walking into a room for the first time doesn't stall.
- What's through a door is got ready as you near it, its textures fed to the GPU a little each frame, rather than all in the frame the doors open.
- Screens are drawn again only when there's something new to see, and the big ones less often: sending a briefing room's viewscreen held a laptop's frame up for 70 ms. A frame draws only a couple of whole canvases: walking into a hall once drew all of its screens in one 112 ms frame.
- The pixel ratio drops while frames wait on the GPU.
