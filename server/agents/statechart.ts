import type { AnyStateMachine, AnyStateNode } from 'xstate';

// An XState machine drawn as a statechart: Mermaid's stateDiagram-v2, from the machine itself (its states, nested as
// they are, each one's transitions with their events and named guards), so a picture of a machine is never out of date
// with its code. GitHub draws it in a docs page (```mermaid), and a lead's station screen with Mermaid's script.

/** A state's id as Mermaid takes it: letters, digits and underscores. */
const mermaidId = (node: AnyStateNode): string => node.id.replace(/[^A-Za-z0-9]/g, '_');

/** The machine as a Mermaid statechart: compound states drawn round their children, final states marked as such. */
export function mermaidStatechart(machine: AnyStateMachine): string {
  const lines = ['stateDiagram-v2', '  direction LR'];
  const finals: string[] = [];
  const edges: string[] = [];

  const visit = (node: AnyStateNode, indent: string): void => {
    const id = mermaidId(node);
    const children = Object.values(node.states) as AnyStateNode[];
    if (children.length) {
      lines.push(`${indent}state "${node.key}" as ${id} {`);
      const initial = node.initial?.target[0];
      if (initial) lines.push(`${indent}  [*] --> ${mermaidId(initial)}`);
      for (const child of children) visit(child, `${indent}  `);
      lines.push(`${indent}}`);
    } else {
      lines.push(`${indent}state "${node.key}" as ${id}`);
    }
    if (node.type === 'final') finals.push(id);
    // one arrow per target and guard, with every event that takes it
    const arrows = new Map<string, { target: string; guard: string; events: string[] }>();
    for (const [event, transitions] of node.transitions) {
      for (const t of transitions) {
        const guard = typeof t.guard === 'string' ? ` [${t.guard}]` : '';
        for (const target of t.target ?? []) {
          const key = `${mermaidId(target)}${guard}`;
          const arrow = arrows.get(key) ?? { target: mermaidId(target), guard, events: [] };
          arrow.events.push(event);
          arrows.set(key, arrow);
        }
      }
    }
    for (const { target, guard, events } of arrows.values()) edges.push(`  ${id} --> ${target} : ${events.join(' | ')}${guard}`);
  };

  for (const node of Object.values(machine.root.states) as AnyStateNode[]) visit(node, '  ');
  const initial = machine.root.initial?.target[0];
  return [
    ...lines,
    ...(initial ? [`  [*] --> ${mermaidId(initial)}`] : []),
    ...edges,
    '  classDef final fill:#1d3320,stroke:#9fd39f,color:#e8e4d8',
    ...(finals.length ? [`  class ${finals.join(',')} final`] : []),
  ].join('\n');
}
