# Architecture

Where things live, by folder. What a file does is in the file.

```
shared/              pure logic and types shared by server and client (shared/types/, a file per feature)
server/              express + WebSocket (/ws), the store (~/.focus/), REST routes, previews, auto update
  github/            GitHub as an Effect service: gh CLI (live), in memory (demo)
  plugins/           what a plugin is to Focus, and loading the ones FOCUS_PLUGINS names (docs/plugins.md)
  agents/            the agents: Claude Code sessions, journals, QA, leads, workspaces, Ops' MCP tools
    manager/         AgentManager's parts, a concern each (seating, sessions, delivery, conflicts, leads, slices, reviews…)
client/src/          the 3D client: renderer, loop and input (main.ts), walking (player.ts)
  world/             the ship, holodecks, stations, characters, screens
  ui/                HUD and panels
  tricorder/         the phone view at /tricorder (no three.js)
plugin-api/          all a plugin may import of Focus
plugins/             what Focus does beyond its core, a folder per plugin
tools/               dev tooling, never part of the running Focus (demo ship, bug corpus, replays, ship build)
deploy/vps/          running Focus on a Linux server over Tailscale
blender/             the scripts that build the decks; client/public/ship/ holds the GLBs they write
```

The client mirrors server state over the WebSocket; every action is a small REST call. Screens are canvases drawn into textures and redrawn only when something changes and you can see them (`world/screenRedraw.ts`), since each drawing sends the whole canvas to the GPU again. `world/warmUp.ts` compiles the ship's shaders before you come aboard, so the first step into a room doesn't stall.
