/** Canonical inline token 格式（chat/social 共用）。 */

/** emojiId 位允许 unicode 别名（name/alt）；不含 `/`，以免吞掉额外 path 段。 */
const EMOJI_ID_IN_TOKEN = '[^\\]/\\r\\n]+?'

/** 行内 emoji token 正则（`:[emoji:pack/id]:`）。 */
export const EMOJI_TOKEN_RE = new RegExp(`:\\[emoji:([\\w.-]+)\\/(${EMOJI_ID_IN_TOKEN})\\]:`, 'giu')

/** 行内消息链接 token 正则。 */
export const MESSAGE_TOKEN_RE = /#\[message:([\w.-]+)\/([\w.-]+)\/([\w.-]+)\]/g

/** 行内频道链接 token 正则。 */
export const CHANNEL_TOKEN_RE = /#\[channel:([\w.-]+)\/([\w.-]+)\]/g

/** 行内群链接 token 正则。 */
export const GROUP_TOKEN_RE = /#\[group:([\w.-]+)\]/g

/** 匹配顺序：@mention → #message → #channel → #group → :emoji: */
export const INLINE_TOKEN_RE = new RegExp(
	`@\\[([^\\]]+)\\]|#\\[message:([\\w.-]+)\\/([\\w.-]+)\\/([\\w.-]+)\\]|#\\[channel:([\\w.-]+)\\/([\\w.-]+)\\]|#\\[group:([\\w.-]+)\\]|:\\[emoji:([\\w.-]+)\\/(${EMOJI_ID_IN_TOKEN})\\]:`,
	'giu',
)

/**
 * @param {string} ref `:[emoji:packId/emojiId]:`
 * @returns {{ packId: string, emojiId: string } | null} 解析结果
 */
export function parseEmojiToken(ref) {
	const m = new RegExp(`:\\[emoji:([\\w.-]+)\\/(${EMOJI_ID_IN_TOKEN})\\]:`, 'iu').exec(String(ref || ''))
	return m ? { packId: m[1], emojiId: m[2] } : null
}

/**
 * 正文中首个 emoji token。
 * @param {string} text 正文
 * @returns {{ packId: string, emojiId: string } | null} 首个匹配
 */
export function firstEmojiTokenInText(text) {
	EMOJI_TOKEN_RE.lastIndex = 0
	const m = EMOJI_TOKEN_RE.exec(String(text || ''))
	return m ? { packId: m[1], emojiId: m[2] } : null
}

/**
 * @param {string} packId 表情包 ID（单包群常与 groupId 相同）
 * @param {string} emojiId 表情 ID
 * @returns {string} `:[emoji:packId/emojiId]:`
 */
export function formatEmojiToken(packId, emojiId) {
	return `:[emoji:${packId}/${emojiId}]:`
}

/**
 * 将 picker 选中项转为插入 token。
 * @param {object} item picker 条目
 * @returns {string} Unicode 字符或 `:[emoji:…]:` 引用
 */
export function tokenForSelection(item) {
	if (item.kind === 'unicode' && item.unicode) return item.unicode
	if (item.packId && item.emojiId) return formatEmojiToken(item.packId, item.emojiId)
	return item.emojiRef || ''
}

/**
 * 将正文中的 emoji token 降级为纯文字（LLM / 读屏）。
 * @param {string} text 正文
 * @param {(packId: string, emojiId: string) => string | null | undefined} resolveAlt 解析 alt；无则回落 emojiId
 * @returns {string} 降级后正文
 */
export function degradeEmojiTokensToAlt(text, resolveAlt) {
	return String(text || '').replace(EMOJI_TOKEN_RE, (_m, packId, emojiId) => {
		const alt = resolveAlt?.(packId, emojiId)
		return alt != null && String(alt).trim() ? String(alt).trim() : emojiId
	})
}

/**
 * 用别名（alt/name）解析为 emojiId；index 由 buildEmojiAliasIndex 生成。
 * @param {Map<string, string> | Record<string, string>} aliasIndex 别名表
 * @param {string} tokenOrAlias emojiId 或别名
 * @returns {string | null} emojiId
 */
export function resolveEmojiIdFromAlias(aliasIndex, tokenOrAlias) {
	const key = String(tokenOrAlias || '').trim()
	if (!key) return null
	if (aliasIndex instanceof Map) return aliasIndex.get(key) || null
	return aliasIndex[key] || null
}

/**
 * 将 token 内 emojiId 位的 name/alt 别名改写成规范 emojiId。
 * @param {string} text 正文
 * @param {(packId: string, emojiOrAlias: string) => string | null | undefined} resolveId 解析器
 * @returns {string} 改写后正文
 */
export function rewriteEmojiAliasesInText(text, resolveId) {
	return String(text || '').replace(EMOJI_TOKEN_RE, (_m, packId, emojiOrAlias) => {
		const resolved = resolveId?.(packId, emojiOrAlias)
		const emojiId = resolved != null && String(resolved).trim() ? String(resolved).trim() : emojiOrAlias
		return formatEmojiToken(packId, emojiId)
	})
}

/**
 * 跨 locale 别名索引：alt / name → emojiId（先到先得）。
 * @param {object[]} items 包内表情
 * @returns {Map<string, string>} 别名到 emojiId 的映射
 */
export function buildEmojiAliasIndex(items) {
	/** @type {Map<string, string>} */
	const index = new Map()
	for (const item of items || []) {
		const emojiId = String(item?.emojiId || '').trim()
		if (!emojiId) continue
		if (!index.has(emojiId)) index.set(emojiId, emojiId)
		const localized = item.localized || {}
		for (const slice of Object.values(localized))
			for (const key of ['alt', 'name']) {
				const alias = String(slice?.[key] || '').trim()
				if (alias && !index.has(alias)) index.set(alias, emojiId)
			}
	}
	return index
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} `#[channel:groupId/channelId]`
 */
export function formatChannelToken(groupId, channelId) {
	return `#[channel:${groupId}/${channelId}]`
}

/**
 * @param {string} groupId 群 ID
 * @returns {string} `#[group:groupId]`
 */
export function formatGroupToken(groupId) {
	return `#[group:${groupId}]`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息 event id
 * @returns {string} `#[message:groupId/channelId/messageId]`
 */
export function formatMessageToken(groupId, channelId, messageId) {
	return `#[message:${groupId}/${channelId}/${messageId}]`
}

/**
 * @param {string} entityHash 128-hex entity hash
 * @returns {string} `@[entity:entityHash]`
 */
export function formatEntityMentionToken(entityHash) {
	return `@[entity:${entityHash}]`
}

/**
 * @param {string} roleId `everyone` | `here` | 角色 id
 * @returns {string} `@[role:roleId]`
 */
export function formatRoleMentionToken(roleId) {
	return `@[role:${roleId}]`
}

/**
 * 去掉正文中的频道链标记（发帖框同步群关联时用）。
 * @param {string} text 正文
 * @returns {string} 清除后的正文
 */
export function stripChannelTokens(text) {
	return String(text || '')
		.replace(CHANNEL_TOKEN_RE, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}
