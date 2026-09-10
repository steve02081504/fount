/**
 * 通用多选控制器：维护选中集合 / 选择模式 / 范围锚点，支持 Shift 连续范围与 Ctrl/⌘ 单选切换，
 * 以及 Ctrl/⌘+A 全选、Esc 退出。DOM 同步与右键等业务语义交由调用方通过 onChange / 回调处理。
 */

/**
 * 判断键盘事件目标是否是可输入控件（此时不劫持快捷键）。
 * @param {EventTarget | null} target 事件目标
 * @returns {boolean} 是输入控件则为 true
 */
export function isEditableTarget(target) {
	const tag = target?.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
}

/**
 * 创建选择控制器。
 * @param {object} options 配置
 * @param {() => string[]} options.getOrderedIds 返回当前可见项 id 顺序（Shift 范围依据）
 * @param {(state: { selectedIds: Set<string>, mode: boolean, anchorId: string | null }) => void} [options.onChange] 选中态变化回调
 * @param {'toggle' | 'single'} [options.plainClick] 无修饰键普通点击策略：'toggle' 进入/切换选择模式；'single' 单选并设锚点
 * @param {'add' | 'replace'} [options.shiftRange] Shift 范围语义：'add' 叠加到现有选中；'replace' 替换为整段范围
 * @returns {object} 控制器
 */
export function createSelectionController({ getOrderedIds, onChange, plainClick = 'toggle', shiftRange = 'add' } = {}) {
	/** @type {Set<string>} */
	const selectedIds = new Set()
	/** @type {boolean} */
	let mode = false
	/** @type {string | null} */
	let anchorId = null

	/**
	 * 触发变更回调。
	 * @returns {void}
	 */
	function emit() {
		onChange?.({ selectedIds, mode, anchorId })
	}

	/**
	 * 进入 / 退出选择模式；退出时清空选择。
	 * @param {boolean} on 是否进入
	 * @returns {void}
	 */
	function setMode(on) {
		mode = !!on
		if (!mode) {
			selectedIds.clear()
			anchorId = null
		}
		emit()
	}

	/**
	 * 清空选择（保留选择模式标记为关闭）。
	 * @returns {void}
	 */
	function clear() {
		selectedIds.clear()
		anchorId = null
		mode = false
		emit()
	}

	/**
	 * 直接替换整个选中集。
	 * @param {Iterable<string>} ids 新选中项
	 * @param {{ anchor?: string | null }} [options] 锚点
	 * @returns {void}
	 */
	function setSelection(ids, { anchor = null } = {}) {
		selectedIds.clear()
		for (const id of ids || []) selectedIds.add(id)
		anchorId = anchor
		emit()
	}

	/**
	 * 设置单项选中态（复选框路径：不切换，直接置位）。
	 * @param {string} id 项 id
	 * @param {boolean} on 是否选中
	 * @returns {void}
	 */
	function setItemSelected(id, on) {
		if (on) selectedIds.add(id)
		else selectedIds.delete(id)
		anchorId = id
		if (on) mode = true
		emit()
	}

	/**
	 * 从锚点到目标叠加一段范围。
	 * @param {string} fromId 锚点 id
	 * @param {string} toId 目标 id
	 * @param {string[]} ids 可见 id 顺序
	 * @returns {boolean} 锚点与目标均可见时返回 true
	 */
	function addRange(fromId, toId, ids) {
		const from = ids.indexOf(fromId)
		const to = ids.indexOf(toId)
		if (from === -1 || to === -1) return false
		const [lo, hi] = from <= to ? [from, to] : [to, from]
		for (let i = lo; i <= hi; i++) selectedIds.add(ids[i])
		return true
	}

	/**
	 * 处理一次点选。
	 * @param {string} id 点选项 id
	 * @param {{ shift?: boolean, ctrl?: boolean }} [mods] 修饰键
	 * @returns {void}
	 */
	function handleClick(id, mods = {}) {
		const ids = getOrderedIds?.() || []
		if (!ids.includes(id)) return
		const modifier = !!(mods.ctrl || mods.shift)
		if (!mode && !modifier) {
			if (plainClick === 'single') {
				selectedIds.clear()
				selectedIds.add(id)
				anchorId = id
				emit()
				return
			}
			mode = true
		}
		mode = true
		if (mods.shift) {
			if (shiftRange === 'replace') {
				selectedIds.clear()
				if (anchorId && addRange(anchorId, id, ids)) {
					emit()
					return
				}
				selectedIds.add(id)
				anchorId = id
				emit()
				return
			}
			if (anchorId && addRange(anchorId, id, ids)) {
				emit()
				return
			}
		}
		if (selectedIds.has(id)) selectedIds.delete(id)
		else selectedIds.add(id)
		anchorId = id
		emit()
	}

	/**
	 * 全选 / 取消全选当前可见项。
	 * @param {boolean} checked 是否全选
	 * @returns {void}
	 */
	function selectAll(checked) {
		selectedIds.clear()
		if (checked) {
			for (const id of getOrderedIds?.() || []) selectedIds.add(id)
			mode = true
		}
		anchorId = null
		emit()
	}

	/**
	 * 剔除已不可见的选中项（列表筛选 / 重渲后调用）。
	 * @param {Iterable<string>} visibleIds 当前可见 id
	 * @returns {void}
	 */
	function reconcile(visibleIds) {
		if (!visibleIds) return
		const set = new Set(visibleIds)
		let changed = false
		for (const id of [...selectedIds])
			if (!set.has(id)) {
				selectedIds.delete(id)
				changed = true
			}
		if (changed) emit()
	}

	/**
	 * 判断某项是否选中。
	 * @param {string} id 项 id
	 * @returns {boolean} 是否选中
	 */
	function isSelected(id) {
		return selectedIds.has(id)
	}

	/**
	 * 读取当前选中项列表。
	 * @returns {string[]} 选中项 id 列表
	 */
	function getSelected() {
		return [...selectedIds]
	}

	/**
	 * 读取当前是否处于选择模式。
	 * @returns {boolean} 是否选择模式
	 */
	function getMode() {
		return mode
	}

	/**
	 * 读取范围锚点。
	 * @returns {string | null} 锚点 id
	 */
	function getAnchor() {
		return anchorId
	}

	return {
		handleClick,
		selectAll,
		setMode,
		clear,
		reconcile,
		setSelection,
		setItemSelected,
		isSelected,
		getSelected,
		getMode,
		getAnchor,
	}
}

