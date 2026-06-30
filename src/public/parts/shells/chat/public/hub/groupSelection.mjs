/**
 * 侧栏群图标多选（Shift 范围 / Ctrl 切换）与选中样式同步。
 */
import { hubStore } from './core/state.mjs'

/**
 * @returns {string[]} 侧栏可见群 ID（内存顺序，与 serverBar 渲染一致）
 */
export function orderedSidebarGroupIds() {
	if (hubStore.sidebarGroupOrder.length)
		return [...hubStore.sidebarGroupOrder]
	return hubStore.groups
		.filter(g => !g.friendBinding?.entityHash)
		.map(g => g.groupId)
}

/**
 * @returns {string[]} 当前选中的群 ID 列表
 */
export function getSelectedGroupIds() {
	return [...hubStore.selectedGroupIds]
}

/**
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否在多选集中
 */
export function isGroupSelected(groupId) {
	return hubStore.selectedGroupIds.has(groupId)
}

/** @returns {void} */
export function clearGroupSelection() {
	hubStore.selectedGroupIds.clear()
	hubStore.selectionAnchorGroupId = null
	syncGroupSelectionStyles()
}

/** @returns {void} */
export function syncGroupSelectionStyles() {
	document.querySelectorAll('#hub-server-list .hub-server-item[data-group-id]').forEach(el => {
		const id = String(el.dataset.groupId || '').trim()
		el.classList.toggle('is-multi-selected', hubStore.selectedGroupIds.has(id))
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
		if (hubStore.selectedGroupIds.has(groupId))
			hubStore.selectedGroupIds.delete(groupId)
		else hubStore.selectedGroupIds.add(groupId)
		hubStore.selectionAnchorGroupId = groupId
		syncGroupSelectionStyles()
		return
	}

	if (mod.shift) {
		const anchor = hubStore.selectionAnchorGroupId
		if (!anchor || !ids.includes(anchor)) {
			hubStore.selectedGroupIds.clear()
			hubStore.selectedGroupIds.add(groupId)
			hubStore.selectionAnchorGroupId = groupId
			syncGroupSelectionStyles()
			return
		}
		const a = ids.indexOf(anchor)
		const b = ids.indexOf(groupId)
		const [lo, hi] = a <= b ? [a, b] : [b, a]
		hubStore.selectedGroupIds.clear()
		for (let i = lo; i <= hi; i++) hubStore.selectedGroupIds.add(ids[i])
		syncGroupSelectionStyles()
		return
	}

	hubStore.selectedGroupIds.clear()
	hubStore.selectedGroupIds.add(groupId)
	hubStore.selectionAnchorGroupId = groupId
	syncGroupSelectionStyles()
}

/**
 * 右键菜单目标群：已多选且含当前项时用整组选中集，否则仅当前群。
 * @param {string} groupId 右键所在群
 * @returns {string[]} 菜单作用的群 ID 列表
 */
export function contextMenuTargetGroupIds(groupId) {
	const id = String(groupId || '').trim()
	if (hubStore.selectedGroupIds.size > 1 && hubStore.selectedGroupIds.has(id))
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
	if (hubStore.selectedGroupIds.has(id)) return
	clearGroupSelection()
	hubStore.selectedGroupIds.add(id)
	hubStore.selectionAnchorGroupId = id
	syncGroupSelectionStyles()
}
