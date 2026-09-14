/**
 * 多列碎裂检查：CSS `columns` 容器里，普通分块子元素被拆到多列时
 * `getClientRects()` 会返回多段（每列一段）。正常单块、或带
 * `break-inside: avoid` 的元素只有一段。命中即 `[test:layout]` 控制台报错
 * （Playwright 硬失败）。
 *
 * 这类「视觉上被一分为二」的元素语义/文案扫描（a11y / locale / emoji / cssvar）
 * 都读不到——它们只看文本与样式，不看几何；本任务补上几何维度。
 */
import { wake } from './loop.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:layout]')

let dirty = true
let scanned = false

/**
 * DOM 变化后置脏并唤醒，确保首轮扫描后仍会重扫。
 * @returns {void}
 */
export function markDirty() {
	dirty = true
	wake()
}

/**
 * drain 覆盖：至少扫过一轮。
 * @returns {boolean} 已覆盖则为 true
 */
function covered() {
	return scanned
}

/**
 * drain 开始：重置覆盖并要求扫描。
 * @returns {void}
 */
function beginDrain() {
	dirty = true
	scanned = false
}

/**
 * 元素是否为多列容器（`column-count > 1` 或出现 `column-width`）。
 * @param {Element} element 元素
 * @returns {boolean} 多列则为 true
 */
function isMultiColumn(element) {
	const style = getComputedStyle(element)
	if (style.columnCount && style.columnCount !== 'auto' && Number(style.columnCount) > 1) return true
	return !!style.columnWidth && style.columnWidth !== 'auto' && parseFloat(style.columnWidth) > 0
}

/**
 * 收集多列容器中被拆断的分块子元素。
 * 行内元素换行本就多段，跳过；SVG 子树跳过。
 * @param {ParentNode} [root=document] 扫描根
 * @returns {{ container: Element, child: Element, fragments: number }[]} 命中项
 */
export function collectFragmentedBlocks(root = document) {
	const hits = []
	for (const container of root.querySelectorAll('*')) {
		if (container instanceof SVGElement) continue
		if (!isMultiColumn(container)) continue
		for (const child of container.children) {
			if (child instanceof SVGElement) continue
			const display = getComputedStyle(child).display
			if (display === 'contents' || display.startsWith('inline')) continue
			const fragments = child.getClientRects().length
			if (fragments > 1) hits.push({ container, child, fragments })
		}
	}
	return hits
}

/**
 * 生成简短定位串。
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
 * loop 回调：有脏标记时扫描一轮多列碎裂。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {boolean} true = 空转
 */
function run({ draining }) {
	if (!dirty && !(draining && !scanned)) return true
	dirty = false
	for (const { child, fragments } of collectFragmentedBlocks()) {
		const where = describeElement(child)
		reporter.report(
			`fragmented-block\t${where}\t${fragments}`,
			`fragmented-block\t${where}`,
			`该块在多列容器内被拆成 ${fragments} 段`,
			'补 `break-inside: avoid`，或在该状态下关闭多列',
		)
	}
	scanned = true
	return false
}

/** 任务轮转间隔 */
const LAYOUT_SCAN_MS = 500

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'layout', delayMs: LAYOUT_SCAN_MS, run, covered, beginDrain }
