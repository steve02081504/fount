import { assertHex64, isHex64, isSignatureHex128, normalizeHex64 } from '../hexIds.mjs'
import { isPlainObject } from '../wire_ingress.mjs'

const MAX_DISCOVERY_ADS = 64

/**
 * @param {unknown} ad 单条 discovery 广告
 * @returns {object | null} 白名单字段
 */
function sanitizeDiscoveryAdvertisement(ad) {
	if (!isPlainObject(ad)) return null
	const groupId = String(ad.groupId || '').trim()
	const advertiserPubKeyHash = normalizeHex64(ad.advertiserPubKeyHash)
	const signature = String(ad.signature || '').trim().toLowerCase()
	if (!groupId || !isHex64(advertiserPubKeyHash) || !isSignatureHex128(signature)) return null
	const advertiserNodeHash = normalizeHex64(ad.advertiserNodeHash)
	const body = {
		groupId,
		title: String(ad.title || '').slice(0, 200),
		blurb: String(ad.blurb || '').slice(0, 500),
		advertiserPubKeyHash,
		advertiserNodeHash: isHex64(advertiserNodeHash) ? advertiserNodeHash : String(ad.advertiserNodeHash || '').trim(),
		observedAt: Number(ad.observedAt) || 0,
		signature,
	}
	const memberCount = Number(ad.memberCount)
	if (Number.isFinite(memberCount) && memberCount > 0)
		body.memberCount = Math.floor(memberCount)
	return body
}

/**
 * @param {unknown} ads advertisements 数组
 * @returns {object[]} 已清扫广告
 */
function sanitizeDiscoveryAdvertisements(ads) {
	if (!Array.isArray(ads)) return []
	return ads.slice(0, MAX_DISCOVERY_ADS).map(sanitizeDiscoveryAdvertisement).filter(Boolean)
}

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
			advertisements: sanitizeDiscoveryAdvertisements(payload.advertisements),
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
			advertisements: sanitizeDiscoveryAdvertisements(payload.advertisements),
		}
	}
	catch {
		return null
	}
}
