/**
 * 【文件】public/src/lib/unicodeEmojiData.mjs
 * 【职责】从 unicode-emoji-json CDN 加载 RGI emoji 分组数据供选择器使用。
 * 【原理】loadUnicodeEmojiByGroup 拉 data-by-group.json 并缓存；unicodeEmojiGroupTabGlyph 提供 Tab 字形。
 * 【数据结构】emojiByGroup Record<group, codes[]>、emojiGroupOrder[]。
 * 【关联】ui/emojiPicker.mjs；与 customEmojis 并列数据源。
 */
const UNICODE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/unicode-emoji-json@0.9.0/data-by-group.json'

/** @type {Record<string, string[]> | null} */
let emojiByGroup = null

/** @type {string[]} */
let emojiGroupOrder = []

/** @type {Promise<{ byGroup: Record<string, string[]>, order: string[] }> | null} */
let loadPromise = null

/** unicode-emoji-json 官方分组 → tab 上显示的标志性 emoji */
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

/**
 * 分组 tab 用标志性 emoji。
 * @param {string} groupName 官方分组名
 * @returns {string} 单字符或 ZWJ 序列
 */
export function unicodeEmojiGroupTabGlyph(groupName) {
	return UNICODE_EMOJI_GROUP_TAB_GLYPH[groupName] || '❓'
}

/**
 * 懒加载 unicode-emoji-json 分组数据。
 * @returns {Promise<{ byGroup: Record<string, string[]>, order: string[] }>} 分组名到 emoji 列表及顺序
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
 * 将官方分组名转为安全的 `data-tab` 键。
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} tab 键
 */
export function unicodeEmojiTabKey(groupName) {
	return String(groupName).replace(/\s+/g, '_').replace(/&/g, 'and')
}

/**
 * Unicode 官方分组名的 i18n 键（`chat.unicodeEmojiGroups.*`）。
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} data-i18n 键
 */
export function unicodeEmojiGroupI18nKey(groupName) {
	return `chat.unicodeEmojiGroups.${unicodeEmojiTabKey(groupName)}`
}

/**
 * 由 tab 键还原分组名（仅用于 unicode 分组）。
 * @param {string} tabKey data-tab 值
 * @param {string[]} order 分组顺序
 * @returns {string | null} 分组名
 */
export function unicodeEmojiGroupFromTabKey(tabKey, order) {
	for (const name of order)
		if (unicodeEmojiTabKey(name) === tabKey) return name
	return null
}

/** 最近使用 emoji tab */
export const RECENT_EMOJI_TAB_KEY = '__recent__'

/** 最近 tab 标志性 emoji */
export const RECENT_EMOJI_TAB_GLYPH = '🕒'

/** 当前群自定义表情 tab 标志性 emoji */
export const CURRENT_GROUP_EMOJI_TAB_GLYPH = '⭐'

/** 其他群自定义表情 tab 标志性 emoji */
export const GROUP_EMOJI_TAB_GLYPH = '👥'

/** 群自定义表情 tab 前缀（`__g__:${groupId}`） */
export const GROUP_EMOJI_TAB_PREFIX = '__g__:'

/**
 * tab 按钮内仅渲染 emoji 字形（避免 i18n 覆盖 innerHTML）。
 * @param {string} glyph 标志性 emoji
 * @returns {string} HTML
 */
export function emojiTabGlyphHtml(glyph) {
	return `<span class="hub-emoji-tab-glyph" aria-hidden="true">${glyph}</span>`
}

/**
 * 群自定义表情 tab 键。
 * @param {string} groupId 群 ID
 * @returns {string} data-tab 值
 */
export function groupTabKey(groupId) {
	return `${GROUP_EMOJI_TAB_PREFIX}${groupId}`
}

/**
 * 从 tab 键解析群 ID。
 * @param {string} tabKey data-tab 值
 * @returns {string | null} 群 ID，非群 tab 时为 null
 */
export function extractGroupIdFromTabKey(tabKey) {
	if (!tabKey?.startsWith(GROUP_EMOJI_TAB_PREFIX)) return null
	return tabKey.slice(GROUP_EMOJI_TAB_PREFIX.length) || null
}
