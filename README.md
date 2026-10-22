# 🏢 Welcome to the USS Focus

A cartoon, first-person 3D starship where a crew of **Claude Code** agents works through your GitHub issues, and you're the captain: each goal gets a lead you work with a slice at a time, each slice ships as pull requests, QA reviews them and you merge.

![A project holodeck: a round training hall on a beach, the Kanban display curving round the far wall, team pods round the walls with their screens over them, and the crew at their stations in the middle](docs/room.jpg)

GitHub goes through the [`gh` CLI](https://cli.github.com/). Claude runs through the Agent SDK on **your own Claude login**, so agents use your Claude subscription.

## Quick start

```bash
corepack enable     # once: provides the pnpm version package.json asks for
pnpm install
pnpm run demo       # fake GitHub + pretend agents, nothing to set up
```

Open <http://127.0.0.1:4477>, click **Come aboard**, and walk around (WASD, E to use what you're looking at).

## The real thing

1. **Node.js 20+**, with pnpm: `corepack enable`
2. **GitHub CLI**, signed in: `gh auth login`
3. **Claude Code**, signed in with your subscription: run `claude` once and `/login`, or set `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.
4. *(optional, for browser testing)* `pnpm exec playwright install chromium`

```bash
pnpm run dev        # live mode with hot reload for the 3D client
# or
pnpm run build && pnpm start
```

In your **ready room** (<kbd>M</kbd>), make a **New project** from your repos, then walk into its holodeck.

> If `ANTHROPIC_API_KEY` is set, agents ignore it and use your Claude login; `FOCUS_USE_API_KEY=1` puts them on the key. Several agents at once use your plan's limits faster: **Settings → Agents working at once** caps that (default 4). To run Focus on a Linux server, see `deploy/vps/setup.sh`.

## Working on Focus

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). [CLAUDE.md](CLAUDE.md) has the commands and rules. The docs hold what the code can't: [architecture](docs/architecture.md) (where things live), [scripts](docs/scripts.md), [invariants](docs/invariants.md), [plugins](docs/plugins.md), and the pages under `docs/` and `plugins/*/` for each part's decisions and promises.

## Licence

MIT: see [LICENSE](LICENSE). Focus runs agents through Anthropic's Claude Agent SDK, which `pnpm install` fetches under Anthropic's own terms, not this licence: you need your own Claude account and accept [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) to use it.

Focus is a fan-made homage to Star Trek, not affiliated with or endorsed by Paramount or CBS Studios, who own Star Trek and its marks.
