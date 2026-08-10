import { normalizeHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'
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
		normalizeHex64(pubKeyHex),
		nonceBase64Url,
		String(introSignatureHex || '').trim().replace(/^0x/iu, ''),
	]
	if (nodeUrl) segments.push(String(nodeUrl).trim())
	return buildRunUri('dm', segments)
}

/**
 * 可选联邦字段转 URI 槽（空则空串，避免跳槽挤掉后续字段）。
 * @param {string | undefined | null} value 原始值
 * @param {'plain' | 'hex64'} mode plain 原样 trim；hex64 规范化
 * @returns {string} 槽内容
 */
function joinUriSlot(value, mode) {
	const trimmed = String(value || '').trim()
	if (!trimmed) return ''
	return mode === 'hex64' ? normalizeHex64(trimmed) : trimmed
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
	const secret = joinUriSlot(roomSecret, 'plain')
	const pub = joinUriSlot(introducerPubKeyHash, 'hex64')
	const pow = joinUriSlot(powAnchorRef, 'plain')
	const node = joinUriSlot(introducerNodeHash, 'hex64')
	// 任一联邦字段出现则固定四槽，禁止「有值才 push」导致 node 挤进 pow。
	if (secret || pub || pow || node)
		segments.push(secret, pub, pow, node)
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
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息 eventId
 * @returns {string} canonical message run URI
 */
export function formatMessageRunUri(groupId, channelId, eventId) {
	return buildRunUri('message', [groupId, channelId, eventId])
}

/**
 * @param {string} raw URI
 * @returns {{ groupId: string, channelId: string, eventId: string } | null} message 载荷
 */
export function parseMessageRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'message') return null
	const [groupId, channelId, eventId] = parsed.args
	if (!groupId || !channelId || !eventId) return null
	return { groupId, channelId, eventId }
}

/**
 * @param {string | undefined} value URI 槽
 * @returns {string | undefined} 非空 trim；空串视为缺省
 */
function optionalJoinSlot(value) {
	const trimmed = String(value || '').trim()
	return trimmed || undefined
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
		roomSecret: optionalJoinSlot(roomSecret),
		introducerPubKeyHash: optionalJoinSlot(introducerPubKeyHash),
		powAnchorRef: optionalJoinSlot(powAnchorRef),
		introducerNodeHash: optionalJoinSlot(introducerNodeHash),
	}
}
