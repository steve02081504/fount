import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'


import { canonicalStringify } from '../canonical_json.mjs'
import { sign, verify } from '../crypto.mjs'
import { HEX_ID_64 } from '../hexIds.mjs'
import { HLC } from '../hlc.mjs'

/**
 * 重导出 64 位十六进制事件 ID 正则（`HEX_ID_64` 别名）。
 */
export { HEX_ID_64 as EVENT_ID_HEX }
const EVENT_ID_HEX = HEX_ID_64
const HEX_PAIR = /^[\da-f]{2}$/iu

/**
 * 对事件 id 列表做二叉 Merkle 根（字典序叶子，§7 checkpoint）。
 * @param {string[]} ids 事件 id
 * @returns {string} 64 位十六进制根
 */
export function merkleRoot(ids) {
	const sorted = [...new Set(ids.filter(id => EVENT_ID_HEX.test(String(id))))].sort()
	if (!sorted.length)
		return createHash('sha256').update('', 'utf8').digest('hex')
	/** @type {Buffer[]} */
	let level = sorted.map(id => createHash('sha256').update(id, 'utf8').digest())
	while (level.length > 1) {
		/** @type {Buffer[]} */
		const next = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = index + 1 < level.length ? level[index + 1] : left
			next.push(createHash('sha256').update(Buffer.concat([left, right])).digest())
		}
		level = next
	}
	return Buffer.from(level[0]).toString('hex')
}

/**
 * 本节点可见 DAG 叶集合摘要（§7.1 `local_tips_hash`）。
 * @param {string[]} tipIds 叶事件 id
 * @returns {string} SHA-256 十六进制
 */
export function computeLocalTipsHash(tipIds) {
	const sorted = [...new Set(tipIds.filter(id => EVENT_ID_HEX.test(String(id))))].sort()
	return createHash('sha256').update(sorted.join(','), 'utf8').digest('hex')
}

/**
 * 规范化父 id 列表：去重、去空、字典序（§6 验签域）。
 * @param {unknown} raw 原始 prev_event_ids 字段
 * @returns {string[]} 去重并字典序排序后的父事件 id 数组
 */
export function sortedPrevEventIds(raw) {
	if (!Array.isArray(raw)) return []
	return [...new Set(raw.filter(id => EVENT_ID_HEX.test(String(id))))].sort()
}

/**
 * 移除对象中值为 `undefined` 的键（浅拷贝）。
 * @param {object} object 输入对象
 * @returns {object} 不含 undefined 值的浅拷贝
 */
function stripUndefined(object) {
	/** @type {Record<string, unknown>} */
	const out = {}
	for (const [key, value] of Object.entries(object))
		if (value !== undefined) out[key] = value
	return out
}

/**
 * 从事件中取出参与 ID 计算与签名的字段（不含 id、signature、received_at 等）。
 * @param {object} event 完整事件对象
 * @returns {object} 用于 canonical 序列化与验签的正文子集
 */
export function eventBodyForSign(event) {
	const body = {
		type: event.type,
		groupId: event.groupId,
		channelId: event.channelId ?? null,
		sender: event.sender,
		charId: event.charId ?? null,
		timestamp: event.timestamp,
		hlc: event.hlc,
		prev_event_ids: sortedPrevEventIds(event.prev_event_ids),
		content: event.content,
	}
	if (event.node_id != null) body.node_id = event.node_id
	return stripUndefined(body)
}

/**
 * 事件 ID = SHA256(canonical unsigned body) 十六进制
 * @param {object} body `eventBodyForSign` 或同形对象
 * @returns {string} SHA256 十六进制事件 id
 */
export function computeEventId(body) {
	const normalized = { ...body }
	if ('prev_event_ids' in normalized)
		normalized.prev_event_ids = sortedPrevEventIds(normalized.prev_event_ids)
	return createHash('sha256').update(canonicalStringify(stripUndefined(normalized)), 'utf8').digest('hex')
}

/**
 * 验签 / 哈希用的 UTF-8 字节序列
 * @param {object} body 与 `computeEventId` 同形的正文对象
 * @returns {import('node:buffer').Buffer} canonical JSON 的 UTF-8 字节
 */
export function signPayloadBytes(body) {
	return Buffer.from(canonicalStringify(stripUndefined({
		...body,
		prev_event_ids: sortedPrevEventIds(body.prev_event_ids),
	})), 'utf8')
}

/**
 * 最小堆（按 compare 取最小元素）。
 * @template T
 */
class MinHeap {
	/** @type {T[]} */
	#data = []
	/** @type {(left: T, right: T) => number} */
	#compare

	/** @param {(left: T, right: T) => number} compare 比较函数 */
	constructor(compare) {
		this.#compare = compare
	}

	/** @returns {number} 元素个数 */
	get size() {
		return this.#data.length
	}

