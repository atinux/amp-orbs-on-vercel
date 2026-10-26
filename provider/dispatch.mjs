#!/usr/bin/env node
// dispatch.mjs - Amp self-hosted orbs on Vercel Sandbox.
// `amp orb provider` runs this once per job (spawn, pause, delete).
// Contract: https://ampcode.com/docs/orbs/self-hosted#dispatch-contract
import { APIError, Sandbox, Snapshot } from '@vercel/sandbox'
import { getVercelOidcToken } from '@vercel/oidc'

const { ORB_OPERATION, ORB_ID, ORB_TOKEN, AMP_URL } = process.env

// The orb-image daemon (zero instances) makes every deployment build Amp's orb
// image and push it to this VCR repository. Set VERCEL_ORB_IMAGE to use another
// image reference instead.
const ORB_IMAGE_REPOSITORY = 'daemon.orb-image'

// On a Vercel Daemon, pass no credentials: the SDK reads the daemon's OIDC
// token. Outside Vercel, set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID.
const credentials = process.env.VERCEL_TOKEN
	? {
			token: process.env.VERCEL_TOKEN,
			teamId: process.env.VERCEL_TEAM_ID,
			projectId: process.env.VERCEL_PROJECT_ID,
		}
	: {}

// A paused orb keeps its disk as a snapshot. Expire it 30 days after the last
// pause so unused threads don't accumulate storage costs. After expiry, the
// next spawn starts a fresh orb and Amp runs repository setup again.
const SNAPSHOT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000
const snapshotPolicy = {
	snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
	keepLastSnapshots: {
		count: 1, expiration: SNAPSHOT_EXPIRATION_MS, deleteEvicted: true,
	},
}

// Vercel API credentials: the access token if set, otherwise the OIDC token,
// whose claims carry the team and project IDs.
async function apiAuth() {
	if (credentials.token) return credentials
	const token = await getVercelOidcToken()
	const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
	return { token, teamId: claims.owner_id, projectId: claims.project_id }
}

// Daemon images are tagged with the deployment ID, not `latest`, so pin the
// newest ready image by digest.
async function resolveOrbImage() {
	if (process.env.VERCEL_ORB_IMAGE) return process.env.VERCEL_ORB_IMAGE
	const { token, teamId, projectId } = await apiAuth()
	const url = new URL(`https://api.vercel.com/v1/vcr/repository/${ORB_IMAGE_REPOSITORY}/images`)
	url.searchParams.set('teamId', teamId)
	url.searchParams.set('projectId', projectId)
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

async function orbExists() {
	try {
		await Sandbox.get({ ...credentials, name: ORB_ID, resume: false })
		return true
	} catch (error) {
		if (error instanceof APIError && error.response.status === 404) return false
		throw error
	}
}

if (ORB_OPERATION === 'spawn') {
	// Resolve the image only for new orbs; existing orbs resume from their disk.
	const image = (await orbExists()) ? undefined : await resolveOrbImage()
	if (image) console.log(`Creating ${ORB_ID} from ${image}`)
	const sandbox = await Sandbox.getOrCreate({
		...credentials,
		name: ORB_ID,
		...(image ? { image } : {}),
		resources: { vcpus: 4 },
		timeout: 60 * 60 * 1000,
		persistent: true,
		...snapshotPolicy,
	})
	// getOrCreate() ignores new settings for an existing sandbox.
	if (sandbox.snapshotExpiration !== SNAPSHOT_EXPIRATION_MS) {
		await sandbox.update(snapshotPolicy)
	}
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
} else if (ORB_OPERATION === 'pause' || ORB_OPERATION === 'delete') {
	try {
		const sandbox = await Sandbox.get({
			...credentials, name: ORB_ID, resume: false,
		})
		if (ORB_OPERATION === 'delete') {
			if (sandbox.status === 'running') await sandbox.stop()
			for await (const saved of await sandbox.listSnapshots()) {
				if (saved.status !== 'created') continue
				const snapshot = await Snapshot.get({
					...credentials, snapshotId: saved.id,
				})
				await snapshot.delete()
			}
			await sandbox.delete()
		} else if (sandbox.status === 'running') await sandbox.stop()
	} catch (error) {
		if (!(error instanceof APIError && error.response.status === 404)) {
			throw error
		}
	}
} else {
	console.error(`Unknown ORB_OPERATION: ${ORB_OPERATION}`)
	process.exit(1)
}
