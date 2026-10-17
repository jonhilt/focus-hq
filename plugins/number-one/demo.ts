// The demo office's Number One (README.md): scripted, on the demo's ship.
import type { NumberOneOfficer, NumberOneReply, NumberOneTurn } from './chat';
import { DEMO_FILES as FILES, randomHex, sleep } from '../../plugin-api/server';

/** The repo a demo conversation is about, and the made-up files it talks about. */
function demoCode(repos: string[]): { repo: string; files: string[]; folder: string } {
  const repo = repos.find((r) => /web|front|app|game|dodger/.test(r)) ?? repos[0];
  const kind = /api/.test(repo) ? 'api' : /game|dodger/.test(repo) ? 'game' : 'web';
  return { repo, files: FILES[kind], folder: repo.split('/')[1] };
}

/**
 * The demo Number One: reads the ship's real (demo) state for "what's going on", pretends to read a project's code or an
 * agent's worktree, and suggests work when the captain sounds like they want something built.
 */
export class DemoNumberOne implements NumberOneOfficer {
  private speed = Number(process.env.FOCUS_DEMO_SPEED ?? 1);

  async turn(req: NumberOneTurn, activity: (text: string) => void): Promise<NumberOneReply> {
    const wait = async (seconds: number) => {
      await sleep((seconds * 1000) / this.speed);
      if (req.signal.aborted) throw new Error('Stopped');
    };
    const asked = req.messages.filter((m) => m.from === 'manager').at(-1)?.text.replace(/\s+/g, ' ').trim() ?? '';
    const q = asked.toLowerCase();
    const said = (text: string, spoken: string, costUsd = 0.04): NumberOneReply => ({ text, spoken, sessionId: req.resumeSessionId ?? `demo-one-${randomHex(3)}`, costUsd });
    const project = req.projects.find((p) => q.includes(p.name.toLowerCase()) || p.repos.some((r) => q.includes(r.split('/')[1]))) ?? req.projects.find((p) => p.repos.length);
    activity('Thinking…');
    await wait(1);

    if (/going on|status|stuck|happening|needs me|who'?s/.test(q)) {
      activity('Checking the ship’s status');
      const ship = await req.shipStatus();
      await wait(1.2);
      const rooms = ship.projects.map((p) => {
        const working = p.agents.filter((a) => a.task !== 'review').map((a) => `${a.name} on ${a.issue} (${a.activity})`);
        const prs = p.prs.map((pr) => `#${pr.number} ${pr.qa}`);
        const needs = p.needsCaptain.length ? `Needs you: ${p.needsCaptain.join('; ')}.` : 'Nothing needs you there.';
        return `**${p.name}**: ${working.length ? working.join(', ') : 'nobody at a desk'}. ${prs.length ? `Open PRs: ${prs.join(', ')}.` : 'No open PRs.'} ${needs}`;
      });
      const waiting = ship.projects.reduce((n, p) => n + p.needsCaptain.length, 0);
      return said(rooms.join('\n\n') || 'There are no projects aboard yet.', waiting ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you, Captain. The details are on screen.` : 'All quiet, Captain. Nothing needs you right now.');
    }

    // "remember…", "note that…", "log this…": jotted down in the captain's personal log
    const remember = /^(?:please\s+)?(?:remember|note|log|jot down)(?:\s+(?:that|this))?[:,]?\s+(.+)$/i.exec(asked);
    if (remember?.[1]) {
      const thought = remember[1].replace(/^\w/, (c) => c.toUpperCase());
      return { ...said(`Logged it in your personal log, Captain: “${thought}”`, 'Logged it, Captain.'), log: thought };
    }

    if (/land|closed goal|finished goal/.test(q)) {
      activity('Checking the ship’s status');
      const ship = await req.shipStatus();
      await wait(1.2);
      const goals = ship.projects.flatMap((p) => p.closedGoals.map((g) => ({ project: p.name, ...g })));
      const lines = goals.map((g) => {
        const prs = g.prs.map((pr) => `${pr.repo}#${pr.number} ${pr.state}${pr.stale ? ' (as recorded; GitHub didn’t answer)' : ''}`);
        const landed = g.prs.length > 0 && g.prs.every((pr) => pr.state === 'merged' && !pr.stale);
        return `**${g.title}** (${g.project}, ${g.lead}, ${g.slices} ${g.slices === 1 ? 'slice' : 'slices'}): ${prs.length ? prs.join(', ') : 'no PRs'}. ${landed ? 'It landed.' : 'Not all of it has landed.'}`;
      });
      return said(lines.join('\n\n') || 'No goals have been closed yet, Captain.', goals.length ? `${goals.length} closed ${goals.length === 1 ? 'goal' : 'goals'}, Captain. The details are on screen.` : 'No goals have been closed yet, Captain.');
    }

    const agent = (await req.shipStatus()).projects.flatMap((p) => p.agents).find((a) => q.includes(a.name.toLowerCase().replace(/^(lt\.|ensign) /, '')));
    if (agent && /done|so far|progress|up to/.test(q)) {
      activity(`Reading ${agent.worktree ?? 'their branch'}`);
      await wait(1.5);
      const { files } = demoCode([agent.repo]);
      return said(
        `${agent.name} is on ${agent.issue}. In their worktree (\`${agent.worktree ?? 'cloud'}\`) they've changed \`${files[0]}\` and \`${files[4]}\` so far, and added a test next to it. It's half-finished: ${agent.activity.toLowerCase()}.`,
        `${agent.name} has made a start on two files and a test. It's not done yet.`,
      );
    }

    if (project && /how does|where|work|code|file|read/.test(q)) {
      const { files, folder } = demoCode(project.repos);
      activity(`Pulling the latest code of ${project.name}`);
      await wait(1.5);
      for (const file of [files[0], files[4]]) {
        activity(`Reading ${project.id}/${folder}/${file}`);
        await wait(1.2);
      }
      return said(
        `In ${project.name}, it starts in \`${folder}/${files[0]}\`, which hands off to \`${folder}/${files[4]}\` for the state. \`${folder}/${files[1]}\` only renders what it's given.`,
        `It starts in the app's entry point and keeps its state in one module. The files are on screen.`,
        0.07,
      );
    }

    if (project && /should we|could we|we need|let'?s|add|build|want/.test(q)) {
      return {
        ...said(
          `That sounds like work for ${project.name}. I'd start with a draft at Ops; if it turns out bigger than one issue, start it as a goal with a lead of its own instead.`,
          `That's one for ${project.name}. Want me to send it to Ops, or to the lead?`,
        ),
        suggest: { projectId: project.id, idea: asked },
      };
    }

    return said(
      `Happy to think it through, Captain. Ask me how something works in ${project?.name ?? 'any project'}, what's going on aboard, or what an agent has done so far.`,
      'Happy to think it through, Captain.',
    );
  }
}
