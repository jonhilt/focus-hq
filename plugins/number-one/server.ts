// The number-one plugin: Number One in the ready room, the ship's first officer, who talks anything through
// with the captain in a read-only chat, and takes the captain's calls hands-free. FOCUS_PLUGINS=number-one.
import { Calls } from './call/calls';
import { NumberOne } from './chat';
import { DemoNumberOne } from './demo';
import { ClaudeNumberOne } from './officer';
import { chatAfterRestart, freshChat, NUMBER_ONE, numberOne as firstOfficer, type NumberOneLive, type NumberOneSaved } from './shared';
import { type FocusPlugin } from '../../plugin-api/server';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const numberOnePlugin: FocusPlugin = {
  id: NUMBER_ONE,
  // the keys calls need: OpenAI's for gpt-live-1, TypeSafe's for Jev
  secrets: [
    { name: 'OPENAI_API_KEY', label: 'OpenAI API key', hint: 'For calls: the voice (gpt-live-1).' },
    { name: 'TYPESAFE_API_KEY', label: 'TypeSafe API key', hint: 'For calls: Jev, who works out what you asked for.' },
  ],
  start(host) {
    const saved = host.state<NumberOneSaved>(() => ({ chat: freshChat() }));
    const live = host.state<NumberOneLive>(() => ({ activity: '', call: { call: null } }), { saved: false });
    // a turn in flight when Focus shut down ends, and the chat stays usable
    const chat = saved.get().chat;
    if (chatAfterRestart(chat) !== chat) saved.set({ chat: chatAfterRestart(chat) });
    const numberOne = new NumberOne(
      {
        projects: () => host.projects(),
        settings: () => host.settings(),
        shipStatus: () => host.shipStatus(),
        personalLog: { entries: () => host.personalLog.entries(), note: (text) => void host.personalLog.note(text, firstOfficer().name) },
        saved,
        live,
      },
      host.demo ? new DemoNumberOne() : new ClaudeNumberOne((run) => host.shipSession(run)),
    );
    // calls read the ship and act on the captain's goals through Ops, once the captain has said yes
    const calls: Calls = new Calls((call) => live.set({ call }), {
      snapshot: () => host.snapshot(),
      ledger: () => host.ledger(),
      startQueued: (projectId, queueId) => host.goals.startQueued(projectId, queueId),
      startGoal: (projectId, goal) => host.goals.start(projectId, goal, { from: 'a call' }),
      message: (agentId, said) => host.goals.message(agentId, said),
    }, () => ({ openai: host.secret('OPENAI_API_KEY'), typesafe: host.secret('TYPESAFE_API_KEY') }), host.demo);
    live.set({ call: calls.status() });
    return {
      // a key the captain set or cleared: the Call button says at once whether calls can be taken
      secretChanged: () => live.set({ call: calls.status() }),
      routes: [
        { method: 'post', path: '/say', handle: ({ body }) => numberOne.say(text(body.text)) },
        { method: 'post', path: '/new', handle: () => numberOne.newConversation() },
        // the browser's WebRTC offer in, the session's id and answer out; Ops joins the call itself
        {
          method: 'post',
          path: '/call',
          handle: ({ body }) => {
            const sdp = text(body.sdp);
            if (!sdp) throw new Error('Send the WebRTC offer');
            return calls.start(sdp);
          },
        },
        { method: 'post', path: '/hang-up', handle: ({ body }) => calls.hangUp(text(body.id)) },
      ],
    };
  },
};

export default numberOnePlugin;
