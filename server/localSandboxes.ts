import fs from 'node:fs';
import path from 'node:path';
import { Effect, Layer } from 'effect';
import { paths } from './config';
import { PreviewMachine } from './previewMachine';
import { Sandboxes } from './sandbox';

const shortName = (repo: string) => repo.split('/')[1] ?? repo;

/** data/previews/<key>/<repo name>, or <owner>__<name> when two repos in the project share a name. */
function previewDir(key: string, repo: string, repos: readonly string[]): string {
  const clash = repos.some((r) => r !== repo && shortName(r).toLowerCase() === shortName(repo).toLowerCase());
  return path.join(paths.previews, key, clash ? repo.replace('/', '__') : shortName(repo));
}

/**
 * The first kind of sandbox: a folder under data/previews and a free port on this machine, run by `PreviewMachine`.
 *
 * Releasing one leaves its folders where they are, so the project's next preview fetches into its checkouts rather
 * than cloning again; only `remove` deletes them. A key's sandboxes all share its folders, so two at once for one key
 * would trip over each other: `Previews` keeps one per project.
 */
const layer: Layer.Layer<Sandboxes, never, PreviewMachine> = Layer.effect(
  Sandboxes,
  Effect.gen(function* () {
    const machine = yield* PreviewMachine;
    return Sandboxes.of({
      acquire: (key, repos) =>
        Effect.gen(function* () {
          const dir = (repo: string) => previewDir(key, repo, repos);
          return {
            dir,
            port: yield* Effect.cached(machine.freePort),
            checkout: (repo, ref) => machine.checkout(repo, dir(repo), ref),
            spawn: (command, options) => machine.spawn(command, options),
            signal: (pid, signal) => machine.signal(pid, signal),
            probe: (url) => machine.probe(url),
          };
        }),
      remove: (key) => Effect.sync(() => fs.rmSync(path.join(paths.previews, key), { recursive: true, force: true })),
    });
  }),
);

/** Sandboxes on this machine, run by `machine` (a stand-in in tests). */
export const localSandboxes = (machine: Layer.Layer<PreviewMachine> = PreviewMachine.layer): Layer.Layer<Sandboxes> =>
  layer.pipe(Layer.provide(machine));
