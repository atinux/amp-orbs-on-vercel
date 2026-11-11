import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const profile = fileURLToPath(new URL('../profile.sh', import.meta.url));

function loadProfile(overrides = {}) {
	const result = spawnSync('/bin/bash', [
		'--noprofile', '--norc', '-c',
		'set -e; . "$1"; printf "%s\\n" "$PATH" "$AGENT_BROWSER_ENGINE" "$LIGHTPANDA_DISABLE_TELEMETRY"',
		'orb-profile-test', profile,
	], {
		encoding: 'utf8',
		env: { PATH: '/usr/bin:/bin', ...overrides },
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trimEnd().split('\n');
}

test('restores the tool path and Chrome default in a clean environment', () => {
	assert.deepEqual(loadProfile(), [
		'/opt/orb-tools/node_modules/.bin:/usr/bin:/bin',
		'chrome',
		'true',
	]);
});

test('preserves explicit engine and telemetry settings', () => {
	assert.deepEqual(loadProfile({
		AGENT_BROWSER_ENGINE: 'lightpanda',
		LIGHTPANDA_DISABLE_TELEMETRY: 'false',
	}), [
		'/opt/orb-tools/node_modules/.bin:/usr/bin:/bin',
		'lightpanda',
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
