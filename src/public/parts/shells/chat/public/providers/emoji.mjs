/**
 * Chat emoji 内容提供商（registries.emoji）：最近 / 群自定义 / Unicode 分组。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns-description, jsdoc/require-returns, jsdoc/require-param-type */
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

const FREQUENT_EMOJI_LIMIT = 32

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/**
 * @param {object} ctx
 * @returns {Promise<object[]>}
 */
async function loadRecentItems(ctx) {
	const entries = await fetchFrequentEmojis(FREQUENT_EMOJI_LIMIT)
	/** @type {object[]} */
	const items = []
	for (const entry of entries) {
		if (entry.kind === 'custom' && entry.groupId && entry.emojiId) {
			const emojiRef = `:[${entry.groupId}/${entry.emojiId}]:`
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
 * @param {string} targetGroupId
 * @returns {Promise<object[]>}
 */
async function loadGroupItems(targetGroupId) {
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(targetGroupId)}/emojis`, {
		credentials: 'include',
	})
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error || 'load failed')
	return (data.entries || []).map(entry => {
		const emojiRef = `:[${targetGroupId}/${entry.emojiId}]:`
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
 * @param {object} ctx
 * @returns {Promise<object[]>}
 */
async function listTabs(ctx) {
	/** @type {object[]} */
	const tabs = [{
		id: RECENT_EMOJI_TAB_KEY,
		type: 'recent',
		glyph: RECENT_EMOJI_TAB_GLYPH,
		i18nKey: 'chat.hub.recentEmojiTab',
	}]

	const currentGroupId = ctx?.groupId ?? null
	const allGroups = ctx?.getGroups?.() ?? []
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
 * @param {object} tab
 * @param {object} ctx
 * @returns {Promise<{ items: object[], emptyI18n?: string, errorI18n?: string }>}
 */
async function loadTabItems(tab, ctx) {
	if (tab.id === RECENT_EMOJI_TAB_KEY) {
		const items = await loadRecentItems(ctx)
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
 * @param {object} item
 * @returns {string}
 */
function tokenForSelection(item) {
	if (item.unicode) return item.unicode
	if (item.emojiRef) return item.emojiRef
	if (item.groupId && item.emojiId)
		return `:[${item.groupId}/${item.emojiId}]:`
	return ''
}

/**
 * @param {object} group
 * @param {boolean} isCurrent
 * @returns {string}
 */
function groupTabInnerHtml(group, isCurrent) {
	if (isCurrent)
		return `<span class="hub-emoji-tab-glyph" aria-hidden="true">${CURRENT_GROUP_EMOJI_TAB_GLYPH}</span>`
	if (group.avatar)
		return `<img src="${escapeHtml(group.avatar)}" class="hub-emoji-tab-icon hub-emoji-tab-avatar" width="20" height="20" alt="" aria-hidden="true" />`
	return `<span class="hub-emoji-tab-glyph" aria-hidden="true">${GROUP_EMOJI_TAB_GLYPH}</span>`
}

/**
 *
 */
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
	 *
	 * @param item
	 */
	isGroupEmojiItem: item => item?.kind === 'custom' && !!(item.groupId && item.emojiId),
}
