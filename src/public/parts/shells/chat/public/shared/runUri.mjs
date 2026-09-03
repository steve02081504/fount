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
 * Chat hub 私聊深链：`?contact=<entityHash>`（Social「私信」同款）。
 * 链接可能被分享给别的节点，故始终走全局 entityHash，而不是仅本机可见的 `?char=` 直达。
 * 打开方在自己的 fount 节点访问该路径即可发起与目标实体的私聊。
 * @param {string} entityHash 目标实体 128 位 entityHash
 * @returns {string} hub 页浏览器路径（相对 fount 根）
 */
export function formatChatDmHref(entityHash) {
	return `/parts/shells:chat/hub/?contact=${encodeURIComponent(entityHash || '')}`
}

/**
 * 组装 join 深链分享 URL。
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
