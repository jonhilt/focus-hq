# On your phone (Tricorder)

The office also serves a phone-sized page, the **Tricorder**, at `/tricorder`. It shows what needs you (raised hands, agents in trouble, goals' leads waiting for your reply or ready to wrap up, PRs QA gave up on, conflicting PRs: the same rule as [Comms](comms.md)), each project's agents in flight, its PRs and its issues. From there you can open an agent's terminal and browser, approve or decline, message or stop them, merge, send a PR to QA, hand its conflicts to an agent, and assign an agent to an issue.

| | | | |
| --- | --- | --- | --- |
| ![The Tricorder's home screen](tricorder-home.jpg) | ![An agent's terminal, with a raised hand pinned on top](tricorder-agent.jpg) | ![An agent's browser tab](tricorder-browser.jpg) | ![Pull requests and their actions](tricorder-prs.jpg) |

The office only listens on `127.0.0.1`, so reach it from your iPhone over [Tailscale](https://tailscale.com):

1. Install Tailscale on the Mac and on the iPhone, and sign both in to the same tailnet.
2. On the Mac, with the office running, run `tailscale serve --bg 4477`. This puts the office on your tailnet over HTTPS (the office answers names under `.ts.net`; another name needs `FOCUS_ALLOWED_HOSTS`, see [configuration](configuration.md#who-the-office-answers)) (`tailscale serve status` shows the address, `tailscale serve reset` takes it down).
3. On the iPhone, open `https://<mac>.<tailnet>.ts.net/tricorder` in Safari, then **Share → Add to Home Screen**. It opens full screen from there, and reconnects when you come back to it.

Anyone on your tailnet who can reach the Mac can control the office, and the office runs agents as you, with your GitHub credentials. The API has no login of its own: the tailnet is the only lock, so don't share the machine with people you wouldn't hand your laptop to.
