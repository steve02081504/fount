import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import * as ed25519 from 'npm:@noble/ed25519'

import { canonicalStringify } from './canonical_json.mjs'
import { HLC } from './hlc.mjs'

/**
 * 多父 DAG：`prev_event_ids` 字典序稳定；验签与事件 ID 均基于确定性 canonical JSON。
 */

/**
 * 规范化父 id 列表：去重、去空、字典序（§6 验签域）。
 * @param {unknown} raw - 原始 prev_event_ids 字段（任意类型）
 * @returns {string[]} 去重并字典序排序后的父事件 id 数组
 */
export function sortedPrevEventIds(raw) {
	if (raw == null) return []
	if (!Array.isArray(raw)) return []
	return [...new Set(raw.filter(x => typeof x === 'string' && x.length > 0))].sort()
}

/**
 * 从事件中取出参与 ID 计算与签名的字段（不含 id、signature、received_at 等）。
 * @param {object} event - 完整事件对象
 * @returns {object} 用于 canonical 序列化与验签的正文子集
 */
export function eventBodyForSign(event) {
	const channelId = event.channelId ?? null
	const charId = event.charId ?? null
	const hlc = event.hlc && typeof event.hlc === 'object'
		? event.hlc
		: { wall: Number(event.timestamp) || 0, logical: 0 }
	const body = {
		type: event.type,
		groupId: event.groupId,
		channelId,
		sender: event.sender,
		charId,
		timestamp: event.timestamp,
		hlc,
		prev_event_ids: sortedPrevEventIds(event.prev_event_ids),
		content: event.content,
	}
	if (event.node_id !== undefined && event.node_id !== null)
		body.node_id = event.node_id

	return stripUndefined(body)
}

/**
 * 移除对象中值为 `undefined` 的键（浅拷贝）。
 * @param {object} o - 输入对象
 * @returns {object} 不含 undefined 值的浅拷贝
 */
function stripUndefined(o) {
	/** @type {Record<string, unknown>} */
	const out = {}
	for (const [k, v] of Object.entries(o))
		if (v !== undefined) out[k] = v

	return out
}

/**
 * 事件 ID = SHA256(canonical unsigned body) 十六进制
 * @param {object} body `eventBodyForSign` 或同形对象
 * @returns {string} SHA256 十六进制事件 id
 */
export function computeEventId(body) {
	const b = { ...body }
	if ('prev_event_ids' in b) b.prev_event_ids = sortedPrevEventIds(b.prev_event_ids)
	return createHash('sha256').update(canonicalStringify(stripUndefined(b)), 'utf8').digest('hex')
}

/**
 * 验签 / 哈希用的 UTF-8 字节序列
 * @param {object} body - 与 `computeEventId` 同形的正文对象
 * @returns {import('node:buffer').Buffer} canonical JSON 的 UTF-8 字节
 */
export function signPayloadBytes(body) {
	const b = { ...body }
	if ('prev_event_ids' in b) b.prev_event_ids = sortedPrevEventIds(b.prev_event_ids)
	return Buffer.from(canonicalStringify(stripUndefined(b)), 'utf8')
}

/**
 * 规范拓扑序（Kahn + tiebreaker：hlc.wall, hlc.logical, node_id, id；与分布式群聊规范 §4 一致）。
 * @param {Array<{ id: string, prev_event_ids?: unknown, hlc?: { wall: number, logical: number }, sender?: string, node_id?: string }>} metas - 事件元数据列表（至少含 id 与父引用）
 * @returns {string[]} 按规范顺序排列的事件 id 列表
 */
export function topologicalCanonicalOrder(metas) {
	if (!metas.length) return []
	const byId = new Map(metas.map(m => [m.id, m]))
	const parentCount = new Map()
	for (const m of metas) {
		const c = sortedPrevEventIds(m.prev_event_ids).filter(p => byId.has(p)).length
		parentCount.set(m.id, c)
	}

	/**
	 * 读取事件的 HLC，缺省为 0。
	 * @param {string} id - 事件 id
	 * @returns {{ wall: number, logical: number }} wall 与 logical 分量
	 */
	const hlcOf = id => {
		const m = byId.get(id)
		const h = m?.hlc
		if (h && typeof h === 'object') return { wall: Number(h.wall) || 0, logical: Number(h.logical) || 0 }
		return { wall: 0, logical: 0 }
	}

	/**
	 * 规范 tie-break 比较两个事件 id。
	 * @param {string} a - 事件 id
	 * @param {string} b - 事件 id
	 * @returns {number} 小于零、零或大于零
	 */
	const cmpIds = (a, b) => {
		const ha = hlcOf(a), hb = hlcOf(b)
		if (ha.wall !== hb.wall) return ha.wall - hb.wall
		if (ha.logical !== hb.logical) return ha.logical - hb.logical
		const na = String(byId.get(a)?.node_id || ''), nb = String(byId.get(b)?.node_id || '')
		if (na !== nb) return na.localeCompare(nb)
		return a.localeCompare(b)
	}

	const out = []
	const ready = new Set(metas.filter(m => parentCount.get(m.id) === 0).map(m => m.id))

	while (ready.size) {
		const next = [...ready].sort(cmpIds)[0]
		ready.delete(next)
		out.push(next)
		for (const m of metas) {
			if (m.id === next) continue
			const ps = sortedPrevEventIds(m.prev_event_ids)
			if (!ps.includes(next)) continue
			const left = (parentCount.get(m.id) || 0) - 1
			parentCount.set(m.id, left)
			if (left === 0) ready.add(m.id)
		}
	}

	if (out.length < metas.length) {
		const rest = metas.map(m => m.id).filter(id => !out.includes(id)).sort(cmpIds)
		out.push(...rest)
	}

	return out
}

