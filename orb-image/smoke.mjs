import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function assertAttachmentSupport(version, help) {
  const match = version.match(/gh version (\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'Cannot determine GitHub CLI version');
  const [, major, minor] = match.map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 99), 'GitHub CLI 2.99.0+ is required');
  assert.ok(help.includes('--attach'), 'GitHub CLI must support native PR attachments');
}

export function assertPng(data) {
  assert.ok(data.length >= 24, 'Empty or truncated screenshot');
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'Screenshot must be PNG');
  assert.equal(data.toString('ascii', 12, 16), 'IHDR', 'PNG is missing its dimensions');
  assert.ok(data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0, 'Screenshot must have nonzero dimensions');
}

export function buildSmokeEnvironment(config, session, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.startsWith('AGENT_BROWSER_')));
  return {
    ...env,
    AGENT_BROWSER_CONFIG: config,
    AGENT_BROWSER_SESSION: `${session}-legacy`,
    AGENT_BROWSER_ENGINE: 'chrome',
    AGENT_BROWSER_NO_VERSION_CHECK: '1',
    LIGHTPANDA_DISABLE_TELEMETRY: 'true',
  };
}

export async function smoke() {
  const root = await mkdtemp(join(tmpdir(), 'orb-tools-smoke-'));
  const session = `orb-tools-${randomUUID()}`;
  const config = join(root, 'agent-browser.json');
  const env = buildSmokeEnvironment(config, session);
  const run = async (command, args) => (await exec(command, args, {
    cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  })).stdout;
  const browser = (engine, ...args) => run('agent-browser', ['--session', `${session}-${engine}`, '--engine', engine, ...args]);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const heading = request.url === '/after' ? 'After' : 'Before';
    response.end(`<!doctype html><html><head><title>Orb tools smoke test</title></head><body><h1>${heading}</h1><button id="action" onclick="document.getElementById('result').textContent='Clicked successfully'">Run action</button><p id="result">Ready</p></body></html>`);
  });
  try {
    await writeFile(config, '{}\n');
    const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url)));
    assert.match(await run('agent-browser', ['--version']), new RegExp(`agent-browser ${manifest.dependencies['agent-browser'].replaceAll('.', '\\.')}`));
    assert.match(await run('before-and-after', ['--help']), /Screenshot comparison tool/);
    assertAttachmentSupport(await run('gh', ['--version']), await run('gh', ['pr', 'edit', '--help']));
    assert.match(await run('ffmpeg', ['-version']), /ffmpeg version/);
    assert.match(await run('jq', ['--version']), /jq-/);
    assert.match(await run('lightpanda', ['version']), /1\.0\.3/);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await mkdir(join(root, 'captures'));
    await browser('chrome', 'open', url);
    assert.match(await browser('chrome', 'get', 'title'), /Orb tools smoke test/);
    const screenshot = join(root, 'captures', 'browser.png');
    await browser('chrome', 'screenshot', screenshot);
    assertPng(await readFile(screenshot));

    // Omit --markdown: URL-mode markdown can upload to a public service.
    const legacyOutput = join(root, 'legacy');
    await run('before-and-after', [url, `${url}/after`, '--output', legacyOutput]);
    const images = (await readdir(legacyOutput)).filter(name => name.endsWith('.png'));
    assert.equal(images.length, 2, 'Legacy CLI must create both screenshots');
    const captures = await Promise.all(images.map(name => readFile(join(legacyOutput, name))));
    captures.forEach(assertPng);
    assert.notEqual(createHash('sha256').update(captures[0]).digest('hex'),
      createHash('sha256').update(captures[1]).digest('hex'), 'Before and after captures must differ');

    await browser('lightpanda', 'open', url);
    assert.match(await browser('lightpanda', 'get', 'title'), /Orb tools smoke test/);
    assert.match(await browser('lightpanda', 'snapshot'), /Run action/);
    await browser('lightpanda', 'click', '#action');
    assert.match(await browser('lightpanda', 'get', 'text', '#result'), /Clicked successfully/);
    console.log('PASS: pinned CLIs, native GitHub attachments, Chrome screenshots, legacy capture and Lightpanda DOM interaction');
  } finally {
    await Promise.all(['chrome', 'lightpanda', 'legacy'].map(async engine => {
      try {
        if (engine === 'legacy') {
          await run('agent-browser', ['--session', `${session}-legacy`, '--engine', 'chrome', 'close']);
        } else {
          await browser(engine, 'close');
        }
      } catch { /* Preflight may fail before a browser starts. */ }
    }));
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await smoke(); } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exitCode = 1;
  }
}
