/**
 * 【文件】public/hub/serverBarDnd.mjs
 * 【职责】左侧服务器栏的群组拖拽：将群拖入/拖出文件夹、把两个群拖到一起创建文件夹（Discord 风格）。
 * 【原理】对 `renderServerBar` 渲染出的 `.hub-server-item[data-group-id]` 与 `.hub-folder-tile[data-folder-idx]`
 *   绑定 HTML5 拖放；落点判定后改写 `hubStore.sidebar.groupFoldersState.folders`，归一化（移除空文件夹、解散单群文件夹），
 *   再 `persistGroupFolders` + `renderServerBar` 重绘。
 * 【数据结构】folder：{ id, name, nameIsDefault, groupIds[], collapsed }。
 * 【关联】serverBar（persistGroupFolders / renderServerBar）、core/state。
 */
import { hubStore } from './core/state.mjs'

/** @type {string|null} 当前正在拖拽的群 ID（dragover 时 dataTransfer 不可读，用模块变量兜底） */
let draggedGroupId = null

/**
 * @returns {Array<{ id: string, name: string, nameIsDefault?: boolean, groupIds: string[], collapsed?: boolean }>} 文件夹数组（按需初始化）
 */
function folders() {
	return hubStore.sidebar.groupFoldersState.folders || (hubStore.sidebar.groupFoldersState.folders = [])
}

/**
 * 生成唯一文件夹 ID。
 * @returns {string} 文件夹 ID
 */
