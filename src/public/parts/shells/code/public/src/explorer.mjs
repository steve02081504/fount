/** 工作区文件树与文件标签；文件和代理会话共用标签栏。 */
import { geti18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import * as api from './endpoints.mjs'
import { createFileEditor, bufferContent, bufferDirty } from './fileEditor.mjs'
import { fileIcon, iconElement } from './icons.mjs'
import { selectWorkspace } from './pills.mjs'
import { activeTab, getRuntime, richInput, store, tabKeyOf } from './store.mjs'
import { renderTabs, saveTabPrefs, syncCodeUrl } from './tabs.mjs'
import { windowedRows } from './windowedRows.mjs'

const tree = document.getElementById('code-explorer-tree')
const sidebar = document.getElementById('code-explorer')
const workspaceLabel = document.getElementById('code-explorer-workspace')
const connectionStatus = document.getElementById('code-explorer-connection')
const editor = document.getElementById('code-editor')
const editorHost = document.getElementById('code-editor-input')
const status = document.getElementById('code-editor-status')
const toggle = document.getElementById('code-explorer-toggle')
let treeWindow = null
let fileEditor = null, editorPromise = null, fileLoad = null
let displayedFileTab = null
/** 状态栏只在 paintEditorStatus 里写入，这里保留最近一次光标位置。 @type {{line: number, column: number}} */
let cursorPosition = { line: 1, column: 1 }

/** @type {Map<string, {content: string, base: string, version: string, lineEnding?: string, model?: object, viewState?: object, savedAlternativeVersionId?: number, savedOriginalVersionId?: number, saving?: boolean, saveAgain?: boolean, external?: boolean}>} */
const buffers = new Map()
/** @type {Map<string, Set<string>>} */
const expanded = new Map()
/** @type {Map<string, Array<object>>} */
const directoryCache = new Map()
let directoryLoad = null
let treeRevision = 0
let fileRevision = 0
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
	return !!buffer && bufferDirty(buffer)
}

/**
 * @param {object} tab - Closed file tab.
 * @returns {void} Discards its buffer.
 */
export function forgetFileTab(tab) {
	const key = tabKeyOf(tab), buffer = buffers.get(key)
	if (buffer) fileEditor?.disposeBuffer(buffer)
	buffers.delete(key)
}

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
	// 窗口必须延迟到页面就绪后再创建：模块级创建会让任何 import 本模块的裸页面直接崩掉。
	treeWindow = windowedRows(tree, { height: 28, render: renderTreeRow })
	window.addEventListener('pagehide', event => {
		watchSubscription?.stop?.(); watchSubscription = null; fileLoad?.abort(); directoryLoad?.abort()
		if (!event.persisted && fileEditor) {
			fileEditor.dispose()
			for (const buffer of buffers.values()) fileEditor.disposeBuffer(buffer)
			fileEditor = null; editorPromise = null
		}
	})
	window.addEventListener('pageshow', event => { if (event.persisted) void refreshExplorer({ clear: true }) })
	setSidebarVisible(localStorage.getItem('code.explorer.visible') !== 'false' && matchMedia('(min-width: 851px)').matches)
	window.addEventListener('code-workspace-change', () => void refreshExplorer({ workspaceOverride: store.workspace }))
	toggle.addEventListener('click', () => setSidebarVisible(sidebar.hidden))
	document.getElementById('code-explorer-refresh').addEventListener('click', () => void refreshExplorer({ clear: true }))
	window.addEventListener('blur', () => void saveActiveFile())
	document.addEventListener('visibilitychange', () => { if (document.hidden) void saveActiveFile() })
	// Ctrl+S 独占保存并吞掉浏览器默认行为；非文件标签下 saveActiveFile 是空操作。
	document.addEventListener('keydown', event => {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
		event.preventDefault()
		void saveActiveFile()
	}, true)
	void refreshExplorer()
}

/**
 * 刷新当前标签所属工作区的文件树。
 * @param {{clear?: boolean, workspaceOverride?: object|null}} [options] - Clear cached directories or select a new workspace.
 * @returns {Promise<void>} Tree render completion.
 */
export async function refreshExplorer({ clear = false, workspaceOverride = null } = {}) {
	if (!treeWindow) return
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
		treeWindow.set([{ note: 'code.explorer.noWorkspace' }])
		return
	}
	if (clear) for (const key of directoryCache.keys()) if (key.startsWith(`${workspace.id}\0`)) directoryCache.delete(key)
	directoryLoad?.abort()
	const controller = directoryLoad = new AbortController()
	const rows = await collectDirectory(workspace, '', 0, revision, controller.signal)
	if (revision === treeRevision) treeWindow.set(rows)
}

