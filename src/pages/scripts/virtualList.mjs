/**
 * @module virtualList
 * @description 提供一个通用的虚拟滚动列表解决方案，用于高效渲染大量数据。
 */
import { onElementRemoved } from './onElementRemoved.mjs'
/**
 * 创建一个哨兵元素，用于 IntersectionObserver。
 * @param {string} id - 哨兵元素的 ID。
 * @returns {HTMLDivElement} 创建的哨兵 div 元素。
 * @private
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
 * @returns {{
 *   destroy: function(): void,
 *   refresh: function(): Promise<void>,
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
	initialIndex = 0, // Default to 0 for standard lists
	onRenderComplete = () => { },
	replaceItemRenderer = (oldElement, newElement) => oldElement.replaceWith(newElement),
}) {
	const state = {
		queue: [],
		startIndex: 0,
		totalCount: 0,
		isLoading: false,
		observer: null,
		sentinelTop: null,
		sentinelBottom: null,
		// 存储每个渲染项对应的DOM元素，用于滚动位置恢复
		renderedElements: new Map(),
		bufferSize: 3,
	}

	/**
	 * 更新动态缓冲区大小。
	 */
	function updateDynamicBufferSize() {
		if (!state.renderedElements.size) return

		const totalHeight = state.renderedElements.reduce((total, element) => total + element.clientHeight, 0)
		const avgHeight = totalHeight / state.renderedElements.size
		if (avgHeight > 0) {
			const viewportItemCount = Math.ceil(container.clientHeight / avgHeight)
			state.bufferSize = Math.max(3, viewportItemCount)
		}
	}

	/**
	 * 渲染当前队列中的项目。
	 * @private
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
	 * 向上加载更多项目。
	 * @private
	 */
	async function prependItems() {
		try {
			const firstItemIndex = state.startIndex
			if (firstItemIndex <= 0)
				return

			const oldFirstElement = state.renderedElements.get(firstItemIndex)
			const oldScrollTop = container.scrollTop
			const oldFirstElementRect = oldFirstElement?.getBoundingClientRect()
			const itemsToFetch = state.bufferSize
			const newStartIndex = Math.max(0, state.startIndex - itemsToFetch)
			const numItemsActuallyFetched = state.startIndex - newStartIndex
			if (numItemsActuallyFetched <= 0)
				return

			const { items: newItems } = await fetchData(newStartIndex, numItemsActuallyFetched)
			if (newItems?.length) {
				state.startIndex = newStartIndex
				state.queue = newItems.concat(state.queue)
				// 保持队列大小，裁剪尾部
				if (state.queue.length > 3 * state.bufferSize)
					state.queue.splice(3 * state.bufferSize)

				await renderQueue()
				// 恢复滚动位置
				const newFirstElementCorrespondingToOld = state.renderedElements.get(firstItemIndex)
				if (newFirstElementCorrespondingToOld && oldFirstElementRect) {
					const newFirstElementRect = newFirstElementCorrespondingToOld.getBoundingClientRect()
					const scrollAdjustment = newFirstElementRect.top - oldFirstElementRect.top
					container.scrollTop = oldScrollTop + scrollAdjustment
				}
			}
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}
	/**
	 * 向下加载更多项目。
	 * @private
	 */
	async function appendItems() {
		try {
			const currentCount = state.startIndex + state.queue.length
			if (currentCount >= state.totalCount)
				return

			const itemsToFetch = state.bufferSize
			const numItemsToFetch = Math.min(itemsToFetch, state.totalCount - currentCount)

			const { items: newItems } = await fetchData(currentCount, numItemsToFetch)
			if (newItems?.length) {
				state.queue = state.queue.concat(newItems)
				// 保持队列大小，裁剪头部
				if (state.queue.length > 3 * state.bufferSize) {
					const excess = state.queue.length - (3 * state.bufferSize)
					state.queue.splice(0, excess)
					state.startIndex += excess
				}
				await renderQueue()
			}
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}
	/**
	 * 处理 IntersectionObserver 的回调。
	 * @param {IntersectionObserverEntry[]} entries - 交叉观察器条目数组。
	 * @private
	 */
	async function handleIntersection(entries) {
		if (state.isLoading) return

		const entry = entries.find(e => e.isIntersecting)
		if (!entry) return

		state.isLoading = true
		state.observer.disconnect() // 停止观察，防止重复触发

		if (entry.target.id === 'sentinel-top')
			await prependItems()
		else if (entry.target.id === 'sentinel-bottom')
			await appendItems()

	}

	/**
	 * 初始化并启动对哨兵的观察。
	 * @private
	 */
	function observeSentinels() {
		if (!state.observer)
			state.observer = new IntersectionObserver(handleIntersection, {
				root: container,
				rootMargin: '500px 0px', // 预加载边距
			})

		state.observer.disconnect()

		// 只有在有项目可前置时才观察顶部哨兵
		if (state.sentinelTop && state.startIndex > 0)
			state.observer.observe(state.sentinelTop)

		// 只有在有项目可追加时才观察底部哨兵
		if (state.sentinelBottom && (state.startIndex + state.queue.length) < state.totalCount)
			state.observer.observe(state.sentinelBottom)

		state.isLoading = false
	}

	/**
	 * 强制刷新整个列表。
	 * @public
	 */
	async function refresh() {
		state.isLoading = true
		try {
			const { total } = await fetchData(0, 0) // Get total count
			state.totalCount = total
			if (total === 0) {
				state.queue = []
				state.startIndex = 0
				await renderQueue()
				return
			}

			// Determine start index for fetching, respecting buffer
			const targetIndex = Math.max(0, Math.min(initialIndex, state.totalCount - 1))
			const fetchStartIndex = Math.max(0, targetIndex - state.bufferSize)
			const itemsToFetch = state.bufferSize * 2

			const { items } = await fetchData(fetchStartIndex, itemsToFetch)
			state.queue = items
			state.startIndex = fetchStartIndex

			await renderQueue()

			// Scroll into position
			const targetElement = state.renderedElements.get(targetIndex)
			if (targetElement) {
				const scrollBlock = targetIndex > state.bufferSize ? 'center' : 'start'
				targetElement.scrollIntoView({ block: scrollBlock, behavior: 'instant' })
			} else if (initialIndex > 0)
				// Fallback for chat view if element not found
				container.scrollTop = container.scrollHeight
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 *
	 */
	function destroy() {
		if (state.observer)
			state.observer.disconnect()

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
		state.isLoading = true
		try {
			state.queue.push(item)
			state.totalCount++

			if (state.queue.length > 3 * state.bufferSize) {
				const excess = state.queue.length - (3 * state.bufferSize)
				state.queue.splice(0, excess)
				state.startIndex += excess
			}

			await renderQueue()

			if (scrollTo)
				container.scrollTop = container.scrollHeight

		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 删除指定索引的项目。
	 * @param {number} index - 要删除的项目的绝对索引。
	 */
	async function deleteItem(index) {
		const queueIndex = index - state.startIndex
		if (queueIndex < 0 || queueIndex >= state.queue.length) {
			// Item is not in view, just refresh to get correct counts
			await refresh()
			return
		}

		state.isLoading = true
		try {
			state.queue.splice(queueIndex, 1)
			state.totalCount--
			await renderQueue()
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
		 * 替换指定索引的项目。
		 * @param {number} index - 要替换的项目的绝对索引。
		 * @param {object} item - 新的项目。
		 */
	async function replaceItem(index, item) {
		const queueIndex = index - state.startIndex
		if (queueIndex < 0 || queueIndex >= state.queue.length) {
			console.warn(`[virtualList] replaceItem called for index ${index} which is not in view.`)
			await refresh()
			return
		}

		state.isLoading = true
		try {
			const oldElement = state.renderedElements.get(index)
			const newElement = await Promise.resolve(renderItem(item, index))

			await Promise.resolve(replaceItemRenderer(oldElement, newElement, item))

			state.queue[queueIndex] = item
			state.renderedElements.set(index, newElement)
		}
		finally {
			state.isLoading = false
		}
	}

	// 初始化
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
			if (queueIndex >= 0 && queueIndex < state.queue.length)
				return state.queue[queueIndex]

			return null
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
			const elementIndexInDom = Array.from(container.children).indexOf(element)
			if (elementIndexInDom <= 0 || elementIndexInDom >= container.children.length - 1) return -1
			const queueIndex = elementIndexInDom - 1
			return queueIndex >= 0 && queueIndex < state.queue.length ? queueIndex : -1
		},
		/**
			 * 根据队列索引获取总日志索引。
			 * @param {number} queueIndex - 在当前队列中的索引。
			 * @returns {number} - 在总数据集中的绝对索引，如果无效则返回 -1。
			 */
		getChatLogIndexByQueueIndex: (queueIndex) => {
			if (queueIndex < 0 || queueIndex >= state.queue.length) return -1
			return state.startIndex + queueIndex
		},
	}
}
