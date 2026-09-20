/**
 * CSS 变量注册与自动更新。
 *
 * `registerCssUpdater(func, { observe })` 会立即运行一次，并在以下时机用
 * `requestAnimationFrame` 合并后重跑：
 * - 窗口尺寸变化（所有已注册更新器）；
 * - `observe` 指定的元素 / 选择器子树发生 DOM 变动或尺寸变化（仅该更新器）。
 *
 * 返回的取消函数会摘除更新器并断开观察。典型用途：把实测几何写进 CSS 变量，
 * 由样式表消费并做合成友好的过渡（导航滑动指示器、资料页 tab 指示器）。
 */

const root = document.documentElement

/**
 * 写入全局 CSS 变量。
 * @param {string} name 变量名（含前导 `--`）
 * @param {string} value 变量值
 * @returns {void}
 */
export function setCssVariable(name, value) {
	root.style.setProperty(name, value)
}

/**
 * `registerCssUpdater` 的观察目标：元素、选择器，或它们的数组。
 * @typedef {Element | string | Array<Element | string>} CssUpdaterTargets
 */

/** @type {Set<{ func: () => void, scheduled: boolean, mutationObserver: MutationObserver | null, resizeObserver: ResizeObserver | null }>} */
const updaters = new Set()

/**
 * 运行单个更新器；异常只记录，不阻断同批次其他更新器。
 * @param {{ func: () => void }} entry 更新器条目
 * @returns {void}
 */
function run(entry) {
	try {
		entry.func()
	}
	catch (error) {
		console.error('[cssValues] updater failed', error)
	}
}

/**
 * 在下一帧运行更新器（同一帧内的多次触发只跑一次）。
 * @param {Parameters<typeof run>[0]} entry 更新器条目
 * @returns {void}
 */
function scheduleRun(entry) {
	if (entry.scheduled) return
	entry.scheduled = true
	requestAnimationFrame(() => {
		entry.scheduled = false
		if (updaters.has(entry)) run(entry)
	})
}

/**
 * 把 observe 选项解析为元素列表。
 * @param {CssUpdaterTargets} [targets] 元素 / 选择器 / 数组
 * @returns {Element[]} 解析出的元素
 */
function resolveTargets(targets) {
	if (!targets) return []
	const list = Array.isArray(targets) ? targets : [targets]
	const elements = []
	for (const target of list)
		if (typeof target === 'string')
			elements.push(...document.querySelectorAll(target))
		else if (target instanceof Element)
			elements.push(target)

	return elements
}

/**
 * 为更新器附加 DOM 变动与尺寸观察。
 * @param {Parameters<typeof run>[0] & { mutationObserver: MutationObserver | null, resizeObserver: ResizeObserver | null }} entry 更新器条目
 * @param {Element[]} targets 观察目标
 * @param {MutationObserverInit} [observeOptions] 追加 / 覆盖的观察选项
 * @returns {void}
 */
function attachObservers(entry, targets, observeOptions) {
	if (!targets.length) return
	entry.mutationObserver = new MutationObserver(() => scheduleRun(entry))
	entry.resizeObserver = new ResizeObserver(() => scheduleRun(entry))
	for (const target of targets) {
		entry.mutationObserver.observe(target, {
			childList: true, subtree: true, attributes: true, characterData: true,
			...observeOptions,
		})
		entry.resizeObserver.observe(target)
	}
}

/**
 * 注册一个 CSS 更新器：立即运行，并在窗口尺寸变化或观察目标变动时重跑。
 * @param {() => void} func 更新器：把实测值写进 CSS 变量
 * @param {{ observe?: CssUpdaterTargets, observeOptions?: MutationObserverInit }} [options] `observe` 为需观察 DOM / 尺寸的子树；`observeOptions` 覆盖观察选项（如 `attributeFilter` 防止更新器自身写的 `style` 触发自激循环）
 * @returns {() => void} 取消注册并断开观察
 */
export function registerCssUpdater(func, options = {}) {
	const entry = { func, scheduled: false, mutationObserver: null, resizeObserver: null }
	updaters.add(entry)
	attachObservers(entry, resolveTargets(options.observe), options.observeOptions)
	run(entry)
	return () => {
		updaters.delete(entry)
		entry.mutationObserver?.disconnect()
		entry.resizeObserver?.disconnect()
	}
}

window.addEventListener('resize', () => {
	for (const entry of updaters) scheduleRun(entry)
})
