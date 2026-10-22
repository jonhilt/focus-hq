// Settings' card for a bot speaking for the captain (server/bot.ts): its token made here, its webhook, the webhook's
// Authorization header, and Focus's address as the bot reaches it. The server never sends the secrets back, only
// where each comes from (`BotStatus`), so a secret's field is for typing a new one, never for showing it.
import type { SetBy } from '../../../shared/types';
import { api } from '../net/api';
import { state } from '../net/state';
import type { Ui } from './context';
import { confirmDialog } from './confirmDialog';
import { busy, fill, h } from './dom';

/** The token just made, shown until the captain makes another or clears it, or the page reloads. */
let madeToken: string | undefined;
/** The card shown last: Settings is drawn again as Focus's info changes, which may come before the new token does. */
let latest: (() => void) | undefined;

/** Where a setting comes from, as a chip: an environment variable's can't be changed here. */
function setByChip(by: SetBy, env: string, detail?: string): HTMLElement {
  if (by === 'env') return h('span', { class: 'chip warn', title: `Unset ${env} and restart Focus to change it here` }, `from ${env}`);
  return by ? h('span', { class: 'chip ok' }, detail ? `set · ${detail}` : 'set') : h('span', { class: 'chip' }, 'not set');
}

/** Follows Focus's info, but not while the captain is typing in it: what they type is sent as they leave the field. */
export function botSection(ui: Ui): HTMLElement {
  const el = h('div', { class: 'card voice-setup bot-setup', style: 'margin-top:12px' });
  // after a change, as it's taken: the field it was typed in empties, and the card shows where things stand now
  const sent = (input: HTMLInputElement | null, change: () => Promise<unknown>) =>
    void change().then(() => {
      if (input) input.value = '';
      render();
    }, (e: Error) => ui.error(e.message));

  /** A field for a secret: typing a new one and leaving the field saves it; Clear forgets it. */
  const secretRow = (label: string, by: SetBy, env: string, input: HTMLInputElement, clear: () => Promise<unknown>, detail?: string) => {
    const clearBtn = h('button', { class: 'btn small' }, 'Clear');
    clearBtn.onclick = () => sent(null, clear);
    return h('div', { class: 'voice-row' }, h('span', null, label), setByChip(by, env, detail), by === 'env' ? null : input, by === 'captain' ? clearBtn : null);
  };

  const render = () => {
    const info = state.info;
    if (!info) return fill(el, h('strong', { class: 'label' }, 'Bot'), h('p', { class: 'muted' }, 'Connecting…'));
    const bot = info.bot;
    if (!bot.token) madeToken = undefined;

    const make = h('button', { class: 'btn small primary' }, bot.token ? 'Make a new token' : 'Make a token');
    make.onclick = async () => {
      const keep = bot.token && !(await confirmDialog({ title: 'Make a new bot token?', message: 'The bot’s current token stops working at once: give it the new one.', confirmLabel: 'Make a new one', danger: true }));
      if (!keep) await busy(make, async () => void (madeToken = (await api.newBotToken()).token), ui.error).then(() => latest?.());
    };
    // or the bot's own token, the one it already sends: pasted here, it's never shown again
    const ownToken = h('input', { type: 'password', autocomplete: 'off', placeholder: bot.token ? 'or paste a new one of your own' : 'or paste your own', style: 'flex:1' });
    ownToken.addEventListener('change', () => {
      madeToken = undefined;
      sent(ownToken, () => api.changeBot({ token: ownToken.value }));
    });
    const clearToken = h('button', { class: 'btn small' }, 'Clear');
    clearToken.onclick = () => sent(null, () => api.clearBotToken());
    const copy = h('button', { class: 'btn small' }, 'Copy');
    copy.onclick = () => void navigator.clipboard.writeText(madeToken ?? '').then(() => ui.hud.toast('info', 'Copied the bot token'), (e: Error) => ui.error(e.message));

    const webhook = h('input', { type: 'url', placeholder: bot.webhook.by ? 'Type a new address to replace it' : 'https://…', style: 'flex:1' });
    webhook.addEventListener('change', () => sent(webhook, () => api.changeBot({ webhook: webhook.value })));
    const auth = h('input', { type: 'password', autocomplete: 'off', placeholder: bot.auth ? 'Type a new one to replace it' : 'e.g. Bearer …', style: 'flex:1' });
    auth.addEventListener('change', () => sent(auth, () => api.changeBot({ auth: auth.value })));
    const publicUrl = h('input', { type: 'url', value: bot.publicUrl.url ?? '', placeholder: 'e.g. https://focus.your-tailnet.ts.net', style: 'flex:1' });
    publicUrl.addEventListener('change', () => sent(null, () => api.updateSettings({ publicUrl: publicUrl.value })));

    fill(el,
      h('div', { class: 'row' }, h('strong', { class: 'label' }, 'Bot'), bot.token && bot.webhook.by ? h('span', { class: 'chip ok' }, 'on') : h('span', { class: 'chip' }, 'off')),
      h('p', { class: 'muted' }, 'A bot speaking for you (the chief of staff’s inbox, on the API): it calls Focus with the token, and hears what changes on its webhook, each delivery signed with the token. Kept on this machine, in secrets.env in Focus’s data folder: never sent back to a browser or handed to agents.'),
      h('div', { class: 'voice-row' }, h('span', null, 'Token'), setByChip(bot.token, 'FOCUS_BOT_TOKEN'), bot.token === 'env' ? null : [make, ownToken], bot.token === 'captain' ? clearToken : null),
      madeToken
        ? h('div', { class: 'voice-row' }, h('span', null, ''), h('code', { style: 'user-select:all;word-break:break-all' }, madeToken), copy, h('small', { class: 'muted' }, 'Shown this once: give it to your bot.'))
        : null,
      secretRow('Webhook', bot.webhook.by, 'FOCUS_BOT_WEBHOOK', webhook, () => api.changeBot({ webhook: null }), bot.webhook.host),
      secretRow('Its header', bot.auth, 'FOCUS_BOT_WEBHOOK_AUTH', auth, () => api.changeBot({ auth: null })),
      h('small', { class: 'muted' }, 'Sent as Authorization on each delivery, when the webhook wants one.'),
      h('div', { class: 'voice-row', style: 'margin-top:8px' }, h('span', null, 'Public address'), bot.publicUrl.by === 'env' ? setByChip('env', 'FOCUS_PUBLIC_URL') : publicUrl),
      h('small', { class: 'muted' }, 'Focus as the bot reaches it, to make the links it’s sent whole.'),
    );
  };
  ui.panels.own(state.on('info', () => el.isConnected && !el.contains(document.activeElement) && render()));
  latest = render;
  render();
  return el;
}
