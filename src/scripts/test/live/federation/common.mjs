/**
 * L4 联邦 live 探针共用库（支持 FOUNT_TEST_NODE_COUNT 个节点）。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/require-param-type -- live probe harness */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
	invokeMultipart,
	invokeRequest,
	sleep,
	TEST_PNG_BYTES,
} from '../http.mjs'
import { completeLiveScript, skipCase, testCase, writeLiveSummary } from '../singleNode/helpers.mjs'

/** @typedef {import('../http.mjs').LiveNodeHandle} LiveNodeHandle */

/**
 * @param {number} index
 * @returns {LiveNodeHandle}
 */
function newFedNodeHandle(index) {
	const idx = index + 1
	const letter = String.fromCharCode('A'.charCodeAt(0) + index)
	const baseKey = `FOUNT_TEST_NODE_${idx}_BASE_URL`
	const keyKey = `FOUNT_TEST_NODE_${idx}_KEY`
	const dataKey = `FOUNT_TEST_NODE_${idx}_DATA`
	const base = process.env[baseKey]?.trim()
	const key = process.env[keyKey]?.trim()
	const dataPath = process.env[dataKey]
	if (!base) throw new Error(`${baseKey} is required; run via test/live/run.mjs`)
	if (!key) throw new Error(`${keyKey} is required; run via test/live/run.mjs`)
	return {
		base: base.replace(/\/+$/, ''),
		key,
		name: letter,
		dataPath,
		index: idx,
	}
}

/** @param {LiveNodeHandle} node */
function resetFedNodeBlocklist(node) {
	try {
		const dataPath = String(node.dataPath || '').trim()
		if (!dataPath) return
		const nodeDir = path.join(dataPath, 'p2p/node')
		fs.mkdirSync(nodeDir, { recursive: true })
		fs.writeFileSync(path.join(nodeDir, 'denylist.json'), '{"blocked":[]}', 'utf8')
	}
	catch (error) {
		console.log(`  blocklist reset WARN [${node.name}] ${error.message}`)
	}
}

/** @returns {LiveNodeHandle[]} */
function loadFedNodes() {
	const count = parseInt(process.env.FOUNT_TEST_NODE_COUNT || '2', 10)
	if (count < 1) throw new Error('FOUNT_TEST_NODE_COUNT must be >= 1')
	return Array.from({ length: count }, (_, index) => newFedNodeHandle(index))
}

/** @type {LiveNodeHandle[]} */
export const FedNodes = loadFedNodes()
for (const node of FedNodes) resetFedNodeBlocklist(node)

/** @type {LiveNodeHandle} */
export const FedA = FedNodes[0]
/** @type {LiveNodeHandle | null} */
export const FedB = FedNodes[1] ?? null
/** @type {LiveNodeHandle | null} */
export const FedC = FedNodes[2] ?? null
export const FedPngBytes = TEST_PNG_BYTES

/** @param {LiveNodeHandle} node @param {string} method @param {string} p2pPath @param {unknown} [body] */
export async function P2pApi(node, method, p2pPath, body) {
	return invokeRequest(node, method, `/api/p2p${p2pPath}`, body)
}

/** @param {LiveNodeHandle} node @param {string} method @param {string} chatPath @param {unknown} [body] */
export async function Api(node, method, chatPath, body) {
	return invokeRequest(node, method, chatPath, body, { shell: 'chat' })
}

/** @param {LiveNodeHandle} node @param {string} shell @param {string} method @param {string} shellPath @param {unknown} [body] */
export async function ShellApi(node, shell, method, shellPath, body) {
	return invokeRequest(node, method, shellPath, body, { shell })
}

/** @param {LiveNodeHandle} node @param {string} method @param {string} rootPath @param {unknown} [body] */
export async function RootApi(node, method, rootPath, body) {
	return invokeRequest(node, method, rootPath, body, { timeoutSec: 60 })
}

/** @param {LiveNodeHandle} node @param {string} method @param {string} chatPath @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType] */
export async function ApiMultipart(node, method, chatPath, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
	return invokeMultipart(node, 'chat', method, chatPath, fields, fileField, fileName, fileBytes, contentType)
}

/** @param {LiveNodeHandle} node @param {string} shell @param {string} method @param {string} shellPath @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType] */
export const ShellApiMultipart = (node, shell, method, shellPath, fields, fileField, fileName, fileBytes, contentType = 'image/png') =>
	invokeMultipart(node, shell, method, shellPath, fields, fileField, fileName, fileBytes, contentType)

