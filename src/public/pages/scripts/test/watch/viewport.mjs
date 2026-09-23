/**
 * 页面级「略超一屏」检查：文档可滚动高度超出视口、却不足视口的 1.1 倍时，
 * 几乎总是满屏布局（`h-dvh` / `100vh` 应用壳）被几像素的溢出撑破——右侧多出一条
 * 几乎滚不动的页面滚动条，顶栏还会被滚走一截。命中即 `[test:viewport]`（Playwright 硬失败）。
 *
 * 超出 1.1 倍视为真长文档（正常滚动页面），不管。视口不可滚（`overflow: hidden|clip`）也不管。
 *
 * 只检查声明了 `data-app-shell` 的满屏应用壳（`<body data-app-shell>`）：这类页面整体恰好一屏、
 * 滚动交给内部容器，本就不该有页面级滚动条；长文档页 / 允许页面滚动的页不声明、不检查。
 *
 * 检查时在 body 末尾常驻一个「扩展浮层探针」：仿划词 / 翻译类浏览器扩展注入的隐藏 tooltip
 *（body 直属、`position: absolute` 不设 top、`visibility: hidden`、约 16px 高）。它落在满屏布局
 * 之后，把没裁剪视口的应用壳撑出几像素——真实用户装了扩展才会看到的滚动条，测试里也必现。
 */
import { wake } from './loop.mjs'
import { ignore } from './mutation_gate.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:viewport]')

/** 容忍的亚像素 / 取整误差（像素）。 */
const EPSILON_PX = 1
/** 超过视口此倍数即视为正常长页面。 */
const LONG_PAGE_RATIO = 1.1

let dirty = true
let scanned = false

/** 满屏应用壳声明属性（`<body data-app-shell>`）：声明后本任务才会检查页面级滚动条。 */
export const APP_SHELL_ATTRIBUTE = 'data-app-shell'
/** 扩展浮层探针标记属性。 */
export const EXTENSION_PROBE_ATTRIBUTE = 'data-fount-test-extension-probe'

/**
 * 确保扩展浮层探针挂在 body 末尾（页面整体替换 body 内容后补回）；在 ignore 内挂，不触发重扫。
 * @returns {void}
 */
export function ensureExtensionProbe() {
	if (!document.body || document.body.querySelector(`:scope > [${EXTENSION_PROBE_ATTRIBUTE}]`)) return
	ignore(() => {
		const probe = document.createElement('div')
		probe.setAttribute(EXTENSION_PROBE_ATTRIBUTE, '')
		probe.setAttribute('aria-hidden', 'true')
		probe.style.cssText = 'position: absolute; visibility: hidden; padding: 6px; border: 2px solid; font-size: 11px; pointer-events: none'
		document.body.appendChild(probe)
	})
}
/**
 * DOM / 视口变化：标记脏并唤醒。
 * @returns {void}
 */
export function markDirty() {
	dirty = true
	wake()
}

if (typeof window !== 'undefined') window.addEventListener('resize', markDirty, { passive: true })

/**
 * drain 覆盖：至少扫描一轮。
 * @returns {boolean} 已覆盖则为 true
 */
function covered() {
	return scanned
}

/**
 * drain 开始：重置覆盖并要求重扫。
 * @returns {void}
 */
function beginDrain() {
	dirty = true
	scanned = false
}

/**
 * 视口（html / body 传播后）纵向是否可滚。
 * @returns {boolean} 可滚则为 true
 */
function viewportScrollable() {
	/**
	 * @param {string} value overflow 值
	 * @returns {boolean} 是否裁剪
	 */
	const clipping = value => value === 'hidden' || value === 'clip'
	const html = getComputedStyle(document.documentElement).overflowY
	if (html !== 'visible') return !clipping(html)
	// html 为 visible 时 body 的 overflow 传播到视口
	return !document.body || !clipping(getComputedStyle(document.body).overflowY)
}

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
 * 找出把文档撑出视口底部的元素（不进入会裁剪子树的容器；按底边降序取前几个）。
 * @param {number} viewportHeight 视口高度
 * @returns {{ where: string, bottom: number }[]} 疑似元凶
 */
