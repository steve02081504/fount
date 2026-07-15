/**
 * 【文件】public/src/MessagePipeline.mjs
 * 【职责】Hub 消息列表的前端管道：封装虚拟列表分页、向上加载、追加/替换/删除行，以及「是否在底部」的自动滚底策略。
 * 【原理】createVirtualList 只负责 DOM 窗口化渲染；本模块在 container 上监听 scroll，距底部 <100px 时 shouldAutoScroll=true。程序化滚底时设置 programmaticScrollUntil（500ms 内忽略 scroll），避免用户上滑阅读时被强制拉回底部。appendItem(scroll) 在应自动滚底时先 markProgrammaticScroll 再委托 virtualList。
 * 【数据结构】options: { container, fetchData, renderItem, initialIndex?, onRenderComplete?, loadMoreTop? }；返回 API：virtualList、refresh、appendItem、replaceItem、deleteItem、scrollToBottom、destroy。
 * 【关联】hub/messages 初始化时创建；依赖 @pages/scripts/lib/virtualList.mjs。
 */
/**
 * 【文件】public/src/MessagePipeline.mjs
 * 【职责】Hub 消息列表的前端管道：封装虚拟列表分页、向上加载、追加/替换/删除行，以及「是否在底部」的自动滚底策略。
 * 【原理】createVirtualList 只负责 DOM 窗口化渲染；本模块在 container 上监听 scroll，距底部 <100px 时 shouldAutoScroll=true。
 *   程序化滚底时设置 programmaticScrollUntil（500ms 内忽略 scroll 事件），避免用户上滑阅读时被强制拉回底部。
 *   appendItem(scroll) 在应自动滚底时先 markProgrammaticScroll 再委托 virtualList。
 * 【数据结构】options: { container, fetchData, renderItem, initialIndex?, onRenderComplete?, loadMoreTop? }；
 *   返回 API：virtualList、refresh、appendItem、replaceItem、deleteItem、scrollToBottom、getShouldAutoScroll。
 * 【关联】hub/messages 初始化时创建；依赖 @pages/scripts/lib/virtualList.mjs。
 */
import { createVirtualList } from '../../../scripts/lib/virtualList.mjs'

/**
 * 创建消息列表管道：虚拟列表 + 自动滚动跟踪。
 * @param {object} options 配置
 * @param {HTMLElement} options.container 消息列表根节点
 * @param {Function} options.fetchData 分页拉取
 * @param {Function} options.renderItem 渲染单行
 * @param {number} [options.initialIndex] 初始滚动索引
 * @param {Function} [options.onRenderComplete] 渲染完成回调
 * @param {Function} [options.loadMoreTop] 向上加载更多
 * @returns {object} 管道 API
 */
export function createMessagePipeline({
	container,
	fetchData,
	renderItem,
	initialIndex = 0,
	onRenderComplete,
	loadMoreTop = null,
}) {
	/** @type {ReturnType<typeof createVirtualList> | null} */
	let virtualList = null
	let shouldAutoScroll = true
	let programmaticScrollUntil = 0
	let lastScrollTop = container.scrollTop
	let prefetchInFlight = false

	container.addEventListener('scroll', () => {
		if (Date.now() < programmaticScrollUntil) return
		const scrollTop = container.scrollTop
		const scrollingUp = scrollTop < lastScrollTop
		lastScrollTop = scrollTop
		shouldAutoScroll = scrollTop >=
			container.scrollHeight - container.clientHeight - 100
		if (
			scrollingUp
			&& loadMoreTop
			&& !prefetchInFlight
			&& scrollTop < container.clientHeight * 2
		) {
			prefetchInFlight = true
			void Promise.resolve(loadMoreTop()).finally(() => {
				prefetchInFlight = false
			})
		}
	}, { passive: true })

	/** @param {boolean} [force] 是否强制滚到底 */
	function markProgrammaticScroll(force = true) {
		if (force) shouldAutoScroll = true
		programmaticScrollUntil = Date.now() + 500
	}

	virtualList = createVirtualList({
		container,
		fetchData,
		renderItem,
		initialIndex,
		/** @returns {void} */
		onRenderComplete: () => onRenderComplete?.(),
		loadMoreTop,
	})

	return {
		/** @returns {ReturnType<typeof createVirtualList> | null} 底层虚拟列表实例 */
		get virtualList() { return virtualList },

		/** @returns {Promise<void>} */
		async refresh() {
			await virtualList.refresh()
		},

		/**
		 * @param {object} item 消息数据
		 * @param {boolean} [scroll] 追加后是否滚到底
		 * @returns {Promise<void>}
		 */
		async appendItem(item, scroll) {
			if (scroll ?? shouldAutoScroll) markProgrammaticScroll()
			await virtualList.appendItem(item, scroll ?? shouldAutoScroll)
		},

		/**
		 * 分批（按 rAF）追加多条消息，避免长批次阻塞主线程。
		 * @param {object[]} items 消息数组
		 * @param {boolean} [scroll] 末尾是否滚到底
		 * @returns {Promise<void>}
		 */
		async appendItemsBatch(items, scroll) {
			const rows = Array.isArray(items) ? items : []
			if (!rows.length) return
			if (scroll ?? shouldAutoScroll) markProgrammaticScroll()
			const chunkSize = 50
			for (let offset = 0; offset < rows.length; offset += chunkSize) {
				if (offset > 0)
					await new Promise(resolve => requestAnimationFrame(() => resolve()))
				const chunk = rows.slice(offset, offset + chunkSize)
				for (const row of chunk)
					await virtualList.appendItem(row, false)
			}
			if (scroll ?? shouldAutoScroll)
				container.scrollTop = container.scrollHeight
		},

		/**
		 * @param {number} index 列表索引
		 * @param {object} item 新消息数据
		 * @returns {Promise<void>}
		 */
		async replaceItem(index, item) {
			await virtualList.replaceItem(index, item)
		},

		/** @param {number} index 索引 */
		async deleteItem(index) {
			await virtualList.deleteItem(index)
		},

		/** @returns {void} */
		destroy() {
			virtualList?.destroy()
			virtualList = null
		},
	}
}
