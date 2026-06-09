import { assertHex64 } from '../hexIds.mjs'

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
