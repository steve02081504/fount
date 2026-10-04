/** 工作区文件树与文件标签；文件和代理会话共用标签栏。 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import * as api from './endpoints.mjs'
import { selectWorkspace } from './pills.mjs'
import { activeTab, getRuntime, richInput, store, tabKeyOf } from './store.mjs'
import { renderTabs, saveTabPrefs, syncCodeUrl } from './tabs.mjs'

const tree = document.getElementById('code-explorer-tree')
const sidebar = document.getElementById('code-explorer')
const workspaceLabel = document.getElementById('code-explorer-workspace')
const connectionStatus = document.getElementById('code-explorer-connection')
const editor = document.getElementById('code-editor')
const input = document.getElementById('code-editor-input')
const lines = document.getElementById('code-editor-lines')
const filename = document.getElementById('code-editor-filename')
const dirtyMarker = document.getElementById('code-editor-dirty')
const saveButton = document.getElementById('code-editor-save')
const diffButton = document.getElementById('code-editor-diff')
const diffView = document.getElementById('code-editor-diff-view')
const summary = document.getElementById('code-editor-summary')
const status = document.getElementById('code-editor-status')
const toggle = document.getElementById('code-explorer-toggle')

/** @type {Map<string, {content: string, base: string, version: string, loading?: boolean, saving?: boolean, external?: boolean}>} */
const buffers = new Map()
/** @type {Map<string, Set<string>>} */
const expanded = new Map()
/** @type {Map<string, Array<object>>} */
const directoryCache = new Map()
let treeRevision = 0
let fileRevision = 0
let diffVisible = false
/** 当前的工作区变化订阅（key 标识工作区与监听目录集合）。 @type {{key: string, stop: (() => void)|null}|null} */
let watchSubscription = null
let watchState = 'connecting'
let refreshPending = false
let refreshing = false

/** 绘制工作区的自动刷新连接状态；断线时保留已有树与编辑内容。 */
function paintWatchState() {
	const key = `code.explorer.connection.${watchState}`
	connectionStatus.hidden = watchState === 'connected' || !watchSubscription?.stop
	connectionStatus.dataset.i18n = key
	connectionStatus.textContent = geti18n(key)
}

/**
 * 让自动更新范围跟上界面：已展开目录加上已打开文件所在目录。
 * @param {object} workspace - 目标工作区。
 * @returns {string[]} 排序后的工作区相对目录。
 */
function watchedDirectories(workspace) {
	const openFileDirs = store.tabs
		.filter(tab => tab.type === 'file' && tab.workspaceId === workspace.id)
		.map(tab => tab.id.includes('/') ? tab.id.slice(0, tab.id.lastIndexOf('/')) : '')
	return [...new Set(['', ...expanded.get(workspace.id) || [], ...openFileDirs])].sort()
}

/** 合并连续通知，避免网络较慢时多次刷新互相覆盖。 */
async function scheduleWatchRefresh() {
	refreshPending = true
	if (refreshing) return
	refreshing = true
	try {
		while (refreshPending) { refreshPending = false; await refreshOpenFiles() }
	}
	finally { refreshing = false }
}

/**
 * @param {object|null} [tab] - Active or requested tab.
 * @returns {object|null} Its workspace.
 */
function workspaceFor(tab = activeTab()) {
	return store.workspaces.find(w => w.id === tab?.workspaceId) || store.workspace
}

/**
 * @param {object} tab - File tab.
 * @returns {{machine: string, workdir: string}|null} File target.
 */
function fileTarget(tab) {
	const workspace = workspaceFor(tab)
	return workspace && { machine: String(workspace.machine ?? '0'), workdir: workspace.path }
}

/**
 * @param {string} workspaceId - Workspace ID.
 * @param {string} path - Relative path.
 * @returns {string} Cache key.
 */
function cacheKey(workspaceId, path) { return `${workspaceId}\0${path}` }

/**
 * @param {object} tab - File tab.
 * @returns {boolean} Whether its buffer differs from disk.
 */
export function isFileDirty(tab) {
	const buffer = tab?.type === 'file' && buffers.get(tabKeyOf(tab))
	return !!buffer && buffer.content !== buffer.base
}

/**
 * @param {object} tab - Closed file tab.
 * @returns {void} Discards its buffer.
 */
export function forgetFileTab(tab) { buffers.delete(tabKeyOf(tab)) }

/**
 * @param {boolean} visible - Whether the sidebar is shown.
 * @returns {void} Updates visibility.
 */
function setSidebarVisible(visible) {
	sidebar.hidden = !visible
	toggle.setAttribute('aria-expanded', String(visible))
	localStorage.setItem('code.explorer.visible', String(visible))
}

