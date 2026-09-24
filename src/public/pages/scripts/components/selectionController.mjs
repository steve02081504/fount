/**
 * 通用多选控制器：以「按有序 id 锚定的区间集」维护选中态，支持 Shift 连续范围、
 * Ctrl/⌘ 单选切换、Ctrl/⌘+A 全选、Esc 退出，以及原生文字选择跨项时的自动升变与拖选。
 *
 * 区间表示使范围选取只改首尾（内存 O(段数)，可覆盖数万项），区间内取消某项会自然断成两段；
 * 有序列表来自 `getOrderedIds`，虚拟滚动只渲染窗口也不影响选择范围。DOM 同步与业务语义
 * 交由调用方通过 `onChange` / 回调处理。
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
 * @param {() => string[]} options.getOrderedIds 返回当前完整有序项 id（Shift 范围 / 区间解析依据；建议返回稳定数组引用以省去重建）
 * @param {(state: { selectedIds: object, count: number, mode: boolean, anchorId: string | null }) => void} [options.onChange] 选中态变化回调
 * @param {'toggle' | 'single'} [options.plainClick] 无修饰键普通点击策略：'toggle' 进入/切换选择模式；'single' 单选并设锚点
 * @param {'add' | 'replace'} [options.shiftRange] Shift 范围语义：'add' 叠加到现有选中；'replace' 替换为整段范围
 * @returns {object} 控制器
 */
