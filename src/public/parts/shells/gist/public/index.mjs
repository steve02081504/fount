/**
 * gist 列表页：以瀑布流卡片展示全部 gist（标题 + 开头内容），支持搜索、排序、
 * 选择模式下的多选与批量下载 / 删除，以及 Ctrl/Shift 快捷键选择。
 */
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { bindSelectionShortcuts, createSelectionController } from '/scripts/components/selectionController.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { initTranslations, onLanguageChange, primaryLocale, setElementI18n } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { deleteGists, getGist, listGists } from './src/endpoints.mjs'
import { downloadHtmlDocument, fileNameFromHtmlTitle, renderMarkdownAsStandaloneDocument } from './src/standaloneDocument.mjs'
import { deriveTitleFromMarkdown } from './src/title.mjs'

const VIEW_URL = '/parts/shells:gist/view'
const EDIT_URL = '/parts/shells:gist/edit.html'
const DEFAULT_SORT = 'updated-desc'
const VIEW_STORAGE_KEY = 'gist:view'

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
	 * 标题升序（标题由 markdown 推导，见 displayTitle）。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'title-asc': (a, b) => (a.displayTitle || '').localeCompare(b.displayTitle || ''),
	/**
	 * 标题降序（标题由 markdown 推导，见 displayTitle）。
	 * @param {object} a - gist 摘要。
	 * @param {object} b - gist 摘要。
	 * @returns {number} 排序差值。
	 */
	'title-desc': (a, b) => (b.displayTitle || '').localeCompare(a.displayTitle || ''),
}

/** @type {Array<object>} 当前列表全部 gist 摘要。 */
let allGists = []
/** @type {Array<object>} 当前筛选 / 排序后可见的 gist 摘要。 */
let visibleGists = []
/** 多选控制器（选择模式 / 选中集合 / 范围锚点）。 */
const selection = createSelectionController({
	/**
	 * @returns {string[]} 当前可见 gist id 顺序
	 */
	getOrderedIds: () => visibleGists.map(gist => gist.id),
	onChange: syncSelection,
	plainClick: 'toggle',
	shiftRange: 'add',
})
/** @type {string} 搜索关键词。 */
let query = ''
/** @type {string} 当前排序方式。 */
let sortKey = DEFAULT_SORT
/** @type {string} 安全等级筛选（'all' | 'secure' | 'trusted'）。 */
let securityFilter = 'all'
/** @type {string} 来源筛选（'all' | 'manual' | 'chat' | 'social' | 'code' | 'md-drop'）。 */
let sourceFilter = 'all'
/** @type {string} 视图模式（'grid' | 'list'）。 */
let viewMode = loadViewMode()

/**
 * 从 localStorage 读取视图模式，非法值回退网格。
 * @returns {'grid' | 'list'} 视图模式。
 */
function loadViewMode() {
	try {
		return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
	}
	catch {
		return 'grid'
	}
}

/**
 * 持久化视图模式（localStorage 不可用时静默忽略）。
 * @param {'grid' | 'list'} mode - 视图模式。
 * @returns {void}
 */
function saveViewMode(mode) {
	try {
		localStorage.setItem(VIEW_STORAGE_KEY, mode)
	}
	catch { /* 忽略隐私模式下的写入失败 */ }
}

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
 * 本地化相对时间（如「3 小时前」），用于列表卡片；完整时间放 title 属性。
 * @param {number} timestamp - 毫秒时间戳。
 * @returns {string} 相对时间文本。
 */
function formatRelativeTime(timestamp) {
	const diff = (timestamp ?? 0) - Date.now()
	const abs = Math.abs(diff)
	const units = [
		['year', 365 * 24 * 60 * 60 * 1000],
		['month', 30 * 24 * 60 * 60 * 1000],
		['week', 7 * 24 * 60 * 60 * 1000],
		['day', 24 * 60 * 60 * 1000],
		['hour', 60 * 60 * 1000],
		['minute', 60 * 1000],
	]
	const [unit, size] = units.find(([, unitSize]) => abs >= unitSize) ?? ['minute', 60 * 1000]
	return new Intl.RelativeTimeFormat(primaryLocale(), { numeric: 'auto' }).format(Math.round(diff / size), unit)
}

/**
 * 向父元素写入文本，并把命中的搜索关键词用 <mark> 高亮（无关键词时退化为纯文本）。
 * @param {HTMLElement} parent - 目标父元素（会先清空）。
 * @param {string} text - 原始文本。
 * @param {string} keyword - 搜索关键词。
 * @returns {void}
 */
