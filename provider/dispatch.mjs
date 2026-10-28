#!/usr/bin/env node
// dispatch.mjs - Amp self-hosted orbs on Vercel Sandbox.
// `amp orb provider` runs this once per job (spawn, pause, delete).
// Contract: https://ampcode.com/docs/orbs/self-hosted#dispatch-contract
//
// Authentication is OIDC only: on a Vercel Daemon, the Sandbox SDK and
// getVercelOidcToken() read the daemon's short-lived token. No Vercel access
// token is used.
import { APIError, Sandbox, Snapshot } from '@vercel/sandbox'
import { getVercelOidcToken } from '@vercel/oidc'

const { ORB_OPERATION, ORB_ID, ORB_TOKEN, AMP_URL } = process.env

// The orb-image daemon (zero instances) makes every deployment build Amp's orb
// image and push it to this VCR repository.
const ORB_IMAGE_REPOSITORY = 'daemon.orb-image'

// A paused orb keeps its disk as a snapshot, which expires 30 days after it was
// last used. After that, the next spawn starts a fresh orb.
const SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000

// Daemon images are tagged with the deployment ID, not `latest`, so pin the
// newest ready image by digest. The OIDC token's claims carry the team and
// project IDs.
async function resolveOrbImage() {
	const token = await getVercelOidcToken()
	const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
	const url = new URL(`https://api.vercel.com/v1/vcr/repository/${ORB_IMAGE_REPOSITORY}/images`)
	url.searchParams.set('teamId', claims.owner_id)
	url.searchParams.set('projectId', claims.project_id)
	const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
	if (!response.ok) {
		throw new Error(`Listing ${ORB_IMAGE_REPOSITORY} images failed: ${response.status} ${await response.text()}`)
	}
	const { images = [] } = await response.json()
	const newest = images
		.filter((image) => image.status === 'ready' && image.kind === 'manifest')
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
	if (!newest) throw new Error(`No ready image in ${ORB_IMAGE_REPOSITORY}. Deploy the project to build it.`)
	return `${ORB_IMAGE_REPOSITORY}@${newest.manifestDigest}`
}

// Returns the orb's sandbox without resuming it, or null if it doesn't exist.
async function findOrb() {
	try {
		return await Sandbox.get({ name: ORB_ID, resume: false })
	} catch (error) {
		if (error instanceof APIError && error.response.status === 404) return null
		throw error
	}
}

// Returns the orb's sandbox if it can resume. A stopped orb whose snapshot
// expired can't resume (410 snapshot_not_found), so delete it and let spawn
// create a fresh orb.
async function findResumableOrb() {
	const sandbox = await findOrb()
	if (!sandbox || sandbox.status !== 'stopped') return sandbox
	if (sandbox.currentSnapshotId) {
		try {
			const snapshot = await Snapshot.get({ snapshotId: sandbox.currentSnapshotId })
			if (snapshot.status === 'created') return sandbox
		} catch (error) {
			if (!(error instanceof APIError && error.response.status === 404)) throw error
		}
	}
	await sandbox.delete()
	return null
}

if (ORB_OPERATION === 'spawn') {
	// Resolve the image only for new orbs; existing orbs resume from their disk.
	const image = (await findResumableOrb()) ? undefined : await resolveOrbImage()
	if (image) console.log(`Creating ${ORB_ID} from ${image}`)
	const sandbox = await Sandbox.getOrCreate({
		name: ORB_ID,
		...(image ? { image } : {}),
		resources: { vcpus: 4 },
		timeout: 60 * 60 * 1000,
		persistent: true,
		snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
		keepLastSnapshots: { count: 1, expiration: SNAPSHOT_EXPIRATION_MS, deleteEvicted: true },
	})
	const setup = await sandbox.runCommand({
		cmd: '/bin/bash',
		args: ['-c', 'hostname localhost && mkdir -p /vercel/sandbox'],
		sudo: true,
	})
	if (setup.exitCode !== 0) throw new Error(await setup.stderr())
	await sandbox.runCommand({
		cmd: '/usr/bin/setpriv',
		args: [
			'--reuid=user', '--regid=user', '--init-groups', '--',
			'/usr/bin/env', `ORB_TOKEN=${ORB_TOKEN}`,
			...(AMP_URL ? [`AMP_URL=${AMP_URL}`] : []),
			'HOME=/home/user', 'USER=user', '/bin/bash', '-lc',
			'exec amp orb bootstrap',
		],
		sudo: true,
		detached: true,
	})
} else if (ORB_OPERATION === 'pause') {
	const sandbox = await findOrb()
	if (sandbox?.status === 'running') await sandbox.stop()
} else if (ORB_OPERATION === 'delete') {
	const sandbox = await findOrb()
	if (sandbox) {
		if (sandbox.status === 'running') await sandbox.stop()
		// sandbox.delete() keeps snapshots, so delete them first.
		for await (const saved of await sandbox.listSnapshots()) {
			if (saved.status === 'created') await (await Snapshot.get({ snapshotId: saved.id })).delete()
		}
		await sandbox.delete()
	}
} else {
	console.error(`Unknown ORB_OPERATION: ${ORB_OPERATION}`)
	process.exit(1)
}