	/** @param {T} value 入堆 */
	push(value) {
		const data = this.#data
		data.push(value)
		let index = data.length - 1
		while (index > 0) {
			const parent = (index - 1) >> 1
			if (this.#compare(data[index], data[parent]) >= 0) break
			;[data[index], data[parent]] = [data[parent], data[index]]
			index = parent
		}
	}

	/** @returns {T | undefined} 弹出最小元素 */
	pop() {
		const data = this.#data
		if (!data.length) return undefined
		const top = data[0]
		const last = data.pop()
		if (data.length && last !== undefined) {
			data[0] = last
			let index = 0
			for (; ;) {
				const left = index * 2 + 1
				const right = left + 1
				let smallest = index
				if (left < data.length && this.#compare(data[left], data[smallest]) < 0)
					smallest = left
				if (right < data.length && this.#compare(data[right], data[smallest]) < 0)
					smallest = right
				if (smallest === index) break
				;[data[index], data[smallest]] = [data[smallest], data[index]]
				index = smallest
			}
		}
		return top
	}
}

/**
 * 规范拓扑序（Kahn + tiebreaker：hlc.wall, hlc.logical, node_id, id；与分布式群聊规范 §4 一致）。
 * @param {Array<{ id: string, prev_event_ids?: unknown, hlc?: { wall: number, logical: number }, sender?: string, node_id?: string }>} metas 事件元数据列表
 * @returns {string[]} 按规范顺序排列的事件 id 列表
 */
export function topologicalCanonicalOrder(metas) {
	if (!metas.length) return []
	const byId = new Map(metas.map(meta => [meta.id, meta]))
	const parentCount = new Map()
	/** @type {Map<string, string[]>} */
	const children = new Map()
	for (const meta of metas) {
		const parentsInGraph = sortedPrevEventIds(meta.prev_event_ids).filter(parentId => byId.has(parentId))
		parentCount.set(meta.id, parentsInGraph.length)
		for (const parentId of parentsInGraph) {
			const list = children.get(parentId)
			if (list) list.push(meta.id)
			else children.set(parentId, [meta.id])
		}
	}

	/**
	 * @param {string} eventId 事件 id
	 * @returns {{ wall: number, logical: number }} wall 与 logical 分量
	 */
	const hlcOf = eventId => {
		const hlc = byId.get(eventId)?.hlc
		return { wall: Number(hlc?.wall) || 0, logical: Number(hlc?.logical) || 0 }
	}

	/**
	 * @param {string} leftId 事件 id
	 * @param {string} rightId 事件 id
	 * @returns {number} 比较结果
	 */
	const compareIds = (leftId, rightId) => {
		const leftHlc = hlcOf(leftId)
		const rightHlc = hlcOf(rightId)
		if (leftHlc.wall !== rightHlc.wall) return leftHlc.wall - rightHlc.wall
		if (leftHlc.logical !== rightHlc.logical) return leftHlc.logical - rightHlc.logical
		const leftNode = String(byId.get(leftId)?.node_id || '')
		const rightNode = String(byId.get(rightId)?.node_id || '')
		if (leftNode !== rightNode) return leftNode.localeCompare(rightNode)
		return leftId.localeCompare(rightId)
	}

	const ordered = []
	const ready = new MinHeap(compareIds)
	for (const meta of metas)
		if (parentCount.get(meta.id) === 0) ready.push(meta.id)


	while (ready.size) {
		const next = ready.pop()
		if (next == null) break
		ordered.push(next)
		for (const childId of children.get(next) || []) {
			const remaining = (parentCount.get(childId) || 0) - 1
			parentCount.set(childId, remaining)
			if (remaining === 0) ready.push(childId)
		}
	}

	return ordered
}

/**
 * @param {string} hex 十六进制串
 * @param {number} expectedByteLength 期望字节长度
 * @returns {Uint8Array | null} 解析后的字节
 */
function parseHexBytes(hex, expectedByteLength) {
	if (!hex || hex.length !== expectedByteLength * 2 || hex.length % 2 !== 0) return null
	const bytes = hex.match(/.{2}/g)
	if (!bytes?.every(pair => HEX_PAIR.test(pair))) return null
	return new Uint8Array(bytes.map(byte => Number.parseInt(byte, 16)))
}

/**
 * 签名事件（签名为不含 id 的 canonical body）
 * @param {object} event 含完整字段；可含占位 id
 * @param {Uint8Array} privateKey 私钥
 * @returns {Promise<string>} 十六进制签名
 */
export async function signEvent(event, privateKey) {
	const body = eventBodyForSign(event)
	const signature = await sign(signPayloadBytes(body), privateKey)
	return Array.from(signature).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 验证事件签名
 * @param {object} event 含 signature、sender 与正文字段的完整事件
 * @returns {Promise<boolean>} 验签是否通过
 */
export async function verifyEventSignature(event) {
	try {
		const signature = parseHexBytes(event?.signature, 64)
		const publicKey = parseHexBytes(event?.sender, 32)
		if (!signature || !publicKey) return false
		return await verify(signature, signPayloadBytes(eventBodyForSign(event)), publicKey)
	}
	catch (error) {
		console.error('Signature verification failed:', error)
		return false
	}
}

/**
 * 创建新事件
 * @param {object} params 事件字段与签名私钥等构造参数
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
