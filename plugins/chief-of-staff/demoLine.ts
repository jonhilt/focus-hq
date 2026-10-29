import { demoPace, randomHex, sleep } from '../../plugin-api/server';
import type { LineOfficer, LineReply, LineTurn } from './line';

// The demo ship's direct line: scripted. Asked to build something, it starts a goal in the project named (or the first
// on the line) through the line's own tool, as the live one would; told something about an open goal by its title, it
// tells that goal's lead; otherwise it talks.

/** What the user said last, as the prompt quotes it. */
const lastSaid = (prompt: string): string => /The user says:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1]?.trim() ?? '';

/** The projects and goals on the line, as the prompt lists them. */
function listed(prompt: string): { projects: { id: string; name: string }[]; goals: { id: string; title: string }[] } {
  const projects = [...prompt.matchAll(/^- (.+) \(id ([^)]+)\)/gm)].map((m) => ({ name: m[1] ?? '', id: m[2] ?? '' }));
  const goals = [...prompt.matchAll(/^ {2}- (\S+): “(.+?)”/gm)].map((m) => ({ id: m[1] ?? '', title: m[2] ?? '' }));
  return { projects, goals };
}

export class DemoLine implements LineOfficer {
  async turn(req: LineTurn, activity: (text: string) => void): Promise<LineReply> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / demoPace());
      if (req.signal.aborted) throw new Error('Stopped');
    };
    const said = lastSaid(req.prompt);
    const q = said.toLowerCase();
    const { projects, goals } = listed(req.prompt);
    const reply = (text: string): LineReply => ({ text, sessionId: req.resumeSessionId ?? `demo-line-${randomHex(3)}`, costUsd: 0.03 });
    const tool = (name: string) => req.tools.find((t) => t.name === name);
    activity('Thinking it over');
    await wait(1);
    const goal = goals.find((g) => q.includes(g.title.toLowerCase()));
    if (goal) {
      activity('Telling a goal’s lead');
      await tool('tell_goal')?.run({ leadId: goal.id, text: said });
      return reply(`That fits “${goal.title}”, which is open already, so I told its lead rather than starting another goal.`);
    }
    if (/\b(build|add|make|start|we need|let'?s|fix)\b/.test(q)) {
      const project = projects.find((p) => q.includes(p.name.toLowerCase())) ?? projects[0];
      if (!project) return reply('There’s no project on my line to start that in: switch me on for one first.');
      activity('Starting a goal');
      const why = 'You asked for it, and it isn’t part of any goal that’s open.';
      const answer = await tool('start_goal')?.run({ projectId: project.id, text: said, why });
      await wait(0.5);
      return reply(answer?.startsWith('You started that goal already') ? `That's under way already in ${project.name}, so I didn't start it again.` : `I started it in ${project.name}: ${why} Close it from here if that's not what you meant.`);
    }
    return reply('Understood. Say the word when it’s something to build, and I’ll put it in the right project: an open goal if it fits one, a new goal if not.');
  }
}