/** 翻译和工作区状态就绪后初始化控件一次。 @returns {void} */
export function initExplorer() {
	window.addEventListener('pagehide', () => { watchSubscription?.stop?.(); watchSubscription = null })
	window.addEventListener('pageshow', event => { if (event.persisted) void refreshExplorer({ clear: true }) })
	setSidebarVisible(localStorage.getItem('code.explorer.visible') !== 'false' && matchMedia('(min-width: 851px)').matches)
	window.addEventListener('code-workspace-change', () => void refreshExplorer({ workspaceOverride: store.workspace }))
	toggle.addEventListener('click', () => setSidebarVisible(sidebar.hidden))
	document.getElementById('code-explorer-refresh').addEventListener('click', () => void refreshExplorer({ clear: true }))
	input.addEventListener('input', () => {
		const tab = activeTab()
		if (tab?.type !== 'file') return
		const buffer = buffers.get(tabKeyOf(tab))
		if (!buffer) return
		buffer.content = input.value
		paintEditor(tab)
	})
	input.addEventListener('scroll', () => { lines.scrollTop = input.scrollTop })
	input.addEventListener('keydown', event => {
		if (event.key === 'Tab') {
			event.preventDefault()
			const start = input.selectionStart
			input.setRangeText('\t', start, input.selectionEnd, 'end')
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
			event.preventDefault()
			void saveActiveFile()
		}
	})
	saveButton.addEventListener('click', () => void saveActiveFile())
	diffButton.addEventListener('click', () => {
		diffVisible = !diffVisible
		paintEditor(activeTab())
	})
	void refreshExplorer()
}

/**
 * 刷新当前标签所属工作区的文件树。
 * @param {{clear?: boolean, workspaceOverride?: object|null}} [options] - Clear cached directories or select a new workspace.
 * @returns {Promise<void>} Tree render completion.
 */
export async function refreshExplorer({ clear = false, workspaceOverride = null } = {}) {
	const workspace = workspaceOverride || workspaceFor()
	// 监听范围 = 已展开目录 + 已打开文件的父目录；范围或工作区变化时重订阅
	const target = workspace && { machine: String(workspace.machine ?? '0'), workdir: workspace.path }
	const directories = workspace ? watchedDirectories(workspace) : []
	const watchKey = [target?.machine, target?.workdir, ...directories].join('\0')
	if (watchSubscription?.key !== watchKey) {
		watchSubscription?.stop?.()
		watchState = 'connecting'
		watchSubscription = { key: watchKey, stop: null }
		if (workspace) watchSubscription.stop = api.watchWorkspace(target, directories, () => {
			if (watchSubscription?.key === watchKey) void scheduleWatchRefresh()
		}, state => {
			if (watchSubscription?.key !== watchKey) return
			// 重连期间维持断线提示，直到新订阅 ready。
			if (state !== 'connecting' || watchState !== 'disconnected') watchState = state
			paintWatchState()
		})
		paintWatchState()
	}
	const revision = ++treeRevision
	workspaceLabel.textContent = workspace?.name || workspace?.path || geti18n('code.workspaces.none')
	if (!workspace) {
		tree.replaceChildren(note('code.explorer.noWorkspace'))
		return
	}
	if (clear) for (const key of directoryCache.keys()) if (key.startsWith(`${workspace.id}\0`)) directoryCache.delete(key)
	await paintDirectory(workspace, '', tree, 0, revision)
}

/** 页面语言改变后重画编辑器与文件树的本地化文案。 @returns {void} */
export function rerenderExplorer() {
	paintWatchState()
	const tab = activeTab()
	if (tab?.type === 'file') paintEditor(tab)
	void refreshExplorer()
}

/**
 * @param {string} key - Localized status key.
 * @returns {HTMLElement} Status row.
 */
function note(key) {
	const row = document.createElement('div')
	row.className = 'code-explorer-note'
	row.dataset.i18n = key
	row.textContent = geti18n(key)
	return row
}

/**
 * @param {object} workspace - Target workspace.
 * @param {string} path - Relative directory path.
 * @param {HTMLElement} container - Tree container.
 * @param {number} depth - Tree nesting depth.
 * @param {number} revision - Render revision.
 * @returns {Promise<void>} Directory render completion.
 */
