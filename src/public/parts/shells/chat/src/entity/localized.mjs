import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { pickLocalizedSlice } from '../../../../../../scripts/i18n/locale_match.mjs'
import { applySfwOverlay } from '../../../../../../scripts/sfw.mjs'

import { profileAvatarFileUrl, profileSfwAvatarFileUrl } from './filesUrl.mjs'

/**
 * @param {unknown} linkItem 链接项
 * @returns {object | null} 规范化链接项或 null
 */
function normalizeLink(linkItem) {
	const url = String(linkItem?.url || '').trim()
	if (!url) return null
	return {
		icon: (linkItem.icon || ''),
		name: (linkItem.name || ''),
		url,
	}
}

/**
 * @param {unknown} tags 原始 tags
 * @returns {string[] | undefined} 规范化 tags；非数组时 undefined
 */
function normalizeTags(tags) {
	if (!Array.isArray(tags)) return undefined
	return tags.map(t => t.replace(/^#+/, '')).filter(Boolean)
}

/**
 * @param {unknown} links 原始 links
 * @returns {object[] | undefined} 规范化 links；非数组时 undefined
 */
function normalizeLinks(links) {
	if (!Array.isArray(links)) return undefined
	return links.map(normalizeLink).filter(Boolean)
}

/**
 * 将单 locale 切片（含可选 sfw_*）写入目标对象。
 * @param {object} slice 目标
 * @param {object} value 原始切片
 * @returns {void}
 */
function writeLocaleSliceFields(slice, value) {
	if (value.name != null) slice.name = String(value.name).trim()
	if (value.avatar) slice.avatar = String(value.avatar).trim()
	if (value.description != null) slice.description = String(value.description)
	if (value.description_markdown != null) slice.description_markdown = String(value.description_markdown)
	if (value.version) slice.version = String(value.version).trim()
	if (value.author) slice.author = String(value.author).trim()
	if (value.home_page) slice.home_page = String(value.home_page).trim()
	if (value.issue_page) slice.issue_page = String(value.issue_page).trim()

	const tags = normalizeTags(value.tags)
	const links = normalizeLinks(value.links)
	// 空数组也写入：用户显式清空后不应回退到 part 默认 tags/links
	if (tags !== undefined) slice.tags = tags
	if (links !== undefined) slice.links = links

	if (value.sfw_name != null) slice.sfw_name = String(value.sfw_name).trim()
	if (value.sfw_avatar) slice.sfw_avatar = String(value.sfw_avatar).trim()
	if (value.sfw_description != null) slice.sfw_description = String(value.sfw_description)
	if (value.sfw_description_markdown != null)
		slice.sfw_description_markdown = String(value.sfw_description_markdown)
	const sfwTags = normalizeTags(value.sfw_tags)
	const sfwLinks = normalizeLinks(value.sfw_links)
	if (sfwTags !== undefined) slice.sfw_tags = sfwTags
	if (sfwLinks !== undefined) slice.sfw_links = sfwLinks
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
		const localeKey = (key || '')
		if (!localeKey || !value) continue
		/** @type {Record<string, unknown>} */
		const slice = {}
		writeLocaleSliceFields(slice, value)
		if (Object.keys(slice).length) out[localeKey] = slice
	}
	return out
}

/**
 * @param {string} displayName 展示名
 * @param {{ subjectHash?: string }} profile 资料对象
 * @returns {boolean} 是否为占位展示名
 */
export function isPlaceholderDisplayName(displayName, profile) {
	const name = (displayName || '')
	if (!name) return true
	const subjectHash = String(profile?.subjectHash || '').trim()
	if (!subjectHash || subjectHash.length < 12) return false
	const placeholder = `${subjectHash.slice(0, 8)}…${subjectHash.slice(-4)}`
	return name === placeholder
}

/**
 * 将逻辑路径头像归一为 EVFS URL。
 * @param {string} avatar 头像字段
 * @param {string | undefined} entityHash 实体 hash
 * @returns {string} 归一后的头像
 */
function rewriteAvatarLogicalPath(avatar, entityHash) {
	if (!avatar || !isEntityHash128(entityHash)) return avatar
	if (avatar === 'profile/avatar') return profileAvatarFileUrl(entityHash)
	if (avatar === 'profile/sfw_avatar') return profileSfwAvatarFileUrl(entityHash)
	return avatar
}

/**
 * @param {object} stored 磁盘上的 profile 对象
 * @param {string[]} locales 查看者区域设置
 * @param {object} infoDefaults part 默认
 * @param {{ sfw?: boolean }} [options] 选项；`sfw` 为真时对切片与 banner 做 sfw_* overlay
 * @returns {object} 合并后的展示字段
 */
export function resolveProfilePresentation(stored, locales, infoDefaults, options = {}) {
	const localized = normalizeLocalizedMap(stored?.localized)
	let slice = pickLocalizedSlice(localized, locales) || {}
	if (options.sfw) slice = applySfwOverlay(slice) || slice

	let name = slice.name?.trim() || infoDefaults.name
	if (name && isPlaceholderDisplayName(name, stored))
		name = infoDefaults.name

	const description = slice.description != null
		? String(slice.description)
		: infoDefaults.description
	const description_markdown = slice.description_markdown != null
		? String(slice.description_markdown)
		: slice.description != null ? String(slice.description) : infoDefaults.description_markdown

	const tags = Array.isArray(slice.tags) ? slice.tags : infoDefaults.tags || []
	const links = Array.isArray(slice.links) ? slice.links : infoDefaults.links || []

	let avatar = slice.avatar?.trim() || infoDefaults.avatar || ''
	// 仅归一「profile/avatar」「profile/sfw_avatar」逻辑路径；无头像时不要虚构 EVFS URL。
	avatar = rewriteAvatarLogicalPath(avatar, stored?.entityHash)

	let banner = String(stored?.banner || '').trim()
	if (options.sfw) {
		const sfwBanner = String(stored?.sfw_banner || '').trim()
		if (sfwBanner) banner = sfwBanner
	}

	return {
		name: name || infoDefaults.name,
		avatar: avatar || '',
		banner,
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

/**
 * 仅写入各 locale 的 `sfw_avatar`，不碰基线 avatar。
 * @param {Record<string, object>} localized 多语言表
 * @param {string} avatarUrl SFW 头像 URL
 * @returns {Record<string, object>} 带 sfw_avatar 的多语言表
 */
export function applySfwAvatarToAllLocales(localized, avatarUrl) {
	const keys = Object.keys(localized)
	if (!keys.length) return { '': { sfw_avatar: avatarUrl } }
	/** @type {Record<string, object>} */
	const out = {}
	for (const key of keys)
		out[key] = { ...localized[key], sfw_avatar: avatarUrl }
	return out
}
