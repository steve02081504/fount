/**
 * One-shot migration: remove username from node-level P2P API calls.
 * Run: deno run --allow-read --allow-write tools/migrate_p2p_callers.mjs
 */
import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts'

const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

/** @type {string[]} */
const NODE_FUNCS = [
	'loadBlocklist', 'saveBlocklist', 'addBlocklistEntry', 'isSubjectBlocked',
	'isPeerKeyBlocked', 'isPubKeyHashBlocked', 'isEntityHashBlocked', 'setEntityBlocked',
	'addGroupBlockedPeer', 'removeGroupBlockedPeer', 'addGroupBlockedPeers',
	'addBlocklistFromBanContent',
	'loadNetwork', 'saveNetwork', 'addNetworkPeer', 'applyNetworkHint',
	'recordExplorePeersFromRoster', 'mergeNetworkPeerPools', 'mergeTrustedPeers',
	'loadPeerPoolView',
	'loadReputation', 'saveReputation', 'bumpReputationOnRelay',
	'recordGossipAllUnknownWant', 'recordMessageRateViolation',
	'bumpChunkStorageReputation', 'penalizeChunkStorageFailure',
	'penalizeArchiveServeMismatch', 'applyVolatileSlashAlert',
	'applyDecayCollusionAfterSlash', 'applyReputationResetToScores',
	'seedMemberReputationFromIntroducer', 'pickNodeScore',
	'getNodeHash', 'getMailboxRoutingSettings', 'countMailboxPending',
	'hasChunk', 'getChunk', 'putChunk', 'putChunkFromStream',
	'createChunkReadStream', 'chunkStorePath', 'chunkStoreRoot',
	'takeIncomingWantIdsSlot', 'takeOutgoingWantIdsSlot',
	'invalidateTrustGraphCache', 'buildIdentityAnnounce', 'ensureNodeSeed',
	'invalidateUserRoom',
]

const USERNAME_VARS = String.raw`(?:username|replicaUsername|user|u|nodeUsername)`

/**
 * @param {string} content
 * @returns {string}
 */
function stripUsernameFirstArg(content) {
	for (const fn of NODE_FUNCS) {
		// func(username) -> func()
		const re0 = new RegExp(`\\b${fn}\\(\\s*${USERNAME_VARS}\\s*\\)`, 'g')
		content = content.replace(re0, `${fn}()`)
		// func(username, -> func(
		const re1 = new RegExp(`\\b${fn}\\(\\s*${USERNAME_VARS}\\s*,`, 'g')
		content = content.replace(re1, `${fn}(`)
	}
	// wantIdsPeerKey(username, groupId -> wantIdsPeerKey(groupId
	content = content.replace(
		new RegExp(`\\bwantIdsPeerKey\\(\\s*${USERNAME_VARS}\\s*,`, 'g'),
		'wantIdsPeerKey(',
	)
	// wantIdsGroupKey(username, groupId) -> wantIdsGroupKey(groupId)
	content = content.replace(
		new RegExp(`\\bwantIdsGroupKey\\(\\s*${USERNAME_VARS}\\s*,`, 'g'),
		'wantIdsGroupKey(',
	)
	return content
}

/**
 * @param {string} content
 * @returns {string}
 */
function applySpecialCases(content) {
	content = content.replace(
		/\bensureUserRoom\(\s*(username|replicaUsername|user)\s*\)/g,
		'ensureUserRoom({ replicaUsername: $1 })',
	)
	content = content.replace(
		/\battachGroupPartWire\(\s*(username|replicaUsername|user)\s*,/g,
		'attachGroupPartWire({ replicaUsername: $1 },',
	)
	content = content.replace(
		/\battachPartWire\(\s*(username|replicaUsername|user)\s*,/g,
		'attachPartWire({ replicaUsername: $1 },',
	)
	content = content.replace(
		/\battachMailboxWire\(\s*(username|replicaUsername|user)\s*,/g,
		'attachMailboxWire({ replicaUsername: $1 },',
	)
	content = content.replace(
		/\battachIdentityAnnounceHandlers\(\s*room\s*,\s*(username|replicaUsername|user)\s*,/g,
		'attachIdentityAnnounceHandlers(room,',
	)
	content = content.replace(
		/\bgetLocalNodeHash\(\s*(?:username|replicaUsername|user|u|nodeUsername)\s*\)/g,
		'getNodeHash()',
	)
	content = content.replace(
		/\bgetNodeHash\(\s*(?:username|replicaUsername|user|u|nodeUsername)\s*\)/g,
		'getNodeHash()',
	)
	// isWritableLocalEntity(replicaUsername, entityHash) -> isWritableLocalEntity(entityHash)
	content = content.replace(
		/\bisWritableLocalEntity\(\s*(?:username|replicaUsername|user)\s*,\s*/g,
		'isWritableLocalEntity(',
	)
	return content
}

/**
 * @param {string} content
 * @param {string} filePath
 * @returns {string}
 */
function applyImportReplacements(content, filePath) {
	const isP2p = filePath.includes('/scripts/p2p/')
	const isServer = filePath.includes('/server/')

	// reputation_user -> reputation
	content = content.replace(/reputation_user\.mjs/g, 'reputation.mjs')

	// memo in p2p
	if (isP2p) {
		content = content.replace(/from '\.\.\/memo\.mjs'/g, "from '../utils/memo.mjs'")
		content = content.replace(/from "\.\.\/memo\.mjs"/g, 'from "../utils/memo.mjs"')
	}

	// entity localized / agent / persona -> p2p_server (non-p2p only)
	if (!isP2p) {
		content = content.replace(
			/scripts\/p2p\/entity\/localized\.mjs/g,
			'server/p2p_server/localized.mjs',
		)
		content = content.replace(
			/scripts\/p2p\/entity\/agentResolve\.mjs/g,
			'server/p2p_server/agent_resolve.mjs',
		)
		content = content.replace(
			/scripts\/p2p\/entity\/personaPresentation\.mjs/g,
			'server/p2p_server/persona_presentation.mjs',
		)
	}

	// getReplicaFromReq from http_glue (not from entity/replica) — skip p2p and http_glue itself
	if (!isP2p && !filePath.endsWith('http_glue.mjs')) {
		content = content.replace(
			/from ['"]([^'"]*?)scripts\/p2p\/entity\/replica\.mjs['"]/g,
			(match, prefix) => {
				if (!/getReplicaFromReq|getLocalNodeHash|getOperatorEntityHash/.test(content))
					return match
				return `from '${prefix}server/p2p_server/http_glue.mjs'`
			},
		)
	}

	return content
}

/** @type {string[]} */
const changed = []

for await (const entry of walk(ROOT, { exts: ['.mjs'], skip: [/node_modules/] })) {
	if (entry.path.includes('migrate_p2p_callers')) continue
	const path = entry.path.replace(/\\/g, '/')
	let content = await Deno.readTextFile(entry.path)
	const original = content
	content = stripUsernameFirstArg(content)
	content = applySpecialCases(content)
	content = applyImportReplacements(content, path)
	if (content !== original) {
		await Deno.writeTextFile(entry.path, content)
		changed.push(path.replace(ROOT.replace(/\\/g, '/'), 'src/'))
	}
}

console.log(`Changed ${changed.length} files:`)
for (const f of changed.sort()) console.log(f)
