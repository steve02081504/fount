/**
 * 为 LLM / 读屏路径解析 emoji alt 文本；发帖时把 name/alt 别名改成规范 emojiId。
 */
import { pickLocalizedSlice } from '../../../../../scripts/i18n/locale_match.mjs'
import { localesForUser } from '../../../../../scripts/locale.mjs'
import {
	buildEmojiAliasIndex,
	degradeEmojiTokensToAlt,
	EMOJI_TOKEN_RE,
	resolveEmojiIdFromAlias,
	rewriteEmojiAliasesInText,
} from '../public/shared/inlineTokenSyntax.mjs'

import { findPackAcrossEntities } from './entity/entityEmojis.mjs'
import { findPackAcrossGroups } from './group/groupEmojis.mjs'

/** 单条消息内最多解析的不同 packId 数（防恶意 token 扫盘）。 */
const MAX_PACKS_PER_TEXT = 32

/**
 * @param {string} username 操作用户名
 * @param {string} packId 包 ID
 * @returns {Promise<object | null>} manifest
 */
async function loadPackManifestForUser(username, packId) {
	const groupHit = await findPackAcrossGroups(username, packId)
	if (groupHit?.manifest) return groupHit.manifest
	const entityHit = await findPackAcrossEntities(packId)
	return entityHit?.manifest || null
}

/**
 * 查找包表情的 alt 文案（群或实体包）。
 * @param {string} username 操作用户名
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @param {string[]} [locales] 优先 locale；省略时用用户偏好
 * @returns {Promise<string>} alt 或回退名
 */
export async function lookupEmojiAlt(username, packId, emojiId, locales) {
	const loc = locales || localesForUser(username)
	const manifest = await loadPackManifestForUser(username, packId)
	const item = (manifest?.items || []).find(e => e.emojiId === emojiId)
	if (!item) return emojiId
	const slice = pickLocalizedSlice(item.localized, loc) || {}
	const name = String(slice.name || '').trim() || emojiId
	return String(slice.alt || '').trim() || name
}

/**
 * 异步将正文中的 emoji token 降级为 alt。
 * @param {string} username 操作用户名
 * @param {string} text 含 token 的正文
 * @param {string[]} [locales] 优先 locale；省略时用用户偏好
 * @returns {Promise<string>} token 替换为 alt 后的文本
 */
export async function degradeTextEmojisAsync(username, text, locales) {
	const loc = locales || localesForUser(username)
	const raw = String(text || '')
	const re = new RegExp(EMOJI_TOKEN_RE.source, 'giu')
	/** @type {Map<string, string>} */
	const cache = new Map()
	/** @type {Set<string>} */
	const packs = new Set()
	for (const match of raw.matchAll(re)) {
		const key = `${match[1]}/${match[2]}`
		if (cache.has(key)) continue
		if (!packs.has(match[1])) {
			if (packs.size >= MAX_PACKS_PER_TEXT) continue
			packs.add(match[1])
		}
		cache.set(key, await lookupEmojiAlt(username, match[1], match[2], loc))
	}
	return degradeEmojiTokensToAlt(raw, (packId, emojiId) => cache.get(`${packId}/${emojiId}`))
}

/**
 * 将正文 token 中的 name/alt 别名改写为规范 emojiId（跨 locale 索引）。
 * @param {string} username 操作用户名
 * @param {string} text 含 token 的正文
 * @returns {Promise<string>} 改写后正文
 */
export async function canonicalizeEmojiTokensInText(username, text) {
	const raw = String(text || '')
	if (!raw.includes(':[emoji:')) return raw
	const re = new RegExp(EMOJI_TOKEN_RE.source, 'giu')
	/** @type {Map<string, Map<string, string>>} */
	const indexes = new Map()
	for (const match of raw.matchAll(re)) {
		const packId = match[1]
		if (indexes.has(packId)) continue
		if (indexes.size >= MAX_PACKS_PER_TEXT) break
		const manifest = await loadPackManifestForUser(username, packId)
		indexes.set(packId, buildEmojiAliasIndex(manifest?.items || []))
	}
	return rewriteEmojiAliasesInText(raw, (packId, emojiOrAlias) => {
		const index = indexes.get(packId)
		if (!index) return emojiOrAlias
		return resolveEmojiIdFromAlias(index, emojiOrAlias) || emojiOrAlias
	})
}

/**
 * 规范化文本类消息 content 内的 emoji 别名。
 * @param {string} username 操作用户名
 * @param {object} content wire content
 * @returns {Promise<object>} 可能改写后的 content
 */
export async function canonicalizeMessageContentEmojis(username, content) {
	if (!content || typeof content !== 'object') return content
	if (content.type && content.type !== 'text') return content
	const fields = ['content', 'content_for_show', 'content_for_edit']
	/** @type {object} */
	const next = { ...content }
	let changed = false
	for (const field of fields) {
		if (typeof next[field] !== 'string' || !next[field].includes(':[emoji:')) continue
		const rewritten = await canonicalizeEmojiTokensInText(username, next[field])
		if (rewritten !== next[field]) {
			next[field] = rewritten
			changed = true
		}
	}
	return changed ? next : content
}
