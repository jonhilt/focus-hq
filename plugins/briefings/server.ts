// The briefings plugin (README.md): the lead's explain tool, an animated explainer of a concept on their station's
// screen in the office's LCARS player; and the captain's questions about one up close, which the lead answers between
// turns and the quick answerer while they're busy. Its browser part narrates a briefing and asks about it.
// FOCUS_PLUGINS=briefings, and switched on in each project's settings.
import type { FocusPlugin, ResumeHow } from '../../plugin-api/server';
import { BriefingDesk } from './desk';
import { z } from 'zod';
import { explainerPage } from './explainer';
import { explainShape, explainTool } from './explainTool';
import { ClaudeQuickAnswerer, DemoQuickAnswerer } from './quickAnswer';
import { BRIEFINGS, briefingSpot } from './shared';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const how = (v: unknown): ResumeHow | undefined => (v === 'key' || v === 'wait' ? v : undefined);

const briefings: FocusPlugin = {
  id: BRIEFINGS,
  start(host) {
    const desk = new BriefingDesk(host, host.demo ? new DemoQuickAnswerer() : new ClaudeQuickAnswerer(host));
    return {
      leadTools: [explainTool],
      routes: [
        // a question about a lead's briefing, up close: the lead answers it, or the quick answerer while they're busy
        {
          method: 'post',
          path: '/ask',
          handle: ({ body }) => desk.ask(text(body.lead), { briefing: text(body.briefing), spot: briefingSpot(body.spot), question: text(body.question), how: how(body.how) }),
        },
        // an explainer's player page from its input, as the explain tool would put it up: for the studio's recorder
        {
          method: 'post',
          path: '/page',
          handle: ({ body }) => {
            const page = explainerPage(z.object(explainShape).parse(body));
            if ('error' in page) throw new Error(page.error);
            return page;
          },
        },
      ],
    };
  },
};

export default briefings;