/** 页面语言改变后重画编辑器与文件树的本地化文案。 @returns {void} */
export function rerenderExplorer() {
	if (!treeWindow) return
	paintWatchState()
	const tab = activeTab()
	if (tab?.type === 'file') { fileEditor?.translate(); paintEditor(tab) }
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
 * @param {object} workspace - Workspace.
 * @param {string} path - Directory.
 * @param {number} depth - Indent.
 * @param {number} revision - Load generation.
 * @param {AbortSignal} signal - Cancellation.
 * @returns {Promise<Array<object>>} Flattened expanded tree.
 */
async function collectDirectory(workspace, path, depth, revision, signal) {
	const key = cacheKey(workspace.id, path)
	let entries = directoryCache.get(key)
	if (!entries) 
		try {
			entries = []
			let offset = 0
			do {
				const page = await api.listWorkspaceDirectory({ machine: String(workspace.machine ?? '0'), workdir: workspace.path }, path, { offset, limit: 2000, signal })
				entries.push(...page.entries)
				offset = page.nextOffset
			} while (offset != null && !signal.aborted)
			if (signal.aborted || revision !== treeRevision) return []
			directoryCache.set(key, entries)
		} catch (error) {
			if (signal.aborted || revision !== treeRevision) return []
			if (error?.http_code !== 404) console.error('code explorer: directory failed', error)
			return [{ note: 'code.explorer.loadFailed', depth }]
		}
	
	const rows = []
	for (const entry of entries.slice().sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))) {
		if (signal.aborted || revision !== treeRevision) return []
		rows.push({ ...entry, workspace, depth })
		if (entry.isDirectory && expanded.get(workspace.id)?.has(entry.path))
			rows.push(...await collectDirectory(workspace, entry.path, depth + 1, revision, signal))
	}
	return rows
}

/**
 * 在虚拟化工作区树中绘制文件、目录或状态提示。
 * @param {object} entry - Workspace tree entry or a `{ note }` placeholder.
 * @returns {HTMLElement} Visible tree row.
 */
function renderTreeRow(entry) {
	if (entry.note) return note(entry.note)
	const { workspace, depth } = entry
	const row = document.createElement('button')
	row.type = 'button'
	row.className = 'code-tree-row'
	row.style.paddingInlineStart = `${0.55 + depth * 0.9}rem`
	row.dataset.selected = String(!entry.isDirectory && activeTab()?.type === 'file' && activeTab().workspaceId === workspace.id && activeTab().id === entry.path)
	const open = expanded.get(workspace.id)?.has(entry.path) || false
	if (entry.isDirectory) row.setAttribute('aria-expanded', String(open))
	const arrow = document.createElement('span')
	arrow.className = 'code-tree-chevron'
	arrow.textContent = entry.isDirectory ? open ? '⌄' : '›' : ''
	const icon = iconElement(fileIcon(entry.name, entry.isDirectory), { size: 15 })
	const name = document.createElement('span')
	name.className = 'code-tree-name'
	name.setAttribute('user-content', '')
	name.textContent = entry.name
	row.append(arrow, icon, name)
	row.addEventListener('click', () => {
		if (!entry.isDirectory) { void openFileTab(workspace, entry.path); return }
		let paths = expanded.get(workspace.id)
		if (!paths) expanded.set(workspace.id, paths = new Set())
		if (paths.has(entry.path)) paths.delete(entry.path)
		else paths.add(entry.path)
		void refreshExplorer()
	})
	void svgInliner(row)
	return row
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
	if (displayedFileTab && tabKeyOf(displayedFileTab) !== tabKeyOf(tab)) void saveFile(displayedFileTab)
	displayedFileTab = tab
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
	document.querySelector('.code-main')?.classList.remove('empty-mode')
	const workspace = workspaceFor(tab)
	if (workspace) store.workspace = workspace
	document.querySelector('.code-main')?.classList.add('file-view')
	editor.hidden = false
	syncCodeUrl(tab)
	renderTabs()
	saveTabPrefs()
	void refreshExplorer()
	fileLoad?.abort()
	const controller = fileLoad = new AbortController()
	const revision = ++fileRevision
	try {
		fileEditor = await (editorPromise ||= createFileEditor(editorHost, {
			/** @returns {Promise<void>} 重绘活动文件与标签条。 */
			onChange: () => paintEditor(activeTab()),
			onSave: saveActiveFile,
			/** @param {{line: number, column: number}} position 当前选区坐标。 @returns {void} 更新状态栏。 */
			onSelection: position => { cursorPosition = position; paintEditorStatus() },
		}))
	} catch (error) {
		editorPromise = null
		if (revision === fileRevision) status.textContent = String(error.message || error)
		return
	}
	if (controller.signal.aborted || revision !== fileRevision || store.activeTabKey !== key) return
	const buffer = buffers.get(key)
	if (buffer) { await paintEditor(tab); fileEditor.focus(); return }
	const target = fileTarget(tab)
	if (!target) return
	fileEditor.clear()
	fileEditor.setHidden(false)
	status.textContent = geti18n('code.explorer.loading')
	try {
		const result = await api.readWorkspaceFileChunks(target, tab.id, {
			signal: controller.signal,
			/**
			 * 文件加载时就地显示已读取的字节进度。
			 * @param {number} loaded - 已读取字节数。
			 * @param {number} total - 文件总字节数。
			 * @returns {void} 更新加载状态文案。
			 */
			onProgress: (loaded, total) => {
				if (revision === fileRevision) status.textContent = `${geti18n('code.explorer.loading')} · ${Math.ceil(loaded / 1024)} / ${Math.ceil(total / 1024)} KiB`
			},
		})
		if (revision !== fileRevision || store.activeTabKey !== key) return
		buffers.set(key, { content: result.content, base: result.content, version: result.version })
		await paintEditor(tab)
		fileEditor.focus()
	}
	catch (error) {
		if (revision !== fileRevision || store.activeTabKey !== key) return
		if (activeTab() !== tab) return
		status.textContent = String(error?.message || error)
		showToastI18n('error', 'code.error.generic', { error: status.textContent })
	}
}