/**
 * 绑定全局快捷键：Ctrl/⌘+A 全选可见项，Esc 退出选择模式。
 * @param {ReturnType<typeof createSelectionController>} controller 控制器
 * @param {object} [options] 选项
 * @param {() => void} [options.onEscape] Esc 回调（缺省退出选择模式）
 * @param {() => boolean} [options.canSelectAll] 是否允许全选（缺省允许）
 * @param {(target: EventTarget | null) => boolean} [options.isEditableTarget] 可输入控件判定
 * @param {Document | HTMLElement} [options.target] 事件绑定目标（缺省 document）
 * @returns {() => void} 解绑函数
 */
export function bindSelectionShortcuts(controller, {
	onEscape,
	canSelectAll,
	isEditableTarget: isEditable = isEditableTarget,
	target = document,
} = {}) {
	/**
	 * 处理快捷键。
	 * @param {KeyboardEvent} event 键盘事件
	 * @returns {void}
	 */
	const onKeyDown = event => {
		if (isEditable(event.target)) return
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
			if (canSelectAll && !canSelectAll()) return
			event.preventDefault()
			controller.selectAll(true)
			return
		}
		if (event.key === 'Escape' && controller.getMode()) {
			event.preventDefault()
			if (onEscape) onEscape()
			else controller.setMode(false)
		}
	}
	target.addEventListener('keydown', onKeyDown)
	return () => target.removeEventListener('keydown', onKeyDown)
}
