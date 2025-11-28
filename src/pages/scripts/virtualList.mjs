/**
 * @module virtualList
 * @description 提供一个通用的虚拟滚动列表解决方案，用于高效渲染大量数据。
 */
import { onElementRemoved } from './onElementRemoved.mjs'

/**
 * 创建一个哨兵元素，用于 IntersectionObserver。
 * @param {string} id - 哨兵元素的 ID。
 * @returns {HTMLDivElement} 创建的哨兵 div 元素。
 */
function createSentinel(id) {
	const sentinel = document.createElement('div')
	sentinel.id = id
	sentinel.style.height = '1px'
	sentinel.style.opacity = '0'
	sentinel.style.pointerEvents = 'none'
	return sentinel
}

/**
 * 创建并管理一个虚拟滚动列表。
 *
 * @param {object} options - 配置对象。
 * @param {HTMLElement} options.container - 将容纳列表并处理滚动的容器元素。
 * @param {function(number, number): Promise<{items: Array<object>, total: number}>} options.fetchData - 一个异步函数，用于获取数据块。它接收 `offset` 和 `limit` 作为参数，并应返回一个包含 `items` 数组和 `total` 数量的对象。
 * @param {function(object, number): (HTMLElement|Promise<HTMLElement>)} options.renderItem - 一个函数，用于将单个数据项渲染成 DOM 元素。它接收 `item` 和其在总数据集中的 `index`。
 * @param {number} [options.initialIndex=0] - 列表初始加载时要滚动到的项目索引。默认为 0 (列表开头)。
 * @param {function(): void} [options.onRenderComplete] - 每次队列渲染完成时调用的回调函数。
 * @param {function(HTMLElement, HTMLElement, object): (void|Promise<void>)} [options.replaceItemRenderer] - 一个可选的函数，用于自定义替换 DOM 元素的方式。接收 `oldElement`、`newElement` 和 `item`。默认为直接替换。
 * @param {boolean} [options.setInitialScroll=true] - 是否在初始加载时滚动到 `initialIndex` 指定的项目。默认为 true。
 * @returns {{
 *   destroy: function(): void,
 *   refresh: function(): Promise<void>,
 *   appendItem: function(object, boolean=): Promise<void>,
 *   deleteItem: function(number): Promise<void>,
 *   replaceItem: function(number, object): Promise<void>,
 *   getItem: function(number): object|null,
 *   getQueue: function(): Array<object>,
 *   getQueueIndex: function(HTMLElement): number,
 *   getChatLogIndexByQueueIndex: function(number): number
 * }} - 一个包含控制方法的虚拟列表实例。
 */
