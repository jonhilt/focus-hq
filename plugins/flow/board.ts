import { type GoalStrip, pluginState } from '../../client/src/plugins';
import { fitText, UI_FONT } from '../../client/src/world/canvas';
import type { Box } from '../../client/src/world/msd';
import { LCARS_FONT } from '../../client/src/world/starship';
import type { Agent } from '../../shared/types';
import { FLOW_COLOR } from './colors';
import { FLOW, type FlowPluginState, type LeadFlow } from './shared';
import { flowNow, flowShares, flowSummary } from './words';

const DIM = '#6e7681';
const BODY = '#e6edf3';
/** The strip's height on the board, a gap above it included. */
const HEIGHT = 112;
const GAP = 14;

/** Along the bottom of the goal's board, its flow (README.md), once there's one: the board counts it up each minute. */
export function flowStrip(lead: Agent): GoalStrip | null {
  const flow = pluginState<FlowPluginState>(FLOW)?.leads[lead.id];
  return flow ? { height: HEIGHT, key: [flow.now, flow.active], draw: (ctx, box) => drawFlow(ctx, flow, box) } : null;
}

/**
 * What the goal's waiting on now and for how long (and why, when it's you), then a bar of where its time has gone
 * while someone was around, and that in words.
 */
function drawFlow(ctx: CanvasRenderingContext2D, flow: LeadFlow, { x, y: top, w }: Box): void {
  const y = top + GAP;
  const now = flowNow(flow, Date.now());
  ctx.fillStyle = '#232a3a';
  ctx.fillRect(x, y, w, 3);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let cx = x;
  const put = (text: string, font: string, color: string) => {
    ctx.font = font;
    ctx.fillStyle = color;
    const t = fitText(ctx, text, x + w - cx);
    ctx.fillText(t, cx, y + 46);
    cx += ctx.measureText(t).width + 18;
  };
  put(now.words.toUpperCase(), `600 36px ${LCARS_FONT}`, FLOW_COLOR[now.state]);
  put(now.for.toUpperCase(), `600 36px ${LCARS_FONT}`, BODY);
  if (now.why) put(now.why, `26px ${UI_FONT}`, DIM);
  const by = y + 62;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, by, w, 16, 8);
  ctx.clip();
  ctx.fillStyle = '#232a3a';
  ctx.fillRect(x, by, w, 16);
  let sx = x;
  for (const s of flowShares(flow, Date.now())) {
    ctx.fillStyle = FLOW_COLOR[s.state];
    ctx.fillRect(sx, by, s.share * w, 16);
    sx += s.share * w;
  }
  ctx.restore();
  ctx.font = `20px ${LCARS_FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(fitText(ctx, flowSummary(flow, Date.now()).toUpperCase(), w), x, by + 42);
}
