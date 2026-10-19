# Previewing a pull request

Every PR card under **Ready to merge** (and a finished agent's panel) has a **Preview** button. Each project has one preview at a time: previewing another PR replaces it.

1. The PR's head (`refs/pull/<n>/head`, so teammates' and forks' PRs work too) is checked out in `~/.focus/previews/<project>/<repo>`. Any other repo of the project that the preview commands mention (`{dir:<repo>}`) is checked out next to it at its default branch. The checkouts are reused from one preview to the next, so `node_modules`, `bin/obj` and other ignored build output stick around.
2. The project's **preview command** runs in the PR's checkout. Set it in the ready room (**Projects → Preview**). Leave it empty and the office runs `npm install && npm run dev` in the PR's repo (or the `start` script, with pnpm/yarn/bun if the repo has their lockfile).
3. The links come from the command's output: a JSON object with `urls` (`{"urls": {"web": "http://127.0.0.1:55686", "api": "…"}}`, a list, or a single `url`) becomes named links, web front ends before APIs. Otherwise every local URL it prints (`http://localhost:5173/`…) becomes a link. If it prints neither, the office waits for the free port it offered.
4. You get a toast with **Open ↗** once a site answers. The preview panel's sidebar picks the command's output or each log file in the folder its JSON reported as `logs` (lines mentioning errors or failures are highlighted). It also shows the links with their last health check (lit gold when a site stops answering or answers with a 5xx), **Restart** (e.g. after the agent pushed more commits; the card says when the preview is behind) and **Stop**.

| Command | |
| --- | --- |
| **Start** | Brings the site(s) up. It can stay in the foreground like a dev server, or exit once its sites are up in the background. In that case the office keeps checking that the sites still answer. If it reported its URLs as JSON and exits non-zero without saying `failed`, `error` or `stopped` (e.g. `"status": "unhealthy"`), the preview still comes up as long as one of its sites answers within 30 seconds, with a ⚠ warning. Otherwise a JSON `error` in its output (or its `status` and exit code) becomes the failure message. |
| **Stop** *(optional)* | Tears down whatever **Start** left running, like containers and background servers. It runs on **Stop**, when a preview fails, when the PR is merged or closed, when the office shuts down, and before every start, so a stack left over from a crash is never reused. After it, the office kills whatever is left of the start command's process tree. A failed preview stays on screen with its output and logs until you dismiss it. |
| **Progress** *(optional)* | Polled every 5 seconds while starting. Only its JSON output counts, not its exit code. That's either this stack's state, or a list of stacks (`{"sessions": [...]}`) where this preview's is the one that mentions its checkout paths. The `phase` shows as progress ("Starting – database-migrate"), and once the preview is up its `status` drives the ⚠ warning (`unhealthy`, then gone again at `ready`). A list is the more reliable choice: if a stack it listed drops out while still starting, whatever was running it has died, and the preview fails within about 10 seconds instead of waiting for the start command to time out. The same goes for a running stack that drops out of the list. A start command can also print JSON lines with a `phase` itself. |

| Placeholder | |
| --- | --- |
| `{dir}` | the PR's checkout (also the working directory) |
| `{dir:<repo>}` | that repo's checkout (name or owner/name): the PR's code if the PR is in it, its default branch otherwise |
| `{port}`, `$FOCUS_PREVIEW_PORT` | a free port |
| `{pr}`, `{repo}` | the PR number and owner/name |

`PORT` is only set for the auto-detected npm command, so a CLI that starts several sites doesn't hand them all one port.

A project whose API, web app and admin app live in three repos and come up with one script might use:

```
Start     {dir:shop-api}/scripts/stack up --api {dir:shop-api} --web {dir:shop-web} --admin {dir:shop-admin}
Stop      {dir:shop-api}/scripts/stack down --api {dir:shop-api} --web {dir:shop-web} --admin {dir:shop-admin}
Progress  {dir:shop-api}/scripts/stack list
```

## From another machine

A preview's sites listen on the office's machine, often only on loopback, so their links (`http://localhost:5173/`) only open there. For a browser on another machine of your tailnet (the office on a server, or on your Mac opened from a laptop), the office mirrors each site's port onto the machine's [Tailscale](https://tailscale.com) addresses once the site answers, and closes the mirror when the preview stops. The mirror hands requests and WebSocket upgrades (hot reload) through to the site as if they came from `localhost`, so dev servers that refuse other names, like Vite, let them in. The sites themselves stay on loopback, out of reach of anything but your tailnet.

The links then open at the mirror: the same port, at the name you reached the office by (`http://my-server:5173/`). In a browser on the office's own machine they stay as they are. A site that already listens on every address (`0.0.0.0`) is reached directly instead.

The mirrors are plain http unless the office has a certificate. Without one, a previewed site can't use what browsers keep for secure pages (the microphone, service workers, the clipboard). To make them https, get the machine's certificate from Tailscale (HTTPS certificates switched on for the tailnet), into the office's data folder:

```
tailscale cert --cert-file ~/.focus/tls/preview.crt --key-file ~/.focus/tls/preview.key <machine>.<tailnet>.ts.net
```

The links then use the certificate's name (`https://<machine>.<tailnet>.ts.net:5173/`). The certificate lasts 90 days: run it again before then (each mirror reads it as it opens). `FOCUS_PREVIEW_HOSTS` mirrors onto other addresses instead (`off` for none), and `FOCUS_PREVIEW_CERT` / `FOCUS_PREVIEW_KEY` point at a certificate elsewhere. The mirror is `server/previewMirrors.ts`.

The commands run through your shell (so `&&` and `npm` on Windows work), on your machine, as you. A preview runs the PR's code, so only preview PRs you'd be happy to run locally.
