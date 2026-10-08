# Scripts

| | |
| --- | --- |
| `npm run demo` | demo mode with hot reload |
| `npm run dev` | live mode with hot reload |
| `npm run build` | build the client into `dist/` |
| `npm start` | serve `dist/` in live mode |
| `npm run typecheck` | `tsc` over server, client and shared code |
| `npm test` | unit tests (vitest) for the pure decision code: QA verdicts, badges, prompts |
| `npm run smoke` | headless Playwright check of the splash screen in demo mode (screenshots in `smoke-shots/`) |
| `npm run zfight` | optional, on-demand headless scan of the demo office's 3D scene for z-fighting (coplanar faces from different meshes); fails listing each pair |
| `npm run gaps` | optional, on-demand headless scan of the demo office's 3D scene for gaps (faces from different meshes facing each other 2 mm to 5 cm apart, like a panel hovering off its wall); fails listing each pair |
