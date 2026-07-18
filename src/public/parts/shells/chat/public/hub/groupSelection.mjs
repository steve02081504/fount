/**
 * 侧栏群图标多选（Shift 范围 / Ctrl 切换）与选中样式同步。
 */
import { store } from './core/state.mjs'

/**
 * @returns {string[]} 侧栏可见群 ID（内存顺序，与 serverBar 渲染一致）
 */
export function orderedSidebarGroupIds() {
	if (store.sidebar.sidebarGroupOrder.length)
		return [...store.sidebar.sidebarGroupOrder]
	return store.sidebar.groups
		.filter(g => !g.friendBinding?.entityHash)
		.map(g => g.groupId)
}

/**
 * @returns {string[]} 当前选中的群 ID 列表
 */
export function getSelectedGroupIds() {
	return [...store.sidebar.selectedGroupIds]
}

/**
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否在多选集中
 */
export function isGroupSelected(groupId) {
	return store.sidebar.selectedGroupIds.has(groupId)
}

/** @returns {void} */
export function clearGroupSelection() {
	store.sidebar.selectedGroupIds.clear()
	store.sidebar.selectionAnchorGroupId = null
	syncGroupSelectionStyles()
}

/** @returns {void} */
export function syncGroupSelectionStyles() {
	document.querySelectorAll('#server-list .server-item[data-group-id]').forEach(el => {
		const id = String(el.dataset.groupId || '').trim()
		el.classList.toggle('is-multi-selected', store.sidebar.selectedGroupIds.has(id))
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {{ shift?: boolean, ctrl?: boolean }} mod 修饰键
 * @returns {void}
 */
export function handleGroupItemModifierClick(groupId, mod = {}) {
	const ids = orderedSidebarGroupIds()
	if (!ids.includes(groupId)) return

	if (mod.ctrl) {
		if (store.sidebar.selectedGroupIds.has(groupId))
			store.sidebar.selectedGroupIds.delete(groupId)
		else store.sidebar.selectedGroupIds.add(groupId)
		store.sidebar.selectionAnchorGroupId = groupId
		syncGroupSelectionStyles()
		return
	}

	if (mod.shift) {
		const anchor = store.sidebar.selectionAnchorGroupId
		if (!anchor || !ids.includes(anchor)) {
			store.sidebar.selectedGroupIds.clear()
			store.sidebar.selectedGroupIds.add(groupId)
			store.sidebar.selectionAnchorGroupId = groupId
			syncGroupSelectionStyles()
			return
		}
		const a = ids.indexOf(anchor)
		const b = ids.indexOf(groupId)
		const [lo, hi] = a <= b ? [a, b] : [b, a]
		store.sidebar.selectedGroupIds.clear()
		for (let i = lo; i <= hi; i++) store.sidebar.selectedGroupIds.add(ids[i])
		syncGroupSelectionStyles()
		return
	}

	store.sidebar.selectedGroupIds.clear()
	store.sidebar.selectedGroupIds.add(groupId)
	store.sidebar.selectionAnchorGroupId = groupId
	syncGroupSelectionStyles()
}

/**
 * 右键菜单目标群：已多选且含当前项时用整组选中集，否则仅当前群。
 * @param {string} groupId 右键所在群
 * @returns {string[]} 菜单作用的群 ID 列表
 */
export function contextMenuTargetGroupIds(groupId) {
	const id = String(groupId || '').trim()
	if (store.sidebar.selectedGroupIds.size > 1 && store.sidebar.selectedGroupIds.has(id))
		return getSelectedGroupIds()
	if (id) return [id]
	return []
}

/**
 * 右键前规范化选中集（未选中项上右键则单独选中该项）。
 * @param {string} groupId 群 ID
 * @returns {void} 无返回值
 */
export function primeContextMenuSelection(groupId) {
	const id = String(groupId || '').trim()
	if (!id) return
	if (store.sidebar.selectedGroupIds.has(id)) return
	clearGroupSelection()
	store.sidebar.selectedGroupIds.add(id)
	store.sidebar.selectionAnchorGroupId = id
	syncGroupSelectionStyles()
}
