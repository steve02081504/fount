/**
 * L4 联邦 live 探针共用库（支持 FOUNT_TEST_NODE_COUNT 个节点）。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { ms } from '../../../ms.mjs'
import {
	invokeMultipart,
	invokeRequest,
	sleep,
	TEST_PNG_BYTES,
} from '../http.mjs'
import { completeLiveScript, skipCase, testCase, writeLiveSummary } from '../singleNode/helpers.mjs'

/** @typedef {import('../http.mjs').LiveNodeHandle} LiveNodeHandle */

/**
 * @param {number} index 下标
 * @returns {LiveNodeHandle} 联邦 live 节点句柄
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

/**
 * @param {LiveNodeHandle} node 联邦节点
 * @returns {void} 无
 */
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

/**
 * @returns {LiveNodeHandle[]} 已加载节点列表
 */
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
/**
 *
 */
export const FedPngBytes = TEST_PNG_BYTES

/**
 * @param {LiveNodeHandle} node @param {string} method @param {string} p2pPath @param {unknown} [body]
 * @param {string} method HTTP 方法
 * @param {string} p2pPath P2P API 路径
 * @param {object | undefined} body 请求体
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} P2P API 响应
 */
export async function P2pApi(node, method, p2pPath, body) {
	return invokeRequest(node, method, `/api/p2p${p2pPath}`, body)
}

/**
 * @param {LiveNodeHandle} node @param {string} method @param {string} chatPath @param {unknown} [body]
 * @param {string} method HTTP 方法
 * @param {string} chatPath chat API 路径
 * @param {object | undefined} body 请求体
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} Chat API 响应
 */
export async function Api(node, method, chatPath, body) {
	return invokeRequest(node, method, chatPath, body, { shell: 'chat' })
}

/**
 * @param {LiveNodeHandle} node @param {string} shell @param {string} method @param {string} shellPath @param {unknown} [body]
 * @param {string} shell shell 名
 * @param {string} method HTTP 方法
 * @param {string} shellPath shell API 路径
 * @param {object | undefined} body 请求体
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} shell API 响应
 */
export async function ShellApi(node, shell, method, shellPath, body) {
	return invokeRequest(node, method, shellPath, body, { shell })
}

/**
 * @param {LiveNodeHandle} node @param {string} method @param {string} rootPath @param {unknown} [body]
 * @param {string} method HTTP 方法
 * @param {string} rootPath 根路径
 * @param {object | undefined} body 请求体
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} 根路径 API 响应
 */
export async function RootApi(node, method, rootPath, body) {
	return invokeRequest(node, method, rootPath, body, { timeoutSec: 60 })
}

/**
 * @param {LiveNodeHandle} node @param {string} method @param {string} chatPath @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType]
 * @param {string} method HTTP 方法
 * @param {string} chatPath chat API 路径
 * @param {Record<string, string>} fields 表单字段
 * @param {string} fileField 表单文件字段名
 * @param {string} fileName 文件名
 * @param {Uint8Array | Buffer} fileBytes 文件字节
 * @param {string} [contentType] MIME 类型
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} multipart 响应
 */
export async function ApiMultipart(node, method, chatPath, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
	return invokeMultipart(node, 'chat', method, chatPath, fields, fileField, fileName, fileBytes, contentType)
}

/**
 * @param {LiveNodeHandle} node @param {string} shell @param {string} method @param {string} shellPath @param {Record<string,string|number|boolean>} fields @param {string} fileField @param {string} fileName @param {Uint8Array} fileBytes @param {string} [contentType]
 * @param {string} shell shell 名
 * @param {string} method HTTP 方法
 * @param {string} shellPath shell API 路径
 * @param {Record<string, string>} fields 表单字段
 * @param {string} fileField 表单文件字段名
 * @param {string} fileName 文件名
 * @param {Uint8Array | Buffer} fileBytes 文件字节
 * @param {string} [contentType] MIME 类型
 * @returns {Promise<import('../http.mjs').LiveHttpResponse>} multipart 响应
 */
