/** @type {IntersectionObserver | null} */
let activeObserver = null

/**
 * 绑定 IntersectionObserver 无限滚动。
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
	activeObserver = new IntersectionObserver(entries => {
		if (!entries.some(entry => entry.isIntersecting)) return
		if (!hasMore()) return
		void onLoad()
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
	}
	if (sentinel.parentElement !== container)
		container.appendChild(sentinel)
	return sentinel
}
