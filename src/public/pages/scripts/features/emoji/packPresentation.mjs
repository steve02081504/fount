/**
 * pack / 表情条目的 locale 展示解析。
 */
import { pickLocalizedSlice } from '../../i18n/locale_match.mjs'

/**
 * @param {object} pack pack 对象（含 localized）
 * @param {string[]} locales 优先 locale
 * @param {object} [infoDefaults] 群 / 作者默认展示
 * @returns {object} 合并后的展示字段
 */
export function resolvePackPresentation(pack, locales, infoDefaults = {}) {
	const slice = pickLocalizedSlice(pack?.localized, locales) || {}
	return {
		name: String(slice.name || '').trim() || infoDefaults.name || pack?.packId || '',
		avatar: String(slice.avatar || '').trim() || infoDefaults.avatar || '',
		description: slice.description != null ? String(slice.description) : infoDefaults.description || '',
		description_markdown: slice.description_markdown != null
			? String(slice.description_markdown)
			: slice.description != null ? String(slice.description) : infoDefaults.description_markdown || '',
		version: String(slice.version || '').trim() || infoDefaults.version || '',
		author: String(slice.author || '').trim() || infoDefaults.author || '',
		home_page: String(slice.home_page || '').trim() || infoDefaults.home_page || '',
		issue_page: String(slice.issue_page || '').trim() || infoDefaults.issue_page || '',
		tags: Array.isArray(slice.tags) ? [...slice.tags] : infoDefaults.tags || [],
		links: Array.isArray(slice.links) ? [...slice.links] : infoDefaults.links || [],
	}
}

/**
 * @param {object} item 表情条目（含 localized / emojiId）
 * @param {string[]} locales 优先 locale
 * @returns {{ name: string, alt: string }} 展示名与 alt 文案
 */
export function resolveEmojiItemLabels(item, locales) {
	const slice = pickLocalizedSlice(item?.localized, locales) || {}
	const emojiId = String(item?.emojiId || '').trim()
	const name = String(slice.name || '').trim() || emojiId
	const alt = String(slice.alt || '').trim() || name
	return { name, alt }
}
