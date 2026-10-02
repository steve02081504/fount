/**
 * 横向包 rail、分区与表情网格行的有界窗口：包元数据常驻内存，屏外按钮与图片不挂载。
 * 几何与 emojiPicker.css 一致：36px 格、4px 间距、32px 分组标题。
 * @param {object} options 渲染回调与容器。
 * @param {HTMLElement} options.rail 横向视口。
 * @param {HTMLElement} options.scroll 纵向视口。
 * @param {object[]} options.sections 分区元数据。
 * @param {Function} options.renderRail rail 按钮工厂。
 * @param {Function} options.renderSection 分区外壳工厂。
 * @param {Function} options.appendItem 表情按钮工厂。
 * @param {Function} options.onActive 活动分区回调。
 * @returns {{ jump: (id: string) => void, destroy: () => void }} 导航与清理句柄。
 */
export function createEmojiPickerWindow({ rail, scroll, sections, renderRail, renderSection, appendItem, onActive }) {
	/** 表情格边长、间距；rail 项宽 32。 */
	const CELL = 36
	const GAP = 4
	const PITCH = CELL + GAP
	const SUMMARY = 32
	const RAIL_PITCH = 32 + GAP
	/** `.emoji-scroll` 左右内边距合计。 */
	const SCROLL_PADDING = 16
	const collapsed = new Set()
	const mounted = new Map()
	const railMounted = new Map()
	const railTrack = document.createElement('div')
	railTrack.className = 'emoji-rail-track'
	railTrack.style.width = `${sections.length * RAIL_PITCH}px`
	rail.append(railTrack)
	const content = document.createElement('div')
	content.className = 'emoji-window-content'
	scroll.append(content)
	let layout = []
	let columns = 1
	let frame = 0
	let destroyed = false
	let activeId = null

	/** 仅按几何重算偏移，不构造屏外 DOM。 */
	function measure() {
		columns = Math.max(1, Math.floor((scroll.clientWidth - SCROLL_PADDING + GAP) / PITCH))
		let top = 0
		layout = sections.map(section => {
			const rows = Math.max(1, Math.ceil(section.items.length / columns))
			const height = SUMMARY + (collapsed.has(section.id) ? 0 : rows * PITCH)
			const entry = { section, top, height, rows }
			top += height
			return entry
		})
		content.style.height = `${top}px`
	}

	/** 只对 rail 视口做差量挂载，并保留获得焦点的按钮。 */
	function paintRail() {
		const start = Math.max(0, Math.floor(rail.scrollLeft / RAIL_PITCH) - 3)
		const end = Math.min(sections.length, Math.ceil((rail.scrollLeft + rail.clientWidth) / RAIL_PITCH) + 3)
		for (const [index, button] of railMounted)
			if ((index < start || index >= end) && button !== document.activeElement) {
				button.remove()
				railMounted.delete(index)
			}
		for (let index = start; index < end; index++) {
			let button = railMounted.get(index)
			if (!button) {
				button = renderRail(sections[index])
				button.style.left = `${index * RAIL_PITCH}px`
				const next = [...railMounted].filter(([mountedIndex]) => mountedIndex > index).sort((a, b) => a[0] - b[0])[0]?.[1]
				railTrack.insertBefore(button, next || null)
				railMounted.set(index, button)
			}
		}
		for (const button of railMounted.values()) {
			const active = button.dataset.section === activeId
			button.classList.toggle('emoji-rail-active', active)
			button.setAttribute('aria-current', String(active))
		}
	}

	/** 差量挂载可见分区，大包内只挂载邻近行。 */
	function paint() {
		if (destroyed) return
		const viewport = scroll.clientHeight || 280
		const start = Math.max(0, scroll.scrollTop - viewport)
		const end = scroll.scrollTop + viewport * 2
		const active = layout.find(entry => entry.top + entry.height > scroll.scrollTop)
		activeId = active?.section.id
		onActive(active?.section)
		for (const [id, element] of mounted) {
			const entry = layout.find(item => item.section.id === id)
			if (entry && entry.top <= end && entry.top + entry.height >= start) continue
			if (element.contains(document.activeElement)) {
				// 保留焦点分区：只同步列数，避免屏外分区残留旧列造成横向溢出；滚回可视区时会重建。
				element.querySelector('.emoji-grid').style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
				continue
			}
			element.remove()
			mounted.delete(id)
		}
		for (const entry of layout) {
			const { section, top, height, rows } = entry
			if (top > end || top + height < start) continue
			let element = mounted.get(section.id)
			if (!element) {
				element = renderSection(section)
				element.open = !collapsed.has(section.id)
				const next = layout.slice(layout.indexOf(entry) + 1).find(item => mounted.has(item.section.id))
				content.insertBefore(element, next ? mounted.get(next.section.id) : null)
				mounted.set(section.id, element)
				element.addEventListener('toggle', () => {
					if (destroyed || !element.isConnected || element.open === !collapsed.has(section.id)) return
					if (element.open) collapsed.delete(section.id)
					else collapsed.add(section.id)
					measure()
					paint()
				})
			}
			element.style.top = `${top}px`
			element.style.height = `${height}px`
			const grid = element.querySelector('.emoji-grid')
			if (collapsed.has(section.id)) continue
			const firstRow = Math.max(0, Math.floor((start - top - SUMMARY) / PITCH))
			const lastRow = Math.min(rows, Math.ceil((end - top - SUMMARY) / PITCH))
			const signature = `${columns}:${firstRow}:${lastRow}`
			if (grid.dataset.window === signature) continue
			grid.dataset.window = signature
			grid.replaceChildren()
			grid.style.paddingTop = `${firstRow * PITCH}px`
			grid.style.paddingBottom = `${Math.max(0, rows - lastRow) * PITCH}px`
			grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
			if (!section.items.length) {
				const empty = document.createElement('div')
				empty.className = 'emoji-grid-empty'
				empty.dataset.i18n = 'chat.emoji.emptyPack'
				grid.append(empty)
			}
			else for (let i = firstRow * columns; i < Math.min(section.items.length, lastRow * columns); i++)
				appendItem(grid, section.items[i])
		}
		paintRail()
	}

	/** 把滚轮/触摸滚动更新合并到一帧。 */
	function schedule() {
		if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint() })
	}

	/**
	 * 用键盘在虚拟化 rail 项间导航。
	 * @param {KeyboardEvent} event 键盘输入。
	 * @returns {void}
	 */
	function navigateRail(event) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		const button = event.target.closest('[data-section]')
		if (!button) return
		event.preventDefault()
		const current = sections.findIndex(section => section.id === button.dataset.section)
		const index = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
			: Math.max(0, Math.min(sections.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)))
		rail.scrollLeft = Math.max(0, index * RAIL_PITCH - rail.clientWidth / 2)
		paintRail()
		railMounted.get(index)?.focus({ preventScroll: true })
	}
	scroll.addEventListener('scroll', schedule, { passive: true })
	rail.addEventListener('scroll', schedule, { passive: true })
	rail.addEventListener('keydown', navigateRail)
	const observer = new ResizeObserver(() => { measure(); paint() })
	observer.observe(scroll)
	observer.observe(rail)
	measure()
	paint()
	return {
		/**
		 * 展开并跳转，不要求目标已挂载。
		 * @param {string} id 分区标识。
		 * @returns {void}
		 */
		jump(id) {
			const index = sections.findIndex(section => section.id === id)
			if (index < 0) return
			collapsed.delete(id)
			const element = mounted.get(id)
			if (element) element.open = true
			measure()
			scroll.scrollTop = layout[index].top
			rail.scrollLeft = Math.max(0, index * RAIL_PITCH - rail.clientWidth / 2)
			paint()
		},
		/** 释放观察者与已排期的渲染。 */
		destroy() {
			destroyed = true
			observer.disconnect()
			cancelAnimationFrame(frame)
			scroll.removeEventListener('scroll', schedule)
			rail.removeEventListener('scroll', schedule)
			rail.removeEventListener('keydown', navigateRail)
			mounted.clear()
			railMounted.clear()
		},
	}
}
