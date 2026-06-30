import { randomUUID } from 'node:crypto'

import { dispatchInbound } from './inbound_registry.mjs'
import { getNodeHash } from './node_context.mjs'
import {
	isPartInvokeResponse,
	normalizePartpath,
	unwrapPartInvokeResult,
} from './part_invoke.mjs'
import { getShellPartpath } from './part_path_registry.mjs'
import { isPlainObject } from './wire_ingress.mjs'

/** @typedef {import('./part_invoke.mjs').PartInvokeResponse} PartInvokeResponse */

/** @type {Map<string, { responses: PartInvokeResponse[], finish: () => void, maxResponses: number, respondedPeers: Set<string> }>} */
const pendingPartInvoke = new Map()

/**
 * @typedef {{
 *   send: (name: string, payload: unknown, peerId: string | null) => void
 *   on: (name: string, handler: (payload: unknown, peerId: string) => void) => void
 * }} PartWireAdapter
 */

/**
 * @typedef {{ replicaUsername?: string }} PartWireContext
 */

/**
 * @param {object} data 入站 part_timeline_put 载荷
 * @param {string} partpath 已规范化 part 路径
 * @returns {object | null} 白名单字段
 */
function parsePartTimelinePut(data, partpath) {
	const timelineEntityHash = String(data.timelineEntityHash || '').trim().toLowerCase()
	if (!timelineEntityHash || !isPlainObject(data.event)) return null
	return {
		type: 'part_timeline_put',
		partpath,
		timelineEntityHash,
		event: data.event,
		...data.nodeHash ? { nodeHash: String(data.nodeHash).trim() } : {},
		...data.groupId ? { groupId: String(data.groupId).trim() } : {},
	}
}

/**
 * @param {object} fields 载荷字段
 * @param {string} fields.partpath part 路径
 * @param {object} fields.invoke 调用体
 * @param {string} [fields.nodeHash] 来源节点
 * @param {string} [fields.requestId] RPC 请求 id
 * @param {string} [fields.groupId] 群上下文（mailbox give ingest）
 * @returns {object} part_invoke 线载荷
 */
export function buildPartInvokePayload({ partpath, invoke, nodeHash, requestId, groupId }) {
	return {
		partpath,
		invoke,
		...nodeHash ? { nodeHash } : {},
		...requestId ? { requestId } : {},
		...groupId ? { groupId } : {},
	}
}

/**
 * 挂载 part_timeline_put / part_invoke / part_invoke_response。
 * @param {PartWireContext} ctx 入站上下文
 * @param {PartWireAdapter} wire Trystero 适配器
 * @param {{ allowPartInvoke?: (payload: object) => boolean }} [options] 入站过滤
 * @returns {void}
 */
export function attachPartWire(ctx, wire, options = {}) {
	wire.on('part_timeline_put', data => {
		if (!isPlainObject(data)) return
		const partpath = normalizePartpath(data.partpath)
		if (!partpath) return
		const message = parsePartTimelinePut(data, partpath)
		if (!message) return
		void dispatchInbound({
			replicaUsername: ctx.replicaUsername,
			requesterNodeHash: data.nodeHash ? String(data.nodeHash).trim() : null,
		}, message)
	})

	wire.on('part_invoke', (data, peerId) => {
		if (!isPlainObject(data)) return
		if (options.allowPartInvoke?.(data) === false) return
		void handleIncomingPartInvoke(ctx, data, wire, peerId)
	})

	wire.on('part_invoke_response', (data, peerId) => {
		if (!isPlainObject(data)) return
		handleIncomingPartInvokeResponse(data, peerId)
	})
}

/**
 * @param {PartWireContext} ctx 入站上下文
 * @param {object} payload part_invoke 请求
 * @param {PartWireAdapter} wire 发送适配器
 * @param {string} peerId 对端
 * @returns {Promise<void>}
 */
export async function handleIncomingPartInvoke(ctx, payload, wire, peerId) {
	const partpath = normalizePartpath(payload?.partpath)
	const invoke = payload?.invoke
	if (!partpath || !isPlainObject(invoke)) return

	const response = await dispatchInbound({
		replicaUsername: ctx.replicaUsername,
		requesterNodeHash: payload.nodeHash ? String(payload.nodeHash).trim() : null,
		groupId: payload.groupId ? String(payload.groupId).trim() : undefined,
		peerId,
	}, {
		type: 'part_invoke',
		partpath,
		invoke,
		nodeHash: payload.nodeHash,
		groupId: payload.groupId,
		requestId: payload.requestId,
	})
	if (response == null) return

	if (payload.requestId) {
		try {
			wire.send('part_invoke_response', {
				requestId: payload.requestId,
				partpath,
				response,
			}, peerId)
		}
		catch { /* disconnected */ }
		return
	}

	const followUp = unwrapPartInvokeResult(response)
	if (!isPlainObject(followUp)) return
	try {
		wire.send('part_invoke', buildPartInvokePayload({
			partpath,
			invoke: followUp,
			nodeHash: payload.nodeHash,
			groupId: payload.groupId,
		}), peerId)
	}
	catch { /* disconnected */ }
}