export const ShellApiMultipart = (node, shell, method, shellPath, fields, fileField, fileName, fileBytes, contentType = 'image/png') =>
	invokeMultipart(node, shell, method, shellPath, fields, fileField, fileName, fileBytes, contentType)

/**
 * @param {number} timeoutSec @param {number} intervalSec @param {() => Promise<boolean>} probe
 * @param {number} intervalSec 轮询间隔秒
 * @param {Function} probe 探测回调
 * @returns {Promise<boolean>} 超时前最后一次探测结果
 */
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

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {number} [waitMs]
 * @param {string} groupId 群 ID
 * @param {number} [waitMs] 等待毫秒
 * @returns {Promise<void>} 无
 */
export async function InvokeFedCatchupSync(node, groupId, waitMs = ms('6s')) {
	await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs })
	await Api(node, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {number} [minMembers] @param {number} [timeoutSec]
 * @param {string} groupId 群 ID
 * @param {number} [minMembers] 最少成员数
 * @param {number} [timeoutSec] 超时秒数
 * @returns {Promise<boolean>} 成员数是否达到门槛
 */
export async function WaitFedMembers(node, groupId, minMembers = 2, timeoutSec = 120) {
	return PollUntil(timeoutSec, 3, async () => {
		await InvokeFedCatchupSync(node, groupId, ms('5s'))
		const state = await Api(node, 'GET', `/groups/${groupId}/state`)
		return state.status === 200
			&& state.json?.viewer?.isMember === true
			&& Number(state.json?.meta?.memberCount) >= minMembers
	})
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {() => Promise<boolean>} probe @param {number} [timeoutSec] @param {number} [intervalSec] @param {number} [catchupWaitMs]
 * @param {string} groupId 群 ID
 * @param {Function} probe 探测回调
 * @param {number} [timeoutSec] 超时秒数
 * @param {number} [intervalSec] 轮询间隔秒
 * @param {number} [catchupWaitMs] 追赶等待毫秒
 * @returns {Promise<boolean>} probe 是否在超时前成功
 */
export async function WaitFedConverged(node, groupId, probe, timeoutSec = 120, intervalSec = 3, catchupWaitMs = 6000) {
	const deadline = Date.now() + timeoutSec * 1000
	do {
		await InvokeFedCatchupSync(node, groupId, catchupWaitMs)
		if (await probe()) return true
		await sleep(intervalSec * 1000)
	} while (Date.now() < deadline)
	return false
}

/**
 * @param {() => Promise<boolean>} probe @param {number} [timeoutSec] @param {number} [intervalSec]
 * @param {number} [timeoutSec] 超时秒数
 * @param {number} [intervalSec] 轮询间隔秒
 * @returns {Promise<boolean>} probe 是否在超时前成功
 */
export async function WaitFedLive(probe, timeoutSec = 90, intervalSec = 3) {
	return PollUntil(timeoutSec, intervalSec, probe)
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 ID
 * @returns {Promise<boolean>} 频道是否含目标消息
 */
export async function TestFedHasMessage(node, groupId, channelId, eventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	return response.json?.messages?.some(row => row.eventId === eventId) ?? false
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId @param {string | RegExp} pattern
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 ID
 * @param {unknown} pattern pattern
 * @returns {Promise<boolean>} 消息正文是否匹配 pattern
 */
export async function TestFedMessageContent(node, groupId, channelId, eventId, pattern) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	const row = response.json?.messages?.find(item => item.eventId === eventId)
	if (!row) return false
	const text = row.content?.content_for_show || row.content?.content || ''
	return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} eventId
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 事件 ID
 * @returns {Promise<boolean>} 目标消息是否已删除
 */
export async function TestFedMessageDeleted(node, groupId, channelId, eventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	return !response.json?.messages?.some(row => row.eventId === eventId)
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId @param {string} targetEventId
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 目标事件 ID
 * @returns {Promise<boolean>} 目标消息是否有反应
 */
export async function TestFedHasReaction(node, groupId, channelId, targetEventId) {
	const response = await Api(node, 'GET', `/groups/${groupId}/channels/${channelId}/messages`)
	if (response.status !== 200) return false
	const entry = response.json?.reactions?.[targetEventId]
	if (!entry) return false
	return Object.values(entry).some(row => row?.voters?.length >= 1)
}

/**
 * @param {LiveNodeHandle} node @param {string} groupId @param {string} channelId
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<boolean>} 频道是否存在于群状态
 */
export async function TestFedHasChannel(node, groupId, channelId) {
	const state = await Api(node, 'GET', `/groups/${groupId}/state`)
	return state.status === 200 && state.json?.meta?.channels?.[channelId] != null
}

/**
 * @param {string} name @param {string | null} seedText @param {LiveNodeHandle[]} joinNodes
 * @param {string} seedText 种子文本
 * @param {object[]} joinNodes 加入节点
 * @returns {Promise<{ groupId: string, channelId: string, seedEventId: string | null, invite: object }>} 开放群加入上下文
 */
export async function InitializeOpenGroupJoinMulti(name, seedText, joinNodes) {
	const group = (await Api(FedA, 'POST', '/groups/', { name, description: 'L4 fed probe' })).json
	const groupId = group.groupId
	const channelId = group.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${groupId}/settings`, { joinPolicy: 'open' })
	const invite = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: ms('1h') })).json
	let seedEventId = null
	if (seedText)
		seedEventId = (await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
			content: { type: 'text', content: seedText },
		})).json?.event?.id

	const minMembers = 1 + joinNodes.length
	await WarmupFedNodeLinks([FedA, ...joinNodes])
	await Api(FedA, 'POST', `/groups/${groupId}/federation/rebind`, {})
	let joined = 0
	for (const node of joinNodes) {
		const join = await Api(node, 'POST', `/groups/${groupId}/join`, {
			roomSecret: invite.roomSecret,
			signalingAppId: invite.signalingAppId,
			introducerPubKeyHash: invite.introducerPubKeyHash,
			introducerNodeHash: invite.introducerNodeHash,
		})
		if (join.status !== 200) throw new Error(`${node.name} join failed: ${join.status} ${join.raw}`)
		joined++
		const need = 1 + joined
		const okJoin = await WaitFedMembers(FedA, groupId, need, 120)
		if (!okJoin) throw new Error(`federation health gate after ${node.name} join: members>=${need}`)
		await Api(node, 'POST', `/groups/${groupId}/federation/rebind`, {})
		await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: ms('8s') })
	}
	for (const node of [FedA, ...joinNodes])
		await Api(node, 'POST', `/groups/${groupId}/federation/rebind`, {})

	const meshOk = await PollUntil(90, 4, async () => {
		for (const node of [FedA, ...joinNodes])
			await Api(node, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: ms('6s') })

		const state = await Api(FedA, 'GET', `/groups/${groupId}/state`)
		return state.status === 200 && Number(state.json?.meta?.memberCount) >= minMembers
	})
	if (!meshOk) throw new Error(`federation mesh warmup: members>=${minMembers}`)
	return { groupId, channelId, seedEventId, invite }
}

/**
 * 双端互拨 user-room，减少 join / CAS 路径冷启动失败。
 * @param {LiveNodeHandle[]} nodes 节点列表
 * @returns {Promise<void>} 无
 */
export async function WarmupFedNodeLinks(nodes) {
	/** @type {Array<{ node: LiveNodeHandle, nodeHash: string }>} */
	const identities = []
	for (const node of nodes) {
		const view = await P2pApi(node, 'GET', '/federation')
		if (view.status === 200 && view.json.nodeHash)
			identities.push({ node, nodeHash: String(view.json.nodeHash).trim().toLowerCase() })
	}
	for (const { node, nodeHash } of identities)
		for (const { node: peer, nodeHash: peerHash } of identities)
			if (peer.name !== node.name)
				await P2pApi(node, 'POST', '/federation/connect-node', { targetNodeHash: peerHash })
}

/**
 * @param {string} name @param {string | null} seedText
 * @param {string} seedText 种子文本
 * @returns {Promise<{ groupId: string, channelId: string, seedEventId: string | null, invite: object }>} 双节点开放群加入上下文
 */
export async function InitializeOpenGroupJoin(name, seedText) {
	const group = (await Api(FedA, 'POST', '/groups/', { name, description: 'L4 fed probe' })).json
	const groupId = group.groupId
	const channelId = group.defaultChannelId
	await Api(FedA, 'PUT', `/groups/${groupId}/settings`, { joinPolicy: 'open' })
	const invite = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: ms('1h') })).json
	let seedEventId = null
	if (seedText)
		seedEventId = (await Api(FedA, 'POST', `/groups/${groupId}/channels/${channelId}/messages`, {
			content: { type: 'text', content: seedText },
		})).json?.event?.id

	await WarmupFedNodeLinks([FedA, FedB])
	await Api(FedA, 'POST', `/groups/${groupId}/federation/rebind`, {})

	const join = await Api(FedB, 'POST', `/groups/${groupId}/join`, {
		roomSecret: invite.roomSecret,
		signalingAppId: invite.signalingAppId,
		introducerPubKeyHash: invite.introducerPubKeyHash,
		introducerNodeHash: invite.introducerNodeHash,
	})
	if (join.status !== 200) throw new Error(`B join failed: ${join.status} ${join.raw}`)
	let ok = await WaitFedMembers(FedB, groupId)
	if (!ok)
		ok = await PollUntil(60, 4, async () => {
			await Api(FedA, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: ms('6s') })
			await Api(FedA, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
			await Api(FedB, 'POST', `/groups/${groupId}/federation/catchup`, { waitMs: ms('6s') })
			await Api(FedB, 'POST', `/groups/${groupId}/dag/merge-tips`, {})
			const state = await Api(FedB, 'GET', `/groups/${groupId}/state`)
			return state.status === 200 && Number(state.json?.meta?.memberCount) >= 2
		})

	if (!ok) {
		const inviteRetry = (await Api(FedA, 'POST', `/groups/${groupId}/invite-ticket`, { ttlMs: ms('1h') })).json
		await Api(FedB, 'POST', `/groups/${groupId}/join`, {
			roomSecret: inviteRetry.roomSecret,
			signalingAppId: inviteRetry.signalingAppId,
			introducerPubKeyHash: inviteRetry.introducerPubKeyHash,
			introducerNodeHash: inviteRetry.introducerNodeHash,
		})
		ok = await WaitFedMembers(FedB, groupId, 2, 120)
	}
	if (!ok) throw new Error('federation health gate: B never reached members>=2')
	return { groupId, channelId, seedEventId, invite }
}

/**
 * @param {unknown} row 群列表行
 * @returns {boolean} 是否为联邦测试群
 */
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

/**
 * @param {LiveNodeHandle} node 联邦节点
 * @returns {Promise<string[]>} 测试群 ID 列表
 */
async function getFedTestGroupIds(node) {
	const list = await Api(node, 'GET', '/groups/')
	if (list.status !== 200) return []
	return list.json?.filter(testFedTestGroup).map(row => String(row.groupId)).filter(Boolean) ?? []
}

/**
 * @param {LiveNodeHandle} node @param {string[]} groupIds
 * @param {string[]} groupIds 群 ID 列表
 * @returns {Promise<void>} 无
 */
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

/**
 * @param {string} tag @param {string} [groupId]
 * @param {string} groupId 群 ID
 * @returns {void} 无
 */
export function WriteFedSummary(tag, groupId) {
	writeLiveSummary(tag)
	if (groupId) console.log(`groupId=${groupId}`)
}

/**
 *
 */
export { completeLiveScript, skipCase, testCase }

/**
 * @returns {Promise<void>} 无
 */
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

/**
 * @param {string} groupId 群 ID
 * @returns {Promise<void>} 无
 */
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
