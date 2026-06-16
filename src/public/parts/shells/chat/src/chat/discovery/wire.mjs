/**
 * 群发现联邦线消息解析（入站）。
 */
import {
	assertDiscoveryNodeHash,
	assertDiscoveryRequestId,
} from '../../../../../../../scripts/p2p/schemas/discovery_wire.mjs'
import { isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'

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