export function createVirtualList({
	container,
	fetchData,
	renderItem,
	initialIndex = 0,
	onRenderComplete = () => { },
	replaceItemRenderer = (oldElement, newElement) => oldElement.replaceWith(newElement),
	setInitialScroll = true,
}) {
	const state = {
		queue: [], // 当前加载的数据项队列
		startIndex: 0, // 队列在总数据集中的起始索引
		totalCount: 0, // 总数据项数量
		isLoading: false, // 是否正在加载数据
		observer: null, // IntersectionObserver 实例
		sentinelTop: null, // 上哨兵元素
		sentinelBottom: null, // 下哨兵元素
		renderedElements: new Map(), // 索引到 DOM 元素的映射
		bufferSize: 10, // 初始缓冲大小
		maxQueueSize: 0, // 最大队列大小，动态计算
		avgItemHeight: 0, // 平均项高度，用于动态缓冲
		resizeObserver: null, // ResizeObserver 用于容器大小变化
	}

	/**
	 * 获取加载锁，确保只有一个请求在进行中。
	 * @returns {Promise<void>} - 加载锁的 Promise。
	 */
	async function getMutex() {
		while (state.isLoading) await new Promise((resolve) => setTimeout(resolve, 100))
		return state.isLoading = true
	}

	/**
	 * 更新动态缓冲区大小和平均项高度。
	 */
	function updateDynamicBufferSize() {
		if (!state.renderedElements.size) return
		let totalHeight = 0
		for (const element of state.renderedElements.values())
			totalHeight += element.getBoundingClientRect().height // 使用更准确的 getBoundingClientRect

		state.avgItemHeight = totalHeight / state.renderedElements.size
		if (state.avgItemHeight) {
			const viewportItemCount = Math.ceil(container.clientHeight / state.avgItemHeight)
			state.bufferSize = Math.max(5, viewportItemCount + 5) // 增加最小缓冲以提高鲁棒性
			state.maxQueueSize = state.bufferSize * 3 // 保持3倍缓冲
		}
	}

	/**
	 * 对整个队列进行全量渲染。主要用于初始化或完全刷新。
	 */
	async function renderQueue() {
		const fragment = document.createDocumentFragment()
		state.renderedElements.clear()
		state.sentinelTop = createSentinel('sentinel-top')
		fragment.appendChild(state.sentinelTop)
		const renderPromises = state.queue.map((item, i) => {
			const itemIndex = state.startIndex + i
			return Promise.resolve(renderItem(item, itemIndex))
		})
		const elements = await Promise.all(renderPromises)
		elements.forEach((element, i) => {
			if (element) {
				const itemIndex = state.startIndex + i
				state.renderedElements.set(itemIndex, element)
				fragment.appendChild(element)
			}
		})
		state.sentinelBottom = createSentinel('sentinel-bottom')
		fragment.appendChild(state.sentinelBottom)
		container.innerHTML = ''
		container.appendChild(fragment)
		updateDynamicBufferSize()
		onRenderComplete()
	}

	/**
	 * 修剪队列，移除离视口太远的 DOM 元素以防止 DOM 无限增长。
	 * 如果队列长度未超过 maxQueueSize，则不进行修剪。
	 * 否则，确定一个“可见元素及缓冲区”的范围，
	 * 从而从队列的头部和尾部移除超出 maxQueueSize 限制的元素。
	 * 它在每次增量加载（prependItems/appendItems）或追加新项目时被调用。
	 */
	function pruneQueue() {
		if (state.queue.length <= state.maxQueueSize) return
		const viewportTop = container.scrollTop
		const viewportBottom = viewportTop + container.clientHeight
		let retainStart = state.startIndex
		let retainEnd = state.startIndex + state.queue.length - 1

		// 找到视口内的第一个和最后一个渲染元素
		for (const [index, element] of state.renderedElements.entries()) {
			const rect = element.getBoundingClientRect()
			const elementTop = rect.top + container.scrollTop // 绝对位置
			const elementBottom = elementTop + rect.height
			if (elementBottom > viewportTop && elementTop < viewportBottom) {
				retainStart = Math.min(retainStart, index)
				retainEnd = Math.max(retainEnd, index)
			}
		}

		// 扩展保留范围以包括缓冲
		retainStart = Math.max(state.startIndex, retainStart - state.bufferSize)
		retainEnd = Math.min(state.startIndex + state.queue.length - 1, retainEnd + state.bufferSize)

		// 移除头部多余元素
		for (let i = state.startIndex; i < retainStart; i++) {
			const element = state.renderedElements.get(i)
			element?.remove()
			state.renderedElements.delete(i)
		}
		const headCutCount = retainStart - state.startIndex
		if (headCutCount > 0) {
			state.queue.splice(0, headCutCount)
			state.startIndex = retainStart
		}

		// 移除尾部多余元素
		const queueEndIndex = state.startIndex + state.queue.length - 1
		for (let i = queueEndIndex; i > retainEnd; i--) {
			const element = state.renderedElements.get(i)
			element?.remove()
			state.renderedElements.delete(i)
		}
		const tailCutCount = queueEndIndex - retainEnd
		if (tailCutCount > 0)
			state.queue.splice(state.queue.length - tailCutCount, tailCutCount)
	}

	/**
	 * 向上加载更多项目，并使用增量 DOM 更新。
	 */
	async function prependItems() {
		if (state.startIndex <= 0) return
		await getMutex()
		try {
			const itemsToFetch = Math.min(state.bufferSize, state.startIndex)
			const newStartIndex = state.startIndex - itemsToFetch
			const { items: newItems } = await fetchData(newStartIndex, itemsToFetch)
			if (!newItems.length) return

			// 保存当前滚动锚点（第一个可见元素的相对位置）
			const anchorElement = state.sentinelTop.nextSibling
			const anchorTop = anchorElement?.getBoundingClientRect().top || 0

			state.startIndex = state.startIndex - newItems.length
			state.queue.unshift(...newItems)
			const newElementsFragment = document.createDocumentFragment()
			const renderPromises = newItems.map((item, i) => {
				const itemIndex = state.startIndex + i
				return Promise.resolve(renderItem(item, itemIndex))
			})
			const newElements = await Promise.all(renderPromises)
			newElements.forEach((element, i) => {
				if (element) {
					const itemIndex = state.startIndex + i
					state.renderedElements.set(itemIndex, element)
					newElementsFragment.appendChild(element)
				}
			})
			container.insertBefore(newElementsFragment, state.sentinelTop.nextSibling)

			// 恢复滚动位置
			const newAnchorTop = anchorElement.getBoundingClientRect().top
			container.scrollTop += newAnchorTop - anchorTop

			pruneQueue()
			updateDynamicBufferSize()
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 向下加载更多项目，并使用增量 DOM 更新。
	 */
	async function appendItems() {
		const currentCount = state.startIndex + state.queue.length
		if (currentCount >= state.totalCount) return
		await getMutex()
		try {
			const itemsToFetch = Math.min(state.bufferSize, state.totalCount - currentCount)
			const { items: newItems } = await fetchData(currentCount, itemsToFetch)
			if (!newItems.length) return

			const oldQueueLength = state.queue.length
			state.queue.push(...newItems)
			const newElementsFragment = document.createDocumentFragment()
			const renderPromises = newItems.map((item, i) => {
				const itemIndex = state.startIndex + oldQueueLength + i
				return Promise.resolve(renderItem(item, itemIndex))
			})
			const newElements = await Promise.all(renderPromises)
			newElements.forEach((element, i) => {
				if (element) {
					const itemIndex = state.startIndex + oldQueueLength + i
					state.renderedElements.set(itemIndex, element)
					newElementsFragment.appendChild(element)
				}
			})
			container.insertBefore(newElementsFragment, state.sentinelBottom)

			pruneQueue()
			updateDynamicBufferSize()
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 处理 IntersectionObserver 的回调。
	 * @param {IntersectionObserverEntry[]} entries - 交叉观察器条目数组。
	 */
	function handleIntersection(entries) {
		entries.forEach((entry) => {
			if (entry.isIntersecting && !state.isLoading) {
				state.observer.disconnect()
				if (entry.target.id === 'sentinel-top')
					prependItems()
				else if (entry.target.id === 'sentinel-bottom')
					appendItems()
			}
		})
	}

	/**
	 * 初始化并启动对哨兵的观察。
	 */
	function observeSentinels() {
		if (!state.observer)
			state.observer = new IntersectionObserver(handleIntersection, {
				root: container,
				rootMargin: `${container.clientHeight}px 0px`, // 动态 rootMargin 基于视口高度
				threshold: 0,
			})

		state.observer.disconnect()
		if (state.sentinelTop && state.startIndex > 0)
			state.observer.observe(state.sentinelTop)

		if (state.sentinelBottom && (state.startIndex + state.queue.length) < state.totalCount)
			state.observer.observe(state.sentinelBottom)
	}

	/**
	 * 强制刷新整个列表。
	 */
	async function refresh() {
		await getMutex()
		try {
			const { total } = await fetchData(0, 0)
			state.totalCount = total || 0
			if (!state.totalCount) {
				state.queue = []
				state.startIndex = 0
				await renderQueue()
				return
			}
			const targetIndex = Math.max(0, Math.min(initialIndex, state.totalCount - 1))
			const fetchStartIndex = Math.max(0, targetIndex - state.bufferSize)
			const itemsToFetch = Math.min(state.bufferSize * 3, state.totalCount - fetchStartIndex) // 初始加载更多以填充视口
			const { items } = await fetchData(fetchStartIndex, itemsToFetch)
			state.queue = items
			state.startIndex = fetchStartIndex
			await renderQueue()
			if (!setInitialScroll) return
			const targetElement = state.renderedElements.get(targetIndex)
			if (targetElement)
				targetElement.scrollIntoView({
					block: targetIndex === 0 ? 'start' : 'nearest',
					behavior: 'instant',
				})
			else
				container.scrollTop = container.scrollHeight
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 销毁列表实例，清理 DOM 和事件监听器。
	 */
	function destroy() {
		if (state.observer) state.observer.disconnect()
		if (state.resizeObserver) state.resizeObserver.disconnect()
		container.innerHTML = ''
		state.queue = []
		state.renderedElements.clear()
	}

	/**
	 * 在列表末尾追加一个项目。
	 * @param {object} item - 要追加的项目。
	 * @param {boolean} [scrollTo=true] - 是否滚动到新项目。
	 */
	async function appendItem(item, scrollTo = true) {
		await getMutex()
		try {
			state.totalCount++
			const itemIndex = state.startIndex + state.queue.length
			state.queue.push(item)
			const newElement = await Promise.resolve(renderItem(item, itemIndex))
			if (newElement) {
				state.renderedElements.set(itemIndex, newElement)
				container.insertBefore(newElement, state.sentinelBottom)
			}
			pruneQueue()
			updateDynamicBufferSize()
			if (scrollTo)
				newElement?.scrollIntoView({ behavior: 'smooth', block: 'end' }) // 平滑滚动
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 删除指定索引的项目。
	 * @param {number} index - 要删除的项目的绝对索引。
	 * 注意：如果项目不在当前队列中，仅减少 totalCount；否则，还会移除 DOM 并调整后续元素的索引映射。
	 */
	async function deleteItem(index) {
		if (index < 0 || index >= state.totalCount) return
		const queueIndex = index - state.startIndex
		if (!state.queue[queueIndex]) {
			state.totalCount = Math.max(0, state.totalCount - 1)
			return
		}
		await getMutex()
		try {
			state.queue.splice(queueIndex, 1)
			state.totalCount--
			const element = state.renderedElements.get(index)
			element?.remove()
			state.renderedElements.delete(index)
			// 调整后续元素的键
			for (let i = index + 1; i < state.startIndex + state.queue.length + 1; i++) {
				const elem = state.renderedElements.get(i)
				if (elem) {
					state.renderedElements.set(i - 1, elem)
					state.renderedElements.delete(i)
				}
			}
			updateDynamicBufferSize()
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 替换指定索引的项目。
	 * @param {number} index - 要替换的项目的绝对索引。
	 * @param {object} item - 新的项目。
	 * @returns {Promise<void>}
	 */
	async function replaceItem(index, item) {
		if (!item) throw new Error('item is required')
		if (index < 0 || index >= state.totalCount) return
		const queueIndex = index - state.startIndex
		if (!state.queue[queueIndex]) {
			console.warn(`[virtualList] replaceItem called for index ${index} which is not in view.`)
			return
		}
		await getMutex()
		try {
			const oldElement = state.renderedElements.get(index)
			if (!oldElement) return
			const newElement = await Promise.resolve(renderItem(item, index))
			await Promise.resolve(replaceItemRenderer(oldElement, newElement, item))
			state.queue[queueIndex] = item
			state.renderedElements.set(index, newElement)
			updateDynamicBufferSize()
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	// 初始化 ResizeObserver 以处理容器大小变化
	state.resizeObserver = new ResizeObserver(() => {
		updateDynamicBufferSize()
		observeSentinels()
	})
	state.resizeObserver.observe(container)

	// 初始刷新
	refresh()
	onElementRemoved(container, destroy)

	return {
		destroy,
		refresh,
		appendItem,
		deleteItem,
		replaceItem,
		/**
		 * 获取指定索引的数据项。
		 * @param {number} index - 在总数据集中的索引。
		 * @returns {object|null} - 找到的数据项，如果索引超出范围则返回 null。
		 */
		getItem: (index) => {
			const queueIndex = index - state.startIndex
			return state.queue[queueIndex] || null
		},
		/**
		 * 获取当前在 DOM 中的项目队列。
		 * @returns {Array<object>} - 当前渲染的项目数组。
		 */
		getQueue: () => state.queue,
		/**
		 * 获取给定 DOM 元素的队列索引。
		 * @param {HTMLElement} element - 列表中的 DOM 元素。
		 * @returns {number} - 元素在当前队列中的索引，如果未找到则返回 -1。
		 */
		getQueueIndex: (element) => {
			for (const [index, el] of state.renderedElements.entries())
				if (el === element)
					return index - state.startIndex
			return -1
		},
		/**
		 * 根据队列索引获取总日志索引。
		 * @param {number} queueIndex - 在当前队列中的索引。
		 * @returns {number} - 在总数据集中的绝对索引，如果无效则返回 -1。
		 */
		getChatLogIndexByQueueIndex: (queueIndex) => {
			return state.queue[queueIndex] ? state.startIndex + queueIndex : -1
		},
	}
}
