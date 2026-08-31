/** @type {string} */
export const CHAT_RUN_PART = 'shells:chat'
const RUN_PREFIX = `fount://run/${CHAT_RUN_PART}/`

/**
 * @param {string} subcommand 子命令名
 * @param {string[]} segments 已各自 encode 的分号分段
 * @returns {string} `fount://run/…` URI
 */
function buildRunUri(subcommand, segments) {
	return `${RUN_PREFIX}${[subcommand, ...segments].join(';')}`
}

/**
 * @param {object} options 参数
 * @param {string} options.pubKeyHex 介绍者公钥
 * @param {string} options.nonceBase64Url nonce
 * @param {string} options.introSignatureHex 签名
 * @param {string} [options.nodeUrl] 可选节点 URL
 * @returns {string} DM run URI
 */
export function formatDmRunUri({ pubKeyHex, nonceBase64Url, introSignatureHex, nodeUrl }) {
	const segments = [
		encodeURIComponent(pubKeyHex),
		encodeURIComponent(nonceBase64Url),
		encodeURIComponent(introSignatureHex),
	]
	if (nodeUrl) segments.push(encodeURIComponent(nodeUrl))
	return buildRunUri('dm', segments)
}

/**
 * @typedef {{
 *   groupId: string
 *   inviteCode?: string
 *   roomSecret?: string
 *   introducerPubKeyHash?: string
 *   introducerNodeHash?: string
 * }} JoinRunPayload
 */

/**
 * join 深链：单段 JSON 载荷再 URI 编码。
 * `fount://run/shells:chat/join;<encodeURIComponent(JSON)>`
 * @param {JoinRunPayload} input 入群载荷
 * @returns {string} join run URI
 */
export function formatJoinRunUri(input) {
	return buildRunUri('join', [encodeURIComponent(JSON.stringify(input))])
}

/**
 * 解析 IPC / URI 分号段里的 join JSON 载荷（已 decode）。
 * @param {string} raw JSON 字符串
 * @returns {JoinRunPayload} join 载荷
 */
export function parseJoinRunPayload(raw) {
	return JSON.parse(raw)
}

/**
 * @param {string} fountRunUri `fount://run/…`
 * @returns {string} protocol 页 URL
 */
export function wrapProtocolHttpsUrl(fountRunUri) {
	return `https://steve02081504.github.io/fount/protocol?url=${encodeURIComponent(fountRunUri)}`
}

/**
 * 组装 join 深链分享 URL。powAnchorRef 不再写入链接：入群 PoW anchor 由加入方
 * 在 join 时经 `/pow-challenge` 动态申请，避免链接携带易过期的静态锚。
 * @param {object} options 载荷
 * @param {string} options.groupId 群 ID
 * @param {string} [options.inviteCode] 邀请码
 * @param {string} [options.roomSecret] 群房间密钥
 * @param {string} [options.introducerPubKeyHash] 介绍人 pubKeyHash
 * @param {string} [options.introducerNodeHash] 介绍人 nodeHash
 * @returns {string} 分享 URL
 */
export function formatJoinInviteUrl({ groupId, inviteCode, roomSecret, introducerPubKeyHash, introducerNodeHash }) {
	return wrapProtocolHttpsUrl(formatJoinRunUri({
		groupId,
		inviteCode,
		roomSecret,
		introducerPubKeyHash,
		introducerNodeHash,
	}))
}

/**
 * @param {string} raw 输入 URI
 * @returns {{ subcommand: string, args: string[] } | null} 解析结果
 */
export function parseChatRunUri(raw) {
	if (!raw.startsWith('fount://run/')) return null
	const rest = raw.slice('fount://run/'.length)
	if (!rest.startsWith(`${CHAT_RUN_PART}/`)) return null
	const body = rest.slice(CHAT_RUN_PART.length + 1)
	const parts = body.split(';').map(segment => decodeURIComponent(segment))
	const [subcommand, ...args] = parts
	if (!subcommand) return null
	return { subcommand, args }
}

/**
 * @param {string} raw URI
 * @returns {{ pubKeyHex: string, nonce: string, introSignatureHex: string, nodeUrl?: string } | null} DM 载荷
 */
export function parseDmRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'dm') return null
	const [pubKeyHex, nonce, introSignatureHex, nodeUrl] = parsed.args
	return { pubKeyHex, nonce, introSignatureHex, nodeUrl }
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息 eventId
 * @returns {string} message run URI
 */
export function formatMessageRunUri(groupId, channelId, eventId) {
	return buildRunUri('message', [
		encodeURIComponent(groupId),
		encodeURIComponent(channelId),
		encodeURIComponent(eventId),
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
	return { groupId, channelId, eventId }
}

/**
 * @param {string} raw URI
 * @returns {JoinRunPayload | null} join 载荷
 */
export function parseJoinRunUri(raw) {
	const parsed = parseChatRunUri(raw)
	if (!parsed || parsed.subcommand !== 'join' || parsed.args.length !== 1) return null
	return JSON.parse(parsed.args[0])
}
