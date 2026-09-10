/**
 * gist 列表页：以瀑布流卡片展示全部 gist（标题 + 开头内容），支持搜索、排序、
 * 选择模式下的多选与批量下载 / 删除，以及 Ctrl/Shift 快捷键选择。
 */
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { initTranslations, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { deleteGists, getGist, listGists } from './src/endpoints.mjs'
import { downloadHtmlDocument, fileNameFromHtmlTitle, renderMarkdownAsStandaloneDocument } from './src/standaloneDocument.mjs'

const VIEW_URL = '/parts/shells:gist/view'
const EDIT_URL = '/parts/shells:gist/edit.html'
const DEFAULT_SORT = 'updated-desc'

/** 来源类型 → i18n 键。 */
const SOURCE_I18N = {
	chat: 'gist.source.chat',
	social: 'gist.source.social',
	code: 'gist.source.code',
	'md-drop': 'gist.source.md-drop',
}

/** 排序方式 → 比较函数（时间缺失时回退到 createdAt，再回退到 0）。 */
const SORT_COMPARATORS = {
	/**
	 * 更新时间倒序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'updated-desc': (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
	/**
	 * 更新时间正序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'updated-asc': (a, b) => (a.updatedAt ?? a.createdAt ?? 0) - (b.updatedAt ?? b.createdAt ?? 0),
	/**
	 * 创建时间倒序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'created-desc': (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
	/**
	 * 创建时间正序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'created-asc': (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
	/**
	 * 标题升序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'title-asc': (a, b) => (a.title || '').localeCompare(b.title || ''),
	/**
	 * 标题降序。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'title-desc': (a, b) => (b.title || '').localeCompare(a.title || ''),
}

/** @type {Array<object>} 当前列表全部 gist 摘要。 */
let allGists = []
/** @type {Array<object>} 当前筛选 / 排序后可见的 gist 摘要。 */
let visibleGists = []
/** @type {Set<string>} 已选中的 gist id。 */
const selectedIds = new Set()
/** 是否处于选择模式。 */
let selectionMode = false
/** 框选范围锚点（最近一次点选的 gist id）。 */
let selectionAnchorId = null
/** @type {string} 搜索关键词。 */
let query = ''
/** @type {string} 当前排序方式。 */
let sortKey = DEFAULT_SORT

/**
 * 构建徽标元素（i18n 键经 data-i18n 动态翻译）。
 * @param {string} i18nKey - 翻译键。
 * @param {string} extraClass - 额外样式类。
 * @returns {HTMLSpanElement} 徽标元素。
 */
function badge(i18nKey, extraClass) {
	const element = document.createElement('span')
	element.className = `gist-badge ${extraClass}`.trim()
	element.dataset.i18n = i18nKey
	return element
}

/**
 * 来源徽标：未知类型回退为「手动创建」。
 * @param {{type?: string} | null} source - gist 来源。
 * @returns {HTMLSpanElement} 来源徽标。
 */
function sourceBadge(source) {
	const key = source?.type && SOURCE_I18N[source.type] ? SOURCE_I18N[source.type] : 'gist.source.manual'
	return badge(key, 'gist-badge-source')
}

/**
 * 安全等级徽标：secure 用成功色，trusted 用警示色。
 * @param {string} level - 'secure' | 'trusted'。
 * @returns {HTMLSpanElement} 安全等级徽标。
 */
function securityBadge(level) {
	const key = level === 'secure' ? 'gist.security.secure' : 'gist.security.trusted'
	const extraClass = level === 'secure' ? 'gist-badge-secure' : 'gist-badge-trusted'
	return badge(key, extraClass)
}

/**
 * 本地化时间显示。
 * @param {number} timestamp - 毫秒时间戳。
 * @returns {string} 本地化时间文本。
 */
function formatDate(timestamp) {
	const date = new Date(timestamp)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleString()
}

/**
 * 由 gist id 派生稳定的封面色相（0–359），让每张卡片配色各异且刷新后不变。
 * @param {string} id - gist id。
 * @returns {number} 色相角度。
 */
function hueFromId(id) {
	let hash = 0
	for (const char of String(id)) hash = (hash * 31 + char.codePointAt(0)) % 360
	return hash
}

/**
 * 按标题关键词筛选（大小写不敏感）。
 * @param {Array<object>} gists - 待筛选列表。
 * @param {string} keyword - 搜索关键词。
 * @returns {Array<object>} 筛选后的列表。
 */
function filterGists(gists, keyword) {
	const needle = keyword.trim().toLowerCase()
	if (!needle) return gists
	return gists.filter(gist => (gist.title || '').toLowerCase().includes(needle))
}

/**
 * 按指定方式排序（返回新数组，不改动原列表）。
 * @param {Array<object>} gists - 待排序列表。
 * @param {string} key - 排序方式。
 * @returns {Array<object>} 排序后的列表。
 */
function sortGists(gists, key) {
	const compare = SORT_COMPARATORS[key] || SORT_COMPARATORS[DEFAULT_SORT]
	return [...gists].sort(compare)
}

/**
 * 同步工具栏状态：全选框（含半选）、已选数量与批量按钮可用性。
 * @returns {void}
 */
function updateSelectionUi() {
	const count = selectedIds.size
	const allSelected = visibleGists.length > 0 && visibleGists.every(gist => selectedIds.has(gist.id))
	const someSelected = visibleGists.some(gist => selectedIds.has(gist.id))
	const selectAllBox = document.getElementById('select-all-checkbox')
	selectAllBox.checked = allSelected
	selectAllBox.indeterminate = someSelected && !allSelected
	setElementI18n(
		document.getElementById('selection-count'),
		count ? 'gist.list.selectedCount' : 'gist.list.noneSelected',
		count ? { count } : {},
	)
	document.getElementById('batch-download-button').disabled = !count
	document.getElementById('batch-delete-button').disabled = !count
}

/**
 * 将选中集合回写到卡片复选框与高亮态，并刷新工具栏。
 * @returns {void}
 */
function syncSelectionDom() {
	for (const box of document.querySelectorAll('.gist-select-checkbox'))
		box.checked = selectedIds.has(box.dataset.id)
	for (const card of document.querySelectorAll('.gist-card'))
		card.classList.toggle('gist-card-selected', selectedIds.has(card.dataset.id))
	updateSelectionUi()
}

/**
 * 进入 / 退出选择模式；退出时清空选择。
 * @param {boolean} on - 是否进入选择模式。
 * @returns {void}
 */
function setSelectionMode(on) {
	selectionMode = on
	document.body.classList.toggle('gist-selecting', on)
	document.getElementById('gist-selection-bar').hidden = !on
	document.getElementById('gist-controls').hidden = on || !allGists.length
	document.getElementById('select-mode-button').hidden = on || !allGists.length
	if (!on) {
		selectedIds.clear()
		selectionAnchorId = null
	}
	syncSelectionDom()
}

/**
 * 处理卡片点选：支持 Shift 连续范围与 Ctrl/⌘ 单选切换，并自动进入选择模式。
 * @param {object} gist - 被点选的 gist 摘要。
 * @param {MouseEvent} event - 点击事件。
 * @returns {void}
 */
function handleCardSelect(gist, event) {
	if (!selectionMode) setSelectionMode(true)
	if (event.shiftKey && selectionAnchorId) {
		const ids = visibleGists.map(item => item.id)
		const from = ids.indexOf(selectionAnchorId)
		const to = ids.indexOf(gist.id)
		if (from !== -1 && to !== -1) {
			const [lo, hi] = from <= to ? [from, to] : [to, from]
			for (let index = lo; index <= hi; index++) selectedIds.add(ids[index])
			syncSelectionDom()
			return
		}
	}
	if (selectedIds.has(gist.id)) selectedIds.delete(gist.id)
	else selectedIds.add(gist.id)
	selectionAnchorId = gist.id
	syncSelectionDom()
}

/**
 * 创建单个 gist 卡片：渐变封面 + 标题 + 开头内容 + 元信息，封面左上角为选择框。
 * @param {object} gist - gist 摘要。
 * @returns {HTMLDivElement} 卡片元素。
 */
function createCard(gist) {
	const card = document.createElement('div')
	card.className = 'gist-card'
	card.dataset.id = gist.id
	card.style.setProperty('--gist-cover-h', hueFromId(gist.id))

	const checkbox = document.createElement('input')
	checkbox.type = 'checkbox'
	checkbox.className = 'checkbox checkbox-sm gist-select-checkbox'
	checkbox.dataset.id = gist.id
	checkbox.setAttribute('aria-label', gist.title || gist.id)
	checkbox.setAttribute('user-content', 'aria-label')
	checkbox.addEventListener('click', event => event.stopPropagation())
	checkbox.addEventListener('change', () => {
		if (checkbox.checked) selectedIds.add(gist.id)
		else selectedIds.delete(gist.id)
		selectionAnchorId = gist.id
		syncSelectionDom()
	})
	card.appendChild(checkbox)

	const link = document.createElement('a')
	link.className = 'gist-card-link'
	link.href = `${VIEW_URL}?id=${encodeURIComponent(gist.id)}`
	link.addEventListener('click', event => {
		if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
			event.preventDefault()
			handleCardSelect(gist, event)
		}
	})

	const cover = document.createElement('div')
	cover.className = 'gist-card-cover'
	const glyph = document.createElement('span')
	glyph.className = 'gist-card-cover-glyph'
	glyph.textContent = (gist.title || '').trim().charAt(0) || '·'
	glyph.setAttribute('user-content', '')
	cover.appendChild(glyph)
	link.appendChild(cover)

	const body = document.createElement('div')
	body.className = 'gist-card-body'

	const title = document.createElement('div')
	title.className = 'gist-card-title'
	title.textContent = gist.title || ''
	title.setAttribute('user-content', '')
	body.appendChild(title)

	if (gist.excerpt) {
		const excerpt = document.createElement('div')
		excerpt.className = 'gist-card-excerpt'
		excerpt.textContent = gist.excerpt
		excerpt.setAttribute('user-content', '')
		body.appendChild(excerpt)
	}
	link.appendChild(body)

	const meta = document.createElement('div')
	meta.className = 'gist-card-meta flex flex-wrap items-center gap-1.5'
	meta.appendChild(sourceBadge(gist.source))
	meta.appendChild(securityBadge(gist.securityLevel))
	const timeLabel = document.createElement('span')
	timeLabel.dataset.i18n = 'gist.list.updatedAt'
	meta.appendChild(timeLabel)
	const time = document.createElement('span')
	time.className = 'gist-card-time'
	time.textContent = formatDate(gist.updatedAt)
	time.setAttribute('user-content', '')
	meta.appendChild(time)
	link.appendChild(meta)

	card.appendChild(link)
	return card
}

/**
 * 渲染可见列表（空态 / 无结果态或瀑布流卡片），并剔除已被筛选隐藏的选中项。
 * @param {Array<object>} gists - 可见的 gist 摘要列表。
 * @returns {void}
 */
function renderList(gists) {
	visibleGists = gists
	for (const id of [...selectedIds])
		if (!gists.some(gist => gist.id === id)) selectedIds.delete(id)
	const hasAny = allGists.length > 0
	const list = document.getElementById('gist-list')
	list.replaceChildren()
	document.getElementById('gist-controls').hidden = selectionMode || !hasAny
	document.getElementById('select-mode-button').hidden = selectionMode || !hasAny
	if (!gists.length) {
		const empty = document.createElement('div')
		empty.className = 'gist-empty-state'
		empty.dataset.i18n = hasAny ? 'gist.list.noResults' : 'gist.list.empty'
		list.appendChild(empty)
		updateSelectionUi()
		return
	}
	const grid = document.createElement('div')
	grid.className = 'gist-grid'
	for (const gist of gists)
		grid.appendChild(createCard(gist))
	list.appendChild(grid)
	syncSelectionDom()
}

/**
 * 按当前关键词与排序方式重新筛选并渲染。
 * @returns {void}
 */
function refresh() {
	renderList(sortGists(filterGists(allGists, query), sortKey))
}

/**
 * 重新加载全部 gist 并渲染。
 * @returns {Promise<void>} 渲染完成。
 */
async function render() {
	allGists = await listGists()
	refresh()
}

/**
 * 全选 / 取消全选当前可见的 gist。
 * @param {boolean} checked - 是否全选。
 * @returns {void}
 */
function selectAll(checked) {
	selectedIds.clear()
	if (checked)
		for (const gist of visibleGists) selectedIds.add(gist.id)
	selectionAnchorId = null
	syncSelectionDom()
}

/**
 * 将多个 HTML 文档打包为 zip 并触发下载。
 * @param {Array<{ name: string, content: string }>} files - 文件名与内容。
 * @returns {Promise<void>} 下载已触发。
 */
async function downloadZip(files) {
	const { zipSync, strToU8 } = await import('https://esm.sh/fflate')
	const archive = {}
	for (const { name, content } of files)
		archive[name] = strToU8(content)
	const url = URL.createObjectURL(new Blob([zipSync(archive, { level: 6 })], { type: 'application/zip' }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = 'gists.zip'
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}

/**
 * 批量下载：单条直接下载 HTML，多条打包为 zip；文件名取自各文档标题并去重。
 * @returns {Promise<void>} 下载完成。
 */
async function batchDownload() {
	const ids = [...selectedIds]
	if (!ids.length) return
	const gists = await Promise.all(ids.map(id => getGist(id)))
	if (gists.length === 1) {
		const html = await renderMarkdownAsStandaloneDocument(gists[0].markdown)
		downloadHtmlDocument(html, fileNameFromHtmlTitle(html, gists[0].title || 'gist'))
		return
	}
	const files = []
	const usedNames = new Set()
	for (const gist of gists) {
		const html = await renderMarkdownAsStandaloneDocument(gist.markdown)
		let name = fileNameFromHtmlTitle(html, gist.title || 'gist')
		if (usedNames.has(name)) name = name.replace(/\.html$/i, `-${gist.id}.html`)
		usedNames.add(name)
		files.push({ name, content: html })
	}
	await downloadZip(files)
	showToastI18n('success', 'gist.list.batch.downloaded', { count: gists.length })
}

/**
 * 确认后批量删除选中的 gist 并刷新列表。
 * @returns {Promise<void>} 删除完成。
 */
async function batchDelete() {
	const ids = [...selectedIds]
	if (!ids.length) return
	if (!await confirmAction('gist.list.batch.deleteConfirm', { count: ids.length })) return
	const { deleted } = await deleteGists(ids)
	showToastI18n('success', 'gist.list.batch.deleted', { count: deleted.length })
	setSelectionMode(false)
	await render()
}

/**
 * 判断键盘事件目标是否是可输入控件（此时不劫持快捷键）。
 * @param {EventTarget | null} target - 事件目标。
 * @returns {boolean} 是输入控件则为 true。
 */
function isEditableTarget(target) {
	const tag = target?.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
}

/**
 * 绑定全局快捷键：Ctrl/⌘+A 全选可见项，Esc 退出选择模式。
 * @returns {void}
 */
function bindShortcuts() {
	document.addEventListener('keydown', event => {
		if (isEditableTarget(event.target)) return
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
			if (!visibleGists.length) return
			event.preventDefault()
			if (!selectionMode) setSelectionMode(true)
			selectAll(true)
			return
		}
		if (event.key === 'Escape' && selectionMode) {
			event.preventDefault()
			setSelectionMode(false)
		}
	})
}

/**
 * 页面初始化：应用主题、初始化 i18n、绑定搜索 / 排序 / 选择 / 批量操作与新建按钮并加载列表。
 * @returns {Promise<void>} 初始化完成。
 */
async function boot() {
	await initTranslations('gist')
	document.getElementById('new-gist-button').addEventListener('click', () => { location.href = EDIT_URL })
	document.getElementById('select-mode-button').addEventListener('click', () => setSelectionMode(true))
	document.getElementById('exit-selection-button').addEventListener('click', () => setSelectionMode(false))
	document.getElementById('gist-search-input').addEventListener('input', event => {
		query = event.target.value
		refresh()
	})
	document.getElementById('gist-sort-select').addEventListener('change', event => {
		sortKey = event.target.value
		refresh()
	})
	document.getElementById('select-all-checkbox').addEventListener('change', event => { selectAll(event.target.checked) })
	document.getElementById('batch-download-button').addEventListener('click', () => { void batchDownload().catch(handleError('gist.error.generic')) })
	document.getElementById('batch-delete-button').addEventListener('click', () => { void batchDelete().catch(handleError('gist.error.generic')) })
	bindShortcuts()
	await render()
}

applyTheme()

boot().catch(handleError('gist.error.generic'))
