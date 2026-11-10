import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const profile = fileURLToPath(new URL('../profile.sh', import.meta.url));

function loadProfile(overrides = {}) {
	const result = spawnSync('/bin/bash', [
		'--noprofile', '--norc', '-c',
		'. "$1"; printf "%s\\n" "$PATH" "$AGENT_BROWSER_ENGINE" "$LIGHTPANDA_DISABLE_TELEMETRY"',
		'orb-profile-test', profile,
	], {
		encoding: 'utf8',
		env: { PATH: '/usr/bin:/bin', ...overrides },
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trimEnd().split('\n');
}

test('restores the tool path and defaults in a clean environment', () => {
	assert.deepEqual(loadProfile(), [
		'/opt/orb-tools/node_modules/.bin:/usr/bin:/bin',
		'lightpanda',
		'true',
	]);
});

test('preserves explicit engine and telemetry settings', () => {
	assert.deepEqual(loadProfile({
		AGENT_BROWSER_ENGINE: 'chrome',
		LIGHTPANDA_DISABLE_TELEMETRY: 'false',
	}), [
		'/opt/orb-tools/node_modules/.bin:/usr/bin:/bin',
		'chrome',
		'false',
	]);
});

test('uses defaults for empty settings', () => {
	assert.deepEqual(loadProfile({
		AGENT_BROWSER_ENGINE: '',
		LIGHTPANDA_DISABLE_TELEMETRY: '',
	}), loadProfile());
});

test('preserves the rest of the task environment path', () => {
	assert.equal(loadProfile({ PATH: '/custom/bin:/usr/bin:/bin' })[0],
		'/opt/orb-tools/node_modules/.bin:/custom/bin:/usr/bin:/bin');
});

test('the image installs the profile and checks the task user login shell', () => {
	const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
	assert.match(dockerfile, /COPY profile\.sh \/etc\/profile\.d\/orb-tools\.sh/);
	assert.match(dockerfile, /USER user[\s\S]*RUN bash -lc/);
	assert.match(dockerfile, /test "\$\(command -v agent-browser\)" = \/opt\/orb-tools\/node_modules\/\.bin\/agent-browser/);
	assert.match(dockerfile, /test "\$AGENT_BROWSER_ENGINE" = lightpanda/);
	assert.match(dockerfile, /test "\$LIGHTPANDA_DISABLE_TELEMETRY" = true/);
});
