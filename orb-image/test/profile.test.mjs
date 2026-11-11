import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const profile = fileURLToPath(new URL('../profile.sh', import.meta.url));

function loadProfile(overrides = {}) {
	const result = spawnSync('/bin/bash', [
		'--noprofile', '--norc', '-c',
		'set -e; . "$1"; printf "%s\\n" "$PATH" "${AGENT_BROWSER_ENGINE-unset}" "$LIGHTPANDA_DISABLE_TELEMETRY"',
		'orb-profile-test', profile,
	], {
		encoding: 'utf8',
		env: { PATH: '/usr/bin:/bin', ...overrides },
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trimEnd().split('\n');
}

test('disables telemetry without changing the path or setting an engine', () => {
	assert.deepEqual(loadProfile(), ['/usr/bin:/bin', 'unset', 'true']);
});

test('preserves explicit telemetry and engine settings', () => {
	assert.deepEqual(loadProfile({
		AGENT_BROWSER_ENGINE: 'lightpanda',
		LIGHTPANDA_DISABLE_TELEMETRY: 'false',
	}), ['/usr/bin:/bin', 'lightpanda', 'false']);
});

test('disables telemetry when its setting is empty', () => {
	assert.deepEqual(loadProfile({ LIGHTPANDA_DISABLE_TELEMETRY: '' }), loadProfile());
});

test('preserves a custom path', () => {
	assert.equal(loadProfile({ PATH: '/custom/bin:/usr/bin:/bin' })[0],
		'/custom/bin:/usr/bin:/bin');
});
