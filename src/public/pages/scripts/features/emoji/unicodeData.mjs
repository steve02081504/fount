/**
 * 从 unicode-emoji-json CDN 加载 RGI emoji 分组数据。
 */
const UNICODE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/unicode-emoji-json/data-by-group.json'

/** @type {Record<string, string[]> | null} */
let emojiByGroup = null

/** @type {string[]} */
let emojiGroupOrder = []

/** @type {Promise<{ byGroup: Record<string, string[]>, order: string[] }> | null} */
let loadPromise = null

/**
 * unicode-emoji-json 官方分组名 → data-i18n 键（静态维护；CDN 增删分组时改这里）。
 * @type {Readonly<Record<string, string>>}
 */
export const UNICODE_EMOJI_GROUP_I18N_KEYS = {
	'Smileys & Emotion': 'chat.unicodeEmojiGroups.Smileys_and_Emotion',
	'People & Body': 'chat.unicodeEmojiGroups.People_and_Body',
	'Animals & Nature': 'chat.unicodeEmojiGroups.Animals_and_Nature',
	'Food & Drink': 'chat.unicodeEmojiGroups.Food_and_Drink',
	'Travel & Places': 'chat.unicodeEmojiGroups.Travel_and_Places',
	Activities: 'chat.unicodeEmojiGroups.Activities',
	Objects: 'chat.unicodeEmojiGroups.Objects',
	Symbols: 'chat.unicodeEmojiGroups.Symbols',
	Flags: 'chat.unicodeEmojiGroups.Flags',
}

/**
 * 分区标志 glyph：加载后由各组第一个 emoji 填充。
 * @type {Record<string, string>}
 */
export const UNICODE_EMOJI_GROUP_TAB_GLYPH = {}

/** 最近使用分区键 */
export const RECENT_EMOJI_SECTION_KEY = '__recent__'

/** 最近分区标志 */
export const RECENT_EMOJI_SECTION_GLYPH = '🕒'

/**
 * @param {string} groupName 官方分组名
 * @returns {string} 单字符或 ZWJ 序列
 */
export function unicodeEmojiGroupGlyph(groupName) {
	return UNICODE_EMOJI_GROUP_TAB_GLYPH[groupName]
		|| emojiByGroup?.[groupName]?.[0]
		|| '❓'
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
				for (const key of Object.keys(UNICODE_EMOJI_GROUP_TAB_GLYPH))
					delete UNICODE_EMOJI_GROUP_TAB_GLYPH[key]
				for (const block of data) {
					const name = String(block?.name || '').trim()
					if (!name) continue
					const emojis = (block.emojis || []).map(item => item.emoji).filter(Boolean)
					emojiByGroup[name] = emojis
					emojiGroupOrder.push(name)
					if (emojis[0]) UNICODE_EMOJI_GROUP_TAB_GLYPH[name] = emojis[0]
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
 * unicode-emoji-json 分组名 → 稳定键片段（空格→`_`、`&`→`and`）。
 * @param {string} groupName 官方分组名
 * @returns {string} 归一化键
 */
export function normalizeUnicodeEmojiGroupKey(groupName) {
	return String(groupName).replace(/\s+/g, '_').replace(/&/g, 'and')
}

/**
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string} 分区键
 */
export function unicodeEmojiSectionKey(groupName) {
	return `u:${normalizeUnicodeEmojiGroupKey(groupName)}`
}

/**
 * @param {string} groupName unicode-emoji-json 分组名
 * @returns {string | undefined} data-i18n 键；未映射则无
 */
export function unicodeEmojiGroupI18nKey(groupName) {
	return UNICODE_EMOJI_GROUP_I18N_KEYS[groupName]
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
		if (normalizeUnicodeEmojiGroupKey(name) === tabKey) return name
	return null
}
