/**
 * 【文件】public/hub/files.mjs
 * 【职责】群组文件抽屉：列出频道附件、预览/下载，并与 Hub 主布局的开关状态联动。
 * 【原理】`wireFilesDrawer` / `openFilesDrawer` 控制侧滑抽屉显隐与 `#hub-files-drawer` 内容刷新。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../src/api/groupApi、core/domUtils
 */
import { confirmI18n, i18nElement, promptI18n } from '../../../../scripts/i18n.mjs'
import { mountTemplate, renderTemplate } from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { deleteGroupFile, getGroupState, updateFileSystemFolder } from '../src/api/groupApi.mjs'

import { escapeHtml } from './core/domUtils.mjs'

/** @type {string | null} */
let selectedFolderId = null

let filesDrawerWired = false

/** 换群或清理 Hub 状态时重置文件侧栏事件绑定。 */
export function resetFilesDrawerWire() {
	filesDrawerWired = false
	selectedFolderId = null
	setFilesDrawerOpen(false)
}

/**
 * @returns {boolean} 群文件侧栏是否打开
 */
export function isFilesDrawerOpen() {
	const toggle = document.getElementById('hub-files-drawer-toggle')
	return toggle instanceof HTMLInputElement && toggle.checked
}

/**
 * 打开/关闭 Hub 群文件侧栏（DaisyUI drawer）。
 * @param {boolean} open 是否显示
 */
export function setFilesDrawerOpen(open) {
	const toggle = document.getElementById('hub-files-drawer-toggle')
	if (toggle instanceof HTMLInputElement)
		toggle.checked = open
	document.getElementById('hub-header-files-button')?.classList.toggle('is-active', open)
}

/**
 * 根据物化状态刷新文件侧栏列表。
 * @param {object} drawer 上下文
 * @param {string} drawer.groupId 群 ID
 * @param {object} [drawer.state] 群 state；缺省则拉取
 * @param {{ uploadGroupFile?: (file: File, folderId?: string | null) => Promise<void>, downloadGroupFile?: (fileId: string) => Promise<void>, reloadState?: () => Promise<object> }} handlers 操作回调
 * @returns {Promise<void>}
 */
export async function refreshFilesDrawer(drawer, handlers = {}) {
	const host = document.getElementById('hub-files-list')
	if (!host || !drawer.groupId) return
	const state = drawer.state || await getGroupState(drawer.groupId)
	const folders = state.fileFolders || {}
	const files = Array.isArray(state.files) ? state.files : []
	const folderSelect = document.getElementById('hub-files-folder-select')
	if (folderSelect instanceof HTMLSelectElement) {
		folderSelect.replaceChildren()
		folderSelect.appendChild(await renderTemplate('hub/files/folder_option', {
			folderEntries: Object.entries(folders),
			selectedFolderId: selectedFolderId || '',
			escapeHtml,
		}))
		folderSelect.value = selectedFolderId || ''
	}

	const filteredFiles = selectedFolderId
		? files.filter(f => f.folderId === selectedFolderId)
		: files.filter(f => !f.folderId)

	await mountTemplate(host, 'hub/files/drawer', {
		folders,
		filteredFiles,
		escapeHtml,
	})

	host.querySelectorAll('.hub-files-folder-open').forEach(openButton => {
		openButton.addEventListener('click', () => {
			selectedFolderId = openButton.getAttribute('data-folder-id')
			void refreshFilesDrawer(drawer, handlers)
		})
	})
	host.querySelectorAll('.hub-files-folder-rename').forEach(renameButton => {
		renameButton.addEventListener('click', async () => {
			const folderId = renameButton.getAttribute('data-folder-id')
			if (!folderId) return
			const currentName = folders[folderId]?.name || folderId
			const name = await promptI18n('chat.hub.filesRenameFolderPrompt', { name: currentName })
			if (!name?.trim()) return
			await updateFileSystemFolder(drawer.groupId, {
				operation: 'rename',
				folderId,
				name: name.trim(),
			})
			if (handlers.reloadState) {
				const st = await handlers.reloadState()
				await refreshFilesDrawer({ groupId: drawer.groupId, state: st }, handlers)
			}
			else await refreshFilesDrawer(drawer, handlers)
		})
	})
	host.querySelectorAll('.hub-files-folder-delete-button').forEach(deleteFolderButton => {
		deleteFolderButton.addEventListener('click', async () => {
			const folderId = deleteFolderButton.getAttribute('data-folder-id')
			if (!folderId || !confirmI18n('chat.hub.filesDeleteFolderConfirm')) return
			await updateFileSystemFolder(drawer.groupId, { operation: 'delete', folderId })
			if (selectedFolderId === folderId) selectedFolderId = null
			if (handlers.reloadState) {
				const st = await handlers.reloadState()
				await refreshFilesDrawer({ groupId: drawer.groupId, state: st }, handlers)
			}
			else await refreshFilesDrawer(drawer, handlers)
		})
	})
	host.querySelectorAll('.hub-files-download-button').forEach(downloadButton => {
		downloadButton.addEventListener('click', async () => {
			const fileId = downloadButton.getAttribute('data-file-id')
			if (!fileId || !handlers.downloadGroupFile) return
			downloadButton.disabled = true
			try { await handlers.downloadGroupFile(fileId) }
			finally { downloadButton.disabled = false }
		})
	})
	host.querySelectorAll('.hub-files-delete-button').forEach(deleteButton => {
		deleteButton.addEventListener('click', async () => {
			const fileId = deleteButton.getAttribute('data-file-id')
			if (!fileId || !confirmI18n('chat.hub.filesDeleteConfirm')) return
			deleteButton.disabled = true
			try {
				await deleteGroupFile(drawer.groupId, fileId)
				if (handlers.reloadState) {
					const st = await handlers.reloadState()
					await refreshFilesDrawer({ groupId: drawer.groupId, state: st }, handlers)
				}
				else await refreshFilesDrawer(drawer, handlers)
			}
			finally { deleteButton.disabled = false }
		})
	})
}

