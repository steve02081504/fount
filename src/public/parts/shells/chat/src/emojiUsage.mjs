/**
 * 【文件】src/emojiUsage.mjs
 * 【职责】按用户统计 Unicode 与群自定义表情（:[groupId/emojiId]:）的使用频次，供选择器「常用」排序。
 * 【原理】数据存于 shell data（dataname emoji_usage），键 u:{unicode} 或 g:{groupId}/{emojiId}；
 *   每次 recordEmojiUsage 递增 count 并更新 lastUsedAt；超过 MAX_STORED(512) 时按 count、lastUsedAt 淘汰最少使用的条目。
 *   recordEmojiUsageFromMessageContent 从发送的 channel content 正则提取（sticker 类型走 emojiRef）。
 * 【数据结构】entries: Record<id, { id, kind, count, lastUsedAt, unicode? | groupId?, emojiId? }>。
 * 【关联】endpoints 暴露 list API；发送消息路径调用 record；依赖 channelContent 取文本。
 */
import { assignShellData, loadShellData } from '../../../../../server/setting_loader.mjs'

import { channelMessageText } from '../public/shared/channelContent.mjs'

const SHELL_DATANAME = 'emoji_usage'
const MAX_STORED = 512

const CUSTOM_EMOJI_REF = /:\[([\w.-]+)\/([\w.-]+)]:/g
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu

/**
 * @param {'unicode' | 'custom'} kind 类型
 * @param {{ unicode?: string, groupId?: string, emojiId?: string }} fields 字段
 * @returns {string} 存储键
 */
function usageEntryId(kind, fields) {
	if (kind === 'unicode') return `u:${fields.unicode}`
	return `g:${fields.groupId}/${fields.emojiId}`
}

/**
 * @param {string} username 用户
 * @returns {Record<string, object>} id → 统计条目
 */
function loadUsageEntries(username) {
	return loadShellData(username, 'chat', SHELL_DATANAME)?.entries || {}
}

/**
 * @param {Record<string, object>} entries 条目表
 * @returns {Record<string, object>} 修剪后条目表
 */
function pruneUsageEntries(entries) {
	const keys = Object.keys(entries)
	if (keys.length <= MAX_STORED) return entries
	const drop = keys
		.sort((a, b) => {
			const ea = entries[a]
			const eb = entries[b]
			if (ea.count !== eb.count) return ea.count - eb.count
			return ea.lastUsedAt - eb.lastUsedAt
		})
		.slice(0, keys.length - MAX_STORED)
	for (const key of drop) delete entries[key]
	return entries
}

/**
 * 记录一次表情使用（发送消息或选择器使用时调用）。
 * @param {string} username 用户
 * @param {{ kind: 'unicode', unicode: string } | { kind: 'custom', groupId: string, emojiId: string }} item 表情
 * @returns {void}
 */
export function recordEmojiUsage(username, item) {
	if (item.kind === 'unicode') {
		const unicode = String(item.unicode || '').trim()
		if (!unicode) return
		const id = usageEntryId('unicode', { unicode })
		const entries = loadUsageEntries(username)
		const prev = entries[id]
		entries[id] = {
			id,
			kind: 'unicode',
			unicode,
			count: (prev?.count || 0) + 1,
			lastUsedAt: Date.now(),
		}
		assignShellData(username, 'chat', SHELL_DATANAME, { entries: pruneUsageEntries(entries) })
		return
	}
	const groupId = String(item.groupId || '').trim()
	const emojiId = String(item.emojiId || '').trim()
	if (!groupId || !emojiId) return
	const id = usageEntryId('custom', { groupId, emojiId })
	const entries = loadUsageEntries(username)
	const prev = entries[id]
	entries[id] = {
		id,
		kind: 'custom',
		groupId,
		emojiId,
		count: (prev?.count || 0) + 1,
		lastUsedAt: Date.now(),
	}
	assignShellData(username, 'chat', SHELL_DATANAME, { entries: pruneUsageEntries(entries) })
}

/**
 * 从频道消息 content 提取并累计表情使用次数。
 * @param {string} username 发送者
 * @param {Record<string, unknown>} content 消息 content
 * @returns {void}
 */
export function recordEmojiUsageFromMessageContent(username, content) {
	if (!content) return
	if (content.type === 'sticker') {
		const emojiRef = String(content.emojiRef || '').trim()
		const match = /:\[([\w.-]+)\/([\w.-]+)]:/.exec(emojiRef)
		if (match)
			recordEmojiUsage(username, { kind: 'custom', groupId: match[1], emojiId: match[2] })
		return
	}
	const text = channelMessageText(content)
	if (!text) return

	CUSTOM_EMOJI_REF.lastIndex = 0
	const customSeen = new Set()
	for (const match of text.matchAll(CUSTOM_EMOJI_REF)) {
		const key = `${match[1]}/${match[2]}`
		if (customSeen.has(key)) continue
		customSeen.add(key)
		recordEmojiUsage(username, { kind: 'custom', groupId: match[1], emojiId: match[2] })
	}

	UNICODE_EMOJI.lastIndex = 0
	const unicodeSeen = new Set()
	for (const match of text.matchAll(UNICODE_EMOJI)) {
		const glyph = match[0]
		if (!glyph || unicodeSeen.has(glyph)) continue
		unicodeSeen.add(glyph)
		recordEmojiUsage(username, { kind: 'unicode', unicode: glyph })
	}
}

/**
 * 按发送次数列出常用表情。
 * @param {string} username 用户
 * @param {number} [limit=32] 返回条数上限
 * @returns {object[]} 统计条目，按 count、lastUsedAt 降序
 */
export function listFrequentEmojis(username, limit = 32) {
	const cap = Math.min(64, Math.max(1, limit))
	return Object.values(loadUsageEntries(username))
		.sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
		.slice(0, cap)
}
