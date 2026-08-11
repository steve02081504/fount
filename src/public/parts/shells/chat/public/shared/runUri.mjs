import { normalizeHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'
/** @type {string} */
export const CHAT_RUN_PART = 'shells:chat'
const RUN_PREFIX = `fount://run/${CHAT_RUN_PART}/`

/**
 * @param {string} subcommand 子命令名
 * @param {string[]} segments 已各自 encode 的分号分段（join 的 `key=value` 除外，由调用方拼好）
 * @returns {string} `fount://run/…` URI
 */
function buildRunUri(subcommand, segments) {
	return `${RUN_PREFIX}${[subcommand, ...segments].join(';')}`
}

/**
 * @param {string} value 原始段
 * @returns {string} encodeURIComponent 结果
 */
function encodeRunSegment(value) {
	return encodeURIComponent(value)
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
		encodeRunSegment(normalizeHex64(pubKeyHex)),
		encodeRunSegment(nonceBase64Url),
		encodeRunSegment((introSignatureHex || '').trim().replace(/^0x/iu, '')),
	]
	if (nodeUrl) segments.push(encodeRunSegment(nodeUrl.trim()))
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
	const segments = [encodeRunSegment(groupId.trim()), encodeRunSegment(inviteCode.trim())]
	/** @type {Record<string, string>} */
	const fields = {}
	const secret = (roomSecret || '').trim()
	const pub = (introducerPubKeyHash || '').trim()
	const pow = (powAnchorRef || '').trim()
	const node = (introducerNodeHash || '').trim()
	if (secret) fields.roomSecret = secret
	if (pub) fields.introducerPubKeyHash = normalizeHex64(pub)
	if (pow) fields.powAnchorRef = pow
	if (node) fields.introducerNodeHash = normalizeHex64(node)
	for (const [key, value] of Object.entries(fields))
		segments.push(`${encodeRunSegment(key)}=${encodeRunSegment(value)}`)
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
	const input = raw.trim()
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
	return buildRunUri('message', [
		encodeRunSegment(groupId),
		encodeRunSegment(channelId),
		encodeRunSegment(eventId),
	])
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
 * @param {string | undefined} value 字段值
 * @returns {string | undefined} 非空 trim；空串视为缺省
 */
function optionalJoinField(value) {
	const trimmed = (value || '').trim()
	return trimmed || undefined
}

/**
 * @param {string} raw URI
 * @returns {{ groupId: string, inviteCode: string, roomSecret?: string, introducerPubKeyHash?: string, powAnchorRef?: string, introducerNodeHash?: string } | null} join 载荷
 */
export function parseJoinRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'join') return null
	const [groupId, inviteCode, ...fieldSegments] = parsed.args
	if (!groupId) return null
	/** @type {Record<string, string>} */
	const fields = {}
	for (const segment of fieldSegments) {
		const eq = segment.indexOf('=')
		if (eq <= 0) continue
		const key = segment.slice(0, eq).trim()
		const value = segment.slice(eq + 1).trim()
		if (key && value) fields[key] = value
	}
	return {
		groupId,
		inviteCode: inviteCode || '',
		roomSecret: optionalJoinField(fields.roomSecret),
		introducerPubKeyHash: optionalJoinField(fields.introducerPubKeyHash),
		powAnchorRef: optionalJoinField(fields.powAnchorRef),
		introducerNodeHash: optionalJoinField(fields.introducerNodeHash),
	}
}
