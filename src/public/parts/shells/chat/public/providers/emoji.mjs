/**
 * Chat emoji 内容提供商（registries.emoji）：最近 / 群自定义 / Unicode 分组。
 */
import { formatEmojiToken } from '../shared/inlineTokenSyntax.mjs'
import { fetchFrequentEmojis } from '../src/emojiUsageApi.mjs'
import { groupEmojiDataApiPath } from '../src/groupEmojiApi.mjs'
import {
	CURRENT_GROUP_EMOJI_TAB_GLYPH,
	extractGroupIdFromTabKey,
	GROUP_EMOJI_TAB_GLYPH,
	GROUP_EMOJI_TAB_PREFIX,
	groupTabKey,
	loadUnicodeEmojiByGroup,
	RECENT_EMOJI_TAB_GLYPH,
	RECENT_EMOJI_TAB_KEY,
	unicodeEmojiGroupFromTabKey,
	unicodeEmojiGroupI18nKey,
	unicodeEmojiGroupTabGlyph,
	unicodeEmojiTabKey,
} from '../src/lib/unicodeEmojiData.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const FREQUENT_EMOJI_LIMIT = 32

/**
 * @param {object} context picker 上下文
 * @returns {Promise<object[]>} 最近使用 emoji 项
 */
async function loadRecentItems(context) {
	const entries = await fetchFrequentEmojis(FREQUENT_EMOJI_LIMIT)
	/** @type {object[]} */
	const items = []
	for (const entry of entries) {
		if (entry.kind === 'custom' && entry.groupId && entry.emojiId) {
			const emojiRef = formatEmojiToken(entry.groupId, entry.emojiId)
			items.push({
				kind: 'custom',
				groupId: entry.groupId,
				emojiId: entry.emojiId,
				emojiRef,
				label: entry.emojiId,
				previewUrl: groupEmojiDataApiPath(entry.groupId, entry.emojiId),
			})
			continue
		}
		if (entry.kind === 'unicode' && entry.unicode)
			items.push({ kind: 'unicode', unicode: entry.unicode, label: entry.unicode })
	}
	return items
}

/**
 * @param {string} targetGroupId 群 ID
 * @returns {Promise<object[]>} 群自定义 emoji 项
 */
async function loadGroupItems(targetGroupId) {
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(targetGroupId)}/emojis`, {
		credentials: 'include',
	})
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error || 'load failed')
	return (data.entries || []).map(entry => {
		const emojiRef = formatEmojiToken(targetGroupId, entry.emojiId)
		return {
			kind: 'custom',
			groupId: targetGroupId,
			emojiId: entry.emojiId,
			emojiRef,
			label: entry.name || entry.emojiId,
			previewUrl: groupEmojiDataApiPath(targetGroupId, entry.emojiId),
		}
	})
}

/**
 * @param {object} context picker 上下文
 * @returns {Promise<object[]>} 标签页描述列表
 */
async function listTabs(context) {
	/** @type {object[]} */
	const tabs = [{
		id: RECENT_EMOJI_TAB_KEY,
		type: 'recent',
		glyph: RECENT_EMOJI_TAB_GLYPH,
		i18nKey: 'chat.hub.recentEmojiTab',
	}]

	const currentGroupId = context?.groupId ?? null
	const allGroups = context?.getGroups?.() ?? []
	const ordered = []
	if (currentGroupId) {
		const current = allGroups.find(g => g.groupId === currentGroupId)
		if (current) ordered.push({ group: current, isCurrent: true })
		for (const g of allGroups)
			if (g.groupId !== currentGroupId) ordered.push({ group: g, isCurrent: false })
	}
	else
		for (const g of allGroups) ordered.push({ group: g, isCurrent: false })

	for (const { group, isCurrent } of ordered) 
		tabs.push({
			id: groupTabKey(group.groupId),
			type: 'group',
			groupId: group.groupId,
			title: group.name || group.groupId,
			avatar: group.avatar || null,
			isCurrent,
			glyph: isCurrent ? CURRENT_GROUP_EMOJI_TAB_GLYPH : GROUP_EMOJI_TAB_GLYPH,
			i18nKey: isCurrent ? 'chat.hub.currentGroupEmojiTab' : null,
		})
	

	const { order } = await loadUnicodeEmojiByGroup()
	for (const groupName of order)
		tabs.push({
			id: unicodeEmojiTabKey(groupName),
			type: 'unicode',
			groupName,
			glyph: unicodeEmojiGroupTabGlyph(groupName),
			i18nKey: unicodeEmojiGroupI18nKey(groupName),
		})

	return tabs
}

/**
 * @param {object} tab 标签页
 * @param {object} context picker 上下文
 * @returns {Promise<{ items: object[], emptyI18n?: string, errorI18n?: string }>} 网格项与空态 i18n
 */
async function loadTabItems(tab, context) {
	if (tab.id === RECENT_EMOJI_TAB_KEY) {
		const items = await loadRecentItems(context)
		if (!items.length)
			return { items: [], emptyI18n: 'chat.hub.recentEmojisEmpty' }
		return { items }
	}

	const groupId = tab.groupId || extractGroupIdFromTabKey(tab.id)
	if (groupId) 
		try {
			const items = await loadGroupItems(groupId)
			if (!items.length)
				return { items: [], emptyI18n: 'chat.hub.groupEmojisEmpty' }
			return { items }
		}
		catch {
			return { items: [], errorI18n: 'chat.hub.groupEmojisLoadFailed' }
		}
	

	const { byGroup, order } = await loadUnicodeEmojiByGroup()
	const groupName = tab.groupName || unicodeEmojiGroupFromTabKey(tab.id, order)
	const emojis = groupName ? byGroup[groupName] || [] : []
	return {
		items: emojis.map(unicode => ({ kind: 'unicode', unicode, label: unicode })),
	}
}

/**
 * @param {object} item emoji 项
 * @returns {string} 插入编辑器的 token
 */
function tokenForSelection(item) {
	if (item.unicode) return item.unicode
	if (item.emojiRef) return item.emojiRef
	if (item.groupId && item.emojiId)
		return formatEmojiToken(item.groupId, item.emojiId)
	return ''
}

/**
 * @param {object} group 群摘要
 * @param {boolean} isCurrent 是否当前群
 * @returns {string} 标签按钮 innerHTML
 */
function groupTabInnerHtml(group, isCurrent) {
	if (isCurrent)
		return `<span class="emoji-tab-glyph" aria-hidden="true">${CURRENT_GROUP_EMOJI_TAB_GLYPH}</span>`
	if (group.avatar)
		return `<img src="${escapeHtml(group.avatar)}" class="emoji-tab-icon emoji-tab-avatar" width="20" height="20" alt="" aria-hidden="true" />`
	return `<span class="emoji-tab-glyph" aria-hidden="true">${GROUP_EMOJI_TAB_GLYPH}</span>`
}

/** Chat emoji registry 提供商 */
export default {
	kind: 'emoji',
	RECENT_EMOJI_TAB_KEY,
	GROUP_EMOJI_TAB_PREFIX,
	extractGroupIdFromTabKey,
	listTabs,
	loadTabItems,
	tokenForSelection,
	groupTabInnerHtml,
	/**
	 * @param {object} item emoji 项
	 * @returns {boolean} 是否为群自定义 emoji
	 */
	isGroupEmojiItem: item => item?.kind === 'custom' && !!(item.groupId && item.emojiId),
}
