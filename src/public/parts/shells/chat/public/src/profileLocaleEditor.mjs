/**
 * 【文件】public/src/profileLocaleEditor.mjs
 * 【职责】资料多语言编辑器：locale 标签页、语言切片复制/改名、标签/链接规范化。
 * 【原理】ensureLocaleEntry/renameLocaleEntry/renderLocaleTabs 操作 localized 对象。
 * 【数据结构】ProfileLink { icon?, name?, url }；localized Record<locale, fields>。
 * 【关联】Hub/profileEdit、entityProfile；@pages/scripts/i18n/index.mjs。
 */

/**
 * 资料外链条目。
 * @typedef {object} ProfileLink
 * @property {string} [icon] 图标 id 或 URL
 * @property {string} [name] 展示名
 * @property {string} url 链接地址
 */

/**
 * 单 locale 资料字段切片。
 * @typedef {object} ProfileLocaleSlice
 * @property {string} [name] 显示名
 * @property {string} [avatar] 头像 URL
 * @property {string} [description] 纯文本简介
 * @property {string} [description_markdown] Markdown 简介
 * @property {string[]} [tags] 标签列表
 * @property {ProfileLink[]} [links] 外链列表
 */

/**
 * 渲染资料多语言 locale 标签页与新增输入框。
 * @param {HTMLElement} tabsHost 书签容器
 * @param {Record<string, ProfileLocaleSlice>} localized 多语言表
 * @param {string} activeKey 当前选中 locale
 * @param {object} callbacks 回调
 * @param {(key: string) => void} callbacks.onSelect 切换 locale
 * @param {(key: string) => void} callbacks.onRemove 删除 locale
 * @param {(oldKey: string, newKey: string) => void} callbacks.onRename 改名 locale
 * @param {(key: string) => void} callbacks.onAdd 新增 locale
 * @returns {void}
 */
export function renderLocaleTabs(tabsHost, localized, activeKey, callbacks) {
	if (!tabsHost) return
	tabsHost.replaceChildren()
	const keys = Object.keys(localized).sort((a, b) => a.localeCompare(b))

	for (const key of keys) {
		const tab = document.createElement('div')
		tab.className = `profile-locale-tab${key === activeKey ? ' active' : ''}`
		tab.dataset.locale = key

		const selectButton = document.createElement('button')
		selectButton.type = 'button'
		selectButton.className = 'profile-locale-tab-label'
		selectButton.textContent = key
		selectButton.addEventListener('click', () => {
			if (key === activeKey) {
				beginLocaleRename(tab, selectButton, key, callbacks.onRename)
				return
			}
			callbacks.onSelect(key)
		})

		const close = document.createElement('button')
		close.type = 'button'
		close.className = 'profile-locale-tab-close'
		close.textContent = '×'
		close.dataset.i18n = 'chat.hub.profileEdit.localeRemove'
		close.addEventListener('click', () => {
			callbacks.onRemove(key)
		})

		tab.append(selectButton, close)
		tabsHost.append(tab)
	}

	const addInput = document.createElement('input')
	addInput.type = 'text'
	addInput.className = 'profile-locale-add-input input input-bordered input-sm font-mono'
	addInput.autocomplete = 'off'
	addInput.dataset.i18n = 'chat.hub.profileEdit.newLocale'
	addInput.addEventListener('keydown', event => {
		if (event.key !== 'Enter') return
		event.preventDefault()
		const next = addInput.value.trim()
		if (!next) return
		addInput.value = ''
		callbacks.onAdd(next)
	})
	tabsHost.append(addInput)
}

/**
 * 将 locale 标签替换为内联输入以改名（点击已选中标签）。
 * @param {HTMLElement} tab 标签壳
 * @param {HTMLElement} selectButton 当前文案按钮
 * @param {string} key 原 locale
 * @param {(oldKey: string, newKey: string) => void} onRename 提交回调
 * @returns {void}
 */
