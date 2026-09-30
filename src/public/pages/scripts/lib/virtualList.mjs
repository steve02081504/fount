/**
 * 虚拟滚动列表
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
 * @param {function(HTMLElement, HTMLElement, object): (HTMLElement|void|Promise<HTMLElement|void>)} [options.replaceItemRenderer] - 自定义替换 DOM；原地更新时返回保留的元素，默认直接替换。
 * @param {boolean} [options.setInitialScroll=true] - 是否在初始加载时滚动到 `initialIndex` 指定的项目。默认为 true。
 * @param {() => Promise<number>} [options.loadMoreTop] - 当 `startIndex` 为 0 时向上扩展数据源；返回新增加的条数。
 * @param {(item: object) => string} [options.getItemKey] - 可选；提供时 refresh 用键控 DOM 复用，避免全量 innerHTML 重建。
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
	loadMoreTop = null,
	getItemKey = null,
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
		/** @type {Map<string, { element: HTMLElement, itemJson: string }>} */
		keyedCache: new Map(), // getItemKey 模式下的 DOM 复用缓存
		hasRenderedOnce: false, // 是否已完成过至少一次渲染（控制是否再做 initialIndex 滚动）
		bufferSize: 10, // 初始缓冲大小
		maxQueueSize: 0, // 最大队列大小，动态计算
		avgItemHeight: 0, // 平均项高度，用于动态缓冲
		resizeObserver: null, // ResizeObserver 用于容器大小变化
		waiters: [], // 等待加载锁的 resolve 队列（先到先得，无忙等）
		destroyed: false, // 是否已销毁；销毁后在途操作不得再触碰 DOM/状态
		removeListenerCleanup: null, // onElementRemoved 返回的清理函数
	}

	/**
	 * 获取加载锁，确保只有一个请求在进行中。
	 * 锁空闲时立即获得；否则排队等待，锁释放时按序唤醒（不轮询）。
	 * @returns {Promise<void>} - 加载锁的 Promise。
	 */
	async function getMutex() {
		if (state.destroyed) return
		if (state.isLoading)
			await new Promise((resolve) => state.waiters.push(resolve))
		else
			state.isLoading = true
	}

	/**
	 * 释放加载锁；有等待者时把锁直接移交给队首，否则置空。
	 * @returns {void}
	 */
	function releaseMutex() {
		if (state.destroyed) {
			state.isLoading = false
			return
		}
		const next = state.waiters.shift()
		if (next) next()
		else state.isLoading = false
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
	 * 键控 reconcile：按 getItemKey 复用未变 DOM，仅重画变更项。
	 * @returns {Promise<void>}
	 */
	async function reconcileKeyedQueue() {
		const prevCache = state.keyedCache
		const nextCache = new Map()
		const nextRendered = new Map()

		if (!state.sentinelTop || !container.contains(state.sentinelTop)) {
			state.sentinelTop = createSentinel('sentinel-top')
			container.prepend(state.sentinelTop)
		}
		if (!state.sentinelBottom || !container.contains(state.sentinelBottom)) {
			state.sentinelBottom = createSentinel('sentinel-bottom')
			container.appendChild(state.sentinelBottom)
		}

		const renderJobs = state.queue.map((item, i) => {
			const itemIndex = state.startIndex + i
			const key = String(getItemKey(item))
			const itemJson = JSON.stringify(item)
			const cached = prevCache.get(key)
			if (cached && cached.itemJson === itemJson)
				return Promise.resolve({ itemIndex, key, itemJson, element: cached.element, reused: true })
			return Promise.resolve(renderItem(item, itemIndex)).then(element => ({
				itemIndex, key, itemJson, element, item, reused: false, oldElement: cached?.element,
			}))
		})
		const results = await Promise.all(renderJobs)
		if (state.destroyed) return

		let insertBefore = state.sentinelTop.nextSibling
		for (const result of results) {
			if (!result?.element) continue
			const { itemIndex, key, itemJson, reused, oldElement, item } = result
			let { element } = result
			if (!reused && oldElement && oldElement !== element && container.contains(oldElement)) {
				element = await replaceItemRenderer(oldElement, element, item) ?? element
				if (state.destroyed) return
				if (insertBefore === oldElement) insertBefore = element
			}
			// 已在正确位置的节点不得重新插入：移动也会打断文字选择/媒体状态。
			if (element !== insertBefore)
				container.insertBefore(element, insertBefore)
			insertBefore = element.nextSibling
			nextCache.set(key, { element, itemJson })
			nextRendered.set(itemIndex, element)
		}

		for (const [key, { element }] of prevCache) {
			if (nextCache.has(key)) continue
			element.remove()
		}

		// 清理哨兵之间多余节点（非本次队列、非哨兵）
		let node = state.sentinelTop.nextSibling
		const keep = new Set(nextRendered.values())
		while (node && node !== state.sentinelBottom) {
			const next = node.nextSibling
			if (!keep.has(node)) node.remove()
			node = next
		}

		state.keyedCache = nextCache
		state.renderedElements = nextRendered
		updateDynamicBufferSize()
		onRenderComplete()
	}

	/**
	 * 对整个队列进行全量渲染。
	 * 主要用于初始化或完全刷新。
	 */
	async function renderQueue() {
		if (getItemKey) {
			await reconcileKeyedQueue()
			return
		}
		const fragment = document.createDocumentFragment()
		state.renderedElements.clear()
		state.sentinelTop = createSentinel('sentinel-top')
		fragment.appendChild(state.sentinelTop)
		const renderPromises = state.queue.map((item, i) => {
			const itemIndex = state.startIndex + i
			return Promise.resolve(renderItem(item, itemIndex))
		})
		const elements = await Promise.all(renderPromises)
		if (state.destroyed) return
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
	 * 否则，确定一个「可见元素及缓冲区」的范围，
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
			if (element && getItemKey)
				for (const [key, cached] of state.keyedCache)
					if (cached.element === element) {
						state.keyedCache.delete(key)
						break
					}

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
			if (element && getItemKey)
				for (const [key, cached] of state.keyedCache)
					if (cached.element === element) {
						state.keyedCache.delete(key)
						break
					}

			element?.remove()
			state.renderedElements.delete(i)
		}
		const tailCutCount = queueEndIndex - retainEnd
		if (tailCutCount > 0)
			state.queue.splice(state.queue.length - tailCutCount, tailCutCount)
	}

	/**
	 * 在顶部插入已渲染 DOM，可选平移既有 renderedElements 索引，并恢复滚动锚点。
	 * @param {Array<object>} newItems - 待插入的数据项。
	 * @param {(number) => number} itemIndexFor - 将 newItems 下标映射为绝对索引。
	 * @param {{ reindexShift?: number }} [options] - reindexShift 非 0 时整体平移已有 renderedElements 键。
	 * @returns {Promise<boolean>} - 插入成功为 true；哨兵已不在容器时为 false。
	 */
	async function insertPrependedItems(newItems, itemIndexFor, { reindexShift = 0 } = {}) {
		const anchorElement = state.sentinelTop?.nextSibling
		const anchorTop = anchorElement?.getBoundingClientRect().top
		const newElementsFragment = document.createDocumentFragment()
		const newElements = await Promise.all(
			newItems.map((item, i) => Promise.resolve(renderItem(item, itemIndexFor(i))))
		)
		if (state.destroyed) return false
		if (!container.contains(state.sentinelTop)) return false
		if (reindexShift) {
			const nextRendered = new Map()
			for (const [idx, el] of state.renderedElements.entries())
				nextRendered.set(idx + reindexShift, el)
			state.renderedElements = nextRendered
		}
		newElements.forEach((element, i) => {
			if (element) {
				state.renderedElements.set(itemIndexFor(i), element)
				if (getItemKey)
					state.keyedCache.set(String(getItemKey(newItems[i])), { element, itemJson: JSON.stringify(newItems[i]) })
				newElementsFragment.appendChild(element)
			}
		})
		container.insertBefore(newElementsFragment, state.sentinelTop.nextSibling)
		if (anchorElement)
			container.scrollTop += anchorElement.getBoundingClientRect().top - anchorTop
		pruneQueue()
		updateDynamicBufferSize()
		onRenderComplete()
		return true
	}

	/**
	 * 向上加载更多项目，并使用增量 DOM 更新。
	 */
	async function prependItems() {
		if (state.startIndex <= 0 && !loadMoreTop) return
		await getMutex()
		try {
			if (state.destroyed) return
			if (state.startIndex <= 0) {
				const added = await loadMoreTop()
				if (state.destroyed) return
				if (!added) return
				const { total, items: newItems } = await fetchData(0, added)
				if (state.destroyed) return
				state.totalCount = total
				if (!newItems.length) return
				state.startIndex = 0
				state.queue.unshift(...newItems)
				await insertPrependedItems(newItems, (i) => i, { reindexShift: newItems.length })
				return
			}
			const itemsToFetch = Math.min(state.bufferSize, state.startIndex)
			const newStartIndex = state.startIndex - itemsToFetch
			const { items: newItems } = await fetchData(newStartIndex, itemsToFetch)
			if (state.destroyed) return
			if (!newItems.length) return
			state.startIndex = state.startIndex - newItems.length
			state.queue.unshift(...newItems)
			await insertPrependedItems(newItems, (i) => state.startIndex + i)
		} finally {
			releaseMutex()
			if (!state.destroyed) observeSentinels()
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
			if (state.destroyed) return
			const itemsToFetch = Math.min(state.bufferSize, state.totalCount - currentCount)
			const { items: newItems } = await fetchData(currentCount, itemsToFetch)
			if (state.destroyed) return
			if (!newItems.length) return

			const oldQueueLength = state.queue.length
			state.queue.push(...newItems)
			const newElementsFragment = document.createDocumentFragment()
			const renderPromises = newItems.map((item, i) => {
				const itemIndex = state.startIndex + oldQueueLength + i
				return Promise.resolve(renderItem(item, itemIndex))
			})
			const newElements = await Promise.all(renderPromises)
			if (state.destroyed) return
			if (!container.contains(state.sentinelBottom)) return
			newElements.forEach((element, i) => {
				if (element) {
					const itemIndex = state.startIndex + oldQueueLength + i
					state.renderedElements.set(itemIndex, element)
					if (getItemKey)
						state.keyedCache.set(String(getItemKey(newItems[i])), { element, itemJson: JSON.stringify(newItems[i]) })
					newElementsFragment.appendChild(element)
				}
			})
			container.insertBefore(newElementsFragment, state.sentinelBottom)

			pruneQueue()
			updateDynamicBufferSize()
			onRenderComplete()
		} finally {
			releaseMutex()
			if (!state.destroyed) observeSentinels()
		}
	}

	/**
	 * 处理 IntersectionObserver 的回调。
	 * @param {IntersectionObserverEntry[]} entries - 交叉观察器条目数组。
	 */
	function handleIntersection(entries) {
		if (state.destroyed) return
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
		if (state.destroyed) return
		if (!state.observer)
			state.observer = new IntersectionObserver(handleIntersection, {
				root: container,
				rootMargin: `${container.clientHeight}px 0px`, // 动态 rootMargin 基于视口高度
				threshold: 0,
			})

		state.observer.disconnect()
		if (state.sentinelTop && (state.startIndex > 0 || loadMoreTop))
			state.observer.observe(state.sentinelTop)

		if (state.sentinelBottom && (state.startIndex + state.queue.length) < state.totalCount)
			state.observer.observe(state.sentinelBottom)
	}

	/**
	 * 强制刷新整个列表（先获取加载锁）。
	 * @returns {Promise<void>}
	 */
	async function refresh() {
		await getMutex()
		try {
			await refreshUnlocked()
		} finally {
			releaseMutex()
			if (!state.destroyed) observeSentinels()
		}
	}

	/**
	 * 全量刷新的实际逻辑；调用方必须已持有加载锁，本函数不负责释放或重挂哨兵。
	 * @returns {Promise<void>}
	 */
	async function refreshUnlocked() {
		const { total } = await fetchData(0, 0)
		if (state.destroyed) return
		state.totalCount = total
		if (!state.totalCount) {
			state.queue = []
			state.startIndex = 0
			await renderQueue()
			state.hasRenderedOnce = true
			return
		}
		const keepScroll = getItemKey && state.hasRenderedOnce
		const savedScrollTop = keepScroll ? container.scrollTop : 0
		const targetIndex = Math.max(0, Math.min(initialIndex, state.totalCount - 1))
		let fetchStartIndex = keepScroll && state.queue.length
			? state.startIndex
			: Math.max(0, targetIndex - state.bufferSize)
		if (fetchStartIndex >= state.totalCount)
			fetchStartIndex = Math.max(0, state.totalCount - (state.queue.length || state.bufferSize * 3))
		const itemsToFetch = Math.min(
			keepScroll && state.queue.length
				? Math.max(state.queue.length, state.bufferSize * 3)
				: state.bufferSize * 3,
			state.totalCount - fetchStartIndex,
		)
		const { items } = await fetchData(fetchStartIndex, itemsToFetch)
		if (state.destroyed) return
		state.queue = items
		state.startIndex = fetchStartIndex
		await renderQueue()
		if (state.destroyed) return
		state.hasRenderedOnce = true
		if (keepScroll) {
			container.scrollTop = savedScrollTop
			return
		}
		if (!setInitialScroll) return
		const targetElement = state.renderedElements.get(targetIndex)
		if (targetElement)
			targetElement.scrollIntoView({
				block: targetIndex ? 'nearest' : 'start',
				behavior: 'instant',
			})
		else
			container.scrollTop = container.scrollHeight
	}

	/**
	 * 销毁列表实例，清理 DOM、观察器、定时器与在途等待者。
	 * @returns {void}
	 */
	function destroy() {
		if (state.destroyed) return
		state.destroyed = true
		if (state.observer) state.observer.disconnect()
		if (state.resizeObserver) state.resizeObserver.disconnect()
		// 唤醒排队中的操作，让它们看到 destroyed 后自行退出（不再触碰 DOM/状态）。
		for (const resolve of state.waiters) resolve()
		state.waiters = []
		state.isLoading = false
		state.removeListenerCleanup?.()
		state.removeListenerCleanup = null
		container.innerHTML = ''
		state.queue = []
		state.renderedElements.clear()
		state.keyedCache.clear()
		state.hasRenderedOnce = false
	}

	/**
	 * 在列表末尾追加一个项目。
	 * @param {object} item - 要追加的项目。
	 * @param {boolean} [scrollTo=true] - 是否滚动到新项目。
	 */
	async function appendItem(item, scrollTo = true) {
		await getMutex()
		try {
			if (state.destroyed) return
			state.totalCount++
			const itemIndex = state.startIndex + state.queue.length
			state.queue.push(item)
			const newElement = await Promise.resolve(renderItem(item, itemIndex))
			if (state.destroyed) return
			// 哨兵缺失时 DOM 与 state 脱节（如 prune 竞态）：回滚本次改动后全量刷新自愈。
			// 注意此处已持有锁，必须走 refreshUnlocked，否则 refresh 会等待同一把锁而死锁。
			if (!container.contains(state.sentinelBottom)) {
				state.totalCount = Math.max(0, state.totalCount - 1)
				state.queue.pop()
				await refreshUnlocked()
				return
			}
			if (newElement) {
				state.renderedElements.set(itemIndex, newElement)
				if (getItemKey)
					state.keyedCache.set(String(getItemKey(item)), { element: newElement, itemJson: JSON.stringify(item) })
				container.insertBefore(newElement, state.sentinelBottom)
			}
			pruneQueue()
			updateDynamicBufferSize()
			if (scrollTo)
				container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
			onRenderComplete()
		} finally {
			releaseMutex()
			if (!state.destroyed) observeSentinels()
		}
	}

	/**
	 * 删除指定索引的项目。
	 * @param {number} index - 要删除的项目的绝对索引。
	 * 注意：如果项目不在当前队列中，仅减少 totalCount；否则，还会移除 DOM 并调整后续元素的索引映射。
	 */
	async function deleteItem(index) {
		if (state.destroyed) return
		if (index < 0 || index >= state.totalCount) return
		const queueIndex = index - state.startIndex
		if (!state.queue[queueIndex]) {
			state.totalCount = Math.max(0, state.totalCount - 1)
			return
		}
		await getMutex()
		try {
			if (state.destroyed) return
			const element = state.renderedElements.get(index)
			if (element && getItemKey)
				for (const [key, cached] of state.keyedCache)
					if (cached.element === element) {
						state.keyedCache.delete(key)
						break
					}

			state.queue.splice(queueIndex, 1)
			state.totalCount--
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
			releaseMutex()
			if (!state.destroyed) observeSentinels()
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
		await getMutex()
		try {
			if (state.destroyed) return
			const queueIndex = index - state.startIndex
			const oldItem = state.queue[queueIndex]
			const oldElement = state.renderedElements.get(index)
			if (!oldItem || !oldElement) {
				console.warn(`[virtualList] replaceItem called for index ${index} which is not in view.`)
				return
			}
			const newElement = await Promise.resolve(renderItem(item, index))
			if (state.destroyed) return
			const mountedElement = await replaceItemRenderer(oldElement, newElement, item) ?? newElement
			if (state.destroyed) return
			state.queue[queueIndex] = item
			state.renderedElements.set(index, mountedElement)
			if (getItemKey) {
				const oldKey = String(getItemKey(oldItem))
				const newKey = String(getItemKey(item))
				if (oldKey !== newKey) state.keyedCache.delete(oldKey)
				state.keyedCache.set(newKey, { element: mountedElement, itemJson: JSON.stringify(item) })
			}
			updateDynamicBufferSize()
		} finally {
			releaseMutex()
			if (!state.destroyed) observeSentinels()
		}
	}

	// 初始化 ResizeObserver 以处理容器大小变化
	state.resizeObserver = new ResizeObserver(() => {
		if (state.destroyed) return
		updateDynamicBufferSize()
		observeSentinels()
	})
	state.resizeObserver.observe(container)

	// 初始刷新
	refresh()
	state.removeListenerCleanup = onElementRemoved(container, destroy)

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
