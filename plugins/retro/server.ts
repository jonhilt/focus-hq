// The retro plugin: the chief engineer at the engineering station looks back over the frictions found in
// the agents' sessions and drafts an issue for each that keeps coming back, for the captain to accept (it's filed) or
// reject. FOCUS_PLUGINS=retro.
import type { FocusPlugin } from '../../plugin-api/server';
import { ClaudeEngineer } from './claudeEngineer';
import { DemoEngineer } from './demoEngineer';
import { ChiefEngineer } from './engineer';
import { freshRetro, RETRO, type Retro } from './shared';

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const retro: FocusPlugin = {
  id: RETRO,
  start(host) {
    // the demo's engineer is scripted, and pauses only a moment between batches
    const engineer = new ChiefEngineer(
      host,
      host.state<Retro>(freshRetro),
      host.demo ? new DemoEngineer() : new ClaudeEngineer((run) => host.readOnlySession(run)),
      // what each retro gathered, in the plugin's own folder (kept in Focus's retros/ before it was a plugin)
      host.dataDir({ movedFrom: 'retros' }),
      host.demo ? 500 : 20_000,
    );
    return {
      routes: [
        { method: 'post', path: '/preview', handle: ({ body }) => engineer.preview(Number(body.days ?? 14)) },
        { method: 'post', path: '/start', handle: ({ body }) => engineer.start(Number(body.days ?? 14)) },
        { method: 'post', path: '/stop', handle: () => engineer.stop() },
        { method: 'post', path: '/decide', handle: ({ body }) => engineer.decide(String(body.id ?? ''), body.accept === true, text(body.projectId), text(body.repo)) },
      ],
    };
  },
};

export default retro;