/** @param {number} timeoutSec @param {number} intervalSec @param {() => Promise<boolean>} probe */
export async function PollUntil(timeoutSec, intervalSec, probe) {
	const deadline = Date.now() + timeoutSec * 1000
	let last = false
	do {
		last = await probe()
		if (last) return last
		await sleep(intervalSec * 1000)
	} while (Date.now() < deadline)
	return last
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {number} [waitMs] */
export async function InvokeFedCatchupSync(node, groupId, waitMs = 6000) {
	await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs })
	await Api(node, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {number} [minMembers] @param {number} [timeoutSec] */
export async function WaitFedMembers(node, groupId, minMembers = 2, timeoutSec = 120) {
	return PollUntil(timeoutSec, 3, async () => {
		await InvokeFedCatchupSync(node, groupId, 5000)
		const state = await Api(node, 'GET', `/groups/${groupId}/state`)
		return state.status === 200
			&& state.json?.viewer?.isMember === true
			&& Number(state.json?.meta?.memberCount) >= minMembers
	})
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {() => Promise<boolean>} probe @param {number} [timeoutSec] @param {number} [intervalSec] @param {number} [catchupWaitMs] */
export async function WaitFedConverged(node, groupId, probe, timeoutSec = 120, intervalSec = 3, catchupWaitMs = 6000) {
	const deadline = Date.now() + timeoutSec * 1000
	do {
		await InvokeFedCatchupSync(node, groupId, catchupWaitMs)
		if (await probe()) return true
		await sleep(intervalSec * 1000)
	} while (Date.now() < deadline)
	return false
}

/** @param {() => Promise<boolean>} probe @param {number} [timeoutSec] @param {number} [intervalSec] */
export async function WaitFedLive(probe, timeoutSec = 90, intervalSec = 3) {
	return PollUntil(timeoutSec, intervalSec, probe)
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId */
export async function TestFedHasMessage(node, groupId, channelId, eventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	return response.json?.messages?.some(row => row.eventId === eventId) ?? false
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId @param {string | RegExp} pattern */
export async function TestFedMessageContent(node, groupId, channelId, eventId, pattern) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	const row = response.json?.messages?.find(item => item.eventId === eventId)
	if (!row) return false
	const text = row.content?.content_for_show || row.content?.content || ''
	return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId */
export async function TestFedMessageDeleted(node, groupId, channelId, eventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	return !response.json?.messages?.some(row => row.eventId === eventId)
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} targetEventId */
export async function TestFedHasReaction(node, groupId, channelId, targetEventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	const entry = response.json?.reactions?.[targetEventId]
	if (!entry) return false
	return Object.values(entry).some(row => row?.voters?.length >= 1)
}

/** @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId */
export async function TestFedHasChannel(node, groupId, channelId) {
	const state = await Api(node, 'GET', `/groups/${groupId}/state`)
	return state.status === 200 && state.json?.meta?.channels?.[channelId] != null
}

/** @param {string} groupId */
export async function AssertFedPeersReady(groupId) {
	const peersA = await Api(FedA, 'GET', `/groups/${groupId}/peers`)
	const peersB = await Api(FedB, 'GET', `/groups/${groupId}/peers`)
	if (peersA.status !== 200) throw new Error(`NodeA peers probe failed: ${peersA.status}`)
	if (peersB.status !== 200) throw new Error(`NodeB peers probe failed: ${peersB.status}`)
	console.log(`  NodeA peers: ${peersA.json?.peers?.length ?? 0} federationEnabled=${peersA.json?.federationEnabled}`)
	console.log(`  NodeB peers: ${peersB.json?.peers?.length ?? 0} federationEnabled=${peersB.json?.federationEnabled}`)
	const catchA = await Api(FedA, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 3000 })
	const catchB = await Api(FedB, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 3000 })
	if (catchA.status !== 200) throw new Error(`NodeA catchup probe failed: ${catchA.status}`)
	if (catchB.status !== 200) throw new Error(`NodeB catchup probe failed: ${catchB.status}`)
	console.log(`  NodeA catchup: federationActive=${catchA.json?.federationActive} tips=${catchA.json?.tipsCollected}`)
	console.log(`  NodeB catchup: federationActive=${catchB.json?.federationActive} tips=${catchB.json?.tipsCollected}`)
}

/** @param {string} name @param {string | null} seedText @param {LiveNodeHandle[]} joinNodes */
export async function InitializeOpenGroupJoinMulti(name, seedText, joinNodes) {
	const group = (await Api(FedA, 'POST', '/groups/', { name, description: 'L4 fed probe' })).json
	const groupId = group.groupId
	const channelId = group.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${groupId}/settings`, { joinPolicy: 'open' })
	const invite = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: 3_600_000 })).json
	let seedEventId = null
	if (seedText)
		seedEventId = (await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
			content: { type: 'text', content: seedText },
		})).json?.event?.id

	const minMembers = 1 + joinNodes.length
	let joined = 0
	for (const node of joinNodes) {
		const join = await Api(node, 'POST', `/groups/${groupId}/join`, {
			roomSecret: invite.roomSecret,
			signalingAppId: invite.signalingAppId,
			introducerPubKeyHash: invite.introducerPubKeyHash,
		})
		if (join.status !== 200) throw new Error(`${node.name} join failed: ${join.status} ${join.raw}`)
		joined++
		const need = 1 + joined
		const okJoin = await WaitFedMembers(FedA, groupId, need, 120)
		if (!okJoin) throw new Error(`federation health gate after ${node.name} join: members>=${need}`)
		await Api(node, 'POST', `/groups/${groupId}/federation/rebind`, {})
		await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 8000 })
	}
	for (const node of [FedA, ...joinNodes])
		await Api(node, 'POST', `/groups/${groupId}/federation/rebind`, {})

	const meshOk = await PollUntil(90, 4, async () => {
		for (const node of [FedA, ...joinNodes])
			await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 6000 })

		const state = await Api(FedA, 'GET', `/groups/${groupId}/state`)
		return state.status === 200 && Number(state.json?.meta?.memberCount) >= minMembers
	})
	if (!meshOk) throw new Error(`federation mesh warmup: members>=${minMembers}`)
	return { groupId, channelId, seedEventId, invite }
}

/** @param {string} name @param {string | null} seedText */
export async function InitializeOpenGroupJoin(name, seedText) {
	const group = (await Api(FedA, 'POST', '/groups/', { name, description: 'L4 fed probe' })).json
	const groupId = group.groupId
	const channelId = group.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${groupId}/settings`, { joinPolicy: 'open' })
	const invite = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: 3_600_000 })).json
	let seedEventId = null
	if (seedText)
		seedEventId = (await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
			content: { type: 'text', content: seedText },
		})).json?.event?.id

	const join = await Api(FedB, 'POST', `/groups/${groupId}/join`, {
		roomSecret: invite.roomSecret,
		signalingAppId: invite.signalingAppId,
		introducerPubKeyHash: invite.introducerPubKeyHash,
	})
	if (join.status !== 200) throw new Error(`B join failed: ${join.status} ${join.raw}`)
	let ok = await WaitFedMembers(FedB, groupId)
	if (!ok)
		ok = await PollUntil(60, 4, async () => {
			await Api(FedA, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 6000 })
			await Api(FedA, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
			await Api(FedB, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: 6000 })
			await Api(FedB, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
			const state = await Api(FedB, 'GET', `/groups/${groupId}/state`)
			return state.status === 200 && Number(state.json?.meta?.memberCount) >= 2
		})

	if (!ok) {
		const inviteRetry = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: 3_600_000 })).json
		await Api(FedB, 'POST', `/groups/${groupId}/join`, {
			roomSecret: inviteRetry.roomSecret,
			signalingAppId: inviteRetry.signalingAppId,
			introducerPubKeyHash: inviteRetry.introducerPubKeyHash,
		})
		ok = await WaitFedMembers(FedB, groupId, 2, 120)
	}
	if (!ok) throw new Error('federation health gate: B never reached members>=2')
	return { groupId, channelId, seedEventId, invite }
}