function appendHighlighted(parent, text, keyword) {
	parent.replaceChildren()
	const source = String(text ?? '')
	const needle = keyword.trim().toLowerCase()
	if (!needle) {
		parent.textContent = source
		return
	}
	const lowerSource = source.toLowerCase()
	let start = lowerSource.indexOf(needle)
	if (start === -1) {
		parent.textContent = source
		return
	}
	let cursor = 0
	while (start !== -1) {
		if (start > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, start)))
		const mark = document.createElement('mark')
		mark.className = 'gist-hl'
		mark.textContent = source.slice(start, start + needle.length)
		parent.appendChild(mark)
		cursor = start + needle.length
		start = lowerSource.indexOf(needle, cursor)
	}
	if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)))
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
 * 按关键词（标题 + 摘要）与安全等级 / 来源筛选（大小写不敏感）。
 * @param {Array<object>} gists - 待筛选列表。
 * @param {string} keyword - 搜索关键词。
 * @returns {Array<object>} 筛选后的列表。
 */
function filterGists(gists, keyword) {
	const needle = keyword.trim().toLowerCase()
	return gists.filter(gist => {
		if (securityFilter !== 'all' && gist.securityLevel !== securityFilter) return false
		if (sourceFilter !== 'all' && (gist.source?.type || 'manual') !== sourceFilter) return false
		if (!needle) return true
		return (gist.displayTitle || '').toLowerCase().includes(needle)
			|| (gist.excerpt || '').toLowerCase().includes(needle)
	})
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
 * 选中态变化回调：同步选择模式 chrome、卡片复选框 / 高亮与工具栏。
 * @param {{ selectedIds: Set<string>, mode: boolean }} state - 控制器状态。
 * @returns {void}
 */
function syncSelection({ selectedIds, mode }) {
	document.body.classList.toggle('gist-selecting', mode)
	document.getElementById('gist-selection-bar').hidden = !mode
	document.getElementById('gist-controls').hidden = mode || !allGists.length
	document.getElementById('select-mode-button').hidden = mode || !allGists.length
	for (const box of document.querySelectorAll('.gist-select-checkbox'))
		box.checked = selectedIds.has(box.dataset.id)
	for (const card of document.querySelectorAll('.gist-card'))
		card.classList.toggle('gist-card-selected', selectedIds.has(card.dataset.id))
	updateSelectionUi(selectedIds)
}

/**
 * 同步工具栏状态：全选框（含半选）、已选数量与批量按钮可用性。
 * @param {Set<string>} selectedIds - 当前选中集合。
 * @returns {void}
 */
function updateSelectionUi(selectedIds) {
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
 * 读取控制器当前状态快照（选中集 + 是否选择模式）。
 * @returns {{ selectedIds: Set<string>, mode: boolean }} 状态快照。
 */
function selectionState() {
	return { selectedIds: new Set(selection.getSelected()), mode: selection.getMode() }
}

/** 匹配标题开头的英文单词，用于首词主色异色。 */
const LEAD_WORD_PATTERN = /^[A-Za-z][A-Za-z'’-]*/

/**
 * 写入封面标题：把搜索命中词包进 <mark> 高亮，并让英文首词整体主色异色。
 * @param {HTMLElement} element - 标题元素。
 * @param {string} title - 显示标题。
 * @param {string} keyword - 搜索关键词（空则不切分高亮）。
 * @returns {void}
 */
function setCoverTitle(element, title, keyword) {
	element.replaceChildren()
	const needle = keyword.trim().toLowerCase()
	const lower = title.toLowerCase()
	/** @type {{ type: 'text' | 'mark', text: string }[]} */
	const pieces = []
	let cursor = 0
	let start = needle ? lower.indexOf(needle) : -1
	while (start !== -1) {
		if (start > cursor) pieces.push({ type: 'text', text: title.slice(cursor, start) })
		pieces.push({ type: 'mark', text: title.slice(start, start + needle.length) })
		cursor = start + needle.length
		start = lower.indexOf(needle, cursor)
	}
	if (cursor < title.length) pieces.push({ type: 'text', text: title.slice(cursor) })
	for (const [index, piece] of pieces.entries()) {
		const node = piece.type === 'mark' ? document.createElement('mark') : element
		if (piece.type === 'mark') node.className = 'gist-hl'
		let text = piece.text
		if (index === 0) {
			const lead = text.match(LEAD_WORD_PATTERN)
			if (lead) {
				const word = document.createElement('span')
				word.className = 'gist-card-cover-lead'
				word.textContent = lead[0]
				node.appendChild(word)
				text = text.slice(lead[0].length)
			}
		}
		if (text) node.appendChild(document.createTextNode(text))
		if (piece.type === 'mark') element.appendChild(node)
	}
}

/**
 * 创建单个 gist 卡片：渐变封面 + 标题 + 开头内容 + 元信息，封面左上角为选择框。
 * @param {object} gist - gist 摘要。
 * @returns {HTMLDivElement} 卡片元素。
 */
function createCard(gist) {
	const displayTitle = gist.displayTitle || deriveTitleFromMarkdown(gist.markdown || '') || 'Untitled'
	const card = document.createElement('div')
	card.className = 'gist-card'
	card.dataset.id = gist.id
	card.style.setProperty('--gist-cover-h', hueFromId(gist.id))

	const checkbox = document.createElement('input')
	checkbox.type = 'checkbox'
	checkbox.className = 'checkbox checkbox-sm gist-select-checkbox'
	checkbox.dataset.id = gist.id
	checkbox.setAttribute('aria-label', displayTitle)
	checkbox.setAttribute('user-content', 'aria-label')
	checkbox.addEventListener('click', event => event.stopPropagation())
	checkbox.addEventListener('change', () => selection.setItemSelected(gist.id, checkbox.checked))
	card.appendChild(checkbox)

	const link = document.createElement('a')
	link.className = 'gist-card-link'
	link.href = `${VIEW_URL}?id=${encodeURIComponent(gist.id)}`
	link.addEventListener('click', event => {
		if (selection.getMode() || event.ctrlKey || event.metaKey || event.shiftKey) {
			event.preventDefault()
			selection.handleClick(gist.id, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey })
		}
	})

	const cover = document.createElement('div')
	cover.className = 'gist-card-cover'
	const coverTitle = document.createElement('div')
	coverTitle.className = 'gist-card-cover-title'
	if (displayTitle === 'Untitled') coverTitle.classList.add('gist-untitled')
	setCoverTitle(coverTitle, displayTitle, query)
	coverTitle.setAttribute('user-content', '')
	cover.appendChild(coverTitle)
	link.appendChild(cover)

	const body = document.createElement('div')
	body.className = 'gist-card-body'

	if (gist.excerpt) {
		const excerpt = document.createElement('div')
		excerpt.className = 'gist-card-excerpt'
		appendHighlighted(excerpt, gist.excerpt, query)
		excerpt.setAttribute('user-content', '')
		body.appendChild(excerpt)
	}
	link.appendChild(body)

	const meta = document.createElement('div')
	meta.className = 'gist-card-meta flex flex-wrap items-center gap-1.5'
	meta.appendChild(sourceBadge(gist.source))
	meta.appendChild(securityBadge(gist.securityLevel))
	const timeGroup = document.createElement('span')
	timeGroup.className = 'gist-card-timegroup'
	const timeLabel = document.createElement('span')
	timeLabel.dataset.i18n = 'gist.list.updatedAt'
	timeGroup.appendChild(timeLabel)
	const time = document.createElement('span')
	time.className = 'gist-card-time'
	const stamp = gist.updatedAt ?? gist.createdAt
	time.textContent = formatRelativeTime(stamp)
	time.title = formatDate(stamp)
	time.setAttribute('user-content', '')
	timeGroup.appendChild(time)
	meta.appendChild(timeGroup)
	link.appendChild(meta)

	card.appendChild(link)
	return card
}

/**
 * 构建空态 / 无结果态：无 gist 时给新建与拖入引导，有 gist 但被筛掉时给清除搜索。
 * @param {boolean} hasAny - 是否存在任何 gist。
 * @returns {HTMLDivElement} 空态元素。
 */
function createEmptyState(hasAny) {
	const empty = document.createElement('div')
	empty.className = 'gist-empty-state'
	const message = document.createElement('div')
	message.className = 'gist-empty-message'
	message.dataset.i18n = hasAny ? 'gist.list.noResults' : 'gist.list.empty'
	empty.appendChild(message)
	if (!hasAny) {
		const hint = document.createElement('div')
		hint.className = 'gist-empty-hint'
		hint.dataset.i18n = 'gist.list.emptyHint'
		empty.appendChild(hint)
	}
	const actions = document.createElement('div')
	actions.className = 'gist-empty-actions'
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'btn btn-sm'
	if (hasAny) {
		button.classList.add('btn-ghost')
		button.dataset.i18n = 'gist.list.clearSearch'
		button.addEventListener('click', () => {
			query = ''
			document.getElementById('gist-search-input').value = ''
			refresh()
		})
	}
	else {
		button.classList.add('btn-primary')
		button.dataset.i18n = 'gist.list.new'
		button.addEventListener('click', () => { location.href = EDIT_URL })
	}
	actions.appendChild(button)
	empty.appendChild(actions)
	return empty
}

/** 网格列数断点（视口宽度 / rem 字号），与旧 CSS 媒体查询一致。 */
const COLUMN_BREAKPOINTS = [
	[96, 5],
	[72, 4],
	[48, 3],
	[30, 2],
]

/**
 * 计算当前应显示的瀑布流列数（视口宽度 / rem 字号，与旧媒体查询断点一致）。
 * @returns {number} 列数（1–5）。
 */
function gridColumnCount() {
	const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
	const width = document.documentElement.clientWidth
	for (const [threshold, count] of COLUMN_BREAKPOINTS)
		if (width >= threshold * rem) return count
	return 1
}

/**
 * 按最短列优先把卡片分配到各列，形成瀑布流；列数取列断点与卡片数的较小值，避免空列。
 * @param {HTMLDivElement} grid - 已挂载到文档的网格容器。
 * @param {Array<object>} gists - 待渲染的 gist 摘要。
 * @returns {void}
 */
function mountMasonry(grid, gists) {
	const count = Math.min(gridColumnCount(), gists.length)
	const columns = Array.from({ length: count }, () => {
		const column = document.createElement('div')
		column.className = 'gist-col'
		grid.appendChild(column)
		return column
	})
	const heights = new Array(count).fill(0)
	for (const gist of gists) {
		let target = 0
		for (let index = 1; index < count; index++)
			if (heights[index] < heights[target]) target = index
		columns[target].appendChild(createCard(gist))
		heights[target] = columns[target].offsetHeight
	}
}

/**
 * 渲染加载骨架屏（等待列表接口返回时以瀑布流占位）。
 * @returns {void}
 */
function renderSkeleton() {
	const list = document.getElementById('gist-list')
	list.replaceChildren()
	const grid = document.createElement('div')
	grid.className = 'gist-grid'
	for (let columnIndex = 0; columnIndex < gridColumnCount(); columnIndex++) {
		const column = document.createElement('div')
		column.className = 'gist-col'
		for (let index = 0; index < 2; index++) {
			const card = document.createElement('div')
			card.className = 'gist-card gist-skeleton'
			const cover = document.createElement('div')
			cover.className = 'gist-skeleton-cover'
			const body = document.createElement('div')
			body.className = 'gist-skeleton-body'
			card.append(cover, body)
			column.appendChild(card)
		}
		grid.appendChild(column)
	}
	list.appendChild(grid)
}

/**
 * 渲染可见列表（空态 / 无结果态或瀑布流 / 列表卡片），并剔除已被筛选隐藏的选中项。
 * @param {Array<object>} gists - 可见的 gist 摘要列表。
 * @returns {void}
 */
function renderList(gists) {
	visibleGists = gists
	selection.reconcile(gists.map(gist => gist.id))
	const hasAny = allGists.length > 0
	const list = document.getElementById('gist-list')
	list.replaceChildren()
	const mode = selection.getMode()
	document.getElementById('gist-controls').hidden = mode || !hasAny
	document.getElementById('select-mode-button').hidden = mode || !hasAny
	if (!gists.length) {
		list.appendChild(createEmptyState(hasAny))
		updateSelectionUi(selectionState().selectedIds)
		return
	}
	const grid = document.createElement('div')
	grid.className = 'gist-grid'
	list.appendChild(grid)
	if (viewMode === 'list') {
		grid.classList.add('gist-view-list')
		for (const gist of gists) grid.appendChild(createCard(gist))
	}
	else mountMasonry(grid, gists)
	syncSelection(selectionState())
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
	renderSkeleton()
	allGists = await listGists()
	refresh()
}

/**
 * 应用并持久化视图模式，同步切换按钮的激活态，并按新模式重排列表。
 * @param {'grid' | 'list'} mode - 视图模式。
 * @returns {void}
 */
function applyViewMode(mode) {
	viewMode = mode === 'list' ? 'list' : 'grid'
	saveViewMode(viewMode)
	const gridButton = document.getElementById('gist-view-grid')
	const listButton = document.getElementById('gist-view-list')
	gridButton.classList.toggle('btn-active', viewMode === 'grid')
	listButton.classList.toggle('btn-active', viewMode === 'list')
	gridButton.setAttribute('aria-pressed', String(viewMode === 'grid'))
	listButton.setAttribute('aria-pressed', String(viewMode === 'list'))
	if (allGists.length) refresh()
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
	const ids = selection.getSelected()
	if (!ids.length) return
	const gists = await Promise.all(ids.map(id => getGist(id)))
	if (gists.length === 1) {
		const html = await renderMarkdownAsStandaloneDocument(gists[0].markdown)
		downloadHtmlDocument(html, fileNameFromHtmlTitle(html, deriveTitleFromMarkdown(gists[0].markdown)))
		return
	}
	const files = []
	const usedNames = new Set()
	for (const gist of gists) {
		const html = await renderMarkdownAsStandaloneDocument(gist.markdown)
		let name = fileNameFromHtmlTitle(html, deriveTitleFromMarkdown(gist.markdown))
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
	const ids = selection.getSelected()
	if (!ids.length) return
	if (!await confirmAction('gist.list.batch.deleteConfirm', { count: ids.length })) return
	const { deleted } = await deleteGists(ids)
	showToastI18n('success', 'gist.list.batch.deleted', { count: deleted.length })
	selection.setMode(false)
	await render()
}

/**
 * 视口宽度跨过列断点时重排网格；字体加载完成后也重排（卡片高度受字体度量影响）。
 * @returns {void}
 */
function bindLayoutWatch() {
	let renderedColumns = gridColumnCount()
	let timer = 0
	window.addEventListener('resize', () => {
		clearTimeout(timer)
		timer = setTimeout(() => {
			if (viewMode !== 'grid') return
			const columns = gridColumnCount()
			if (columns === renderedColumns) return
			renderedColumns = columns
			if (allGists.length) refresh()
		}, 150)
	})
	document.fonts?.ready.then(() => {
		if (viewMode === 'grid' && allGists.length) refresh()
	})
}

/**
 * 页面初始化：应用主题、初始化 i18n、绑定搜索 / 筛选 / 排序 / 视图 / 选择 / 批量操作与新建按钮并加载列表。
 * @returns {Promise<void>} 初始化完成。
 */
async function boot() {
	await initTranslations('gist')
	document.getElementById('new-gist-button').addEventListener('click', () => { location.href = EDIT_URL })
	document.getElementById('select-mode-button').addEventListener('click', () => selection.setMode(true))
	document.getElementById('exit-selection-button').addEventListener('click', () => selection.setMode(false))
	document.getElementById('gist-search-input').addEventListener('input', event => {
		query = event.target.value
		refresh()
	})
	document.getElementById('gist-security-filter').addEventListener('change', event => {
		securityFilter = event.target.value
		refresh()
	})
	document.getElementById('gist-source-filter').addEventListener('change', event => {
		sourceFilter = event.target.value
		refresh()
	})
	document.getElementById('gist-sort-select').addEventListener('change', event => {
		sortKey = event.target.value
		refresh()
	})
	document.getElementById('gist-view-toggle').addEventListener('click', event => {
		const button = event.target.closest('button')
		if (button) applyViewMode(button.id === 'gist-view-list' ? 'list' : 'grid')
	})
	document.getElementById('select-all-checkbox').addEventListener('change', event => { selection.selectAll(event.target.checked) })
	document.getElementById('batch-download-button').addEventListener('click', () => { void batchDownload().catch(handleError('gist.error.generic')) })
	document.getElementById('batch-delete-button').addEventListener('click', () => { void batchDelete().catch(handleError('gist.error.generic')) })
	applyViewMode(viewMode)
	bindSelectionShortcuts(selection, {
		/**
		 * @returns {boolean} 当前是否存在可见项
		 */
		canSelectAll: () => visibleGists.length > 0,
	})
	bindLayoutWatch()
	await render()
	onLanguageChange(() => refresh())
}

applyTheme()

boot().catch(handleError('gist.error.generic'))
