import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../../plugin-api/server';
import type { RetroOfficer, RetroRequest } from './engineer';

/** The demo's chief engineer: takes a moment over the frictions, then drafts an issue for each group it was given. */
export class DemoEngineer implements RetroOfficer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  /** Finds the port clash the scripted sessions all run into, quoting it. */
  async read(req: { prompt: string; signal: AbortSignal }): Promise<{ structured: unknown; costUsd?: number }> {
    await sleep(800 / this.speed);
    if (req.signal.aborted) throw new Error('Stopped');
    const spans = [...req.prompt.matchAll(/<span id="([^"]+)">\n([\s\S]*?)\n<\/span>/g)].map(([, id, text]) => {
      const clash = /EADDRINUSE: address already in use :::\d+/.exec(text)?.[0];
      return { id, frictions: clash ? [{ kind: 'demo-env', signature: 'demo port in use', quote: clash }] : [] };
    });
    return { structured: { spans }, costUsd: 0.02 };
  }

  async retro(req: RetroRequest, activity: (text: string) => void): Promise<{ structured: unknown; text: string; costUsd?: number }> {
    const groups = [...fs.readFileSync(path.join(req.cwd, 'frictions.md'), 'utf8').matchAll(/^## (G\d+): (\S+): (.+) \((\d+) sessions\)$/gm)];
    for (const step of ['Reading frictions.md', 'Reading ledger.md', 'Drafting']) {
      activity(step);
      await sleep(1200 / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    }
    return {
      text: `${groups.length} drafts.`,
      costUsd: 0.05,
      structured: {
        summary: `A quiet stretch, but the same trouble came up again and again: ${groups.map((g) => g[3]).join(', ')}.`,
        drafts: groups.map(([, id, kind, signature, sessions]) => ({
          groups: [id],
          title: kind === 'demo-env' ? 'Give each workspace its own demo port' : `Stop “${signature}” recurring`,
          body: `Agents keep hitting “${signature}” (${kind}): it came up in ${sessions} sessions, each time costing a few tool calls and a restart.\n\n## What to build\n- The office passes each workspace a free PORT, and \`npm run demo\` uses it.\n\n## Done when\n- Two demos in two workspaces start side by side without a clash.`,
          kind: 'check',
          measure: `Sessions with “${signature}”: ${sessions} this time.`,
        })),
      },
    };
  }
}