export function findOverflowCulprits(viewportHeight) {
	const scrollY = document.scrollingElement?.scrollTop || 0
	/** @type {{ where: string, bottom: number, depth: number }[]} */
	const hits = []
	/**
	 * @param {Element} element 当前元素
	 * @param {number} depth 深度
	 * @returns {void}
	 */
	const walk = (element, depth) => {
		for (const child of element.children) {
			const style = getComputedStyle(child)
			if (style.display === 'none' || style.position === 'fixed') continue
			const rect = child.getBoundingClientRect()
			const bottom = rect.bottom + scrollY
			if (bottom > viewportHeight + EPSILON_PX && rect.height > 0)
				hits.push({ where: describeElement(child), bottom: Math.round(bottom), depth })
			const clipsY = style.overflowY !== 'visible'
			if (!clipsY) walk(child, depth + 1)
		}
	}
	if (document.body) walk(document.body, 0)
	return hits
		.sort((a, b) => b.bottom - a.bottom || b.depth - a.depth)
		.slice(0, 3)
		.map(({ where, bottom }) => ({ where, bottom }))
}

/**
 * 读取当前页面的「略超一屏」溢出量；无问题时返回 0。
 * @returns {{ overflow: number, viewport: number, scrollHeight: number }} 溢出信息
 */
export function measurePageOverflow() {
	const root = document.scrollingElement || document.documentElement
	const viewport = root.clientHeight
	const { scrollHeight } = root
	const overflow = scrollHeight - viewport
	if (!viewport || overflow <= EPSILON_PX || scrollHeight >= viewport * LONG_PAGE_RATIO || !viewportScrollable())
		return { overflow: 0, viewport, scrollHeight }
	return { overflow, viewport, scrollHeight }
}

/**
 * 等两帧（让刚发生的布局落定，过滤中间态）。
 * @returns {Promise<void>}
 */
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/**
 * loop 回调：脏时扫描一轮。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {Promise<boolean>} true = 空转
 */
async function run({ draining }) {
	if (!dirty && !(draining && !scanned)) return true
	// 只检查声明了满屏应用壳的页面；声明本身是 DOM 突变，后续加上会再次标脏
	if (!document.body?.hasAttribute(APP_SHELL_ATTRIBUTE)) {
		scanned = true
		return true
	}
	// 等文档与样式表全部就绪再测：`body` 的视口裁剪规则可能来自较晚的 `<link>`，
	// 太早扫描会把探针的 16px 误判成溢出（且 reporter 一旦上报不再刷新）
	if (document.readyState !== 'complete') return false
	dirty = false
	ensureExtensionProbe()
	if (measurePageOverflow().overflow) {
		await settle()
		const { overflow, viewport, scrollHeight } = measurePageOverflow()
		if (overflow) {
			const culprits = findOverflowCulprits(viewport).map(hit => `${hit.where}@${hit.bottom}`).join(' ')
			reporter.report(
				`page-overflow\t${location.pathname}`,
				`${location.pathname} 页面比视口高 ${overflow}px（scrollHeight ${scrollHeight} / 视口 ${viewport}）：出现几乎滚不动的页面滚动条`,
				culprits ? `疑似撑破元素：${culprits}` : '',
				`满屏应用壳给 body 设 overflow: clip（[${EXTENSION_PROBE_ATTRIBUTE}] 是仿浏览器扩展浮层的测试探针）；否则找出撑破元素，去掉多余 margin / 补 min-height: 0`,
			)
		}
	}
	scanned = true
	return false
}

/** 空转间隔 */
const VIEWPORT_SCAN_MS = 500

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'viewport', delayMs: VIEWPORT_SCAN_MS, run, covered, beginDrain }