export function createSelectionController({ getOrderedIds, onChange, plainClick = 'toggle', shiftRange = 'add' } = {}) {
	/** @type {{ startId: string, endId: string }[]} 有序、互不相交、相邻合并的区间（以 id 锚定） */
	let segments = []
	/** @type {boolean} */
	let mode = false
	/** @type {string | null} */
	let anchorId = null
	/** @type {string[] | null} 最近一次解析用的有序 id 快照 */
	let orderIds = null
	/** @type {Map<string, number> | null} id → 索引 */
	let orderIndex = null
	/** @type {[number, number][]} 已解析、排序、合并后的闭区间索引（含端点） */
	let resolved = []

	/**
	 * 把区间集规范化为排序、合并、去空的索引闭区间，并回写 id 锚定的段。
	 * @param {Iterable<[number, number]>} ranges 索引闭区间
	 * @returns {void}
	 */
	function setResolved(ranges) {
		const sorted = [...ranges].sort((a, b) => a[0] - b[0])
		const merged = []
		for (const range of sorted) {
			const last = merged[merged.length - 1]
			if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
			else merged.push([range[0], range[1]])
		}
		resolved = merged
		const ids = orderIds || []
		segments = merged
			.filter(([lo, hi]) => ids[lo] !== undefined && ids[hi] !== undefined)
			.map(([lo, hi]) => ({ startId: ids[lo], endId: ids[hi] }))
	}

	/**
	 * 刷新有序 id 快照与索引；仅当 `getOrderedIds` 返回新数组引用时重建并重解析区间。
	 * @returns {string[]} 当前有序 id
	 */
	function resolveOrder() {
		const ids = getOrderedIds?.() || []
		if (ids === orderIds && orderIndex) return ids
		orderIds = ids
		orderIndex = new Map()
		for (let i = 0; i < ids.length; i++)
			if (!orderIndex.has(ids[i])) orderIndex.set(ids[i], i)

		const ranges = []
		for (const seg of segments) {
			const a = orderIndex.get(seg.startId)
			const b = orderIndex.get(seg.endId)
			let lo = a === undefined ? b : a
			let hi = b === undefined ? a : b
			if (lo === undefined || hi === undefined) continue
			if (lo > hi) [lo, hi] = [hi, lo]
			ranges.push([lo, hi])
		}
		setResolved(ranges)
		return ids
	}

	/**
	 * 触发变更回调。
	 * @returns {void}
	 */
	function emit() {
		onChange?.({ selectedIds: selectedView, count: getCount(), mode, anchorId })
	}

	/**
	 * 判断某项是否选中。
	 * @param {string} id 项 id
	 * @returns {boolean} 是否选中
	 */
	function isSelected(id) {
		resolveOrder()
		const index = orderIndex.get(id)
		if (index === undefined) return false
		let lo = 0
		let hi = resolved.length - 1
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			const [a, b] = resolved[mid]
			if (index < a) hi = mid - 1
			else if (index > b) lo = mid + 1
			else return true
		}
		return false
	}

	/**
	 * 读取选中项数量（O(段数)）。
	 * @returns {number} 数量
	 */
	function getCount() {
		resolveOrder()
		let count = 0
		for (const [a, b] of resolved) count += b - a + 1
		return count
	}

	/**
	 * 懒枚举选中 id。
	 * @returns {Generator<string>} id 生成器
	 */
	function* iterateSelectedIds() {
		const ids = resolveOrder()
		for (const [a, b] of resolved)
			for (let i = a; i <= b; i++) {
				const id = ids[i]
				if (id !== undefined) yield id
			}
	}

	/** Set-like 懒视图：只读 has / size / 迭代，避免每次变更物化整集合。 */
	const selectedView = {
		has: isSelected,
		/**
		 * @returns {number} 选中数量
		 */
		get size() { return getCount() },
		[Symbol.iterator]: iterateSelectedIds,
		values: iterateSelectedIds,
		/**
		 * @param {(id: string, id2: string, view: object) => void} fn 回调
		 * @returns {void}
		 */
		forEach(fn) {
			for (const id of iterateSelectedIds()) fn(id, id, selectedView)
		},
		/**
		 * @returns {Set<string>} 物化集合
		 */
		toSet() { return new Set(iterateSelectedIds()) },
	}

	/**
	 * 判断某索引是否已选中。
	 * @param {number} index 索引
	 * @returns {boolean} 是否选中
	 */
	function isSelectedIndex(index) {
		for (const [a, b] of resolved)
			if (index >= a && index <= b) return true
		return false
	}

	/**
	 * 叠加一段索引闭区间并规范化。
	 * @param {number} from 起点索引
	 * @param {number} to 终点索引
	 * @returns {void}
	 */
	function addIndexRange(from, to) {
		setResolved([...resolved, from <= to ? [from, to] : [to, from]])
	}

	/**
	 * 取消单个索引（区间中断成两段）。
	 * @param {number} index 索引
	 * @returns {void}
	 */
	function removeIndex(index) {
		const out = []
		for (const [a, b] of resolved) {
			if (index < a || index > b) {
				out.push([a, b])
				continue
			}
			if (a <= index - 1) out.push([a, index - 1])
			if (index + 1 <= b) out.push([index + 1, b])
		}
		setResolved(out)
	}

	/**
	 * 进入 / 退出选择模式；退出时清空选择。
	 * @param {boolean} on 是否进入
	 * @returns {void}
	 */
	function setMode(on) {
		mode = !!on
		if (!mode) {
			segments = []
			resolved = []
			anchorId = null
		}
		emit()
	}

	/**
	 * 清空选择（保留选择模式标记为关闭）。
	 * @returns {void}
	 */
	function clear() {
		segments = []
		resolved = []
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
		resolveOrder()
		const indices = []
		for (const id of ids || []) {
			const index = orderIndex.get(id)
			if (index !== undefined) indices.push([index, index])
		}
		setResolved(indices)
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
		resolveOrder()
		const index = orderIndex.get(id)
		if (index === undefined) return
		if (on) addIndexRange(index, index)
		else removeIndex(index)
		anchorId = id
		if (on) mode = true
		emit()
	}

	/**
	 * 处理一次点选。
	 * @param {string} id 点选项 id
	 * @param {{ shift?: boolean, ctrl?: boolean }} [mods] 修饰键
	 * @returns {void}
	 */
	function handleClick(id, mods = {}) {
		resolveOrder()
		const index = orderIndex.get(id)
		if (index === undefined) return
		const modifier = !!(mods.ctrl || mods.shift)
		if (!mode && !modifier) {
			if (plainClick === 'single') {
				setResolved([[index, index]])
				anchorId = id
				emit()
				return
			}
			mode = true
		}
		mode = true
		if (mods.shift) {
			const anchorIndex = anchorId != null ? orderIndex.get(anchorId) : undefined
			if (shiftRange === 'replace') {
				if (anchorIndex !== undefined) {
					setResolved([[Math.min(anchorIndex, index), Math.max(anchorIndex, index)]])
					emit()
					return
				}
				setResolved([[index, index]])
				anchorId = id
				emit()
				return
			}
			if (anchorIndex !== undefined) {
				addIndexRange(anchorIndex, index)
				emit()
				return
			}
		}
		if (isSelectedIndex(index)) removeIndex(index)
		else addIndexRange(index, index)
		anchorId = id
		emit()
	}

	/**
	 * 以锚点到目标替换 / 叠加一段连续区间（拖选路径：仅更新首尾）。
	 * @param {string} fromId 锚点 id
	 * @param {string} toId 目标 id
	 * @param {{ additive?: boolean }} [options] additive 为真时叠加而非替换
	 * @returns {boolean} 两端均可见时返回 true
	 */
	function setRangeFromAnchor(fromId, toId, { additive = false } = {}) {
		resolveOrder()
		const from = orderIndex.get(fromId)
		const to = orderIndex.get(toId)
		if (from === undefined || to === undefined) return false
		mode = true
		if (additive) addIndexRange(from, to)
		else setResolved([[Math.min(from, to), Math.max(from, to)]])
		emit()
		return true
	}

	/**
	 * 全选 / 取消全选当前有序项。
	 * @param {boolean} checked 是否全选
	 * @returns {void}
	 */
	function selectAll(checked) {
		const ids = resolveOrder()
		if (checked && ids.length) {
			setResolved([[0, ids.length - 1]])
			mode = true
		}
		else setResolved([])
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
		const ids = resolveOrder()
		const visible = new Set(visibleIds)
		const out = []
		for (const [a, b] of resolved) {
			let run = null
			for (let i = a; i <= b; i++) 
				if (visible.has(ids[i])) 
					if (run) run[1] = i
					else run = [i, i]
				
				else if (run) {
					out.push(run)
					run = null
				}
			
			if (run) out.push(run)
		}
		const before = resolved
		setResolved(out)
		if (before.length !== resolved.length || before.some((r, i) => r[0] !== resolved[i][0] || r[1] !== resolved[i][1]))
			emit()
	}

	/**
	 * 读取当前选中项列表（物化数组）。
	 * @returns {string[]} 选中项 id 列表
	 */
	function getSelected() {
		return [...iterateSelectedIds()]
	}

	/**
	 * 读取 Set-like 懒视图（`.has` / `.size` / 可迭代）。
	 * @returns {object} 选中视图
	 */
	function getSelectedView() {
		return selectedView
	}

	/**
	 * 读取区间段快照（诊断 / 测试用）。
	 * @returns {{ startId: string, endId: string }[]} 段列表
	 */
	function getSegments() {
		resolveOrder()
		return segments.map(seg => ({ ...seg }))
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
		setRangeFromAnchor,
		selectAll,
		setMode,
		clear,
		reconcile,
		setSelection,
		setItemSelected,
		isSelected,
		getSelected,
		getSelectedView,
		getSegments,
		getCount,
		getMode,
		getAnchor,
	}
}

