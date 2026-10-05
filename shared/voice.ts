import type { VoiceStatus } from './types';

export const WHISPER_INSTALL = 'brew install whisper-cpp';

/** Why dictation can't run yet, worded for a mic button's tooltip; undefined once it can. */
export function voiceMissing(status: VoiceStatus | null): string | undefined {
  if (!status) return 'Voice input: connecting…';
  const missing = [!status.whisper.found && 'whisper-cli', !status.model.present && 'the speech model'].filter(Boolean);
  if (!missing.length) return undefined;
  return `Voice input needs ${missing.join(' and ')}. Set it up in the ready room: ⚙️ Settings → Voice input.`;
}
