/**
 * SVG 主题对比检测：页面出现 `<svg>` 时，分别以 `data-theme=light` / `data-theme=dark`
 * 校验 SVG 前景色与其背后背景色不相近（感知色距 ≥ 阈值），防止图标在某一主题下隐身。
 */
import { wake } from './loop.mjs'
import { ignore } from './mutation_gate.mjs'
import { createReporter } from './reporter.mjs'

const reporter = createReporter('[test:svg]')

/** 判为"相近"的感知色距（OKLab ΔE）上限：低于该值即前景与背景几乎同色。 */
export const MIN_COLOR_DISTANCE = 0.05

/** 依次校验的主题。 */
const THEMES = ['light', 'dark']

/** 不直接绘制的 SVG 容器子树（defs / clip / mask / 渐变等），其内部 fill/stroke 不参与对比。 */
const NON_DRAWING_TAGS = new Set([
	'defs', 'symbol', 'clipPath', 'mask', 'filter', 'marker',
	'linearGradient', 'radialGradient', 'pattern', 'metadata', 'desc', 'title',
])

/** 直接绘制形状 / 文本的元素标签，读取其计算 fill/stroke。 */
const DRAWING_TAGS = new Set([
	'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
	'text', 'textPath', 'tspan', 'use',
])

/** 非绘制容器选择器：这些容器内部只作为裁剪/掩膜/渐变模板，不直接绘制到画布。 */
const NON_DRAWING_SELECTOR = [...NON_DRAWING_TAGS].join(', ')

/** 测量期间注入的样式：禁用过渡 / 动画，避免主题切换触发 transition 读到插值。 */
const MEASURE_STYLE = '*,*::before,*::after{transition:none !important;animation:none !important}'

/** sRGB → OKLab 的 LMS 中间矩阵（行主序 3×3）。 */
const LMS_FROM_RGB = [
	0.4122214708, 0.5363325363, 0.0514459929,
	0.2119034982, 0.6806995451, 0.1073969566,
	0.0883024619, 0.2817188376, 0.6299787005,
]

/** LMS → OKLab 矩阵（行主序 3×3）。 */
const OKLAB_FROM_LMS = [
	0.2104542553, 0.7936177850, -0.0040720468,
	1.9779984951, -2.4285922050, 0.4505937099,
	0.0259040371, 0.7827717662, -0.8086757660,
]

let dirty = true
let drainPassDone = false

/** 离屏 canvas（懒创建），用于把任意浏览器支持的 CSS 颜色字符串解析成 sRGB。 */
let colorCanvas = null

/** canvas fillStyle 哨兵值：设置目标色失败时保持不变，用于识别非法颜色字符串。 */
const FILL_STYLE_SENTINEL = '#010203'

/**
 * DOM 变化后置脏并唤醒。
 * @returns {void}
 */
function markDirty() {
	dirty = true
	wake()
}

/**
 * drain 覆盖是否完成。
 * @returns {boolean} 本轮 drain svg 已跑完则为 true
 */
function covered() {
	return drainPassDone
}

/**
 * drain 开始：重置覆盖并要求扫描。
 * @returns {void}
 */
function beginDrain() {
	drainPassDone = false
	dirty = true
}

/**
 * 线性化单个 sRGB 通道。
 * @param {number} value sRGB 通道值（0-255）
 * @returns {number} 线性亮度
 */
