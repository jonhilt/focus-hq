# Settings

Where Focus keeps what the captain sets, and why. Most people clone Focus and run it on their own machine, so setting something shouldn't mean editing a shell profile and restarting.

## Three places

- **Settings** (`state.json`, `server/settings.ts`): the captain's choices, set in the ready room, the machine's own among them (auto update, the terminal for cloud sessions, the browser agents drive, where previews are mirrored for your other devices, and in the Voice input card where whisper and its model are and whether the crew's voices use the Apple GPU). They're sent to every browser and lent to every plugin (`host.settings()`), so nothing secret goes here.
- **Secrets** (`secrets.env` in the data folder, `server/secrets.ts`): what mustn't reach a browser or an agent: the bot's token, its webhook (often a secret in its path) and the webhook's header, and the API keys plugins declare (number-one's OpenAI and TypeSafe keys, set in its card in the Plugins tab). Set from Settings, which only ever hears where each comes from, never the value; or edited by hand, read as Focus starts.
- **The environment**: what Focus needs before it can read either (`FOCUS_DATA_DIR`, `PORT`, `HOST`, `FOCUS_ALLOWED_HOSTS`), and knobs for working on Focus itself. An environment variable named for a setting or secret wins over it, and Settings shows it as set there, unchangeable from the browser: a server's env file (`deploy/vps/env.example`) keeps working as it did.

## Promises

Held in `server/secretsInvariants.test.ts`, `server/secrets.test.ts`, `server/focus.pluginSecrets.test.ts`, `server/settingsInvariants.test.ts` and `server/focus.settings.test.ts`:

- What you set in Settings is kept across a restart, and what you clear stays cleared.
- A secret is never sent to a browser: Focus's info says only where each comes from (and the webhook's host).
- A secret is never put in Focus's environment, which every agent's session is handed a copy of; and one set there by hand (a shell profile, a server's env file) isn't handed on to what Focus starts: agents, a preview's dev server, a pull request's checks, git and gh (`withoutSecrets`).
- The file is readable by its owner alone, and changing one name from Settings keeps the rest of it (comments, other names) as it was.
- An environment variable wins. Settings refuses to change a secret one sets; for a setting (`SETTINGS_ENV`), Focus goes by `settingsInForce`, whatever's saved, and Settings shows it as set there, its field locked (`settingsPinned`).

## Rejected

- **Secrets in `state.json`**: it's sent to the browser and lent to plugins, and copied into backups.
- **A `.env` loaded into `process.env`**: the usual way, but every agent's Claude Code session is started with a copy of Focus's environment, so every agent (and every command it runs) could read the secrets. `secrets.env` has a `.env`'s format, so it reads as one, but it's parsed (`util.parseEnv`), not loaded.
- **The OS keychain**: there's none on a headless server, and it means a different way on each platform.
