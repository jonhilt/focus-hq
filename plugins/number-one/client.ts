// Number One in the browser: their figure in the ready room, their chat on E or the 1 key, a toast when a
// reply lands while you're elsewhere, and the call this browser carries.
import { followCalls } from './callView';
import { seatNumberOne } from './figure';
import { currentChat, numberOnePanelOpen, openNumberOnePanel } from './panel';
import { NUMBER_ONE } from './shared';
import { replyNews } from './view';
import './number-one.css';
import { type ClientPlugin, onPluginState, type Ui } from '../../plugin-api/client';

/** Opens the chat, unless it's open already. */
const talk = (ui: Ui) => {
  if (!numberOnePanelOpen()) openNumberOnePanel(ui);
};

const numberOne: ClientPlugin = {
  id: NUMBER_ONE,
  legend: [{ key: '1', label: 'Number One' }],
  start({ ui }) {
    // a reply can take a while: say so when it lands while you're elsewhere
    let before = currentChat()?.status;
    onPluginState(NUMBER_ONE, () => {
      const chat = currentChat();
      const news = numberOnePanelOpen() ? null : replyNews(before, chat);
      if (news) ui.hud.toast(news.level, news.text, { label: 'Read it', run: () => talk(ui) });
      before = chat?.status;
    });
    followCalls();
    return {
      keydown: (e) => {
        if (e.code !== 'Digit1' || ui.panels.isOpen) return false;
        talk(ui);
        return true;
      },
    };
  },
  ship: (host) => seatNumberOne(host, talk),
};

export default numberOne;
