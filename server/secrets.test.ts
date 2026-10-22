import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keepSecrets, parseSecrets, Secrets, secretSetBy, withoutSecrets, withSecret } from './secrets';

describe('the secrets file’s text', () => {
  it('starts with a line saying what it is, and adds a name at the end', () => {
    const text = withSecret('', 'FOCUS_BOT_TOKEN', 'abc');
    expect(text).toMatch(/^# Focus's secrets/);
    expect(text.endsWith("FOCUS_BOT_TOKEN='abc'\n")).toBe(true);
  });

  it('changes a name where it is, keeping the captain’s comments and other lines', () => {
    const before = "# mine\nFOCUS_BOT_TOKEN=old\nOTHER=1\nexport FOCUS_BOT_TOKEN=again\n";
    expect(withSecret(before, 'FOCUS_BOT_TOKEN', 'new')).toBe("# mine\nFOCUS_BOT_TOKEN='new'\nOTHER=1\n");
    expect(withSecret(before, 'FOCUS_BOT_TOKEN', undefined)).toBe('# mine\nOTHER=1\n');
  });

  it('reads back any value it writes, quotes and # among them', () => {
    for (const value of ['Bearer a#b', "it's", `a'b"c`, 'https://h/x?y=1&z=2']) {
      expect(parseSecrets(withSecret('', 'FOCUS_BOT_WEBHOOK_AUTH', value))).toEqual({ FOCUS_BOT_WEBHOOK_AUTH: value });
    }
  });

  it('refuses a value it couldn’t read back', () => {
    expect(() => withSecret('', 'FOCUS_BOT_TOKEN', 'a\nb')).toThrow('one line');
    expect(() => withSecret('', 'FOCUS_BOT_TOKEN', `'"\``)).toThrow('all three');
  });

  it('reads only its own names, an empty one as unset', () => {
    expect(parseSecrets('FOCUS_BOT_TOKEN=\nFOCUS_BOT_WEBHOOK= https://h \nPATH=/x\n')).toEqual({ FOCUS_BOT_WEBHOOK: 'https://h' });
  });
});

describe('the secrets file', () => {
  const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-')), 'secrets.env');

  it('keeps what’s set across a restart, readable by the captain alone', () => {
    const at = file();
    new Secrets(at).set('FOCUS_BOT_TOKEN', 'k');
    expect(new Secrets(at).get('FOCUS_BOT_TOKEN')).toBe('k');
    expect(fs.statSync(at).mode & 0o777).toBe(0o600);
  });

  it('forgets what’s cleared, or set to nothing but spaces', () => {
    const at = file();
    const secrets = new Secrets(at);
    secrets.set('FOCUS_BOT_TOKEN', 'k');
    secrets.set('FOCUS_BOT_TOKEN', '  ');
    expect(new Secrets(at).get('FOCUS_BOT_TOKEN')).toBeUndefined();
  });

  it('never puts what it holds in the environment', () => {
    const before = process.env.FOCUS_BOT_WEBHOOK;
    new Secrets(file()).set('FOCUS_BOT_WEBHOOK', 'https://hook.example/s3cret');
    expect(process.env.FOCUS_BOT_WEBHOOK).toBe(before);
  });
});

describe('what Focus hands what it starts', () => {
  it('leaves out its own secrets, and keeps everything else', () => {
    const env = { FOCUS_BOT_TOKEN: 't', FOCUS_BOT_WEBHOOK: 'https://h/s3cret', FOCUS_BOT_WEBHOOK_AUTH: 'Bearer x', FOCUS_PUBLIC_URL: 'https://f', PATH: '/bin', HOME: '/h' };
    expect(withoutSecrets(env)).toEqual({ FOCUS_PUBLIC_URL: 'https://f', PATH: '/bin', HOME: '/h' });
    expect(env.FOCUS_BOT_TOKEN).toBe('t');
  });
});

describe('a plugin’s secrets', () => {
  it('are kept only when named like an API key, so a plugin can’t keep PATH from what Focus starts', () => {
    expect(() => keepSecrets(['PATH'])).toThrow('named like an API key');
    expect(() => keepSecrets(['openai_key'])).toThrow(`"openai_key" isn't`);
    keepSecrets(['ACME_API_KEY']);
    expect(withoutSecrets({ ACME_API_KEY: 'k', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('are read from the file though the plugin starts after it’s read, and only once it’s kept', () => {
    const at = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-')), 'secrets.env');
    fs.writeFileSync(at, "LATER_API_KEY='k1'\nUNKEPT_API_KEY='k2'\n");
    const secrets = new Secrets(at);
    expect(secrets.get('LATER_API_KEY')).toBeUndefined();
    keepSecrets(['LATER_API_KEY']);
    expect(secrets.get('LATER_API_KEY')).toBe('k1');
    expect(secrets.get('UNKEPT_API_KEY')).toBeUndefined();
    expect(() => secrets.set('UNKEPT_API_KEY', 'x')).toThrow('keeps no secret called UNKEPT_API_KEY');
  });

  it('say where each is set: the environment winning over the file', () => {
    const file = { get: (n: string) => (n === 'A_API_KEY' ? 'saved' : undefined) };
    expect(secretSetBy('A_API_KEY', {}, file)).toBe('captain');
    expect(secretSetBy('A_API_KEY', { A_API_KEY: 'env' }, file)).toBe('env');
    expect(secretSetBy('B_API_KEY', { B_API_KEY: ' ' }, file)).toBeNull();
  });
});