function newFolderId() {
	return `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 从所有文件夹中移除某个群（不做归一化）。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
function detachFromFolders(groupId) {
	for (const folder of folders())
		folder.groupIds = (folder.groupIds || []).filter(id => id !== groupId)
}

/**
 * 归一化文件夹：去重空文件夹、解散仅剩一个群的文件夹。
 * @returns {void}
 */
function normalizeFolders() {
	hubStore.sidebar.groupFoldersState.folders = folders().filter(folder => (folder.groupIds || []).length >= 2)
}

/**
 * 查找群当前所在文件夹。
 * @param {string} groupId 群 ID
 * @returns {object|null} 所在文件夹，未分组为 null
 */
function folderOfGroup(groupId) {
	return folders().find(folder => (folder.groupIds || []).includes(groupId)) || null
}

/**
 * 把群移动到目标文件夹（可指定插入到某个群之前）。
 * @param {string} folderId 目标文件夹 ID
 * @param {string} groupId 被移动群 ID
 * @param {string} [beforeGroupId] 插入到此群之前；缺省追加到末尾
 * @returns {void}
 */
function moveGroupToFolder(folderId, groupId, beforeGroupId) {
	const folder = folders().find(item => item.id === folderId)
	if (!folder) return
	detachFromFolders(groupId)
	folder.groupIds ||= []
	const at = beforeGroupId ? folder.groupIds.indexOf(beforeGroupId) : -1
	if (at >= 0) folder.groupIds.splice(at, 0, groupId)
	else folder.groupIds.push(groupId)
}

/**
 * 用两个群创建新文件夹（拖一个群到另一个未分组群上）。
 * @param {string} targetGroupId 落点群 ID
 * @param {string} groupId 被拖拽群 ID
 * @returns {void}
 */
function createFolderWith(targetGroupId, groupId) {
	detachFromFolders(targetGroupId)
	detachFromFolders(groupId)
	folders().push({
		id: newFolderId(),
		name: '',
		nameIsDefault: true,
		groupIds: [targetGroupId, groupId],
		collapsed: false,
	})
}

/**
 * 把群移出所有文件夹（变为未分组）。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
function moveGroupToUngrouped(groupId) {
	detachFromFolders(groupId)
}

/**
 * 应用一次拖拽变更：归一化 → 持久化 → 重绘。
 * @returns {Promise<void>}
 */
async function commit() {
	normalizeFolders()
	const { persistGroupFolders, renderServerBar } = await import('./serverBar.mjs')
	await persistGroupFolders()
	await renderServerBar()
}

/**
 * 清理拖拽视觉状态。
 * @returns {void}
 */
function clearDropHints() {
	document.querySelectorAll('.hub-drop-into, .hub-drop-before, .hub-drop-after')
		.forEach(el => el.classList.remove('hub-drop-into', 'hub-drop-before', 'hub-drop-after'))
}

/**
 * 绑定服务器栏拖放交互（每次 `renderServerBar` 后调用）。
 * @param {HTMLElement} list `#hub-server-list`
 * @returns {void}
 */
export function attachServerBarDnd(list) {
	if (!(list instanceof HTMLElement)) return

	const items = list.querySelectorAll('.hub-server-item[data-group-id]')
	for (const item of items) {
		if (!(item instanceof HTMLElement)) continue
		item.setAttribute('draggable', 'true')

		item.addEventListener('dragstart', event => {
			draggedGroupId = String(item.dataset.groupId || '').trim()
			item.classList.add('hub-dragging')
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move'
				event.dataTransfer.setData('text/plain', draggedGroupId)
			}
		})
		item.addEventListener('dragend', () => {
			item.classList.remove('hub-dragging')
			draggedGroupId = null
			clearDropHints()
		})

		item.addEventListener('dragover', event => {
			if (!draggedGroupId || draggedGroupId === item.dataset.groupId) return
			event.preventDefault()
			event.stopPropagation()
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
			clearDropHints()
			item.classList.add('hub-drop-into')
		})
		item.addEventListener('dragleave', () => item.classList.remove('hub-drop-into'))

		item.addEventListener('drop', async event => {
			const targetGroupId = String(item.dataset.groupId || '').trim()
			const sourceGroupId = draggedGroupId || event.dataTransfer?.getData('text/plain') || ''
			event.preventDefault()
			event.stopPropagation()
			clearDropHints()
			if (!sourceGroupId || sourceGroupId === targetGroupId) return
			const targetFolder = folderOfGroup(targetGroupId)
			if (targetFolder) moveGroupToFolder(targetFolder.id, sourceGroupId, targetGroupId)
			else createFolderWith(targetGroupId, sourceGroupId)
			await commit()
		})
	}

	const tiles = list.querySelectorAll('.hub-folder-tile[data-folder-idx]')
	for (const tile of tiles) {
		if (!(tile instanceof HTMLElement)) continue
		const wrap = tile.closest('.hub-folder-wrap[data-folder-idx]')
		const folderIndex = Number(tile.dataset.folderIdx)
		const folder = folders()[folderIndex]
		if (!folder) continue

		tile.addEventListener('dragover', event => {
			if (!draggedGroupId) return
			event.preventDefault()
			event.stopPropagation()
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
			clearDropHints()
			wrap?.classList.add('hub-drop-into')
		})
		tile.addEventListener('dragleave', () => wrap?.classList.remove('hub-drop-into'))
		tile.addEventListener('drop', async event => {
			const sourceGroupId = draggedGroupId || event.dataTransfer?.getData('text/plain') || ''
			event.preventDefault()
			event.stopPropagation()
			clearDropHints()
			if (!sourceGroupId || folder.groupIds?.includes(sourceGroupId)) return
			moveGroupToFolder(folder.id, sourceGroupId)
			await commit()
		})
	}

	// 列表空白区域：拖出文件夹 → 变为未分组
	list.addEventListener('dragover', event => {
		if (!draggedGroupId) return
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
	})
	list.addEventListener('drop', async event => {
		const sourceGroupId = draggedGroupId || event.dataTransfer?.getData('text/plain') || ''
		event.preventDefault()
		clearDropHints()
		if (!sourceGroupId || !folderOfGroup(sourceGroupId)) return
		moveGroupToUngrouped(sourceGroupId)
		await commit()
	})
}
