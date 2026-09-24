/**
 * 阅读位置锚点：以「内容块指纹 + 块内比例」记录滚动位置，而非像素或整页比例，
 * 因此在前后窗口尺寸 / 布局变化后仍能跳回同一段内容。供 social 帖子详情页与
 * gist 文档查看页共用。
 *
 * 记录形如 `{ anchor: { blockIndex, blockSig, offsetRatio }, ratio }`：
 * - `blockSig` 为视口顶所在内容块的文本指纹（无文本块退化为标签+类名）。
 * - `offsetRatio` 为视口顶落在该块内的比例（0–1）。
 * - `ratio` 为整体滚动进度，仅在块定位失败时兜底。
 */

/** 内容块指纹最大长度。 */
const SIG_MAX_LEN = 96

/**
 * @param {number} value 原始值
 * @returns {number} 夹到 [0,1] 的数
 */
function clamp01(value) {
	if (!Number.isFinite(value)) return 0
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

/**
 * @param {Window | Element} scrollRoot 滚动根
 * @returns {boolean} 是否为 window
 */
function isWindowRoot(scrollRoot) {
	return scrollRoot === window || scrollRoot === document
}

/**
 * 读取滚动根的度量。
 * @param {Window | Element} scrollRoot 滚动根
 * @returns {{ top: number, viewportHeight: number, maxTop: number }} 度量
 */
function scrollMetrics(scrollRoot) {
	if (isWindowRoot(scrollRoot)) {
		const doc = document.documentElement
		const top = window.scrollY ?? window.pageYOffset ?? doc.scrollTop ?? 0
		const viewportHeight = window.innerHeight || doc.clientHeight || 0
		const scrollHeight = doc.scrollHeight || document.body?.scrollHeight || 0
		return { top, viewportHeight, maxTop: Math.max(0, scrollHeight - viewportHeight) }
	}
	const top = scrollRoot.scrollTop
	const viewportHeight = scrollRoot.clientHeight
	return { top, viewportHeight, maxTop: Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight) }
}

/**
 * 计算元素顶边在滚动内容坐标系中的位置。
 * @param {HTMLElement} element 元素
 * @param {Window | Element} scrollRoot 滚动根
 * @returns {number} 内容坐标
 */
function topInScroll(element, scrollRoot) {
	const rect = element.getBoundingClientRect()
	if (isWindowRoot(scrollRoot))
		return rect.top + (window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop ?? 0)
	return rect.top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
}

/**
 * 读取滚动根当前滚动量。
 * @param {Window | Element} scrollRoot 滚动根
 * @returns {number} 当前滚动量
 */
function readTop(scrollRoot) {
	if (isWindowRoot(scrollRoot))
		return window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop ?? 0
	return scrollRoot.scrollTop
}

/**
 * 写入滚动位置。
 * @param {Window | Element} scrollRoot 滚动根
 * @param {number} top 目标滚动量
 * @returns {void}
 */
function writeTop(scrollRoot, top) {
	if (isWindowRoot(scrollRoot)) {
		window.scrollTo(0, top)
		return
	}
	scrollRoot.scrollTop = top
}

/**
 * 解析可见的内容块列表。
 * @param {HTMLElement} contentRoot 内容根
 * @param {string} [blockSelector] 块选择器；省略时取 contentRoot 的直接子元素
 * @returns {HTMLElement[]} 可见块（文档顺序）
 */
function resolveBlocks(contentRoot, blockSelector) {
	const raw = blockSelector
		? [...contentRoot.querySelectorAll(blockSelector)]
		: [...contentRoot.children]
	return raw.filter(element =>
		element instanceof HTMLElement
		&& element.getClientRects().length > 0
		&& element.getBoundingClientRect().height > 1,
	)
}

/**
 * 内容块指纹：优先文本，无文本时退化到标签+类名。
 * @param {HTMLElement} block 内容块
 * @returns {string} 指纹
 */
function blockSignature(block) {
	const text = String(block.textContent || '').replace(/\s+/g, ' ').trim()
	if (text) return text.slice(0, SIG_MAX_LEN)
	const cls = [...block.classList].slice(0, 2).join('.')
	return `${block.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`.slice(0, SIG_MAX_LEN)
}

/**
 * 采集当前滚动位置。
 * @param {{ scrollRoot: Window | Element, contentRoot: HTMLElement, blockSelector?: string }} options 选项
 * @returns {{ anchor: { blockIndex: number, blockSig: string, offsetRatio: number } | null, ratio: number }} 位置记录
 */
