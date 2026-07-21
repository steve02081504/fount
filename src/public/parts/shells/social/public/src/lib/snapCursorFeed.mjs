/**
 * 竖滑 feed 的 cursor 分页 + 循环重放状态机（video / live 共用）。
 */

/**
 * @param {object} options 选项
 * @param {(cursor: string | null) => Promise<{ items?: object[], nextCursor?: string | null } | null>} options.fetchPage 拉取一页
 * @param {(container: HTMLElement, items: object[]) => void} options.appendSlides 追加 slides
 * @param {(container: HTMLElement, index: number) => boolean} [options.canReplay] 无 cursor 时是否允许循环重放
 * @param {() => boolean} [options.shouldSkip] 跳过加载（如 nearby 大厅）
 * @returns {{
 *   reset: () => void,
 *   seed: (items: object[], nextCursor: string | null) => void,
 *   getShownItems: () => object[],
 *   maybeLoadMore: (container: HTMLElement, index: number) => Promise<void>,
 * }} 分页控制器
 */
export function createSnapCursorFeed({ fetchPage, appendSlides, canReplay, shouldSkip }) {
	/** @type {string | null} */
	let cursor = null
	/** @type {object[]} */
	let shownItems = []
	let pageLoading = false

	return {
		/** @returns {void} */
		reset() {
			cursor = null
			shownItems = []
			pageLoading = false
		},
		/**
		 * @param {object[]} items 首屏条目
		 * @param {string | null} nextCursor 下一页游标
		 * @returns {void}
		 */
		seed(items, nextCursor) {
			shownItems = [...items]
			cursor = nextCursor || null
		},
		/**
		 * @param {HTMLElement} container 容器
		 * @param {object[]} items 条目
		 * @returns {void}
		 */
		append(container, items) {
			appendSlides(container, items)
		},
		/** @returns {object[]} 已展示条目 */
		getShownItems: () => shownItems,
		/**
		 * @param {HTMLElement} container snap 容器
		 * @param {number} index 当前索引
		 * @returns {Promise<void>}
		 */
		async maybeLoadMore(container, index) {
			if (pageLoading || shouldSkip?.()) return
			if (container.children.length - index - 1 > 2) return

			if (cursor) {
				pageLoading = true
				try {
					const data = await fetchPage(cursor)
					if (!data) return
					const items = data.items || []
					cursor = data.nextCursor || null
					if (items.length) {
						shownItems.push(...items)
						appendSlides(container, items)
					}
				}
				finally {
					pageLoading = false
				}
				return
			}

			if (!shownItems.length) return
			if (canReplay && !canReplay(container, index)) return
			pageLoading = true
			try {
				appendSlides(container, shownItems)
			}
			finally {
				pageLoading = false
			}
		},
	}
}