function linearizeChannel(value) {
	const channel = value / 255
	return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/**
 * 将 sRGB 三元组转为 OKLab。
 * @param {[number, number, number]} rgb sRGB [r, g, b]（0-255）
 * @returns {[number, number, number]} OKLab [L, a, b]
 */
export function srgbToOklab([r, g, b]) {
	const [lr, lg, lb] = [linearizeChannel(r), linearizeChannel(g), linearizeChannel(b)]
	const l = Math.cbrt(LMS_FROM_RGB[0] * lr + LMS_FROM_RGB[1] * lg + LMS_FROM_RGB[2] * lb)
	const m = Math.cbrt(LMS_FROM_RGB[3] * lr + LMS_FROM_RGB[4] * lg + LMS_FROM_RGB[5] * lb)
	const s = Math.cbrt(LMS_FROM_RGB[6] * lr + LMS_FROM_RGB[7] * lg + LMS_FROM_RGB[8] * lb)
	return [
		OKLAB_FROM_LMS[0] * l + OKLAB_FROM_LMS[1] * m + OKLAB_FROM_LMS[2] * s,
		OKLAB_FROM_LMS[3] * l + OKLAB_FROM_LMS[4] * m + OKLAB_FROM_LMS[5] * s,
		OKLAB_FROM_LMS[6] * l + OKLAB_FROM_LMS[7] * m + OKLAB_FROM_LMS[8] * s,
	]
}

/**
 * 计算两 sRGB 颜色的感知距离（OKLab ΔE）。
 * @param {[number, number, number]} first 颜色甲
 * @param {[number, number, number]} second 颜色乙
 * @returns {number} 感知色距
 */
export function colorDistance(first, second) {
	const [l1, a1, b1] = srgbToOklab(first)
	const [l2, a2, b2] = srgbToOklab(second)
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/**
 * 获取共享的离屏 canvas 2D context。
 * @returns {CanvasRenderingContext2D} canvas 2D context
 */
function getColorContext() {
	if (!colorCanvas) {
		colorCanvas = document.createElement('canvas')
		colorCanvas.width = 1
		colorCanvas.height = 1
	}
	return colorCanvas.getContext('2d', { willReadFrequently: true })
}

/**
 * 把 CSS 颜色字符串解析为 sRGB 三元组。
 * @param {string} colorString CSS 颜色值（oklch / color-mix / 等任意浏览器支持格式）
 * @returns {[number, number, number] | null} [r, g, b]；不可解析 / 透明 / none / currentColor 返回 null
 */
function cssColorToRgb(colorString) {
	if (!colorString) return null
	const color = colorString.trim()
	if (!color || color === 'none' || color === 'transparent' || color === 'currentColor') return null
	const context = getColorContext()
	context.fillStyle = FILL_STYLE_SENTINEL
	context.fillStyle = color
	if (context.fillStyle === FILL_STYLE_SENTINEL) return null
	context.clearRect(0, 0, 1, 1)
	context.fillRect(0, 0, 1, 1)
	const { data } = context.getImageData(0, 0, 1, 1)
	const [r, g, b, a] = data
	if (a < 255) return null
	return [r, g, b]
}

/**
 * 计算元素背后有效背景色：沿祖先链取首个不透明 background-color。
 * @param {Element} element 起始元素
 * @returns {[number, number, number] | null} sRGB 背景色；找不到返回 null
 */
function elementBackgroundColor(element) {
	let current = element
	while (current) {
		const color = cssColorToRgb(getComputedStyle(current).backgroundColor)
		if (color) return color
		current = current.parentElement
	}
	return null
}

/**
 * 收集 SVG 的渲染前景色集合。
 * @param {SVGSVGElement} svg SVG 元素
 * @returns {Set<string>} 颜色字符串集合（含 svg 根 color 与绘制元素的 fill/stroke）
 */
function collectSvgForegroundColors(svg) {
	const colors = new Set()
	const rootStyle = getComputedStyle(svg)
	colors.add(rootStyle.color)
	if (rootStyle.fill && rootStyle.fill !== 'none') colors.add(rootStyle.fill)
	if (rootStyle.stroke && rootStyle.stroke !== 'none') colors.add(rootStyle.stroke)
	for (const element of svg.querySelectorAll('*')) {
		const tag = element.tagName.toLowerCase()
		if (NON_DRAWING_TAGS.has(tag)) continue
		if (!DRAWING_TAGS.has(tag)) continue
		if (element.closest(NON_DRAWING_SELECTOR)) continue
		const elementStyle = getComputedStyle(element)
		colors.add(elementStyle.color)
		if (elementStyle.fill && elementStyle.fill !== 'none') colors.add(elementStyle.fill)
		if (elementStyle.stroke && elementStyle.stroke !== 'none') colors.add(elementStyle.stroke)
	}
	return colors
}

/**
 * SVG 是否真正渲染可见。
 * @param {SVGSVGElement} svg SVG 元素
 * @returns {boolean} 可见则为 true
 */
function isVisibleSvg(svg) {
	const rect = svg.getBoundingClientRect()
	if (!rect.width || !rect.height) return false
	for (let current = svg; current && current !== document.documentElement; current = current.parentElement) {
		const style = getComputedStyle(current)
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false
	}
	return true
}

/**
 * 生成 SVG 的简短定位描述。
 * @param {SVGSVGElement} svg SVG 元素
 * @returns {string} 定位描述
 */
function svgLocator(svg) {
	const parts = []
	const id = svg.getAttribute('id')
	if (id) parts.push(`#${id}`)
	const className = svg.getAttribute('class')
	if (className) parts.push(`.${className.trim().split(/\s+/).join('.')}`)
	const source = svg.getAttribute('src')
	if (source) parts.push(`[src=${source}]`)
	return `<svg${parts.join('')}>`
}

/**
 * 格式化 sRGB 三元组。
 * @param {[number, number, number]} rgb sRGB [r, g, b]
 * @returns {string} `#rrggbb`
 */
function formatRgb([r, g, b]) {
	return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 背景色是否由页面根级元素（body/html）提供。
 * @param {[number, number, number]} background 背景色
 * @returns {boolean} 由根级提供则为 true
 */
function isRootBackground(background) {
	for (const element of [document.body, document.documentElement]) {
		const rgb = cssColorToRgb(getComputedStyle(element).backgroundColor)
		if (rgb && rgb.join(',') === background.join(',')) return true
	}
	return false
}

/**
 * SVG 是否位于定位子树内（absolute/fixed/sticky/relative 容器）。
 * 这类浮层常叠加在同层级绘制的动态内容（hero 动画、全屏遮罩）之上，
 * 祖先链只能测到页面根背景，真实衬底无法仅凭祖先背景确定。
 * @param {SVGSVGElement} svg SVG 元素
 * @returns {boolean} 是定位浮层则为 true
 */
function isPositionedOverlay(svg) {
	for (let current = svg.parentElement; current && current !== document.documentElement; current = current.parentElement)
		if (getComputedStyle(current).position !== 'static') return true
	return false
}

/**
 * 在指定主题下扫描 SVG 前景/背景色距问题。
 * @param {string} theme 主题名
 * @param {SVGSVGElement[]} svgs 可见 SVG 列表
 * @returns {Array<{ svg: SVGSVGElement, background: [number, number, number], foreground: [number, number, number] }>} 问题列表
 */
function findSvgContrastIssues(theme, svgs) {
	document.documentElement.dataset.theme = theme
	const issues = []
	for (const svg of svgs) {
		const background = elementBackgroundColor(svg)
		if (!background) continue
		// 浮层叠加在动态绘制内容上、祖先链只测到页面根背景时，衬底不可测，跳过以免误报。
		if (isRootBackground(background) && isPositionedOverlay(svg)) continue
		/** @type {Set<string>} */
		const foregrounds = new Set()
		for (const color of collectSvgForegroundColors(svg)) {
			const rgb = cssColorToRgb(color)
			if (rgb) foregrounds.add(rgb.join(','))
		}
		for (const key of foregrounds) {
			const foreground = key.split(',').map(Number)
			if (colorDistance(foreground, background) < MIN_COLOR_DISTANCE) {
				issues.push({ svg, background, foreground })
				break
			}
		}
	}
	return issues
}

/**
 * loop 回调：跑一轮 SVG 主题对比或空转。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {boolean} true = 空转
 */
function run({ draining }) {
	if (!dirty && !(draining && !drainPassDone)) return true
	dirty = false
	try {
		const svgs = [...document.querySelectorAll('svg')].filter(isVisibleSvg)
		if (!svgs.length) return false
		ignore(() => {
			const measureStyle = document.createElement('style')
			measureStyle.textContent = MEASURE_STYLE
			document.documentElement.appendChild(measureStyle)
			const originalTheme = document.documentElement.getAttribute('data-theme')
			try {
				for (const theme of THEMES)
					for (const { svg, background, foreground } of findSvgContrastIssues(theme, svgs))
						reporter.report(
							`svg-theme-contrast\t${theme}\t${svgLocator(svg)}\t${formatRgb(foreground)}\t${formatRgb(background)}`,
							theme,
							svgLocator(svg),
							formatRgb(foreground),
							formatRgb(background),
							'前景色与背景色太相近，图标在该主题下不可辨',
						)
			}
			finally {
				if (originalTheme) document.documentElement.dataset.theme = originalTheme
				else document.documentElement.removeAttribute('data-theme')
				measureStyle.remove()
			}
		})
	}
	finally {
		if (draining) drainPassDone = true
	}
	return false
}

/** 任务轮转间隔 */
const SVG_THEME_SCAN_MS = 500

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'svg', delayMs: SVG_THEME_SCAN_MS, run, covered, beginDrain }

/**
 * 导出 markDirty，供 mutations 观察者在 DOM 变化时联动置脏并重扫。
 */
export { markDirty }
