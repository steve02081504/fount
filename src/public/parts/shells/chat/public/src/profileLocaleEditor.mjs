/**
 * 【文件】public/src/profileLocaleEditor.mjs
 * 【职责】资料多语言编辑器：locale 标签页、新增语言、标签/链接规范化。
 * 【原理】ensureLocaleEntry/renderLocaleTabs 操作 localized 对象；promptNewLocaleKey 从 i18n 可用语言选择。
 * 【数据结构】ProfileLink { icon?, name?, url }；localized Record<locale, fields>。
 * 【关联】Hub/profileEdit、entityProfile；@pages/scripts/i18n/index.mjs。
 */
import { getAvailableLocales, geti18n } from '../../../../scripts/i18n/index.mjs'

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
 * 规范化单个标签：去空白与前导 #。
 * @param {unknown} value 原始标签
 * @returns {string} 规范化标签；空串表示无效
 */
export function normalizeProfileTag(value) {
	return String(value || '').trim().replace(/^#+/, '')
}

/**
 * @param {unknown} tags 原始标签列表
 * @returns {string[]} 去重后的标签
 */
export function normalizeProfileTags(tags) {
	if (!Array.isArray(tags)) return []
	const seen = new Set()
	/** @type {string[]} */
	const out = []
	for (const item of tags) {
		const tag = normalizeProfileTag(item)
		if (!tag || seen.has(tag)) continue
		seen.add(tag)
		out.push(tag)
	}
	return out
}

/**
 * @param {unknown} links 原始链接列表
 * @returns {ProfileLink[]} 规范化链接
 */
export function normalizeProfileLinks(links) {
	if (!Array.isArray(links)) return []
	return links.map(link => ({
		name: String(link?.name || '').trim(),
		url: String(link?.url || '').trim(),
		icon: String(link?.icon || '').trim(),
	})).filter(link => link.url)
}

/**
 * 渲染标签 chip 编辑器。
 * @param {HTMLElement} host chip 容器
 * @param {string[]} tags 当前标签
 * @param {(next: string[]) => void} onChange 变更回调
 * @returns {void}
 */
export function renderTagsEditor(host, tags, onChange) {
	if (!(host instanceof HTMLElement)) return
	const list = normalizeProfileTags(tags)
	host.replaceChildren()
	for (const tag of list) {
		const chip = document.createElement('span')
		chip.className = 'hub-profile-edit-tag-chip'
		const label = document.createElement('span')
		label.textContent = `#${tag}`
		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'hub-profile-edit-tag-remove'
		remove.textContent = '×'
		remove.setAttribute('aria-label', geti18n('chat.hub.profileEdit.tagRemove') || 'remove')
		remove.addEventListener('click', () => {
			onChange(list.filter(item => item !== tag))
		})
		chip.append(label, remove)
		host.append(chip)
	}
}

/**
 * 渲染链接动态行编辑器。
 * @param {HTMLElement} host 行容器
 * @param {ProfileLink[]} links 当前链接
 * @param {(next: ProfileLink[]) => void} onChange 变更回调
 * @returns {void}
 */
export function renderLinksEditor(host, links, onChange) {
	if (!(host instanceof HTMLElement)) return
	const list = normalizeProfileLinks(links)
	const draft = list.length ? list : [{ name: '', url: '', icon: '' }]
	host.replaceChildren()
	draft.forEach((link, index) => {
		const row = document.createElement('div')
		row.className = 'hub-profile-edit-link-row'
		const nameInput = document.createElement('input')
		nameInput.type = 'text'
		nameInput.className = 'input input-bordered input-sm'
		nameInput.value = link.name || ''
		nameInput.placeholder = geti18n('chat.hub.profileEdit.linkNamePlaceholder') || ''
		nameInput.dataset.i18n = 'chat.hub.profileEdit.linkNamePlaceholder'
		const urlInput = document.createElement('input')
		urlInput.type = 'url'
		urlInput.className = 'input input-bordered input-sm'
		urlInput.value = link.url || ''
		urlInput.placeholder = geti18n('chat.hub.profileEdit.linkUrlPlaceholder') || ''
		urlInput.dataset.i18n = 'chat.hub.profileEdit.linkUrlPlaceholder'
		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'btn btn-ghost btn-sm'
		remove.textContent = '×'
		remove.setAttribute('aria-label', geti18n('chat.hub.profileEdit.linkRemove') || 'remove')

		const commit = () => {
			const next = readLinksEditor(host)
			onChange(next.length ? next : [{ name: '', url: '', icon: '' }])
		}
		nameInput.addEventListener('input', commit)
		urlInput.addEventListener('input', commit)
		remove.addEventListener('click', () => {
			const next = draft.filter((_, i) => i !== index)
			onChange(next)
		})
		row.append(nameInput, urlInput, remove)
		host.append(row)
	})
}

/**
 * 从链接编辑器 DOM 读取当前值。
 * @param {HTMLElement | null | undefined} host 行容器
 * @returns {ProfileLink[]} 链接列表（可含空行过滤后）
 */
export function readLinksEditor(host) {
	if (!(host instanceof HTMLElement)) return []
	return [...host.querySelectorAll('.hub-profile-edit-link-row')].map(row => {
		const inputs = row.querySelectorAll('input')
		return {
			name: String(inputs[0]?.value || '').trim(),
			url: String(inputs[1]?.value || '').trim(),
			icon: '',
		}
	}).filter(link => link.url || link.name)
}
