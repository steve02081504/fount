import { createHash } from 'node:crypto'

import { canonicalStringify } from './canonical_json.mjs'
import { compareHlcNode } from './hlc.mjs'

/**
 * 计算 DAG 事件 id = sha256(canonical_json(signPayload))
 *
 * @param {object} signPayload 不含 signature / received_at / isRemote
 * @returns {string} 小写 hex 的 sha256 摘要
 */
export function computeEventId(signPayload) {
	const s = canonicalStringify(signPayload)
	return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * 构建待签名字节（与 computeEventId 一致）
 *
 * @param {object} signPayload 与 `computeEventId` 相同的结构化负载
 * @returns {Uint8Array} UTF-8 编码的 canonical JSON 字节
 */
export function signPayloadBytes(signPayload) {
	return new TextEncoder().encode(canonicalStringify(signPayload))
}

/**
 * Kahn 拓扑序；无 prev 的视为 genesis 多根；同层用 HLC + node_id
 *
 * @param {Array<{
 *   id: string,
 *   prev_event_id: string|null,
 *   hlc: { wall: number, logical: number },
 *   node_id?: string,
 * }>} events 待排序的 DAG 事件（须含 id、hlc；可含 prev_event_id、node_id）
 * @returns {string[]} 规范序 event id 列表
 */
export function topologicalCanonicalOrder(events) {
	const byId = new Map(events.map(e => [e.id, e]))
	const indeg = new Map()
	const children = new Map()

	for (const e of events) {
		if (!indeg.has(e.id)) indeg.set(e.id, 0)
		const p = e.prev_event_id
		if (p && !byId.has(p)) {
			// 缺失父事件：仍参与排序，父边忽略（catch-up 场景）
		}
		else if (p) {
			indeg.set(e.id, (indeg.get(e.id) || 0) + 1)
			if (!children.has(p)) children.set(p, [])
			children.get(p).push(e.id)
		}
	}

	const q = []
	for (const [id, d] of indeg)
		if (d === 0) q.push(id)

	const sorted = []
	/**
	 * 取事件上的 node_id，缺省回退 sender
	 *
	 * @param {string} id 事件 id
	 * @returns {string} 用于 HLC 同拍决胜的节点标识
	 */
	const nodeIdOf = id => byId.get(id)?.node_id || byId.get(id)?.sender || ''

	while (q.length) {
		q.sort((a, b) => {
			const ea = byId.get(a)
			const eb = byId.get(b)
			if (!ea || !eb) return String(a).localeCompare(String(b))
			return compareHlcNode(ea.hlc, eb.hlc, nodeIdOf(a), nodeIdOf(b))
		})
		const id = q.shift()
		sorted.push(id)
		const ch = children.get(id) || []
		for (const c of ch) {
			indeg.set(c, indeg.get(c) - 1)
			if (indeg.get(c) === 0) q.push(c)
		}
	}

	if (sorted.length !== events.length) 
		// 环或重复 id：退回稳定排序
		return [...events]
			.sort((ea, eb) => compareHlcNode(ea.hlc, eb.hlc, nodeIdOf(ea.id), nodeIdOf(eb.id)))
			.map(e => e.id)
	
	return sorted
}

/**
 * 简单 Merkle root（相邻两两 hash，奇数复制末项）
 *
 * @param {string[]} leaves hex 或任意字符串
 * @returns {string} 根节点 digest 的 hex
 */
export function merkleRoot(leaves) {
	if (!leaves.length) return createHash('sha256').update('').digest('hex')
	let layer = leaves.map(l => createHash('sha256').update(String(l), 'utf8').digest('hex'))
	while (layer.length > 1) {
		const next = []
		for (let i = 0; i < layer.length; i += 2) {
			const a = layer[i]
			const b = layer[i + 1] ?? a
			next.push(createHash('sha256').update(a + b, 'utf8').digest('hex'))
		}
		layer = next
	}
	return layer[0]
}