/**
 * @param {object} payload 响应
 * @param {string} [peerId] Trystero 对端 id，用于同 peer 去重
 * @returns {void}
 */
export function handleIncomingPartInvokeResponse(payload, peerId = '') {
	const pending = pendingPartInvoke.get(String(payload?.requestId || ''))
	if (!pending || payload?.response == null) return
	const peerKey = String(peerId || payload?.nodeHash || '').trim()
	if (peerKey) {
		if (pending.respondedPeers.has(peerKey)) return
		pending.respondedPeers.add(peerKey)
	}
	if (!isPartInvokeResponse(payload.response)) return
	pending.responses.push(payload.response)
	if (pending.responses.length >= pending.maxResponses) pending.finish()
}

/**
 * @param {PartInvokeResponse[]} results collect 原始结果
 * @returns {object[]} 仅含成功 result 的载荷
 */
export function partInvokeDataRows(results) {
	/** @type {object[]} */
	const rows = []
	for (const row of results) {
		const data = unwrapPartInvokeResult(row)
		if (data != null) rows.push(/** @type {object} */ data)
	}
	return rows
}

/**
 * @param {PartInvokeResponse[]} results collect 原始结果
 * @returns {string[]} 邻居返回的错误信息
 */
export function partInvokeErrorMessages(results) {
	/** @type {string[]} */
	const errors = []
	for (const row of results) {
		const message = row?.error?.message
		if (message) errors.push(message)
	}
	return errors
}

/**
 * @param {string} username 用户（trust graph fanout 上下文）
 * @param {string} partpath part 路径
 * @param {object} invoke 调用体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<PartInvokeResponse[]>} 邻居 PartInvokeResponse（含 error）
 */
export async function collectPartInvokeResponses(username, partpath, invoke, timeoutMs = 2500, maxResponses = 6) {
	const { fanoutToTopNodes } = await import('./trust_graph.mjs')
	const requestId = randomUUID()
	const nodeHash = getNodeHash()
	/** @type {PartInvokeResponse[]} */
	const responses = []

	const waitForResponses = new Promise(resolve => {
		/**
		 *
		 */
		const finish = () => {
			clearTimeout(timer)
			pendingPartInvoke.delete(requestId)
			resolve(responses)
		}
		const timer = setTimeout(finish, timeoutMs)
		pendingPartInvoke.set(requestId, { responses, finish, maxResponses, respondedPeers: new Set() })
	})

	const sent = await fanoutToTopNodes(username, 'part_invoke', buildPartInvokePayload({
		partpath,
		invoke,
		nodeHash,
		requestId,
	}), maxResponses)

	const pending = pendingPartInvoke.get(requestId)
	if (pending && sent === 0) pending.finish()

	return waitForResponses
}

/**
 * @param {string} username 用户
 * @param {object} rpc social RPC 体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<PartInvokeResponse[]>} 邻居 PartInvokeResponse
 */
export function collectSocialRpcResponses(username, rpc, timeoutMs = 2500, maxResponses = 6) {
	return collectPartInvokeResponses(username, getShellPartpath('social'), wrapSocialRpc(rpc), timeoutMs, maxResponses)
}

/**
 * @param {string} username 用户
 * @param {object} rpc social RPC 体
 * @param {number} [timeoutMs=2500] 超时
 * @param {number} [maxResponses=6] 最多响应数
 * @returns {Promise<{ data: object[], errors: string[] }>} 成功 data 与邻居 error
 */
export async function collectSocialRpcMerged(username, rpc, timeoutMs = 2500, maxResponses = 6) {
	const results = await collectSocialRpcResponses(username, rpc, timeoutMs, maxResponses)
	return { data: partInvokeDataRows(results), errors: partInvokeErrorMessages(results) }
}

/**
 * @param {object} rpc social RPC 体（不含 kind）
 * @returns {object} part_invoke 调用体
 */
export function wrapSocialRpc(rpc) {
	return { kind: 'social_rpc', ...rpc }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {object} signedEvent 签名事件
 * @returns {Promise<number>} 发送次数
 */
export async function publishTimelineEvent(username, entityHash, signedEvent) {
	const { fanoutToTopNodes } = await import('./trust_graph.mjs')
	return fanoutToTopNodes(username, 'part_timeline_put', {
		nodeHash: getNodeHash(),
		partpath: getShellPartpath('social'),
		timelineEntityHash: entityHash.toLowerCase(),
		event: signedEvent,
	}, 8)
}

/**
 * 单向 part_invoke fanout（mailbox put 等）。
 * @param {string} username 用户
 * @param {string} partpath part 路径
 * @param {object} invoke 调用体
 * @param {number} limit fanout 上限
 * @param {string} [nodeHash] 来源节点
 * @param {string} [groupId] 群上下文
 * @returns {Promise<number>} 发送次数
 */
export async function fanoutPartInvoke(username, partpath, invoke, limit, nodeHash, groupId) {
	const { fanoutToTopNodes } = await import('./trust_graph.mjs')
	return fanoutToTopNodes(username, 'part_invoke', buildPartInvokePayload({
		partpath,
		invoke,
		nodeHash,
		groupId,
	}), limit)
}