/**
 * 绑定文件侧栏上传 / 新建文件夹等控件。
 * @param {object} drawer 上下文
 * @param {string} drawer.groupId 群 ID
 * @param {{ uploadGroupFile?: (file: File, folderId?: string | null) => Promise<void>, reloadState?: () => Promise<object> }} handlers 操作回调
 * @returns {void}
 */
export function wireFilesDrawer(drawer, handlers = {}) {
	if (filesDrawerWired) return
	filesDrawerWired = true

	document.getElementById('hub-files-upload-button')?.addEventListener('click', () => {
		document.getElementById('hub-files-upload-input')?.click()
	})

	document.getElementById('hub-files-upload-input')?.addEventListener('change', async event => {
		const input = event.target
		if (!(input instanceof HTMLInputElement) || !input.files?.length) return
		for (const file of input.files)
			if (handlers.uploadGroupFile)
				await handlers.uploadGroupFile(file, selectedFolderId)
		input.value = ''
		if (handlers.reloadState) {
			const st = await handlers.reloadState()
			await refreshFilesDrawer({ groupId: drawer.groupId, state: st }, handlers)
		}
		else await refreshFilesDrawer(drawer, handlers)
	})

	document.getElementById('hub-files-new-folder')?.addEventListener('click', async () => {
		const name = await promptI18n('chat.hub.filesNewFolderPrompt')
		if (!name?.trim()) return
		await updateFileSystemFolder(drawer.groupId, {
			operation: 'create',
			folderId: crypto.randomUUID(),
			name: name.trim(),
		})
		if (handlers.reloadState) {
			const st = await handlers.reloadState()
			await refreshFilesDrawer({ groupId: drawer.groupId, state: st }, handlers)
		}
		else await refreshFilesDrawer(drawer, handlers)
	})

	document.getElementById('hub-files-folder-select')?.addEventListener('change', event => {
		const sel = event.target
		if (!(sel instanceof HTMLSelectElement)) return
		selectedFolderId = sel.value || null
		void refreshFilesDrawer(drawer, handlers)
	})
}

/**
 * 打开群文件侧栏并加载列表。
 * @param {object} drawer 上下文
 * @param {string} drawer.groupId 群 ID
 * @param {object} [drawer.state] 群 state
 * @param {object} handlers 操作回调
 * @returns {Promise<void>}
 */
export async function openFilesDrawer(drawer, handlers) {
	if (isFilesDrawerOpen()) {
		setFilesDrawerOpen(false)
		return
	}
	setFilesDrawerOpen(true)
	const host = document.getElementById('hub-files-list')
	if (host) {
		host.innerHTML = '<div class="text-sm opacity-60 py-8 text-center" data-i18n="chat.hub.filesLoading"></div>'
		i18nElement(host)
	}
	try {
		await refreshFilesDrawer(drawer, handlers)
		wireFilesDrawer(drawer, handlers)
	}
	catch (error) {
		setFilesDrawerOpen(false)
		showToastI18n('error', 'chat.hub.filesLoadFailed', { error: error.message })
	}
}

/** 绑定侧栏关闭时同步顶栏按钮高亮。 @returns {void} */
export function wireFilesDrawerToggle() {
	const toggle = document.getElementById('hub-files-drawer-toggle')
	if (!toggle || toggle.dataset.wired) return
	toggle.dataset.wired = '1'
	toggle.addEventListener('change', () => {
		setFilesDrawerOpen(toggle instanceof HTMLInputElement && toggle.checked)
	})
}