async function paintDirectory(workspace, path, container, depth, revision) {
	const key = cacheKey(workspace.id, path)
	let entries = directoryCache.get(key)
	if (!entries) 
		try {
			entries = (await api.listWorkspaceDirectory({ machine: String(workspace.machine ?? '0'), workdir: workspace.path }, path)).entries
			directoryCache.set(key, entries)
		}
		catch (error) {
			if (revision === treeRevision) container.replaceChildren(note('code.explorer.loadFailed'))
			// 404 表示目录被外部删除或移动：树上的提示行已经说明了状态，再报 console.error 只会污染页面诊断
			if (error?.http_code !== 404) console.error('code explorer: directory failed', error)
			return
		}
	
	if (revision !== treeRevision) return
	const rows = entries.slice().sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
	container.replaceChildren(...rows.map(entry => {
		const wrap = document.createElement('div')
		const row = document.createElement('button')
		row.type = 'button'
		row.className = 'code-tree-row'
		row.style.paddingInlineStart = `${0.55 + depth * 0.9}rem`
		row.dataset.selected = String(!entry.isDirectory && activeTab()?.type === 'file' && activeTab().workspaceId === workspace.id && activeTab().id === entry.path)
		if (entry.isDirectory) row.setAttribute('aria-expanded', String(expanded.get(workspace.id)?.has(entry.path) || false))
		const arrow = document.createElement('span')
		arrow.className = 'code-tree-chevron'
		arrow.textContent = entry.isDirectory ? expanded.get(workspace.id)?.has(entry.path) ? '⌄' : '›' : ''
		const icon = document.createElement('img')
		icon.className = 'text-icon'
		icon.width = 15
		icon.height = 15
		icon.alt = ''
		icon.setAttribute('aria-hidden', 'true')
		icon.src = `https://api.iconify.design/mdi/${entry.isDirectory ? 'folder-outline' : 'file-outline'}.svg`
		const name = document.createElement('span')
		name.className = 'code-tree-name'
		name.setAttribute('user-content', '')
		name.textContent = entry.name
		row.append(arrow, icon, name)
		wrap.appendChild(row)
		if (entry.isDirectory) {
			const children = document.createElement('div')
			if (expanded.get(workspace.id)?.has(entry.path)) void paintDirectory(workspace, entry.path, children, depth + 1, revision)
			row.addEventListener('click', () => {
				let paths = expanded.get(workspace.id)
				if (!paths) expanded.set(workspace.id, paths = new Set())
				if (paths.has(entry.path)) { paths.delete(entry.path); children.replaceChildren() }
				else { paths.add(entry.path); void paintDirectory(workspace, entry.path, children, depth + 1, treeRevision) }
				row.setAttribute('aria-expanded', String(paths.has(entry.path)))
				arrow.textContent = paths.has(entry.path) ? '⌄' : '›'
				void refreshExplorer()
			})
			wrap.appendChild(children)
		}
		else row.addEventListener('click', () => void openFileTab(workspace, entry.path))
		return wrap
	}))
}

/**
 * @param {object} workspace - Owning workspace.
 * @param {string} path - Workspace relative file path.
 * @returns {Promise<void>} File activation completion.
 */
export async function openFileTab(workspace, path) {
	let tab = store.tabs.find(item => item.type === 'file' && item.workspaceId === workspace.id && item.id === path)
	if (!tab) {
		tab = { type: 'file', id: path, workspaceId: workspace.id }
		store.tabs.push(tab)
	}
	await activateFileTab(tab)
}

/**
 * 显示文件标签并保持其他标签的会话运行状态。
 * @param {object} tab - File tab.
 * @returns {Promise<void>} File activation completion.
 */
export async function activateFileTab(tab) {
	if (tab?.type !== 'file') return
	const previous = activeTab()
	if (previous && previous.type !== 'file' && store.session) {
		getRuntime(tabKeyOf(previous), { create: true }).session = store.session
		previous.draft = richInput.value
	}
	if (tab.workspaceId && tab.workspaceId !== store.workspace?.id)
		await selectWorkspace(tab.workspaceId, { fromTabSwitch: true })
	const key = tabKeyOf(tab)
	store.activeTabKey = key
	store.session = null
	const workspace = workspaceFor(tab)
	if (workspace) store.workspace = workspace
	document.querySelector('.code-main').classList.add('file-view')
	editor.hidden = false
	syncCodeUrl(tab)
	renderTabs()
	saveTabPrefs()
	void refreshExplorer()
	const buffer = buffers.get(key)
	if (buffer) { paintEditor(tab); input.focus(); return }
	const target = fileTarget(tab)
	if (!target) return
	const revision = ++fileRevision
	input.disabled = true
	filename.textContent = tab.id
	status.textContent = geti18n('code.explorer.loading')
	try {
		const result = await api.readWorkspaceFile(target, tab.id)
		if (revision !== fileRevision || store.activeTabKey !== key) return
		buffers.set(key, { content: result.content, base: result.content, version: result.version })
		paintEditor(tab)
		input.focus()
	}
	catch (error) {
		if (revision !== fileRevision || store.activeTabKey !== key) return
		status.textContent = String(error?.message || error)
		showToastI18n('error', 'code.error.generic', { error: status.textContent })
	}
}

