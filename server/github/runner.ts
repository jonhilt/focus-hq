import { execFile, type ExecFileException } from 'node:child_process';
import { Context, Data, Effect, Layer, Schema } from 'effect';

const TIMEOUT_MS = 120_000;

const describe = (args: readonly string[]) => `gh ${args.slice(0, 3).join(' ')}`;
const lastLines = (text: string) => text.trim().split('\n').slice(-6).join('\n');

export class GhNotInstalled extends Data.TaggedError('GhNotInstalled') {
  override get message() {
    return 'the GitHub CLI (gh) is not installed or not on the PATH';
  }
}

export class GhNotAuthenticated extends Data.TaggedError('GhNotAuthenticated')<{ stderr: string }> {
  override get message() {
    return 'gh is not logged in to GitHub';
  }
}

export class GhCommandFailed extends Data.TaggedError('GhCommandFailed')<{ args: readonly string[]; stderr: string; exitCode: number | null }> {
  override get message() {
    return `${describe(this.args)} failed: ${lastLines(this.stderr)}`;
  }
}

export class GhTimedOut extends Data.TaggedError('GhTimedOut')<{ args: readonly string[]; timeoutMs: number }> {
  override get message() {
    return `${describe(this.args)} timed out after ${this.timeoutMs / 1000}s`;
  }
}

/** gh succeeded but printed something we can't read: broken JSON, JSON of the wrong shape, or no URL where one was due. */
export class GhBadOutput extends Data.TaggedError('GhBadOutput')<{ args: readonly string[]; output: string; reason: string }> {
  override get message() {
    return `${describe(this.args)} printed output Focus couldn't read: ${this.reason}`;
  }
}

export type GhCommandError = GhNotInstalled | GhNotAuthenticated | GhCommandFailed | GhTimedOut;

export function classify(args: readonly string[], err: ExecFileException, stderr: string): GhCommandError {
  if (err.code === 'ENOENT') return new GhNotInstalled();
  // gh exits with 4 when a command needs a login; older versions only say so on stderr
  if (err.code === 4 || /gh auth login/.test(stderr)) return new GhNotAuthenticated({ stderr });
  // Node's own message (e.g. output too big) when gh printed nothing
  return new GhCommandFailed({ args, stderr: stderr || err.message, exitCode: typeof err.code === 'number' ? err.code : null });
}

/** Runs `gh` without a shell, with stdin input, and resolves with stdout. Interrupting it kills the process. */
export class GhRunner extends Context.Service<GhRunner, {
  run(args: readonly string[], input?: string): Effect.Effect<string, GhCommandError>;
}>()('focus/github/GhRunner') {
  static readonly layer = Layer.succeed(GhRunner, GhRunner.of({
    run: (args, input) =>
      Effect.callback<string, GhCommandError>((resume, signal) => {
        const child = execFile('gh', args, { maxBuffer: 64 * 1024 * 1024, env: process.env, signal }, (err, stdout, stderr) => {
          resume(err ? Effect.fail(classify(args, err, stderr)) : Effect.succeed(stdout));
        });
        if (input !== undefined) child.stdin?.end(input);
      }).pipe(
        Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(new GhTimedOut({ args, timeoutMs: TIMEOUT_MS })) }),
      ),
  }));
}

/** Decodes gh's JSON output against a schema instead of trusting it with a cast. */
export const decodeJson = <T>(schema: Schema.Decoder<T>, args: readonly string[]) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
  return (output: string) => decode(output).pipe(Effect.mapError((e) => new GhBadOutput({ args, output, reason: e.message })));
};
