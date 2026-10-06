import type { EngineeringOption, EngineeringReport } from './types';

// How the ship's engineer's options read, wherever they're shown or passed on: the briefing panel, the lounge's wall
// screen, the officer's prompt and the issue.

/** "Option A", "Option B"… by position in the report. */
export const optionLabel = (index: number): string => `Option ${String.fromCharCode(65 + index)}`;

/** One option as Markdown, for a prompt or an issue's Context. */
export function optionText(option: EngineeringOption): string {
  const list = (label: string, items: string[]) => (items.length ? [`${label}:\n${items.map((i) => `- ${i}`).join('\n')}`] : []);
  return [
    `**${option.title}** (${option.size})`,
    option.approach,
    ...list('Touches', option.touches),
    ...list('Trade-offs', option.tradeoffs),
    ...list('Risks', option.risks),
  ].join('\n\n');
}

/** Every option, labelled, then the recommendation. */
export function reportText(report: EngineeringReport): string {
  const options = report.options.map((o, i) => `${optionLabel(i)}: ${optionText(o)}`).join('\n\n');
  return `${options}\n\nRecommended: ${optionLabel(report.recommended)}. ${report.why}`;
}

/** What the engineer says at the table when the options are in. */
export function recommendation(report: EngineeringReport): string {
  const pick = report.options[report.recommended];
  return `${report.options.length} options on the screen. I’d go with ${optionLabel(report.recommended)}, ${pick.title}: ${report.why}`;
}
