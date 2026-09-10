/**
 * 侧栏群图标多选（Shift 范围 / Ctrl 切换）与选中样式同步。
 */
import { createSelectionController } from '/scripts/components/selectionController.mjs'

import { store } from './core/state.mjs'
import { isFriendBoundGroup } from './friendBindings.mjs'

/** 侧栏群多选控制器（顺序与 serverBar 渲染一致，供 Shift 范围使用）。 */
const selection = createSelectionController({
	/**
	 * @returns {string[]} 侧栏可见群 ID 顺序
	 */
	getOrderedIds: () => orderedSidebarGroupIds(),
	/**
	 * @returns {void}
	 */
	onChange: () => syncGroupSelectionStyles(),
	plainClick: 'single',
	shiftRange: 'replace',
})

/**
 * @returns {string[]} 侧栏可见群 ID（内存顺序，与 serverBar 渲染一致）
 */
export function orderedSidebarGroupIds() {
	const groupById = new Map(store.sidebar.groups.map(group => [group.groupId, group]))
	const ordered = (store.sidebar.sidebarGroupOrder.length
		? [...store.sidebar.sidebarGroupOrder]
		: store.sidebar.groups.map(group => group.groupId)
	).filter(id => {
		const group = groupById.get(id)
		return group ? !isFriendBoundGroup(group) : false
	})
	// sidebarGroupOrder 可能含已删除/好友绑定 ID 而被过滤为空；仍有可见群时回退到当前顺序。
	return ordered.length ? ordered : store.sidebar.groups.filter(group => !isFriendBoundGroup(group)).map(group => group.groupId)
}

/**
 * @returns {string[]} 当前选中的群 ID 列表
 */
export function getSelectedGroupIds() {
	return selection.getSelected()
}

/**
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否在多选集中
 */
export function isGroupSelected(groupId) {
	return selection.isSelected(groupId)
}

/** @returns {void} */
export function clearGroupSelection() {
	selection.clear()
}

/** @returns {void} */
export function syncGroupSelectionStyles() {
	document.querySelectorAll('#server-list .server-item[data-group-id]').forEach(el => {
		const id = el.dataset.groupId || ''
		el.classList.toggle('is-multi-selected', selection.isSelected(id))
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {{ shift?: boolean, ctrl?: boolean }} mod 修饰键
 * @returns {void}
 */
export function handleGroupItemModifierClick(groupId, mod = {}) {
	// Ctrl 优先于 Shift（与旧行为一致）：Ctrl 切换单项，Shift 替换为范围。
	if (mod.ctrl) selection.handleClick(groupId, { ctrl: true })
	else selection.handleClick(groupId, { shift: mod.shift })
}

/**
 * 右键菜单目标群：已多选且含当前项时用整组选中集，否则仅当前群。
 * @param {string} groupId 右键所在群
 * @returns {string[]} 菜单作用的群 ID 列表
 */
export function contextMenuTargetGroupIds(groupId) {
	const id = groupId.trim()
	const selected = selection.getSelected()
	if (selected.length > 1 && selection.isSelected(id))
		return selected
	if (id) return [id]
	return []
}

/**
 * 右键前规范化选中集（未选中项上右键则单独选中该项）。
 * @param {string} groupId 群 ID
 * @returns {void} 无返回值
 */
export function primeContextMenuSelection(groupId) {
	const id = groupId.trim()
	if (!id) return
	if (selection.isSelected(id)) return
	selection.setSelection([id], { anchor: id })
}
