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
}) {
	const state = {
		queue: [],
		startIndex: 0,
		totalCount: 0,
		isLoading: false,
		observer: null,
		sentinelTop: null,
		sentinelBottom: null,
		renderedElements: new Map(),
		bufferSize: 3,
		maxQueueSize: 0,
	}

	/**
	 * 更新动态缓冲区大小，并设置最大队列大小。
	 */
	function updateDynamicBufferSize() {
		if (state.renderedElements.size === 0) return

		let totalHeight = 0
		for (const element of state.renderedElements.values())
			totalHeight += element.clientHeight


		const avgHeight = totalHeight / state.renderedElements.size
		if (avgHeight > 0) {
			const viewportItemCount = Math.ceil(container.clientHeight / avgHeight)
			state.bufferSize = Math.max(3, viewportItemCount)
			state.maxQueueSize = state.bufferSize * 3
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
	 * 该函数通过计算视口中心的元素，并保留其周围的元素，
	 * 从而从队列的头部和尾部移除超出 `maxQueueSize` 限制的元素。
	 * 它在每次增量加载（prependItems/appendItems）或追加新项目时被调用。
	 */
	function pruneQueue() {
		if (state.queue.length <= state.maxQueueSize)
			return


		const midViewport = container.scrollTop + container.clientHeight / 2
		let closestIndex = -1
		let minDistance = Infinity

		for (const [index, element] of state.renderedElements.entries()) {
			const elementTop = element.offsetTop
			const distance = Math.abs(elementTop - midViewport)
			if (distance < minDistance) {
				minDistance = distance
				closestIndex = index
			}
		}
		if (closestIndex === -1) return

		const retainStart = Math.max(state.startIndex, closestIndex - Math.floor(state.maxQueueSize / 2))
		const retainEnd = Math.min(state.startIndex + state.queue.length - 1, closestIndex + Math.floor(state.maxQueueSize / 2))

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
		try {
			const firstItemIndex = state.startIndex
			if (firstItemIndex <= 0) return

			const oldFirstElement = state.renderedElements.get(firstItemIndex)
			const oldScrollTop = container.scrollTop

			const itemsToFetch = state.bufferSize
			const newStartIndex = Math.max(0, state.startIndex - itemsToFetch)
			const numItemsActuallyFetched = state.startIndex - newStartIndex
			if (numItemsActuallyFetched <= 0) return

			const { items: newItems } = await fetchData(newStartIndex, numItemsActuallyFetched)
			if (newItems?.length) {
				state.startIndex = newStartIndex
				state.queue = newItems.concat(state.queue)

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

				if (oldFirstElement) {
					// 计算滚动调整量：
					// oldFirstElement.offsetTop 是旧的第一个元素相对于其 offsetParent 顶部的距离。
					// (oldScrollTop - container.scrollTop) 是在添加新元素之前，由于 DOM 变化导致的容器滚动位置的瞬时变化。
					// scrollAdjustment 旨在抵消这个瞬时变化，确保用户感知的滚动位置不变。
					const scrollAdjustment = oldFirstElement.offsetTop - (oldScrollTop - container.scrollTop)
					// 恢复滚动位置：
					// oldScrollTop 是加载前容器的滚动位置。
					// (oldFirstElement.offsetTop - container.scrollTop - scrollAdjustment) 是旧的第一个元素的新位置与容器当前滚动位置的差值，
					// 减去 scrollAdjustment 以校正由于新内容插入导致的偏移。
					// oldFirstElement.getBoundingClientRect().top 是旧的第一个元素相对于视口顶部的距离，用于微调。
					// 综合这些，旨在精确地将滚动条设置回用户在加载新内容之前看到的位置。
					container.scrollTop = oldScrollTop + (oldFirstElement.offsetTop - container.scrollTop - scrollAdjustment) + oldFirstElement.getBoundingClientRect().top
				}

				pruneQueue()
			}
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 向下加载更多项目，并使用增量 DOM 更新。
	 */
	async function appendItems() {
		try {
			const currentCount = state.startIndex + state.queue.length
			if (currentCount >= state.totalCount) return

			const itemsToFetch = state.bufferSize
			const numItemsToFetch = Math.min(itemsToFetch, state.totalCount - currentCount)

			const { items: newItems } = await fetchData(currentCount, numItemsToFetch)
			if (newItems?.length) {
				const oldQueueLength = state.queue.length
				state.queue = state.queue.concat(newItems)

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
			}
		} finally {
			state.isLoading = false
			observeSentinels()
		}
	}

	/**
	 * 处理 IntersectionObserver 的回调。
	 * @param {IntersectionObserverEntry[]} entries - 交叉观察器条目数组。
	 */
	async function handleIntersection(entries) {
		if (state.isLoading) return
		const entry = entries.find(e => e.isIntersecting)
		if (!entry) return

		state.isLoading = true
		state.observer.disconnect()

		if (entry.target.id === 'sentinel-top')
			await prependItems()
		else if (entry.target.id === 'sentinel-bottom')
			await appendItems()

	}

	/**
	 * 初始化并启动对哨兵的观察。
	 */
	function observeSentinels() {
		if (!state.observer)
			state.observer = new IntersectionObserver(handleIntersection, {
				root: container,
				rootMargin: '500px 0px',
			})

		state.observer.disconnect()
		if (state.sentinelTop && state.startIndex > 0)
			state.observer.observe(state.sentinelTop)

		if (state.sentinelBottom && (state.startIndex + state.queue.length) < state.totalCount)
			state.observer.observe(state.sentinelBottom)

		state.isLoading = false
	}

	/**
	 * 强制刷新整个列表。
	 */
	async function refresh() {
		state.isLoading = true
		try {
			const { total } = await fetchData(0, 0)
			state.totalCount = total
			if (!total) {
				state.queue = []
				state.startIndex = 0
				await renderQueue()
				return
			}

			const initialBufferSize = state.bufferSize || 10
			const targetIndex = Math.max(0, Math.min(initialIndex, state.totalCount - 1))
			const fetchStartIndex = Math.max(0, targetIndex - initialBufferSize)
			const itemsToFetch = initialBufferSize * 2

			const { items } = await fetchData(fetchStartIndex, itemsToFetch)
			state.queue = items
			state.startIndex = fetchStartIndex

			await renderQueue()

			const targetElement = state.renderedElements.get(targetIndex)
			if (targetElement) {
				const scrollBlock = targetIndex > initialBufferSize ? 'center' : 'start'
				targetElement.scrollIntoView({ block: scrollBlock, behavior: 'instant' })
			} else if (initialIndex > 0)
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
			state.totalCount++
			const itemIndex = state.startIndex + state.queue.length
			state.queue.push(item)

			const newElement = await Promise.resolve(renderItem(item, itemIndex))
			if (newElement) {
				state.renderedElements.set(itemIndex, newElement)
				container.insertBefore(newElement, state.sentinelBottom)
			}

			pruneQueue()

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
		if (!state.queue[queueIndex]) {
			state.totalCount = Math.max(0, state.totalCount - 1)
			return
		}

		state.isLoading = true
		try {
			state.queue.splice(queueIndex, 1)
			state.totalCount--
			const element = state.renderedElements.get(index)
			element?.remove()
			state.renderedElements.delete(index)
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
		const queueIndex = index - state.startIndex
		if (!state.queue[queueIndex])
			return console.warn(`[virtualList] replaceItem called for index ${index} which is not in view.`)

		state.isLoading = true
		try {
			const oldElement = state.renderedElements.get(index)
			if (!oldElement) return

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
			const children = Array.from(container.children)
			const elementIndexInDom = children.indexOf(element)
			if (elementIndexInDom <= 0 || elementIndexInDom >= children.length - 1) return -1

			const queueIndex = elementIndexInDom - 1
			return state.queue[queueIndex] ? queueIndex : -1
		},
		/**
		 * 根据队列索引获取总日志索引。
		 * @param {number} queueIndex - 在当前队列中的索引。
		 * @returns {number} - 在总数据集中的绝对索引，如果无效则返回 -1。
		 */
		getChatLogIndexByQueueIndex: (queueIndex) => {
			if (!state.queue[queueIndex]) return -1
			return state.startIndex + queueIndex
		},
	}
}
