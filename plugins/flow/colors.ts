import { LCARS } from '../../plugin-api/client';
import type { FlowState } from './shared';

/**
 * Each state of a goal's flow (README.md) as a colour, wherever it's shown (the goal board's bar, the goals list,
 * Comms): green at work, red reworking, the waits in LCARS tones, the captain in orange.
 */
export const FLOW_COLOR: Record<FlowState, string> = {
  working: '#7cc4a4',
  rework: '#ff5c5c',
  background: LCARS.periwinkle,
  qa: LCARS.lilac,
  review: LCARS.gold,
  captain: LCARS.orange,
  queued: '#6e7681',
};
