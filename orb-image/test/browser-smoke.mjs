import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const page = `<!doctype html><title>Orb browser smoke test</title>
<label for="quantity">Quantity</label><input id="quantity" value="0">
<button onclick="document.querySelector('output').textContent=Number(document.querySelector('input').value)*7">Calculate</button>
<output>pending</output>`;
const server = createServer((_request, response) => {
	response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
	response.end(page);
});

assert.equal(process.env.AGENT_BROWSER_ENGINE, 'chrome');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

try {
	for (const engine of [undefined, 'lightpanda']) {
		const name = engine ?? 'default-chrome';
		const options = ['--session', `orb-smoke-${process.pid}-${name}`];
		if (engine) options.push('--engine', engine);
		const browser = async (...command) => {
			console.log('$ agent-browser', [...options, ...command].join(' '));
			const { stdout, stderr } = await execute('agent-browser', [...options, ...command], {
				encoding: 'utf8',
				timeout: 60_000,
			});
			process.stdout.write(stdout);
			process.stderr.write(stderr);
			return stdout;
		};

		try {
			await browser('open', url);
			assert.match(await browser('snapshot', '-i'), /Quantity/);
			await browser('find', 'label', 'Quantity', 'fill', '6');
			await browser('find', 'role', 'button', 'click', '--name', 'Calculate');
			assert.match(await browser('get', 'text', 'output'), /\b42\b/);
			console.log(`PASS: ${name} navigation, form interaction, and DOM assertion`);
		} finally {
			try {
				await browser('close');
			} catch (error) {
				console.error(`Failed to close smoke-test session: ${error.message}`);
				process.exitCode = 1;
			}
		}
	}
} finally {
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
}