function beginLocaleRename(tab, selectButton, key, onRename) {
	if (tab.querySelector('.profile-locale-tab-edit')) return
	const input = document.createElement('input')
	input.type = 'text'
	input.className = 'profile-locale-tab-edit input input-bordered input-sm font-mono'
	input.value = key
	input.size = Math.max(key.length, 4)
	input.dataset.i18n = 'chat.hub.profileEdit.renameLocale'
	selectButton.replaceWith(input)
	input.focus()
	input.select()

	let done = false
	/**
	 * @param {boolean} commit 是否提交
	 * @returns {void}
	 */
	const finish = commit => {
		if (done) return
		done = true
		const next = input.value.trim()
		if (commit && next && next !== key) onRename(key, next)
		else input.replaceWith(selectButton)
	}
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault()
			finish(true)
			return
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			finish(false)
		}
	})
	input.addEventListener('blur', () => finish(true))
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
 * 规范化标签列表：去重并过滤空项。
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
 * 规范化外链列表：裁剪字段并丢弃无 URL 项。
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
		chip.className = 'profile-edit-tag-chip'
		const label = document.createElement('span')
		label.textContent = `#${tag}`
		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'profile-edit-tag-remove'
		remove.textContent = '×'
		remove.dataset.i18n = 'chat.hub.profileEdit.tagRemove'
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
 * @param {ProfileLink[]} links 当前链接（可含尚未填完的空行）
 * @param {(next: ProfileLink[], meta?: { rebuild?: boolean }) => void} onChange 变更回调；`rebuild` 为 true 时需重建 DOM
 * @returns {void}
 */
export function renderLinksEditor(host, links, onChange) {
	if (!(host instanceof HTMLElement)) return
	const draft = Array.isArray(links) && links.length
		? links.map(link => ({
			name: String(link?.name || ''),
			url: String(link?.url || ''),
			icon: String(link?.icon || ''),
		}))
		: [{ name: '', url: '', icon: '' }]
	host.replaceChildren()
	draft.forEach((link, index) => {
		const row = document.createElement('div')
		row.className = 'profile-edit-link-row'
		const nameInput = document.createElement('input')
		nameInput.type = 'text'
		nameInput.className = 'input input-bordered input-sm'
		nameInput.value = link.name || ''
		nameInput.dataset.i18n = 'chat.hub.profileEdit.link.name'
		const urlInput = document.createElement('input')
		urlInput.type = 'url'
		urlInput.className = 'input input-bordered input-sm'
		urlInput.value = link.url || ''
		urlInput.dataset.i18n = 'chat.hub.profileEdit.link.url'
		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'btn btn-ghost btn-sm'
		remove.textContent = '×'
		remove.dataset.i18n = 'chat.hub.profileEdit.link.remove'

		/**
		 * 将当前表单值写回 onChange。
		 * @returns {void}
		 */
		const commit = () => {
			onChange(readLinksEditor(host, { keepEmpty: true }))
		}
		nameInput.addEventListener('input', commit)
		urlInput.addEventListener('input', commit)
		remove.addEventListener('click', () => {
			const next = readLinksEditor(host, { keepEmpty: true }).filter((_, i) => i !== index)
			onChange(next, { rebuild: true })
		})
		row.append(nameInput, urlInput, remove)
		host.append(row)
	})
}

/**
 * 从链接编辑器 DOM 读取当前值。
 * @param {HTMLElement | null | undefined} host 行容器
 * @param {{ keepEmpty?: boolean }} [options] keepEmpty 时保留未填完的空行（编辑态）
 * @returns {ProfileLink[]} 链接列表
 */
export function readLinksEditor(host, options = {}) {
	if (!(host instanceof HTMLElement)) return []
	const rows = [...host.querySelectorAll('.profile-edit-link-row')].map(row => {
		const inputs = row.querySelectorAll('input')
		return {
			name: String(inputs[0]?.value || '').trim(),
			url: String(inputs[1]?.value || '').trim(),
			icon: '',
		}
	})
	if (options.keepEmpty) return rows
	return rows.filter(link => link.url || link.name)
}
