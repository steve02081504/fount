/** §16：`fount://run/shells:chat/{dm|join};…` 组装与解析（与 protocolhandler 分号参数一致）。 */

import { normalizePubKeyHex } from './pubKeyHex.mjs'

/**
 * chat shell 在 `fount://run/` 协议中的 part 路径标识。
 * protocolhandler 用 `replaceAll(':', '/')` 还原成 loadPart 路径 `shells/chat`，故必须是 `shells:chat`。
 * @type {string}
 */
export const CHAT_RUN_PART = 'shells:chat'
const RUN_PREFIX = `fount://run/${CHAT_RUN_PART}/`

/**
 * @param {string} subcommand 子命令名
 * @param {string[]} segments 分号分段（将 encode）
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
 * @param {string} [mqttRoomSecret] 首次联邦 catch-up bootstrap 口令
 * @param {string} [introducerPubKeyHash] 邀请人 Ed25519 公钥 hex（64 字符）
 * @param {string} [powAnchorRef] 入群 PoW 绑定的近期 DAG tip / checkpoint root
 * @returns {string} canonical join run URI
 */
export function formatJoinRunUri(groupId, inviteCode, mqttRoomSecret, introducerPubKeyHash, powAnchorRef) {
	const segments = [groupId.trim(), inviteCode.trim()]
	if (mqttRoomSecret?.trim()) segments.push(mqttRoomSecret.trim())
	if (introducerPubKeyHash?.trim()) segments.push(normalizePubKeyHex(introducerPubKeyHash))
	if (powAnchorRef?.trim()) segments.push(String(powAnchorRef).trim())
	return buildRunUri('join', segments)
}

/**
 * HTTPS 包装（站外分享 / 扫码）。
 * @param {string} fountRunUri `fount://run/…`
 * @returns {string} protocol 页 URL
 */
export function wrapProtocolHttpsUrl(fountRunUri) {
	return `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(fountRunUri)}`
}

/**
 * 解析 canonical `fount://run/shells:chat/{subcommand};…`。
 * @param {string} raw 输入 URI
 * @returns {{ subcommand: string, args: string[] } | null} 解析结果，非 chat run URI 则 null
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
 * @returns {{ pubKeyHex: string, nonce: string, introSignatureHex: string, nodeUrl?: string } | null} DM 载荷或 null
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
 * @returns {{ groupId: string, inviteCode: string, mqttRoomSecret?: string, introducerPubKeyHash?: string, powAnchorRef?: string } | null} join 载荷或 null
 */
export function parseJoinRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'join') return null
	const [groupId, inviteCode, mqttRoomSecret, introducerPubKeyHash, powAnchorRef] = parsed.args
	if (!groupId) return null
	return {
		groupId,
		inviteCode: inviteCode || '',
		mqttRoomSecret: mqttRoomSecret?.trim() || undefined,
		introducerPubKeyHash: introducerPubKeyHash?.trim() || undefined,
		powAnchorRef: powAnchorRef?.trim() || undefined,
	}
}
