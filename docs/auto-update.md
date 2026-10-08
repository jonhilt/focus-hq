# Auto update

`npm run dev` and `npm start` keep the office on the latest code. Every few minutes the office fetches the branch your Focus checkout tracks (usually `origin/main`). When new commits land there, it waits until no agent is busy, fast-forwards, runs `npm install` if dependencies changed and rebuilds the client (`npm start` only). Then it restarts, and open browser tabs reload on their own. It skips the update when the checkout has local commits or uncommitted changes, and it stays off in demo mode.
