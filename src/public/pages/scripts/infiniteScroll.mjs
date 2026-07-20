/** @type {IntersectionObserver | null} */
let activeObserver = null

/**
 * 绑定 IntersectionObserver 无限滚动。
 * 同一轮「进入相交」只触发一次；离开后再进入才允许下一次。
 * 分页链式加载：调用方在 onLoad 结束后 `bindInfiniteScroll` 重绑（新观察者 armed=true）。
 * 重放/追加若只挪哨兵不重绑：本函数在 onLoad 期间 unobserve，结束后再 observe 且保持 armed=false，
 * 避免挪节点触发的假 leave/enter 在仍相交时连开下一轮。
 * @param {object} options 选项
 * @param {Element | null} [options.root] 滚动根（缺省 viewport）
 * @param {Element} options.sentinel 哨兵元素
 * @param {() => boolean} options.hasMore 是否还有更多
 * @param {() => void | Promise<void>} options.onLoad 触发加载
 * @param {string} [options.rootMargin='480px 0px'] 提前量（约两屏）
 * @returns {void}
 */
export function bindInfiniteScroll({ root = null, sentinel, hasMore, onLoad, rootMargin = '480px 0px' }) {
	disconnectInfiniteScroll()
	if (!sentinel || !hasMore()) return
	let loading = false
	/** 离开相交后重新武装；onLoad 期间 unobserve，避免挪哨兵的假 leave/enter 连触发 */
	let armed = true
	activeObserver = new IntersectionObserver(entries => {
		const intersecting = entries.some(entry => entry.isIntersecting)
		if (!intersecting) {
			armed = true
			return
		}
		if (!armed || loading || !hasMore()) return
		armed = false
		loading = true
		activeObserver?.unobserve(sentinel)
		Promise.resolve(onLoad()).finally(() => {
			loading = false
			if (!activeObserver) return
			// 重新观察：若仍相交会立刻回调，但 armed=false，需真正离开后再进入才开火
			activeObserver.observe(sentinel)
		})
	}, { root, rootMargin })
	activeObserver.observe(sentinel)
}

/** @returns {void} */
export function disconnectInfiniteScroll() {
	activeObserver?.disconnect()
	activeObserver = null
}

/**
 * 确保容器末尾有哨兵节点。
 * @param {HTMLElement} container 列表容器
 * @param {string} sentinelId 哨兵 id
 * @returns {HTMLElement} 哨兵元素
 */
export function ensureScrollSentinel(container, sentinelId) {
	let sentinel = document.getElementById(sentinelId)
	if (!sentinel) {
		sentinel = document.createElement('div')
		sentinel.id = sentinelId
		sentinel.className = 'scroll-sentinel'
		sentinel.setAttribute('aria-hidden', 'true')
		// 避免 scroll anchoring 把哨兵钉在视口内，导致重绑 observer 后立刻再触发
		sentinel.style.overflowAnchor = 'none'
	}
	if (sentinel.parentElement !== container || container.lastElementChild !== sentinel)
		container.appendChild(sentinel)
	return sentinel
}
