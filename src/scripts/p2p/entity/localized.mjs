import { getUserByUsername } from '../../../server/auth.mjs'
import { getPartDetails } from '../../../server/parts_loader.mjs'
import { getLocalizedInfo } from '../../locale.mjs'
import { isEntityHash128 } from '../entity_id.mjs'

import { resolveAgentCharPartName } from './agentResolve.mjs'
import { profileAvatarFileUrl } from './files/url.mjs'
import {
	isPlaceholderDisplayName,
	resolvePersonaPresentation,
	resolvePersonanameForReplica,
} from './personaPresentation.mjs'

/**
 * @param {import('npm:express').Request} req HTTP 请求
 * @param {string} replicaUsername replica 登录名
 * @returns {string[]} 区域设置优先级列表
 */
export function localesFromRequest(req, replicaUsername) {
	const localeQuery = req.query?.locales
	/** @type {string[]} */
	let fromQuery = []
	if (Array.isArray(localeQuery))
		fromQuery = localeQuery.map(String)
	else if (localeQuery)
		fromQuery = String(localeQuery).split(',').map(s => s.trim()).filter(Boolean)
	if (fromQuery.length) return fromQuery
	const userLocales = getUserByUsername(replicaUsername)?.locales
	if (Array.isArray(userLocales) && userLocales.length) return userLocales
	return ['zh-CN', 'en-UK']
}

/**
 * @param {unknown} linkItem 链接项
 * @returns {object | null} 规范化链接或 null
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
 * @param {object} li part info 切片
 * @returns {object[]} 默认链接
 */
function linksFromInfoLi(li) {
	/** @type {object[]} */
	const links = []
	const home = String(li?.home_page || '').trim()
	const issues = String(li?.issue_page || '').trim()
	if (home) links.push({ name: 'Home', url: home, icon: 'https://api.iconify.design/line-md/home.svg' })
	if (issues) links.push({ name: 'Issues', url: issues, icon: 'https://api.iconify.design/line-md/alert.svg' })
	return links
}

/**
 * @param {unknown} localizedInput 原始 localized 字段
 * @returns {Record<string, object>} 规范化映射
 */
export function normalizeLocalizedMap(localizedInput) {
	if (!localizedInput) return {}
	/** @type {Record<string, object>} */
	const out = {}
	for (const [key, value] of Object.entries(localizedInput)) {
		const localeKey = String(key || '').trim()
		if (!localeKey || !value) continue
		const tags = Array.isArray(value.tags)
			? value.tags.map(t => String(t).trim()).filter(Boolean)
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
		if (tags?.length) slice.tags = tags
		if (links?.length) slice.links = links
		if (Object.keys(slice).length) out[localeKey] = slice
	}
	return out
}

/**
 * @param {Record<string, object>} localized 多语言切片
 * @param {string[]} locales 区域设置优先级
 * @returns {object | null} 最佳匹配切片
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
 * @param {object} li part getInfo 切片
 * @returns {object} 默认展示字段
 */
function infoLiToDefaults(li) {
	const description = String(li?.description || '').trim()
	const description_markdown = String(li?.description_markdown || description).trim()
	return {
		name: String(li?.name || '').trim(),
		avatar: String(li?.avatar || '').trim(),
		description,
		description_markdown,
		version: String(li?.version || '').trim(),
		author: String(li?.author || '').trim(),
		home_page: String(li?.home_page || '').trim(),
		issue_page: String(li?.issue_page || '').trim(),
		tags: Array.isArray(li?.tags) ? li.tags.map(t => String(t).trim()).filter(Boolean) : [],
		links: linksFromInfoLi(li),
	}
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {string[]} locales 区域设置列表
 * @returns {Promise<object>} 来自 part getInfo 的默认展示字段
 */
export async function getInfoDefaultsForEntity(replicaUsername, entityHash, locales) {
	const charname = resolveAgentCharPartName(replicaUsername, entityHash)
	if (charname) {
		const details = await getPartDetails(replicaUsername, `chars/${charname}`).catch(() => null) || {}
		const li = getLocalizedInfo(details.info, locales) || getLocalizedInfo(details.info, ['']) || {}
		const defaults = infoLiToDefaults(li)
		return { ...defaults, name: defaults.name || charname }
	}

	const presentation = await resolvePersonaPresentation(replicaUsername)
	const personaname = await resolvePersonanameForReplica(replicaUsername)
	let defaults = infoLiToDefaults({ name: presentation.displayName, avatar: presentation.avatar })
	if (personaname) {
		const details = await getPartDetails(replicaUsername, `personas/${personaname}`).catch(() => null) || {}
		const li = getLocalizedInfo(details.info, locales) || getLocalizedInfo(details.info, ['']) || {}
		defaults = { ...infoLiToDefaults(li), name: defaults.name || presentation.displayName, avatar: defaults.avatar || presentation.avatar }
	}
	return defaults
}

/**
 * @param {object} stored 磁盘上的 profile 对象
 * @param {string[]} locales 查看者区域设置
 * @param {object} infoDefaults part 默认
 * @returns {object} 解析后的展示字段
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

	const tags = slice.tags?.length ? slice.tags : infoDefaults.tags
	const links = slice.links?.length ? slice.links : infoDefaults.links

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
 * @returns {Record<string, object>} 更新后的多语言表
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
