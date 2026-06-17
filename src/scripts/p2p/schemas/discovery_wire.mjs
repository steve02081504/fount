import { assertHex64 } from '../hexIds.mjs'
import { isPlainObject } from '../wire_ingress.mjs'

/**
 * @param {unknown} nodeHash 节点 hash
 * @returns {string} 规范化 hex64
 */
export function assertDiscoveryNodeHash(nodeHash) {
	return assertHex64(nodeHash, 'discovery.nodeHash')
}

/**
 * @param {unknown} requestId 请求 id
 * @returns {string} 非空 trimmed 字符串
 */
export function assertDiscoveryRequestId(requestId) {
	const id = String(requestId ?? '').trim()
	if (!id) throw new Error('discovery.requestId required')
	return id
}

/**
 * @param {unknown} payload 载荷
 * @returns {{ nodeHash: string, advertisements: object[] } | null} 解析结果
 */
export function parseDiscoveryAnnounce(payload) {
	if (!isPlainObject(payload)) return null
	try {
		return {
			nodeHash: assertDiscoveryNodeHash(payload.nodeHash),
			advertisements: Array.isArray(payload.advertisements) ? payload.advertisements : [],
		}
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {{ nodeHash: string, requestId: string, limit: number } | null} 解析结果
 */
export function parseDiscoveryQuery(payload) {
	if (!isPlainObject(payload)) return null
	try {
		return {
			nodeHash: assertDiscoveryNodeHash(payload.nodeHash),
			requestId: assertDiscoveryRequestId(payload.requestId),
			limit: Math.min(64, Math.max(1, Number(payload.limit) || 32)),
		}
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {{ requestId: string, nodeHash: string, advertisements: object[] } | null} 解析结果
 */
export function parseDiscoveryQueryResponse(payload) {
	if (!isPlainObject(payload)) return null
	try {
		return {
			requestId: assertDiscoveryRequestId(payload.requestId),
			nodeHash: assertDiscoveryNodeHash(payload.nodeHash),
			advertisements: Array.isArray(payload.advertisements) ? payload.advertisements : [],
		}
	}
	catch {
		return null
	}
}
