/**
 * P2P / Trystero 入站 wire 公共工具（外来网络边界）。
 */
import { Buffer } from 'node:buffer'

import { isHex64, isSignatureHex128 } from './hexIds.mjs'

/**
 * @param {unknown} value 待判定值
 * @returns {value is Record<string, unknown>} 是否为非 null 的普通对象（非数组）
 */
export function isPlainObject(value) {
	return value != null && !Array.isArray(value) && typeof value === 'object'
}

/**
 * 解析 WebSocket / Trystero 入站 JSON 帧。
 * @param {unknown} raw `ws` message 或字符串
 * @returns {Record<string, unknown> | null} 解析失败或非对象时为 null
 */
export function parseInboundJson(raw) {
	if (raw == null) return null
	const text = typeof raw === 'string'
		? raw
		: Buffer.isBuffer(raw)
			? raw.toString('utf8')
			: String(raw)
	let parsed
	try {
		parsed = JSON.parse(text)
	}
	catch {
		return null
	}
	return isPlainObject(parsed) ? parsed : null
}

/**
 * @param {unknown} event 单条 DAG 行
 * @returns {boolean} 是否具备完整远程签名形态
 */
export function isSignedDagEventRow(event) {
	return isPlainObject(event)
		&& isHex64(event.id)
		&& isSignatureHex128(event.signature)
}

/**
 * 从联邦 `dag_event` 载荷取出已签名事件行。
 * @param {unknown} payload Trystero 载荷（完整签名事件）
 * @param {string} groupId 本群 ID
 * @returns {object | null} 验形通过的事件；否则 null
 */
export function extractInboundSignedEvent(payload, groupId) {
	if (!isSignedDagEventRow(payload)) return null
	if (payload.groupId && String(payload.groupId) !== groupId) return null
	return payload
}