/** @param {unknown} row */
function testFedTestGroup(row) {
	if (row == null) return false
	const name = String(row.name || '')
	const description = String(row.description || '')
	if (name.startsWith('Fed')) return true
	if (name.startsWith('DM ·')) return true
	if (description.includes('L4 fed probe')) return true
	if (description.includes('federation test')) return true
	return false
}

/** @param {LiveNodeHandle} node */
async function getFedTestGroupIds(node) {
	const list = await Api(node, 'GET', '/groups/')
	if (list.status !== 200) return []
	return list.json?.filter(testFedTestGroup).map(row => String(row.groupId)).filter(Boolean) ?? []
}

/** @param {LiveNodeHandle} node @param {string[]} groupIds */
async function invokeGroupLeaveBestEffort(node, groupIds) {
	const ids = [...new Set(groupIds.filter(Boolean))]
	if (!ids.length) return
	try {
		const leave = await Api(node, 'POST', '/groups/leave', { groupIds: ids })
		if (leave.status === 200) {
			console.log(`  leave[${node.name}] count=${ids.length}`)
			return
		}
	}
	catch { /* fall through */ }
	for (const id of ids)
		try { await Api(node, 'DELETE', `/groups/${id}`) } catch { /* ignore */ }
}

/** @param {string} tag @param {string} [groupId] */
export function WriteFedSummary(tag, groupId) {
	writeLiveSummary(tag)
	if (groupId) console.log(`groupId=${groupId}`)
}

export { completeLiveScript, skipCase, testCase }

export async function ClearFedTestGroups() {
	console.log('\n=== Cleanup all test groups ===')
	for (const node of FedNodes)
		try {
			const ids = await getFedTestGroupIds(node)
			if (ids.length) await invokeGroupLeaveBestEffort(node, ids)
			else console.log(`  leave[${node.name}] none`)
		}
		catch (error) {
			console.log(`  cleanup WARN [${node.name}] ${error.message}`)
		}
}

/** @param {string} groupId */
export async function ClearFedGroup(groupId) {
	if (!groupId) return
	console.log('\n=== Cleanup ===')
	for (const node of [...FedNodes].sort((a, b) => (b.index ?? 0) - (a.index ?? 0)))
		try {
			await invokeGroupLeaveBestEffort(node, [groupId])
			console.log(`  cleanup[${node.name}] done for ${groupId}`)
		}
		catch (error) {
			console.log(`  cleanup WARN [${node.name}] ${groupId} ${error.message}`)
		}

	await ClearFedTestGroups()
}
