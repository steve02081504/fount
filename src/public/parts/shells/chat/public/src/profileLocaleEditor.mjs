/**
 * 【文件】public/src/profileLocaleEditor.mjs
 * 【职责】资料多语言编辑器：locale 标签页、新增语言、链接列表编辑。
 * 【原理】ensureLocaleEntry/renderLocaleTabs 操作 localized 对象；promptNewLocaleKey 从 i18n 可用语言选择。
 * 【数据结构】ProfileLink { icon?, name?, url }；localized Record<locale, fields>。
 * 【关联】Hub/profileEdit、entityProfile；@pages/scripts/i18n/index.mjs。
 */
import { getAvailableLocales } from '../../../../scripts/i18n/index.mjs'

/**
 * @typedef {object} ProfileLink
 * @property {string} [icon]
 * @property {string} [name]
 * @property {string} url
 */

/**
 * @typedef {object} ProfileLocaleSlice
 * @property {string} [name]
 * @property {string} [avatar]
 * @property {string} [description]
 * @property {string} [description_markdown]
 * @property {string[]} [tags]
 * @property {ProfileLink[]} [links]
 */

/**
 * @param {Record<string, ProfileLocaleSlice>} localized 多语言表
 * @param {string} activeKey 当前 locale 键
 * @returns {Record<string, ProfileLocaleSlice>} 新表
 */
export function ensureLocaleEntry(localized, activeKey) {
	const key = String(activeKey || '').trim()
	if (!key) return localized
	if (localized[key]) return localized
	return { ...localized, [key]: {} }
}

/**
 * @param {HTMLElement} tabsHost 书签容器
 * @param {Record<string, ProfileLocaleSlice>} localized 多语言表
 * @param {string} activeKey 当前选中 locale
 * @param {object} callbacks 回调
 * @param {(key: string) => void} callbacks.onSelect 切换 locale
 * @param {(key: string) => void} callbacks.onRemove 删除 locale
 * @param {() => void} callbacks.onAdd 添加 locale
 * @returns {void}
 */
export function renderLocaleTabs(tabsHost, localized, activeKey, callbacks) {
	if (!tabsHost) return
	tabsHost.replaceChildren()
	const keys = Object.keys(localized).sort((a, b) => a.localeCompare(b))

	for (const key of keys) {
		const tabButton = document.createElement('button')
		tabButton.type = 'button'
		tabButton.className = `hub-profile-locale-tab${key === activeKey ? ' active' : ''}`
		tabButton.dataset.locale = key
		const label = document.createElement('span')
		label.className = 'hub-profile-locale-tab-label'
		label.textContent = key
		tabButton.append(label)
		const close = document.createElement('span')
		close.className = 'hub-profile-locale-tab-close'
		close.textContent = '×'
		close.setAttribute('role', 'button')
		close.setAttribute('aria-label', 'remove')
		close.addEventListener('click', (event) => {
			event.stopPropagation()
			callbacks.onRemove(key)
		})
		tabButton.addEventListener('click', () => callbacks.onSelect(key))
		tabButton.append(close)
		tabsHost.append(tabButton)
	}

	const addButton = document.createElement('button')
	addButton.type = 'button'
	addButton.className = 'hub-profile-locale-tab hub-profile-locale-tab-add'
	addButton.textContent = '+'
	addButton.addEventListener('click', () => callbacks.onAdd())
	tabsHost.append(addButton)
}

/**
 * 弹出输入框添加新 locale 键。
 * @param {Record<string, ProfileLocaleSlice>} localized 已有键
 * @returns {string | null} 新键或取消
 */
export async function promptNewLocaleKey(localized) {
	const existing = new Set(Object.keys(localized))
	/** @type {{ id: string, name?: string }[]} */
	let localeList = []
	try {
		localeList = await getAvailableLocales()
	}
	catch { /* 离线时仍可手动输入 */ }
	const suggestions = localeList.map(l => l.id).filter(id => !existing.has(id))
	const hint = suggestions.slice(0, 6).join(', ')
	const raw = window.prompt(`Locale key (e.g. zh-CN, en-UK)\n${hint}`, suggestions[0] || 'zh-CN')
	const key = String(raw || '').trim()
	if (!key) return null
	if (existing.has(key)) return null
	return key
}

/**
 * @param {string} tagsText 逗号分隔标签
 * @returns {string[]} 标签数组
 */
export function parseTagsInput(tagsText) {
	return String(tagsText || '')
		.split(/[,，]/)
		.map(t => t.trim())
		.filter(Boolean)
}

/**
 * @param {string[]|undefined} tags 标签
 * @returns {string} 输入框用逗号串
 */
export function formatTagsInput(tags) {
	return Array.isArray(tags) ? tags.join(', ') : ''
}

/**
 * 每行 `名称|URL|图标URL`（图标可省略）。
 * @param {string} text 多行链接
 * @returns {ProfileLink[]} 链接数组
 */
export function parseLinksInput(text) {
	return String(text || '')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.map((line) => {
			const parts = line.split('|').map(p => p.trim())
			if (parts.length >= 2)
				return { name: parts[0], url: parts[1], icon: parts[2] || '' }
			return { name: '', url: parts[0], icon: '' }
		})
		.filter(l => l.url)
}

/**
 * @param {ProfileLink[]|undefined} links 链接
 * @returns {string} 多行文本
 */
export function formatLinksInput(links) {
	if (!Array.isArray(links)) return ''
	return links.map(l => {
		const name = String(l.name || '').trim()
		const url = String(l.url || '').trim()
		const icon = String(l.icon || '').trim()
		if (name && icon) return `${name}|${url}|${icon}`
		if (name) return `${name}|${url}`
		return url
	}).join('\n')
}
