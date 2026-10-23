## Works out the acceptance criteria

Read the PR description and the linked issue, and work out the acceptance criteria. Check every one.

## Reviews the diff as a careful reviewer would

Review the code as a careful reviewer would: `git diff origin/main...HEAD`. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, new logic without tests, and new tests that run code without checking what it does (they raise coverage but catch nothing).

## Runs the checks

Install dependencies if needed, then run these checks: `pnpm run typecheck`, `pnpm test`, and anything else the repo's CLAUDE.md asks.

## Reads every changed line no test exercises

Then go through every file the diff changes (`git diff --stat origin/main...HEAD` lists them all: however many there are, don't pick a few), and find those whose changes no test exercises. Scripts, schemas, prompts and config often aren't tested, and a coverage report may not reach them. Read each of those files' changed lines one by one: a green suite says nothing about them, and they're where bugs get through. For each line, ask what input or state makes it wrong: a comparison off by one, a condition or guard the wrong way round, an argument or index read from the wrong place, a flag, default or schema setting flipped. A real bug there fails the PR like any other: name its file and line. Your report's files lists every changed file, none left out: the tests that exercise it (or none) and what you checked.

## Clicks through UI changes in a browser

If the change touches a web UI, start its dev server in the background and exercise the change with the mcp__browser__ tools: click through it, try the edge cases, and check the console for errors. Stop the server afterwards.
   Call mcp__browser__screenshot on each state that shows the change working or failing: the last 8 go on the pull request with your report, each with the caption you give it.
   Your browser is recorded, and the recording goes on the pull request with your report, edited down: each browser action at real speed, the waits between them fast-forwarded. So walk through the change in the browser as you would show it to a reviewer, one step at a time, ending on the state that proves it works (or doesn't).

## Probes with throwaway scripts

You may write throwaway scripts to probe behaviour, but don't commit them. Put throwaway files and folders (probe scripts, scratch repos, test output you won't commit) in `$FOCUS_SCRATCH`, never in the repo or /tmp. Don't clean them up: Ops deletes the folder when you finish. If you need something in it gone sooner, `rm -rf "$FOCUS_SCRATCH/<path>"` is the one `rm -rf` allowed, on its own (not chained with other commands). To wait for something (a server to answer, a build to finish, a line in a log), don't write `sleep N; <check>`: Claude Code refuses a foreground sleep. Run `focus-wait --until '<check>' --timeout 120` instead (e.g. `focus-wait --until 'curl -sf -m 2 localhost:4477/api/state >/dev/null' --timeout 120`): it runs the check every 2 s (`--every`), returns as soon as it passes, and fails with the check's last output when time runs out.