import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertAttachmentSupport, assertPng, buildSmokeEnvironment } from '../smoke.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('smoke environment isolates legacy Chrome and ignores inherited browser state', () => {
  const inherited = Object.freeze({
    HOME: '/home/user',
    PATH: '/usr/local/bin:/usr/bin',
    AGENT_BROWSER_SESSION: 'normal-session',
    AGENT_BROWSER_ENGINE: 'lightpanda',
    AGENT_BROWSER_CONFIG: '/existing/config.json',
    AGENT_BROWSER_CDP: 'http://127.0.0.1:9222',
    AGENT_BROWSER_PROFILE: '/existing/profile',
    AGENT_BROWSER_AUTO_CONNECT: '1',
    AGENT_BROWSER_NO_VERSION_CHECK: '0',
    AGENT_BROWSER_OTHER_SETTING: 'unexpected',
  });
  const env = buildSmokeEnvironment('/temporary/agent-browser.json', 'isolated', inherited);
  assert.equal(env.HOME, inherited.HOME);
  assert.equal(env.PATH, inherited.PATH);
  assert.equal(env.AGENT_BROWSER_CONFIG, '/temporary/agent-browser.json');
  assert.equal(env.AGENT_BROWSER_SESSION, 'isolated-legacy');
  assert.notEqual(env.AGENT_BROWSER_SESSION, inherited.AGENT_BROWSER_SESSION);
  assert.notEqual(env.AGENT_BROWSER_SESSION, 'isolated-chrome');
  assert.notEqual(env.AGENT_BROWSER_SESSION, 'isolated-lightpanda');
  assert.equal(env.AGENT_BROWSER_ENGINE, 'chrome');
  assert.equal(env.AGENT_BROWSER_NO_VERSION_CHECK, '1');
  assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, 'true');
  assert.deepEqual(Object.keys(env).filter(name => name.startsWith('AGENT_BROWSER_')).sort(), [
    'AGENT_BROWSER_CONFIG', 'AGENT_BROWSER_ENGINE', 'AGENT_BROWSER_NO_VERSION_CHECK', 'AGENT_BROWSER_SESSION',
  ]);
  assert.equal(inherited.AGENT_BROWSER_SESSION, 'normal-session');
});

test('assertPng accepts a real 1x1 PNG', () => {
  assert.doesNotThrow(() => assertPng(png));
});

for (const [name, mutate, message] of [
  ['empty', () => Buffer.alloc(0), /Empty or truncated/],
  ['truncated', () => png.subarray(0, 23), /Empty or truncated/],
  ['wrong signature', data => { data[0] = 0; return data; }, /must be PNG/],
  ['missing IHDR', data => { data.write('IDAT', 12); return data; }, /missing its dimensions/],
  ['zero width', data => { data.writeUInt32BE(0, 16); return data; }, /nonzero dimensions/],
  ['zero height', data => { data.writeUInt32BE(0, 20); return data; }, /nonzero dimensions/],
]) {
  test(`assertPng rejects ${name}`, () => {
    assert.throws(() => assertPng(mutate(Buffer.from(png))), message);
  });
}

for (const version of ['2.99.0', '2.100.0', '3.0.0']) {
  test(`native attachments accept gh ${version}`, () => {
    assert.doesNotThrow(() => assertAttachmentSupport(`gh version ${version}`, '--attach stringArray'));
  });
}

for (const version of ['1.100.0', '2.98.9']) {
  test(`native attachments reject gh ${version}`, () => {
    assert.throws(() => assertAttachmentSupport(`gh version ${version}`, '--attach'), /2\.99\.0\+ is required/);
  });
}

test('native attachments require a recognizable version and attachment flag', () => {
  assert.throws(() => assertAttachmentSupport('unknown', '--attach'), /Cannot determine/);
  assert.throws(() => assertAttachmentSupport('gh version 2.99.0', '--body-file'), /native PR attachments/);
});

test('image installs a checksum-verified stable Lightpanda release', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.ok(dockerfile.includes('https://github.com/lightpanda-io/browser/releases/download/1.0.3/lightpanda-x86_64-linux'));
  const checksum = dockerfile.indexOf('53eb34da09159dcf8f04865dbfe3e63e9a652062684495aa7ced5ddd7c82e8b0');
  const verify = dockerfile.indexOf('sha256sum --check --strict');
  const install = dockerfile.indexOf('install -m 0755 /tmp/lightpanda');
  assert.ok(checksum > 0 && verify > checksum && install > verify);
  assert.match(dockerfile, /ENV LIGHTPANDA_DISABLE_TELEMETRY=true/);
  assert.doesNotMatch(dockerfile, /releases\/download\/nightly|curl[^\n]*\|\s*(?:ba)?sh/);
});

test('image verifies the tools as the task user and returns home', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /USER user\nENV HOME="\/home\/user"\nRUN npm test && npm run smoke\nWORKDIR \/home\/user\s*$/);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(dockerfile, /COPY (?:skills|AGENTS)|\.config\//);
});
