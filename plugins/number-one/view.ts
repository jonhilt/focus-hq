import { numberOne, type NumberOneChat } from './shared';
import { type CrewView } from '../../plugin-api/client';

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

/**
 * What to say when a reply Number One was thinking over lands (`before` is how the chat stood until now): an answer, or
 * that they lost the thread. Nothing for anything else.
 */
export function replyNews(before: NumberOneChat['status'] | undefined, chat: NumberOneChat | null): { level: 'info' | 'error'; text: string } | null {
  if (before !== 'thinking' || !chat || chat.status === 'thinking') return null;
  const name = numberOne().name;
  return chat.status === 'waiting' ? { level: 'info', text: `🖖 ${name} has an answer for you` } : { level: 'error', text: `${name} lost the thread: ${chat.error ?? ''}` };
}
