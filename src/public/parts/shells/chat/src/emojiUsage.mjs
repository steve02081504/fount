/**
 * emoji 使用统计（700 条滚动日志）与收藏 —— chat shell data 宿主。
 *
 * shellData `emoji_usage`:
 * { log: [{ id, at }], lastUsedAtByPack: {}, collection: { packIds: [], emojiIds: [] },
 *   linkedDefaults: { 'group:…'|`entity:…`: packId } }
 *
 * log.id：pack 为 `packId/emojiId`；unicode 为字形本身。
 */
import { assignShellData, loadShellData } from '../../../../../server/setting_loader.mjs'
import {
	packEmojiUsageId,
	parseUsageId,
	unicodeUsageId,
} from '../../../../pages/scripts/features/emoji/order.mjs'
import { channelMessageKind, messageShowText } from '../public/shared/channelContent.mjs'
import { EMOJI_TOKEN_RE, parseEmojiToken } from '../public/shared/inlineTokenSyntax.mjs'

import {
	applyDefaultPackConverge,
	entityDefaultLinkKey,
	groupDefaultLinkKey,
	resolveGroupDefaultPackId,
} from './emojiCollectionLogic.mjs'

/** 默认表情包收敛与 usage id 重导出。 */
export {
	applyDefaultPackConverge,
	entityDefaultLinkKey,
	groupDefaultLinkKey,
	packEmojiUsageId,
	resolveGroupDefaultPackId,
	unicodeUsageId,
}

/** shellData 键名（与 HTTP `/emoji-usage` 对齐） */
export const EMOJI_USAGE_DATANAME = 'emoji_usage'
/** 滚动用量窗口上限 */
export const USAGE_WINDOW = 700

const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu

/**
 * @param {string} username 用户名
 * @returns {object} 返回值
 */
export function loadEmojiUsage(username) {
	const data = loadShellData(username, 'chat', EMOJI_USAGE_DATANAME) || {}
	return {
		log: Array.isArray(data.log) ? data.log : [],
		lastUsedAtByPack: data.lastUsedAtByPack && typeof data.lastUsedAtByPack === 'object' ? { ...data.lastUsedAtByPack } : {},
		collection: {
			packIds: Array.isArray(data.collection?.packIds) ? [...data.collection.packIds] : [],
			emojiIds: Array.isArray(data.collection?.emojiIds) ? [...data.collection.emojiIds] : [],
		},
		linkedDefaults: data.linkedDefaults && typeof data.linkedDefaults === 'object'
			? { ...data.linkedDefaults }
			: {},
	}
}

/**
 * @param {string} username 用户名
 * @param {object} data 载荷
 * @returns {void} 返回值
 */
export function saveEmojiUsage(username, data) {
	assignShellData(username, 'chat', EMOJI_USAGE_DATANAME, {
		log: data.log || [],
		lastUsedAtByPack: data.lastUsedAtByPack || {},
		collection: {
			packIds: data.collection?.packIds || [],
			emojiIds: data.collection?.emojiIds || [],
		},
		linkedDefaults: data.linkedDefaults || {},
	})
}

/**
 * @param {object} state 状态
 * @param {string} usageId 用量 ID
 * @param {number} [at] 参数
 * @returns {object} 返回值
 */
export function appendUsageLog(state, usageId, at = Date.now()) {
	const id = usageId || ''
	if (!id) return state
	const log = [...state.log || [], { id, at }]
	const trimmed = log.length > USAGE_WINDOW ? log.slice(-USAGE_WINDOW) : log
	const next = { ...state, log: trimmed, lastUsedAtByPack: { ...state.lastUsedAtByPack } }
	const parsed = parseUsageId(id)
	if (parsed?.kind === 'pack')
		next.lastUsedAtByPack[parsed.packId] = at
	return next
}

/**
 * @param {{ kind: 'unicode', unicode: string } | { kind: 'pack', packId: string, emojiId: string }} item 用量项
 * @returns {string} 用量 id；无效为空串
 */
function usageIdFromItem(item) {
	if (item.kind === 'unicode') {
		const unicode = item.unicode || ''
		return unicode ? unicodeUsageId(unicode) : ''
	}
	const packId = item.packId || ''
	const emojiId = item.emojiId || ''
	return packId && emojiId ? packEmojiUsageId(packId, emojiId) : ''
}

/**
 * @param {string} username 用户名
 * @param {string[]} usageIds 用量 id 列表（已去重）
 * @returns {void}
 */
function appendAndSaveUsageIds(username, usageIds) {
	if (!usageIds.length) return
	let state = loadEmojiUsage(username)
	const at = Date.now()
	for (const usageId of usageIds)
		state = appendUsageLog(state, usageId, at)
	saveEmojiUsage(username, state)
}

/**
 * @param {string} username 用户名
 * @param {{ kind: 'unicode', unicode: string } | { kind: 'pack', packId: string, emojiId: string }} item 用量项
 * @returns {void} 返回值
 */
export function recordEmojiUsage(username, item) {
	const usageId = usageIdFromItem(item)
	if (!usageId) return
	appendAndSaveUsageIds(username, [usageId])
}

/**
 * @param {string} username 用户名
 * @param {Record<string, unknown>} content 消息 content
 * @returns {void} 返回值
 */
