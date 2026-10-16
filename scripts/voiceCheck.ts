// `pnpm run voice:check`: the spoken dialog with a briefing, end to end and timed, against a running office. Kokoro says
// a question, whisper transcribes it, it's asked about a lead's briefing (the lead answers, or the quick answerer while
// they're busy), and the answer's first sentence is said again: each step against its budget (scripts/voiceCheckRules.ts).
// It runs against this checkout's demo office (`pnpm run demo:start`) unless given `--url`: on a real office, the
// question goes to a real lead, so you say so.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { encodeWav, toMono16k } from '../client/src/ui/speech';
import type { Agent, BriefingReply, TermLine, VoiceStatus } from '../shared/types';
import { repliesToSpeak, sentences } from '../shared/voice';
import { DEMO_TRANSCRIPT } from '../server/voice';
import { root } from './demoOffice';
import { BUDGETS, decodeWav, heardShare, type Step, verdict } from './voiceCheckRules';

const QUESTION = 'What happens to the save if the database stays down for a while?';
const VOICE = 'bm_george';

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

function officeUrl(): string {
  const given = arg('url');
  if (given) return given.replace(/\/+$/, '');
  try {
    return (JSON.parse(readFileSync(path.join(root, '.demo', 'demo.json'), 'utf8')) as { url: string }).url.replace(/\/+$/, '');
  } catch {
    throw new Error('No demo office here: start one with `pnpm run demo:start`, or point at an office with --url');
  }
}

const base = `${officeUrl()}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${route}: ${out.error ?? res.status}`);
  return out;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const at = performance.now();
  const out = await fn();
  return [out, performance.now() - at];
}

async function speak(text: string): Promise<Uint8Array> {
  const res = await fetch(`${base}/voice/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: VOICE }) });
  if (!res.ok) throw new Error(`/voice/speak: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function voicesReady(): Promise<VoiceStatus> {
  await json('POST', '/voice/speech/load');
  for (let waited = 0; waited < 300_000; waited += 2000) {
    const { voice } = await json<{ voice: VoiceStatus }>('GET', '/state');
    if (voice.speech.engine.state === 'ready') return voice;
    if (voice.speech.engine.state === 'failed') throw new Error(voice.speech.engine.error);
    await sleep(2000);
  }
  throw new Error('Kokoro didn’t load within 5 minutes');
}

/** The lead and briefing to ask about: --lead and --briefing, or the first lead with something on their screen. */
async function briefingToAsk(): Promise<{ lead: Agent; briefing: string }> {
  const { agents } = await json<{ agents: Agent[] }>('GET', '/state');
  const leads = agents.filter((a) => a.lead?.artifacts?.length && (!arg('lead') || a.id === arg('lead')));
  const lead = leads.find((a) => a.lead?.artifacts?.some((x) => x.id === arg('briefing'))) ?? leads[0];
  const briefing = arg('briefing') ?? lead?.lead?.artifacts?.at(-1)?.id;
  if (!lead || !briefing) throw new Error('No lead has a briefing on their screen yet: give the demo a minute, or pass --lead and --briefing');
  return { lead, briefing };
}

/** The lead's first reply after `since`, as it should be said, waiting for it up to the lead's budget (and a little). */
async function leadReply(id: string, since: number): Promise<string> {
  for (let waited = 0; waited < BUDGETS.leadReply + 30_000; waited += 1000) {
    const lines = await json<TermLine[]>('GET', `/agents/${id}/lines`);
    const reply = repliesToSpeak(lines.filter((l) => l.t >= since))[0];
    if (reply) return reply;
    await sleep(1000);
  }
  throw new Error('The lead never replied');
}

async function main(): Promise<void> {
  console.log(`voice:check against ${base}`);
  const voice = await voicesReady();
  console.log(`Kokoro is ready${voice.speech.engine.state === 'ready' && voice.speech.engine.on ? ` on the ${voice.speech.engine.on.toUpperCase()}` : ''}`);
  const { lead, briefing } = await briefingToAsk();
  console.log(`Asking ${lead.name} (${lead.status}) about “${briefing}”\n`);
  const steps: Step[] = [];

  const [said, speakMs] = await timed(() => speak(QUESTION));
  steps.push({ name: 'say the question', ms: speakMs, budgetMs: BUDGETS.speak });
  const wav = decodeWav(said);
  if (!wav) throw new Error('Kokoro’s audio isn’t a WAV');
  const [{ text: heard }, transcribeMs] = await timed(async () => {
    const res = await fetch(`${base}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(toMono16k([wav.samples], wav.rate)) });
    return (await res.json()) as { text: string; error?: string };
  });
  // the demo office transcribes every recording to the same line: there's no whisper there to check
  const demo = heard === DEMO_TRANSCRIPT;
  steps.push({ name: 'transcribe it', ms: transcribeMs, budgetMs: BUDGETS.transcribe, skipped: demo, note: demo ? 'demo office: no whisper' : `“${heard}”` });

  const asked = Date.now();
  const question = demo ? QUESTION : heard;
  const [reply, askMs] = await timed(() => json<BriefingReply>('POST', `/agents/${lead.id}/briefing-question`, { briefing, spot: { beat: 0, title: '' }, question }));
  if ('costly' in reply) throw new Error('Asking would pick the lead’s session back up on the API key: try a lead that’s working, or idle on the plan');
  let answer: string;
  if (reply.by === 'quick') {
    answer = reply.text;
    steps.push({ name: 'first reply', ms: askMs, budgetMs: BUDGETS.quickReply, note: 'the quick answerer' });
  } else {
    const [text, replyMs] = await timed(() => leadReply(lead.id, asked));
    answer = text;
    steps.push({ name: 'first reply', ms: askMs + replyMs, budgetMs: BUDGETS.leadReply, note: `${lead.name}` });
  }
  const first = sentences(answer)[0] ?? answer;
  const [, soundMs] = await timed(() => speak(first));
  steps.push({ name: 'say its first sentence', ms: soundMs, budgetMs: BUDGETS.firstSound, note: `“${first.slice(0, 70)}${first.length > 70 ? '…' : ''}”` });

  const { lines, pass } = verdict(steps, demo ? 1 : heardShare(QUESTION, heard));
  for (const line of lines) console.log(line);
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  console.log(`\nQuestion said to answer heard: ${(total / 1000).toFixed(1)} s. ${pass ? 'PASS' : 'FAIL'}`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(`voice:check: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
