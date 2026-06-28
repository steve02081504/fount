/**
 * 删除非当前 nodeHash 托管的 social timeline 目录（一次性维护）。
 * 用法：deno run -A .../purge_stale_timeline_owners.mjs <username> [--data-path <path>]
 */
import { rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { isEntityHash128, parseEntityHash } from '../../../../../../scripts/p2p/entity_id.mjs'
import { initNode, isNodeInitialized } from '../../../../../../scripts/p2p/node/instance.mjs'
import { getNodeHash } from '../../../../../../scripts/p2p/node_context.mjs'
import { createFountEntityStore } from '../../../../../../server/p2p_server/entity_store.mjs'
import { invalidateTimelineOwnerIndex } from '../timeline/ownerIndex.mjs'

const args = process.argv.slice(2)
let dataPathArg = 'data'
/** @type {string | undefined} */
let username
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--data-path' && args[i + 1]) {
		dataPathArg = args[++i]
		continue
	}
	if (!args[i].startsWith('-'))
		username = args[i]
}

if (!username) {
	console.error('usage: purge_stale_timeline_owners.mjs <username> [--data-path data]')
	process.exit(1)
}

const dataPath = path.resolve(dataPathArg)
const nodeDir = path.join(dataPath, 'p2p', 'node')

if (!isNodeInitialized())
	initNode({ nodeDir, entityStore: createFountEntityStore() })

const currentNode = getNodeHash()
const timelinesRoot = path.join(dataPath, 'users', username, 'shells/social/timelines')

/** @type {string[]} */
const kept = []
/** @type {string[]} */
const removed = []

try {
	const entries = await readdir(timelinesRoot, { withFileTypes: true })
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		const entityHash = entry.name.toLowerCase()
		if (!isEntityHash128(entityHash)) continue
		const parsed = parseEntityHash(entityHash)
		if (!parsed) continue
		if (parsed.nodeHash === currentNode) {
			kept.push(entityHash)
			continue
		}
		await rm(path.join(timelinesRoot, entry.name), { recursive: true, force: true })
		removed.push(entityHash)
	}
}
catch (err) {
	if (err?.code === 'ENOENT') {
		console.log('no timelines directory')
		process.exit(0)
	}
	throw err
}

invalidateTimelineOwnerIndex(username)

console.log('current nodeHash:', currentNode)
console.log('kept:', kept.length ? kept : '(none)')
console.log('removed:', removed.length ? removed : '(none)')