/** 返回代理标签时恢复界面。 @returns {void} */
export function showConversationView() {
	++fileRevision
	document.querySelector('.code-main').classList.remove('file-view')
	editor.hidden = true
}

/**
 * @param {string} before - Original file text.
 * @param {string} after - Edited file text.
 * @returns {Array<{type: string, text: string}>} Aligned lines.
 */
function lineDiff(before, after) {
	const a = before.split('\n'), b = after.split('\n')
	// Full line alignment for typical edits; cap large files to keep typing responsive.
	if (a.length * b.length > 120000) {
		let first = 0
		while (first < a.length && first < b.length && a[first] === b[first]) first++
		let lastA = a.length - 1, lastB = b.length - 1
		while (lastA >= first && lastB >= first && a[lastA] === b[lastB]) { lastA--; lastB-- }
		return [...a.slice(first, lastA + 1).map(text => ({ type: 'remove', text })), ...b.slice(first, lastB + 1).map(text => ({ type: 'add', text }))]
	}
	const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
	for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
		dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
	const out = []
	let i = 0, j = 0
	while (i < a.length || j < b.length) 
		if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
		else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ type: 'add', text: b[j++] })
		else out.push({ type: 'remove', text: a[i++] })
	
	return out
}

/** @param {object} tab - Active file tab. @returns {void} Updates editor chrome. */
function paintEditor(tab) {
	if (tab?.type !== 'file') return
	const buffer = buffers.get(tabKeyOf(tab))
	if (!buffer) return
	filename.textContent = tab.id
	if (input.value !== buffer.content) input.value = buffer.content
	input.disabled = false
	const count = buffer.content.split('\n').length
	lines.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n')
	lines.scrollTop = input.scrollTop
	const dirty = buffer.content !== buffer.base
	dirtyMarker.hidden = !dirty
	saveButton.disabled = !dirty || !!buffer.saving
	diffButton.disabled = !dirty
	const changes = dirty ? lineDiff(buffer.base, buffer.content) : []
	const added = changes.filter(line => line.type === 'add').length
	const removed = changes.filter(line => line.type === 'remove').length
	summary.hidden = !dirty
	summary.replaceChildren()
	if (dirty) {
		const label = document.createElement('span')
		label.textContent = `${geti18n('code.explorer.unsaved')} · `
		const add = document.createElement('span')
		add.className = 'code-editor-added'
		add.textContent = `+${added}`
		const remove = document.createElement('span')
		remove.className = 'code-editor-removed'
		remove.textContent = ` −${removed}`
		summary.append(label, add, remove)
	}
	diffView.hidden = !diffVisible || !dirty
	input.hidden = !diffView.hidden
	lines.hidden = !diffView.hidden
	if (!diffView.hidden) 
		diffView.replaceChildren(...changes.map(line => {
			const span = document.createElement('span')
			span.className = `code-editor-diff-line ${line.type}`
			span.textContent = `${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '} ${line.text}`
			return span
		}))
	
	status.textContent = buffer.external ? geti18n('code.explorer.externalChange') : geti18n('code.explorer.lines', { count })
}

/** 使用乐观并发控制保存当前文件。 @returns {Promise<void>} Completion. */
export async function saveActiveFile() {
	const tab = activeTab()
	if (tab?.type !== 'file') return
	const buffer = buffers.get(tabKeyOf(tab))
	if (!buffer || buffer.saving || buffer.content === buffer.base) return
	const target = fileTarget(tab)
	if (!target) return
	buffer.saving = true
	paintEditor(tab)
	try {
		const content = buffer.content
		const result = await api.writeWorkspaceFile(target, tab.id, content, buffer.version)
		buffer.base = content
		buffer.version = result.version
		buffer.external = false
		if (activeTab() === tab) paintEditor(tab)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error?.message || error) })
		status.textContent = String(error?.message || error)
	}
	finally {
		buffer.saving = false
		if (activeTab() === tab) paintEditor(tab)
	}
}

/** 代理运行后重新加载未修改的文件缓冲区，保留未保存的编辑。 */
export async function refreshOpenFiles() {
	await refreshExplorer({ clear: true })
	await Promise.all(store.tabs.filter(tab => tab.type === 'file').map(async tab => {
		const key = tabKeyOf(tab)
		const buffer = buffers.get(key)
		if (!buffer || buffer.saving) return
		try {
			const version = buffer.version
			const result = await api.readWorkspaceFile(fileTarget(tab), tab.id)
			if (buffer.saving || buffer.version !== version || result.version === buffer.version) return
			if (buffer.content !== buffer.base) buffer.external = true
			else { buffer.content = result.content; buffer.base = result.content; buffer.version = result.version }
			if (store.activeTabKey === key) paintEditor(tab)
		}
		catch { /* File may have been removed by the agent; keep the visible buffer. */ }
	}))
}
