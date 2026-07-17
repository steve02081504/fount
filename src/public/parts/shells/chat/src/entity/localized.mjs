import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { profileAvatarFileUrl } from './filesUrl.mjs'

/**
 * @param {unknown} linkItem 链接项
 * @returns {object | null} 规范化链接项或 null
 */
function normalizeLink(linkItem) {
	const url = String(linkItem?.url || '').trim()
	if (!url) return null
	return {
		icon: String(linkItem.icon || '').trim(),
		name: String(linkItem.name || '').trim(),
		url,
	}
}

/**
 * @param {unknown} localizedInput 原始 localized 字段
 * @returns {Record<string, object>} locale → 切片
 */
export function normalizeLocalizedMap(localizedInput) {
	if (!localizedInput) return {}
	/** @type {Record<string, object>} */
	const out = {}
	for (const [key, value] of Object.entries(localizedInput)) {
		const localeKey = String(key || '').trim()
		if (!localeKey || !value) continue
		const tags = Array.isArray(value.tags)
			? value.tags.map(t => String(t).trim().replace(/^#+/, '')).filter(Boolean)
			: undefined
		const links = Array.isArray(value.links)
			? value.links.map(normalizeLink).filter(Boolean)
			: undefined
		/** @type {Record<string, unknown>} */
		const slice = {}
		if (value.name != null) slice.name = String(value.name).trim()
		if (value.avatar) slice.avatar = String(value.avatar).trim()
		if (value.description != null) slice.description = String(value.description)
		if (value.description_markdown != null) slice.description_markdown = String(value.description_markdown)
		if (value.version) slice.version = String(value.version).trim()
		if (value.author) slice.author = String(value.author).trim()
		if (value.home_page) slice.home_page = String(value.home_page).trim()
		if (value.issue_page) slice.issue_page = String(value.issue_page).trim()
		// 空数组也写入：用户显式清空后不应回退到 part 默认 tags/links
		if (tags !== undefined) slice.tags = tags
		if (links !== undefined) slice.links = links
		if (Object.keys(slice).length) out[localeKey] = slice
	}
	return out
}

/**
 * @param {Record<string, object>} localized 多语言切片
 * @param {string[]} locales 区域设置优先级
 * @returns {object | null} 匹配的语言切片
 */
function pickLocalizedSlice(localized, locales) {
	const keys = Object.keys(localized || {})
	if (!keys.length) return null
	for (const locale of locales || []) {
		if (localized[locale]) return localized[locale]
		const prefix = String(locale).split('-')[0]
		const hit = keys.find(k => k === prefix || k.startsWith(`${prefix}-`))
		if (hit) return localized[hit]
	}
	return localized[keys[0]]
}

/**
 * @param {string} displayName 展示名
 * @param {{ subjectHash?: string }} profile 资料对象
 * @returns {boolean} 是否为占位展示名
 */
export function isPlaceholderDisplayName(displayName, profile) {
	const name = String(displayName || '').trim()
	if (!name) return true
	const subjectHash = String(profile?.subjectHash || '').trim().toLowerCase()
	if (!subjectHash || subjectHash.length < 12) return false
	const placeholder = `${subjectHash.slice(0, 8)}…${subjectHash.slice(-4)}`
	return name === placeholder
}

/**
 * @param {object} stored 磁盘上的 profile 对象
 * @param {string[]} locales 查看者区域设置
 * @param {object} infoDefaults part 默认
 * @returns {object} 合并后的展示字段
 */
export function resolveProfilePresentation(stored, locales, infoDefaults) {
	const localized = normalizeLocalizedMap(stored?.localized)
	const slice = pickLocalizedSlice(localized, locales) || {}

	let name = slice.name?.trim() || infoDefaults.name
	if (name && isPlaceholderDisplayName(name, stored))
		name = infoDefaults.name

	const description = slice.description != null
		? String(slice.description)
		: infoDefaults.description
	const description_markdown = slice.description_markdown != null
		? String(slice.description_markdown)
		: slice.description != null ? String(slice.description) : infoDefaults.description_markdown

	const tags = Array.isArray(slice.tags) ? slice.tags : (infoDefaults.tags || [])
	const links = Array.isArray(slice.links) ? slice.links : (infoDefaults.links || [])

	let avatar = slice.avatar?.trim() || infoDefaults.avatar
	if (avatar && !avatar.startsWith('http') && isEntityHash128(stored?.entityHash))
		avatar = profileAvatarFileUrl(stored.entityHash)
	else if (!avatar && isEntityHash128(stored?.entityHash) && stored?.localized)
		avatar = profileAvatarFileUrl(stored.entityHash)

	return {
		name: name || infoDefaults.name,
		avatar: avatar || '',
		description: description || '',
		description_markdown: description_markdown || '',
		version: slice.version?.trim() || infoDefaults.version || '',
		author: slice.author?.trim() || infoDefaults.author || '',
		home_page: slice.home_page?.trim() || infoDefaults.home_page || '',
		issue_page: slice.issue_page?.trim() || infoDefaults.issue_page || '',
		tags: [...tags],
		links: [...links],
	}
}

/**
 * @param {Record<string, object>} localized 多语言表
 * @param {string} avatarUrl 头像 URL
 * @returns {Record<string, object>} 带头像 URL 的多语言表
 */
export function applyAvatarToAllLocales(localized, avatarUrl) {
	const keys = Object.keys(localized)
	if (!keys.length) return { '': { avatar: avatarUrl } }
	/** @type {Record<string, object>} */
	const out = {}
	for (const key of keys)
		out[key] = { ...localized[key], avatar: avatarUrl }
	return out
}