export function captureScrollPosition({ scrollRoot, contentRoot, blockSelector }) {
	const metrics = scrollMetrics(scrollRoot)
	const ratio = metrics.maxTop > 0 ? clamp01(metrics.top / metrics.maxTop) : 0
	if (!(contentRoot instanceof HTMLElement)) return { anchor: null, ratio }
	const blocks = resolveBlocks(contentRoot, blockSelector)
	if (!blocks.length) return { anchor: null, ratio }
	let chosen = blocks[0]
	let chosenIndex = 0
	let chosenTop = topInScroll(chosen, scrollRoot)
	for (let index = 1; index < blocks.length; index++) {
		const top = topInScroll(blocks[index], scrollRoot)
		if (top > metrics.top + 1) break
		chosen = blocks[index]
		chosenIndex = index
		chosenTop = top
	}
	const height = chosen.getBoundingClientRect().height
	const offsetRatio = height > 0 ? clamp01((metrics.top - chosenTop) / height) : 0
	return { anchor: { blockIndex: chosenIndex, blockSig: blockSignature(chosen), offsetRatio }, ratio }
}

/**
 * 在块列表中按指纹定位锚点块（同指纹多个时取索引最接近者），找不到退化为索引。
 * @param {HTMLElement[]} blocks 内容块
 * @param {{ blockIndex: number, blockSig: string }} anchor 锚点
 * @returns {HTMLElement | null} 定位到的块
 */
function locateBlock(blocks, anchor) {
	const sig = anchor?.blockSig
	if (sig) {
		const matches = blocks.filter(block => blockSignature(block) === sig)
		if (matches.length === 1) return matches[0]
		if (matches.length > 1) {
			if (!Number.isInteger(anchor.blockIndex) || anchor.blockIndex < 0) return matches[0]
			let best = matches[0]
			let bestDistance = Infinity
			for (const match of matches) {
				const distance = Math.abs(blocks.indexOf(match) - anchor.blockIndex)
				if (distance < bestDistance) {
					bestDistance = distance
					best = match
				}
			}
			return best
		}
	}
	if (Number.isInteger(anchor?.blockIndex) && anchor.blockIndex >= 0)
		return blocks[anchor.blockIndex] ?? null
	return null
}

/**
 * 应用位置记录：逐帧重定位直到目标稳定（图片 / 公式 / 字体异步撑开布局），
 * 用户主动滚动（wheel / touch）则中止。
 * @param {{ scrollRoot: Window | Element, contentRoot: HTMLElement, blockSelector?: string, record: object | null, maxFrames?: number }} options 选项
 * @returns {Promise<boolean>} 是否定位成功
 */
export function applyScrollPosition({ scrollRoot, contentRoot, blockSelector, record, maxFrames = 600 }) {
	if (!record || !(contentRoot instanceof HTMLElement)) return Promise.resolve(false)

	/**
	 * 按记录计算目标滚动量。
	 * @returns {number | null} 目标滚动量
	 */
	const computeTarget = () => {
		const metrics = scrollMetrics(scrollRoot)
		const blocks = resolveBlocks(contentRoot, blockSelector)
		if (record.anchor) {
			const located = blocks.length ? locateBlock(blocks, record.anchor) : null
			if (located) {
				const top = topInScroll(located, scrollRoot)
				const height = located.getBoundingClientRect().height
				return top + (record.anchor.offsetRatio ?? 0) * height
			}
			// 内容 / 布局尚未就绪（块列表为空）时返回 null 继续重试，勿过早以 ratio 归零收尾
			if (!blocks.length) return null
		}
		if (Number.isFinite(record.ratio) && metrics.maxTop > 0) return record.ratio * metrics.maxTop
		return null
	}

	return new Promise(resolve => {
		let frames = 0
		let lastTarget = NaN
		let stableFrames = 0
		let finished = false
		const controller = new AbortController()

		/**
		 * 结束定位。
		 * @param {boolean} ok 是否成功
		 * @returns {void}
		 */
		const finish = ok => {
			if (finished) return
			finished = true
			controller.abort()
			resolve(ok)
		}
		/**
		 * 用户主动滚动时中止恢复。
		 * @returns {void}
		 */
		const onUserScroll = () => finish(false)
		window.addEventListener('wheel', onUserScroll, { passive: true, signal: controller.signal })
		window.addEventListener('touchstart', onUserScroll, { passive: true, signal: controller.signal })

		/**
		 * 逐帧重定位。
		 * @returns {void}
		 */
		const step = () => {
			if (finished) return
			frames++
			const target = computeTarget()
			if (target != null) {
				writeTop(scrollRoot, target)
				// 滚动根尚未可滚动（CSS 未生效 / 内容未撑开）时写入无效，须继续重试
				const applied = Math.abs(readTop(scrollRoot) - target) <= 2
				if (applied && Number.isFinite(lastTarget) && Math.abs(target - lastTarget) < 1) stableFrames++
				else stableFrames = 0
				lastTarget = target
			}
			else
				stableFrames = 0

			if (stableFrames >= 3 || frames >= maxFrames) {
				finish(target != null)
				return
			}
			requestAnimationFrame(step)
		}
		requestAnimationFrame(step)
	})
}
