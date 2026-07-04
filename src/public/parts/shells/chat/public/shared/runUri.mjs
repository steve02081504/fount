import { normalizePubKeyHex } from './pubKeyHex.mjs'

/** @type {string} */
export const CHAT_RUN_PART = 'shells:chat'
const RUN_PREFIX = `fount://run/${CHAT_RUN_PART}/`

/**
 * @param {string} subcommand 子命令名
 * @param {string[]} segments 分号分段
 * @returns {string} `fount://run/…` URI
 */
function buildRunUri(subcommand, segments) {
	const body = [subcommand, ...segments.map(segment => encodeURIComponent(segment || ''))].join(';')
	return `${RUN_PREFIX}${body}`
}

/**
 * @param {object} options 参数
 * @param {string} options.pubKeyHex 介绍者公钥
 * @param {string} options.nonceBase64Url nonce
 * @param {string} options.introSignatureHex 签名
 * @param {string} [options.nodeUrl] 可选节点 URL
 * @returns {string} canonical DM run URI
 */
export function formatDmRunUri({ pubKeyHex, nonceBase64Url, introSignatureHex, nodeUrl }) {
	const segments = [
		normalizePubKeyHex(pubKeyHex),
		nonceBase64Url,
		String(introSignatureHex || '').trim().replace(/^0x/iu, ''),
	]
	if (nodeUrl) segments.push(String(nodeUrl).trim())
	return buildRunUri('dm', segments)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} inviteCode 邀请码
 * @param {string} [roomSecret] bootstrap 口令
 * @param {string} [introducerPubKeyHash] 邀请人公钥 hex
 * @param {string} [powAnchorRef] PoW 锚点
 * @param {string} [introducerNodeHash] 邀请人 nodeHash
 * @returns {string} canonical join run URI
 */
export function formatJoinRunUri(groupId, inviteCode, roomSecret, introducerPubKeyHash, powAnchorRef, introducerNodeHash) {
	const segments = [groupId.trim(), inviteCode.trim()]
	if (roomSecret?.trim()) segments.push(roomSecret.trim())
	if (introducerPubKeyHash?.trim()) segments.push(normalizePubKeyHex(introducerPubKeyHash))
	if (powAnchorRef?.trim()) segments.push(String(powAnchorRef).trim())
	if (introducerNodeHash?.trim()) segments.push(normalizePubKeyHex(introducerNodeHash))
	return buildRunUri('join', segments)
}

/**
 * @param {string} fountRunUri `fount://run/…`
 * @returns {string} protocol 页 URL
 */
export function wrapProtocolHttpsUrl(fountRunUri) {
	return `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(fountRunUri)}`
}

/**
 * @param {string} raw 输入 URI
 * @returns {{ subcommand: string, args: string[] } | null} 解析结果
 */
export function parseChatRunUri(raw) {
	const input = String(raw || '').trim()
	if (!input.startsWith('fount://run/')) return null
	const rest = input.slice('fount://run/'.length)
	if (!rest.startsWith(`${CHAT_RUN_PART}/`)) return null
	const body = rest.slice(CHAT_RUN_PART.length + 1)

	const parts = body.split(';').map(segment => {
		try { return decodeURIComponent(segment) }
		catch { return segment }
	})
	const subcommand = parts[0]?.trim()
	if (!subcommand) return null
	return { subcommand, args: parts.slice(1) }
}

/**
 * @param {string} raw URI
 * @returns {{ pubKeyHex: string, nonce: string, introSignatureHex: string, nodeUrl?: string } | null} DM 载荷
 */
export function parseDmRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'dm') return null
	const [pubKeyHex, nonce, introSignatureHex, nodeUrl] = parsed.args
	if (!pubKeyHex || !nonce || !introSignatureHex) return null
	return { pubKeyHex, nonce, introSignatureHex, nodeUrl: nodeUrl || undefined }
}

/**
 * @param {string} raw URI
 * @returns {{ groupId: string, inviteCode: string, roomSecret?: string, introducerPubKeyHash?: string, powAnchorRef?: string, introducerNodeHash?: string } | null} join 载荷
 */
export function parseJoinRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'join') return null
	const [groupId, inviteCode, roomSecret, introducerPubKeyHash, powAnchorRef, introducerNodeHash] = parsed.args
	if (!groupId) return null
	return {
		groupId,
		inviteCode: inviteCode || '',
		roomSecret: roomSecret?.trim() || undefined,
		introducerPubKeyHash: introducerPubKeyHash?.trim() || undefined,
		powAnchorRef: powAnchorRef?.trim() || undefined,
		introducerNodeHash: introducerNodeHash?.trim() || undefined,
	}
}