/**
 * 绑定全局快捷键：Ctrl/⌘+A 全选、Ctrl/⌘+C 复制选中、Esc 退出选择模式。
 * @param {ReturnType<typeof createSelectionController>} controller 控制器
 * @param {object} [options] 选项
 * @param {() => void} [options.onEscape] Esc 回调（缺省退出选择模式）
 * @param {() => boolean} [options.canSelectAll] 是否允许全选（缺省允许）
 * @param {(controller: ReturnType<typeof createSelectionController>) => (boolean | void)} [options.onCopy] Ctrl/⌘+C 复制回调；返回 false 时不阻止默认行为
 * @param {(target: EventTarget | null) => boolean} [options.isEditableTarget] 可输入控件判定
 * @param {Document | HTMLElement} [options.target] 事件绑定目标（缺省 document）
 * @returns {() => void} 解绑函数
 */
export function bindSelectionShortcuts(controller, {
	onEscape,
	canSelectAll,
	onCopy,
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
		const mod = event.ctrlKey || event.metaKey
		if (mod && !event.altKey && event.key.toLowerCase() === 'a') {
			if (canSelectAll && !canSelectAll()) return
			event.preventDefault()
			controller.selectAll(true)
			return
		}
		if (mod && !event.altKey && event.key.toLowerCase() === 'c' && onCopy && controller.getMode() && controller.getCount()) {
			if (onCopy(controller) !== false) event.preventDefault()
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

/**
 * 绑定「原生文字选择跨项自动升变 + 拖选」：单项内的文字选择不受影响。
 * 指针拖过另一项或原生选区锚点 / 焦点落在不同项时，进入多选并把该段置为选中，
 * 之后拖动只更新首尾；贴近滚动容器边缘时自动滚动扩展。
 * @param {HTMLElement} container 列表容器
 * @param {object} options 配置
 * @param {string} options.itemSelector 可选中项选择器
 * @param {(element: HTMLElement) => string | null | undefined} options.getId 从项元素取 id
 * @param {ReturnType<typeof createSelectionController>} options.controller 控制器
 * @param {(target: EventTarget | null) => boolean} [options.shouldIgnore] 是否忽略起点（按钮 / 链接等）
 * @param {boolean} [options.autoScroll] 是否边缘自动滚动
 * @param {HTMLElement} [options.scrollContainer] 滚动容器（缺省同 container）
 * @param {number} [options.scrollThreshold] 触发自动滚动的边缘宽度
 * @returns {() => void} 解绑函数
 */
export function bindSelectionUpgrade(container, {
	itemSelector,
	getId,
	controller,
	shouldIgnore,
	autoScroll = true,
	scrollContainer = container,
	scrollThreshold = 48,
} = {}) {
	if (!(container instanceof HTMLElement) || !itemSelector || !controller) return () => { }

	let pointerDown = false
	let upgraded = false
	let startId = null
	let lastExtendedId = null
	let pointerX = 0
	let pointerY = 0
	let scrollRaf = 0
	let suppressSelectionChange = false

	/**
	 * @param {Node | null} node DOM 节点
	 * @returns {HTMLElement | null} 最近的项元素
	 */
	function rowFromNode(node) {
		if (!node) return null
		const el = node.nodeType === Node.ELEMENT_NODE ? /** @type {HTMLElement} */ node : node.parentElement
		const row = el?.closest?.(itemSelector)
		return row && container.contains(row) ? row : null
	}

	/**
	 * @param {Node | null} node DOM 节点
	 * @returns {string | null} 项 id
	 */
	function rowIdFromNode(node) {
		const row = rowFromNode(node)
		if (!row) return null
		const id = getId(row)
		return id == null || id === '' ? null : String(id)
	}

	/**
	 * @param {number} x 视口 x
	 * @param {number} y 视口 y
	 * @returns {string | null} 坐标下项 id
	 */
	function rowIdAtPoint(x, y) {
		return rowIdFromNode(document.elementFromPoint(x, y))
	}

	/** @returns {void} */
	function clearNativeSelection() {
		const selection = window.getSelection?.()
		if (selection && !selection.isCollapsed) selection.removeAllRanges()
	}

	/**
	 * @param {string} toId 目标项 id
	 * @returns {void}
	 */
	function extendRange(toId) {
		if (!startId || !toId || toId === startId || toId === lastExtendedId) return
		if (!controller.setRangeFromAnchor(startId, toId, { additive: false })) return
		lastExtendedId = toId
		upgraded = true
		suppressSelectionChange = true
		clearNativeSelection()
		suppressSelectionChange = false
	}

	/** @returns {void} */
	function stopAutoScroll() {
		if (scrollRaf) cancelAnimationFrame(scrollRaf)
		scrollRaf = 0
	}

	/** @returns {void} */
	function autoScrollStep() {
		scrollRaf = 0
		if (!pointerDown || !upgraded || !autoScroll) return
		const rect = scrollContainer.getBoundingClientRect()
		let delta = 0
		if (pointerY < rect.top + scrollThreshold)
			delta = -Math.max(4, (rect.top + scrollThreshold - pointerY) / 3)
		else if (pointerY > rect.bottom - scrollThreshold)
			delta = Math.max(4, (pointerY - (rect.bottom - scrollThreshold)) / 3)
		if (delta) {
			scrollContainer.scrollTop += delta
			const clampedY = Math.max(rect.top + 1, Math.min(rect.bottom - 1, pointerY))
			const id = rowIdAtPoint(pointerX, clampedY)
			if (id) extendRange(id)
		}
		scrollRaf = requestAnimationFrame(autoScrollStep)
	}

	/**
	 * @param {PointerEvent} event 指针按下
	 * @returns {void}
	 */
	function onPointerDown(event) {
		if (event.button !== 0) return
		if (shouldIgnore?.(event.target)) return
		const id = rowIdFromNode(event.target)
		if (!id) return
		pointerDown = true
		upgraded = false
		startId = id
		lastExtendedId = id
		pointerX = event.clientX
		pointerY = event.clientY
		window.addEventListener('pointermove', onPointerMove, true)
		window.addEventListener('pointerup', onPointerUp, true)
		window.addEventListener('pointercancel', onPointerUp, true)
	}

	/**
	 * @param {PointerEvent} event 指针移动
	 * @returns {void}
	 */
	function onPointerMove(event) {
		if (!pointerDown) return
		pointerX = event.clientX
		pointerY = event.clientY
		const id = rowIdAtPoint(event.clientX, event.clientY)
		if (id && id !== startId) {
			event.preventDefault()
			extendRange(id)
			if (autoScroll && !scrollRaf) scrollRaf = requestAnimationFrame(autoScrollStep)
		}
	}

	/**
	 * @param {PointerEvent} event 指针抬起 / 取消
	 * @returns {void}
	 */
	function onPointerUp(event) {
		if (!pointerDown) return
		pointerDown = false
		stopAutoScroll()
		window.removeEventListener('pointermove', onPointerMove, true)
		window.removeEventListener('pointerup', onPointerUp, true)
		window.removeEventListener('pointercancel', onPointerUp, true)
		if (upgraded && event.type === 'pointerup') {
			/**
			 * 吞掉拖选结束后紧跟的一次 click，避免误切换。
			 * @param {MouseEvent} clickEvent 拖选结束后的首次点击
			 * @returns {void}
			 */
			const swallow = clickEvent => {
				clickEvent.preventDefault()
				clickEvent.stopPropagation()
			}
			window.addEventListener('click', swallow, { capture: true, once: true })
			setTimeout(() => window.removeEventListener('click', swallow, true), 300)
		}
		startId = null
		lastExtendedId = null
		upgraded = false
	}

	/** @returns {void} */
	function onSelectionChange() {
		if (pointerDown || suppressSelectionChange || controller.getMode()) return
		const selection = window.getSelection?.()
		if (!selection || selection.isCollapsed || !selection.rangeCount) return
		const range = selection.getRangeAt(0)
		const start = rowIdFromNode(range.startContainer)
		const end = rowIdFromNode(range.endContainer)
		if (!start || !end || start === end) return
		suppressSelectionChange = true
		controller.setRangeFromAnchor(start, end, { additive: false })
		clearNativeSelection()
		suppressSelectionChange = false
	}

	container.addEventListener('pointerdown', onPointerDown)
	document.addEventListener('selectionchange', onSelectionChange)
	return () => {
		container.removeEventListener('pointerdown', onPointerDown)
		document.removeEventListener('selectionchange', onSelectionChange)
		stopAutoScroll()
	}
}
