import { numberOne } from '../../../shared/crew';
import type { NumberOneChat } from '../../../shared/types';
import type { CrewView } from './character';

/** Number One's bubble: thinking with what they're doing, waiting for you to start or to answer, or lost the thread. */
export function numberOneView(chat: NumberOneChat | null): CrewView {
  const crew = numberOne();
  const base = { name: crew.name, avatar: crew.avatar, tag: 'XO' };
  switch (chat?.status) {
    case 'thinking':
      return { ...base, status: 'working', icon: '💭', line: chat.activity, thinking: true };
    case 'failed':
      return { ...base, status: 'error', line: 'Lost the thread – say again?' };
    case 'waiting':
    case undefined:
      return chat?.messages.length
        ? { ...base, status: 'waiting', icon: '🖖', line: 'Your turn' }
        : { ...base, status: 'waiting', line: 'Ready when you are' };
  }
}
