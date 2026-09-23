/**
 * 闪烁检查（`[test:flicker]`，Playwright 硬失败）：元素的 class / style / hidden 反复切换，
 * 使其（按过渡终点计的）可见性在短时间内来回翻转多次——典型如流式输出时「回到底部」浮标随每帧显隐，
 * 或某个临界条件上的显隐来回抖。按帧采样，同一帧内的中间态不计（只看每帧绘制结果）。
 *
 * 只看样式层（display / visibility / opacity），不按几何尺寸判定：阅读进度条等用 `transform: scaleX(0)`
 * 表达「空」的元素会在滚动时反复缩放，尺寸不是闪隐。
 *
 * watch 自身 `ignore()` 期间（语种轮换、主题测量）的突变不计。
 */
import { isIgnoring } from './mutation_gate.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:flicker]')

/** 统计窗口（毫秒）。 */
const WINDOW_MS = 2000
/** 窗口内可见性翻转次数达到即判闪烁（3 个显隐来回）。 */
const VISIBILITY_FLIPS = 6
/** 过渡终点不透明度低于此值视为不可见。 */
const INVISIBLE_OPACITY = 0.05

/** @type {WeakMap<Element, { visible: boolean, flips: number[] }>} */
const visibilityState = new WeakMap()
/** @type {Set<Element>} */
const pending = new Set()
let frame = 0

/**
 * 生成简短定位符。
 * @param {Element} element 元素
 * @returns {string} 形如 `#id` / `div.cls`
 */
function describeElement(element) {
	if (element.id) return `#${CSS.escape(element.id)}`
	const cls = typeof element.className === 'string'
		? element.className.trim().split(/\s+/).find(Boolean)
		: ''
	if (cls) return `${element.tagName.toLowerCase()}.${CSS.escape(cls)}`
	return element.tagName.toLowerCase()
}

/**
 * 元素不透明度（有进行中的 opacity 过渡时取过渡终点）。
 * @param {Element} element 元素
 * @returns {number} 不透明度
 */
function targetOpacity(element) {
	let opacity = parseFloat(getComputedStyle(element).opacity)
	for (const animation of element.getAnimations?.() || []) {
		if (animation.transitionProperty !== 'opacity') continue
		const last = animation.effect?.getKeyframes?.().at(-1)
		if (last?.opacity !== undefined) opacity = parseFloat(last.opacity)
	}
	return opacity
}

/**
 * 元素当前（按过渡终点）是否可见——只看样式层，见文件头。
 * @param {Element} element 元素
 * @returns {boolean} 可见则为 true
 */
export function isVisibleForFlicker(element) {
	if (!element.isConnected) return false
	if (element.checkVisibility && !element.checkVisibility({ visibilityProperty: true })) return false
	return targetOpacity(element) > INVISIBLE_OPACITY
}

/**
 * 把时间戳推入窗口并剔除过期项，返回窗口内计数。
 * @param {number[]} stamps 时间戳数组（原地修改）
 * @param {number} now 当前时间
 * @returns {number} 窗口内计数
 */
function pushInWindow(stamps, now) {
	stamps.push(now)
	while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift()
	return stamps.length
}

/**
 * 帧末采样：比较待查元素的可见性与上次记录。
 * @returns {void}
 */
function sampleVisibility() {
	frame = 0
	const now = performance.now()
	for (const element of pending) {
		const visible = isVisibleForFlicker(element)
		const state = visibilityState.get(element)
		if (!state) {
			visibilityState.set(element, { visible, flips: [] })
			continue
		}
		if (state.visible === visible) continue
		state.visible = visible
		const flips = pushInWindow(state.flips, now)
		if (flips >= VISIBILITY_FLIPS) {
			const where = describeElement(element)
			reporter.report(
				`visibility\t${where}`,
				`visibility-flicker\t${where}\t${WINDOW_MS}ms 内显隐翻转 ${flips} 次`,
				'显隐条件在临界值附近随每帧抖动；加迟滞或在流式期间固定状态',
			)
		}
	}
	pending.clear()
}

/**
 * 突变回调：记下属性变动的元素，下一帧采样。
 * @param {MutationRecord[]} records 突变
 * @returns {void}
 */
function onMutations(records) {
	if (isIgnoring()) return
	for (const record of records)
		if (record.target instanceof Element) pending.add(record.target)
	if (pending.size && !frame) frame = requestAnimationFrame(sampleVisibility)
}

let installed = false

/**
 * 挂上闪烁检查（幂等）。
 * @param {Node} [root=document.documentElement] 观察根
 * @returns {void}
 */
export function installFlickerWatch(root = document.documentElement) {
	if (installed) return
	installed = true
	new MutationObserver(onMutations).observe(root, {
		subtree: true,
		attributes: true,
		attributeFilter: ['class', 'style', 'hidden', 'open'],
	})
}