/**
 * @deprecated 使用 `computeEventId(eventBodyForSign(event))`
 * @param {object} event - 完整事件对象
 * @returns {Promise<string>} 与 `computeEventId` 一致的事件 id
 */
export async function generateEventId(event) {
	return computeEventId(eventBodyForSign(event))
}

/**
 * 签名事件（签名为不含 id 的 canonical body）
 * @param {object} event - 含完整字段；可含占位 id
 * @param {Uint8Array} privateKey - 私钥
 * @returns {Promise<string>} 十六进制 Ed25519 签名（失败时为 SHA256 回退串）
 */
export async function signEvent(event, privateKey) {
	try {
		const body = eventBodyForSign(event)
		const message = signPayloadBytes(body)
		const signature = await ed25519.sign(message, privateKey)
		return Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('')
	}
	catch {
		const fallbackData = new TextEncoder().encode(String(event.id) + String(event.sender) + String(event.timestamp))
		const hash = await crypto.subtle.digest('SHA-256', fallbackData)
		return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
	}
}

/**
 * 验证事件签名
 * @param {object} event - 含 signature、sender 与正文字段的完整事件
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyEventSignature(event) {
	try {
		/**
		 * 判断字符串是否为合法十六进制。
		 * @param {unknown} s - 待检测值
		 * @param {number} [expectedLen] - 期望字符长度（可选）
		 * @returns {boolean} 是否为合法 hex
		 */
		const isHex = (s, expectedLen) =>
			typeof s === 'string' &&
			(!expectedLen || s.length === expectedLen) &&
			s.length % 2 === 0 &&
			/^[0-9a-f]+$/iu.test(s)

		if (!isHex(event?.signature, 128) || !isHex(event?.sender, 64))
			return false

		const body = eventBodyForSign(event)
		const message = signPayloadBytes(body)
		const signature = new Uint8Array(event.signature.match(/.{2}/g).map(byte => parseInt(byte, 16)))
		const publicKey = new Uint8Array(event.sender.match(/.{2}/g).map(byte => parseInt(byte, 16)))
		return await ed25519.verify(signature, message, publicKey)
	}
	catch (error) {
		console.error('Signature verification failed:', error)
		return false
	}
}

/**
 * DAG 拓扑排序（多父 DFS 后按 HLC 排序）
 * @param {Array<object>} events - 事件列表（须含 id、prev_event_ids、hlc、sender）
 * @returns {Array<object>} 拓扑序排列后的事件数组
 */
export function topologicalSort(events) {
	const eventMap = new Map(events.map(e => [e.id, e]))
	const sorted = []
	const visited = new Set()
	const visiting = new Set()

	/**
	 * DFS 访问单条事件及其父链。
	 * @param {string} eventId - 当前事件 id
	 * @returns {void}
	 */
	function visit(eventId) {
		if (visited.has(eventId)) return
		if (visiting.has(eventId))
			return


		visiting.add(eventId)
		const event = eventMap.get(eventId)
		if (event) {
			const parents = sortedPrevEventIds(event.prev_event_ids)
			for (const p of parents)
				if (eventMap.has(p)) visit(p)
		}

		visiting.delete(eventId)
		visited.add(eventId)
		if (event) sorted.push(event)
	}

	for (const event of events)
		visit(event.id)


	return sorted.sort((a, b) => {
		if (a.hlc.wall !== b.hlc.wall) return a.hlc.wall - b.hlc.wall
		if (a.hlc.logical !== b.hlc.logical) return a.hlc.logical - b.hlc.logical
		return a.sender.localeCompare(b.sender)
	})
}

/**
 * 创建新事件
 * @param {object} params - 事件字段与签名私钥等构造参数
 * @param {string[]} [params.prev_event_ids] 父事件 id；根事件 `[]`
 * @returns {Promise<object>} 含 id、signature 的完整事件对象
 */
export async function createEvent(params) {
	const {
		type, groupId, channelId, sender, charId, content, prev_event_ids, privateKey, hlc,
	} = params

	const event = {
		type,
		groupId,
		channelId: channelId || null,
		sender,
		charId: charId || null,
		timestamp: Date.now(),
		hlc: hlc || HLC.now(),
		prev_event_ids: sortedPrevEventIds(prev_event_ids),
		content,
	}

	event.id = computeEventId(eventBodyForSign(event))
	event.signature = await signEvent(event, privateKey)

	return event
}