/** 返回代理标签时恢复界面。 @returns {void} */
export function showConversationView() {
	if (displayedFileTab) void saveFile(displayedFileTab)
	displayedFileTab = null
	fileLoad?.abort()
	++fileRevision
	document.querySelector('.code-main').classList.remove('file-view')
	editor.hidden = true
}

/** 更新文件标签的未保存状态，不重建标签按钮或移动焦点。 @returns {void} */
function updateFileTabMarkers() {
	for (const element of document.querySelectorAll('.code-tab[data-tab-key]')) {
		const buffer = buffers.get(element.dataset.tabKey)
		const marker = element.querySelector('.code-tab-dirty')
		if (marker) marker.hidden = !buffer || !bufferDirty(buffer)
	}
}

/** 状态栏只由这里写入，行数与光标位置始终一起显示。 @returns {void} */
function paintEditorStatus() {
	const tab = activeTab()
	const buffer = tab?.type === 'file' && buffers.get(tabKeyOf(tab))
	if (!buffer) return
	if (buffer.external) { status.textContent = geti18n('code.explorer.externalChange'); return }
	const count = buffer.model?.getLineCount() || buffer.content.split(/\r\n|\r|\n/).length
	status.textContent = `${geti18n('code.explorer.lines', { count })} · ${geti18n('code.explorer.cursor', cursorPosition)}`
}

/**
 * 刷新活动文件的编辑器界面。
 * @param {object} tab - Active file tab.
 * @returns {Promise<void>} 编辑模型挂载完成。
 */
function paintEditor(tab) {
	if (tab?.type !== 'file') return Promise.resolve()
	const buffer = buffers.get(tabKeyOf(tab))
	if (!buffer) return Promise.resolve()
	const ready = (fileEditor?.show(buffer, tab.id) || Promise.resolve())
		.catch(error => { status.textContent = String(error?.message || error) })
	fileEditor?.setHidden(false)
	updateFileTabMarkers()
	paintEditorStatus()
	return ready
}

/**
 * 使用乐观并发控制保存当前文件。
 * @returns {Promise<void>} Completion.
 */
export async function saveActiveFile() {
	return saveFile(activeTab())
}

/**
 * 保存指定文件，失焦保存始终绑定原缓冲区。
 * @param {object} tab - File tab.
 * @returns {Promise<void>} Save completion.
 */
async function saveFile(tab) {
	if (tab?.type !== 'file') return
	const buffer = buffers.get(tabKeyOf(tab))
	if (!buffer) return
	if (buffer.saving) { buffer.saveAgain = true; return }
	if (!bufferDirty(buffer)) return
	const target = fileTarget(tab)
	if (!target) return
	buffer.saving = true
	if (activeTab() === tab) paintEditor(tab)
	let succeeded = false
	try {
		const content = bufferContent(buffer)
		const savedVersionId = buffer.model.getAlternativeVersionId()
		const result = await api.writeWorkspaceFile(target, tab.id, content, buffer.version)
		buffer.base = content
		buffer.savedAlternativeVersionId = savedVersionId
		buffer.savedOriginalVersionId = savedVersionId
		buffer.version = result.version
		buffer.external = false
		succeeded = true
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error?.message || error) })
		if (activeTab() === tab) status.textContent = String(error?.message || error)
	}
	finally {
		buffer.saving = false
		const again = buffer.saveAgain
		buffer.saveAgain = false
		if (again && succeeded) void saveFile(tab)
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
			if (bufferDirty(buffer)) buffer.external = true
			else {
				fileEditor?.disposeBuffer(buffer)
				buffer.content = result.content; buffer.base = result.content; buffer.version = result.version
				buffer.lineEnding = undefined; buffer.savedAlternativeVersionId = null; buffer.savedOriginalVersionId = null
			}
			if (store.activeTabKey === key) paintEditor(tab)
		}
		catch { /* File may have been removed by the agent; keep the visible buffer. */ }
	}))
}
