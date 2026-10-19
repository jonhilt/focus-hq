/** Whether briefings up close are narrated, remembered per browser (under the key from when the core had it). Off until switched on. */
export const explainerVoice = {
  get on(): boolean {
    return localStorage.getItem('focus.explainer.voice') === '1';
  },
  set on(on: boolean) {
    localStorage.setItem('focus.explainer.voice', on ? '1' : '0');
  },
};
