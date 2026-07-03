/**
 * 侧栏群图标多选（Shift 范围 / Ctrl 切换）与选中样式同步。
 */
import { hubStore } from './core/state.mjs'

/**
 * @returns {string[]} 侧栏可见群 ID（内存顺序，与 serverBar 渲染一致）
 */
export function orderedSidebarGroupIds() {
	if (hubStore.sidebar.sidebarGroupOrder.length)
		return [...hubStore.sidebar.sidebarGroupOrder]
	return hubStore.sidebar.groups
		.filter(g => !g.friendBinding?.entityHash)
		.map(g => g.groupId)
}

/**
 * @returns {string[]} 当前选中的群 ID 列表
 */
export function getSelectedGroupIds() {
	return [...hubStore.sidebar.selectedGroupIds]
}

/**
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否在多选集中
 */
export function isGroupSelected(groupId) {
	return hubStore.sidebar.selectedGroupIds.has(groupId)
}

/** @returns {void} */
export function clearGroupSelection() {
	hubStore.sidebar.selectedGroupIds.clear()
	hubStore.sidebar.selectionAnchorGroupId = null
	syncGroupSelectionStyles()
}

/** @returns {void} */
export function syncGroupSelectionStyles() {
	document.querySelectorAll('#hub-server-list .hub-server-item[data-group-id]').forEach(el => {
		const id = String(el.dataset.groupId || '').trim()
		el.classList.toggle('is-multi-selected', hubStore.sidebar.selectedGroupIds.has(id))
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
		if (hubStore.sidebar.selectedGroupIds.has(groupId))
			hubStore.sidebar.selectedGroupIds.delete(groupId)
		else hubStore.sidebar.selectedGroupIds.add(groupId)
		hubStore.sidebar.selectionAnchorGroupId = groupId
		syncGroupSelectionStyles()
		return
	}

	if (mod.shift) {
		const anchor = hubStore.sidebar.selectionAnchorGroupId
		if (!anchor || !ids.includes(anchor)) {
			hubStore.sidebar.selectedGroupIds.clear()
			hubStore.sidebar.selectedGroupIds.add(groupId)
			hubStore.sidebar.selectionAnchorGroupId = groupId
			syncGroupSelectionStyles()
			return
		}
		const a = ids.indexOf(anchor)
		const b = ids.indexOf(groupId)
		const [lo, hi] = a <= b ? [a, b] : [b, a]
		hubStore.sidebar.selectedGroupIds.clear()
		for (let i = lo; i <= hi; i++) hubStore.sidebar.selectedGroupIds.add(ids[i])
		syncGroupSelectionStyles()
		return
	}

	hubStore.sidebar.selectedGroupIds.clear()
	hubStore.sidebar.selectedGroupIds.add(groupId)
	hubStore.sidebar.selectionAnchorGroupId = groupId
	syncGroupSelectionStyles()
}

/**
 * 右键菜单目标群：已多选且含当前项时用整组选中集，否则仅当前群。
 * @param {string} groupId 右键所在群
 * @returns {string[]} 菜单作用的群 ID 列表
 */
export function contextMenuTargetGroupIds(groupId) {
	const id = String(groupId || '').trim()
	if (hubStore.sidebar.selectedGroupIds.size > 1 && hubStore.sidebar.selectedGroupIds.has(id))
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
	if (hubStore.sidebar.selectedGroupIds.has(id)) return
	clearGroupSelection()
	hubStore.sidebar.selectedGroupIds.add(id)
	hubStore.sidebar.selectionAnchorGroupId = id
	syncGroupSelectionStyles()
}