export function recordEmojiUsageFromMessageContent(username, content) {
	if (!content || typeof content !== 'object') return
	if (channelMessageKind(content) === 'sticker') {
		const parsed = parseEmojiToken(content.emojiRef || '')
		if (parsed)
			recordEmojiUsage(username, { kind: 'pack', packId: parsed.packId, emojiId: parsed.emojiId })
		return
	}
	const text = messageShowText(content)
	if (!text) return

	/** @type {string[]} */
	const usageIds = []
	const seen = new Set()

	EMOJI_TOKEN_RE.lastIndex = 0
	for (const match of text.matchAll(EMOJI_TOKEN_RE)) {
		const usageId = packEmojiUsageId(match[1], match[2])
		if (!usageId || seen.has(usageId)) continue
		seen.add(usageId)
		usageIds.push(usageId)
	}

	UNICODE_EMOJI.lastIndex = 0
	for (const match of text.matchAll(UNICODE_EMOJI)) {
		const usageId = unicodeUsageId(match[0])
		if (!usageId || seen.has(usageId)) continue
		seen.add(usageId)
		usageIds.push(usageId)
	}

	appendAndSaveUsageIds(username, usageIds)
}

/**
 * @param {string} username 用户名
 * @returns {object} usage 载荷（供 provider.usage.load）
 */
export function loadUsagePayload(username) {
	const state = loadEmojiUsage(username)
	return {
		log: state.log.slice(-USAGE_WINDOW),
		lastUsedAtByPack: state.lastUsedAtByPack,
	}
}

/**
 * @param {string} username 用户名
 * @returns {{ packIds: string[], emojiIds: string[] }} 收藏
 */
export function listCollection(username) {
	return loadEmojiUsage(username).collection
}

/**
 * @param {string} username 用户名
 * @param {string} packId 表情包 ID
 * @returns {void} 返回值
 */
export function addPackToCollection(username, packId) {
	const id = packId || ''
	if (!id) return
	const state = loadEmojiUsage(username)
	if (state.collection.packIds.includes(id)) return
	state.collection.packIds = [...state.collection.packIds, id]
	saveEmojiUsage(username, state)
}

/**
 * @param {string} username 用户名
 * @param {string} packId 表情包 ID
 * @returns {void} 返回值
 */
export function removePackFromCollection(username, packId) {
	const id = packId || ''
	if (!id) return
	const state = loadEmojiUsage(username)
	state.collection.packIds = state.collection.packIds.filter(p => p !== id)
	saveEmojiUsage(username, state)
}

/**
 * 默认包收敛：
 * - 首次链接（无旧默认）：写入收藏
 * - 旧默认在收藏内：换成新默认
 * - 旧默认不在收藏：尊重手动移除，不动
 * @param {string} username 用户名
 * @param {string | null | undefined} oldDefaultPackId 旧默认包
 * @param {string | null | undefined} newDefaultPackId 新默认包
 * @returns {void} 返回值
 */
export function convergeDefaultPack(username, oldDefaultPackId, newDefaultPackId) {
	const state = loadEmojiUsage(username)
	state.collection.packIds = applyDefaultPackConverge(
		state.collection.packIds,
		oldDefaultPackId,
		newDefaultPackId,
	)
	saveEmojiUsage(username, state)
}

/**
 * 按来源链接键收敛默认包，并记录最近见到的默认 packId。
 * @param {string} username 用户名
 * @param {string} linkKey `group:…` / `entity:…`
 * @param {string | null | undefined} newDefaultPackId 当前默认包
 * @returns {void}
 */
export function convergeLinkedDefault(username, linkKey, newDefaultPackId) {
	const key = linkKey || ''
	const next = newDefaultPackId || ''
	if (!key || !next) return
	const state = loadEmojiUsage(username)
	const old = String(state.linkedDefaults[key] || '').trim()
	if (old === next) return
	state.collection.packIds = applyDefaultPackConverge(
		state.collection.packIds,
		old || null,
		next,
	)
	state.linkedDefaults[key] = next
	saveEmojiUsage(username, state)
}

/**
 * @param {string} username 用户名
 * @param {number} [limit] 条数上限
 * @returns {object[]} 返回值
 */
export function listFrequentEmojis(username, limit = 32) {
	const cap = Math.min(64, Math.max(1, limit))
	const { log } = loadUsagePayload(username)
	/** @type {Map<string, { id: string, count: number, lastUsedAt: number, kind: string, unicode?: string, packId?: string, emojiId?: string }>} */
	const map = new Map()
	for (const entry of log) {
		const { id } = entry
		const prev = map.get(id)
		const at = entry.at || 0
		if (prev) {
			prev.count += 1
			prev.lastUsedAt = Math.max(prev.lastUsedAt, at)
			continue
		}
		const parsed = parseUsageId(id)
		if (!parsed) continue
		if (parsed.kind === 'unicode')
			map.set(id, { id, kind: 'unicode', unicode: parsed.unicode, count: 1, lastUsedAt: at })
		else
			map.set(id, { id, kind: 'pack', packId: parsed.packId, emojiId: parsed.emojiId, count: 1, lastUsedAt: at })
	}
	return [...map.values()]
		.sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
		.slice(0, cap)
}
