/**
 * 从 unicode-emoji-json CDN 加载 RGI emoji 分组数据。
 */
const UNICODE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/unicode-emoji-json@0.9.0/data-by-group.json'

/** @type {Record<string, string[]> | null} */
let emojiByGroup = null

/** @type {string[]} */
let emojiGroupOrder = []

/** @type {Promise<{ byGroup: Record<string, string[]>, order: string[] }> | null} */
let loadPromise = null

/** unicode-emoji-json 官方分组 → rail / 分区标志性 emoji */
export const UNICODE_EMOJI_GROUP_TAB_GLYPH = {
	'Smileys & Emotion': '😀',
	'People & Body': '👋',
	'Animals & Nature': '🐱',
	'Food & Drink': '🍔',
	'Travel & Places': '✈️',
	Activities: '⚽',
	Objects: '💡',
	Symbols: '❤️',
	Flags: '🏳️',
	Component: '🧩',
}

/** 最近使用分区键 */
export const RECENT_EMOJI_SECTION_KEY = '__recent__'

/** 最近分区标志 */
export const RECENT_EMOJI_SECTION_GLYPH = '🕒'

/**
 * @param {string} groupName 官方分组名
 * @returns {string} 单字符或 ZWJ 序列
 */
export function unicodeEmojiGroupGlyph(groupName) {
	return UNICODE_EMOJI_GROUP_TAB_GLYPH[groupName] || '❓'
}

/**
 * 加载 unicode-emoji-json 分组数据（内存缓存）。
 * @returns {Promise<{ byGroup: Record<string, string[]>, order: string[] }>} 分组名 → 字形列表与顺序
 */
export function loadUnicodeEmojiByGroup() {
	if (emojiByGroup) return Promise.resolve({ byGroup: emojiByGroup, order: emojiGroupOrder })
	if (!loadPromise)
		loadPromise = fetch(UNICODE_EMOJI_CDN)
			.then(r => {
				if (!r.ok) throw new Error(`unicode-emoji-json fetch ${r.status}`)
				return r.json()
			})
			.then(data => {
				if (!Array.isArray(data)) throw new Error('unicode-emoji-json: expected grouped array')
				emojiByGroup = {}
				emojiGroupOrder = []
				for (const block of data) {
					const name = String(block?.name || '').trim()
					if (!name) continue
					emojiByGroup[name] = (block.emojis || []).map(item => item.emoji).filter(Boolean)
					emojiGroupOrder.push(name)
				}
				return { byGroup: emojiByGroup, order: emojiGroupOrder }
			})
			.catch(err => {
				loadPromise = null
				throw err
			})

	return loadPromise
}

/**
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} 分区键
 */
export function unicodeEmojiSectionKey(groupName) {
	return `u:${String(groupName).replace(/\s+/g, '_').replace(/&/g, 'and')}`
}

/**
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} data-i18n 键
 */
export function unicodeEmojiGroupI18nKey(groupName) {
	return `chat.unicodeEmojiGroups.${String(groupName).replace(/\s+/g, '_').replace(/&/g, 'and')}`
}

/**
 * @param {string} sectionKey 分区键
 * @param {string[]} order 分组顺序
 * @returns {string | null} 分组名
 */
export function unicodeEmojiGroupFromSectionKey(sectionKey, order) {
	if (!sectionKey?.startsWith('u:')) return null
	const tabKey = sectionKey.slice(2)
	for (const name of order)
		if (String(name).replace(/\s+/g, '_').replace(/&/g, 'and') === tabKey) return name
	return null
}

/** @deprecated 兼容旧 chat 导入 */
export const RECENT_EMOJI_TAB_KEY = RECENT_EMOJI_SECTION_KEY
/** @deprecated */
export const RECENT_EMOJI_TAB_GLYPH = RECENT_EMOJI_SECTION_GLYPH
/**
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} 旧版 tab 键（不含 `u:` 前缀）
 * @deprecated
 */
export const unicodeEmojiTabKey = (groupName) => unicodeEmojiSectionKey(groupName).slice(2)
/** @deprecated */
export const unicodeEmojiGroupTabGlyph = unicodeEmojiGroupGlyph
/**
 * @param {string} tabKey 旧版 tab 键
 * @param {string[]} order 分组顺序
 * @returns {string | null} 分组名
 * @deprecated
 */
export const unicodeEmojiGroupFromTabKey = (tabKey, order) => {
	for (const name of order)
		if (unicodeEmojiTabKey(name) === tabKey) return name
	return null
}
/** @deprecated */
export const GROUP_EMOJI_TAB_PREFIX = '__g__:'
/** @deprecated */
export const GROUP_EMOJI_TAB_GLYPH = '👥'
/** @deprecated */
export const CURRENT_GROUP_EMOJI_TAB_GLYPH = '⭐'
/**
 * @param {string} groupId 群 ID
 * @returns {string} 旧版群 tab 键
 * @deprecated
 */
export function groupTabKey(groupId) {
	return `${GROUP_EMOJI_TAB_PREFIX}${groupId}`
}
/**
 * @param {string} tabKey 旧版 tab 键
 * @returns {string | null} 群 ID
 * @deprecated
 */
export function extractGroupIdFromTabKey(tabKey) {
	if (!tabKey?.startsWith(GROUP_EMOJI_TAB_PREFIX)) return null
	return tabKey.slice(GROUP_EMOJI_TAB_PREFIX.length) || null
}
/**
 * @param {string} glyph 标志 emoji
 * @returns {string} tab 按钮 HTML
 * @deprecated
 */
export function emojiTabGlyphHtml(glyph) {
	return `<span class="emoji-tab-glyph" aria-hidden="true">${glyph}</span>`
}
