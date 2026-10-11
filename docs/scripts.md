# Scripts

Focus installs with pnpm (`corepack enable`, then `pnpm install`).

| | |
| --- | --- |
| `pnpm run demo` | demo mode with hot reload |
| `pnpm run dev` | live mode with hot reload |
| `pnpm run build` | build the client into `dist/` |
| `pnpm start` | serve `dist/` in live mode |
| `pnpm run typecheck` | `tsc` over server, client and shared code |
| `pnpm test` | unit tests (vitest) for the pure decision code: QA verdicts, badges, prompts |
| `pnpm run crap` | [CRAP scores](crap.md): runs the unit tests with coverage and lists the functions riskiest to change (complexity against coverage); `--changed` adds what the branch touched |
| `pnpm run smoke` | headless Playwright check of the splash screen in demo mode (screenshots in `smoke-shots/`) |
| `pnpm run perf` | optional, on-demand: walks a busy demo office on the GPU in headless Chromium, from the bridge into a holodeck's hall and on into a briefing room, twice, and prints each step's frame times, main-thread time, shader programs linked and textures sent to the GPU (the first walk is what walking in for the first time costs, the second what it costs every time) |
| `pnpm run studio <scene>` | films a scene script (`scenes/*.yaml`) against a demo office: a 1080p rough cut and a beat sheet in `studio-out/<scene>/`; `--voice <file>` mixes a voiceover into `final.mp4` ([the TV studio](studio.md)) |
| `pnpm run zfight` | optional, on-demand headless scan of the demo office's 3D scene for z-fighting (coplanar faces from different meshes); fails listing each pair. |
| `pnpm run gaps` | optional, on-demand headless scan of the demo office's 3D scene for gaps (faces from different meshes facing each other 2 mm to 5 cm apart, like a panel hovering off its wall); fails listing each pair. |
