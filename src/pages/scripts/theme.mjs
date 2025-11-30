import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initLinesBackground, updateColors as updateLinesBackgroundColors } from './linesBackground.mjs'
import { svgInliner } from './svgInliner.mjs'

/**
 * 自定义样式标签的 ID
 * @constant {string}
 */
const CUSTOM_STYLE_ID = 'custom-theme-style'

/**
 * 本地存储中当前主题名称的键名
 * @constant {string}
 */
const STORAGE_KEY_THEME = 'theme'

/**
 * 本地存储中自定义主题远程 URL 的键名
 * @constant {string}
 */
const STORAGE_KEY_CUSTOM_URL = 'custom_theme_url'

/**
 * 本地存储中自定义主题 CSS 内容的键名
 * @constant {string}
 */
const STORAGE_KEY_CUSTOM_CSS = 'custom_theme_css'

/**
 * 本地存储中自定义主题名称的键名
 * @constant {string}
 */
const STORAGE_KEY_CUSTOM_NAME = 'custom_theme_name'

/**
 * 本地存储中自定义主题 MJS 脚本的键名
 * @constant {string}
 */
const STORAGE_KEY_CUSTOM_MJS = 'custom_theme_mjs'

/**
 * 解析 oklch 颜色字符串并获取亮度。
 * @param {string} colorString - oklch 颜色字符串，例如 "oklch(0.5 0.2 240)"。
 * @returns {number|null} - 亮度值 (0-100) 或 null (如果无法解析)。
 */
function parseOklch(colorString) {
	const oklchRegex = /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*\)/
	if (oklchRegex.test(colorString)) {
		const match = colorString.match(oklchRegex)
		let lightness = parseFloat(match[1])
		if (!match[1].endsWith('%'))
			lightness *= 100 // Convert 0-1 to percentage

		return lightness
	}
	return null
}

/**
 * 解析 rgb/rgba 颜色字符串并计算亮度 (感知亮度)。
 * @param {string} colorString - rgb 或 rgba 颜色字符串。
 * @returns {number|null} - 亮度值 (0-100) 或 null。
 */
function parseRgb(colorString) {
	const rgbRegex = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/
	const rgbaRegex = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
	if (rgbRegex.test(colorString) || rgbaRegex.test(colorString)) {
		const match = colorString.match(rgbRegex) || colorString.match(rgbaRegex)
		const r = parseInt(match[1], 10)
		const g = parseInt(match[2], 10)
		const b = parseInt(match[3], 10)
		// sRGB luminance calculation
		const a = [r, g, b].map(v => {
			v /= 255
			return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
		})
		return (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) * 100
	}
	return null
}

/**
 * 解析 hsl/hsla 颜色字符串并获取亮度。
 * @param {string} colorString - hsl 或 hsla 颜色字符串。
 * @returns {number|null} - 亮度值 (0-100) 或 null。
 */
function parseHsl(colorString) {
	const hslRegex = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*\)/
	const hslaRegex = /hsla\(\s*([\d.]+)\s*,\s*([\d.]+%)\s*,\s*([\d.]+%)\s*,\s*([\d.]+)\s*\)/
	if (hslRegex.test(colorString) || hslaRegex.test(colorString)) {
		const match = colorString.match(hslRegex) || colorString.match(hslaRegex)
		let lightness = parseFloat(match[3]) // L in HSL is the lightness.
		if (!match[3].endsWith('%'))
			lightness *= 100 // Convert non-% to percentage

		return lightness
	}
	return null
}

/**
 * 当前应用的主题名称。
 * @type {string}
 */
let theme_now

/**
 * 当前是否为暗黑模式。
 * 初始化时基于系统偏好设置。
 * @type {boolean}
 */
export let is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)

/**
 * 记录上一次检测到的背景颜色，用于检测变化。
 * @type {string}
 */
let oldBcColor

/**
 * 主题变更时的回调函数列表。
 * @type {Array<Function>}
 */
const functions = []

/**
 * 当前加载的自定义主题 MJS 模块（包含 load 和 unload 函数）
 * @type {Object|null}
 */
let currentCustomMjsModule = null

/**
 * 加载自定义主题的 MJS 脚本。
 * MJS 脚本应该导出一个对象，包含 load 和 unload 函数。
 * @param {string} mjsCode - MJS 脚本代码字符串。
 * @returns {Promise<void>}
 */
async function loadCustomMjs(mjsCode) {
	if (!mjsCode) return

	// 先卸载之前的模块
	await unloadCustomMjs()

	try {
		// 使用 async_eval 执行 MJS 代码
		const evalResult = await async_eval(mjsCode)
		if (evalResult.error) {
			console.error('Failed to evaluate custom theme MJS:', evalResult.error)
			return
		}

		const module = evalResult.result

		// 保存模块引用
		currentCustomMjsModule = module

		// 调用 load 函数（如果存在）
		await module?.load?.()
	} catch (error) {
		console.error('Error loading custom theme MJS:', error)
	}
}

/**
 * 卸载当前加载的自定义主题 MJS 模块。
 * @returns {Promise<void>}
 */
async function unloadCustomMjs() {
	try {
		// 调用 unload 函数（如果存在）
		await currentCustomMjsModule?.unload?.()
	} catch (error) {
		console.error('Error unloading custom theme MJS:', error)
	} finally {
		currentCustomMjsModule = null
	}
}

/**
 * 将自定义 CSS 注入到页面头部。
 * 如果样式标签已存在且内容相同，则不进行操作。
 * @param {string} css - CSS 内容字符串。
 * @returns {void}
 */
function injectCustomStyle(css) {
	let styleEl = document.getElementById(CUSTOM_STYLE_ID)
	if (!styleEl) {
		styleEl = document.createElement('style')
		styleEl.id = CUSTOM_STYLE_ID
		document.head.appendChild(styleEl)
	}
	if (styleEl.textContent !== css)
		styleEl.textContent = css
}

/**
 * 从页面中移除自定义样式标签。
 * @returns {void}
 */
function removeCustomStyle() {
	const styleEl = document.getElementById(CUSTOM_STYLE_ID)
	if (styleEl) styleEl.remove()
}

/**
 * 清理本地存储中关于自定义主题的所有数据，并移除样式标签。
 * 通常在切换回内置主题时调用。
 * @returns {Promise<void>}
 */
async function clearCustomThemeData() {
	await unloadCustomMjs()
	localStorage.removeItem(STORAGE_KEY_CUSTOM_URL)
	localStorage.removeItem(STORAGE_KEY_CUSTOM_CSS)
	localStorage.removeItem(STORAGE_KEY_CUSTOM_NAME)
	localStorage.removeItem(STORAGE_KEY_CUSTOM_MJS)
	removeCustomStyle()
}

/**
 * 检查 DOM 的背景颜色是否发生变化。
 * 如果发生变化，触发 updateColors 更新全局状态。
 * @returns {void}
 */
function check_color_change() {
	const computedStyle = getComputedStyle(document.documentElement)
	const bcColor = computedStyle.getPropertyValue('background-color').trim()
	if (oldBcColor !== bcColor) {
		updateColors()
		oldBcColor = bcColor
	}
}

/**
 * 自动调整页面中所有 iframe 的高度以适应内容。
 * @returns {void}
 */
function autoresize_frames() {
	const frames = document.querySelectorAll('iframe')
	for (const frame of frames) try {
		if (frame.contentWindow?.document?.body) {
			const frame_width = frame.contentWindow.document.body.scrollWidth
			const frame_height = frame.contentWindow.document.body.scrollHeight
			frame.style.width = frame_width + 'px'
			frame.style.height = frame_height + 'px'
		}
	} catch (e) { }
}

/**
 * 内部核心函数：将主题应用到 DOM 元素并更新内部状态。
 * 此函数不处理本地存储清理逻辑，仅负责应用。
 * @param {string} theme - 目标主题名称。
 * @returns {void}
 */
function applyThemeToDOM(theme) {
	let resolvedTheme = theme
	if (resolvedTheme === 'auto' || !resolvedTheme)
		resolvedTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

	if (theme === theme_now && document.documentElement.getAttribute('data-theme') === resolvedTheme) return

	theme_now = theme
	localStorage.setItem(STORAGE_KEY_THEME, theme)

	if (document.documentElement.getAttribute('data-theme') !== resolvedTheme)
		document.documentElement.setAttribute('data-theme', resolvedTheme)
}

/**
 * 主题心跳检测函数，由定时器调用。
 * 用于同步多标签页状态、调整 iframe 大小以及检测颜色变化。
 * @returns {void}
 */
function themeHeartbeat() {
	const currentStored = localStorage.getItem(STORAGE_KEY_THEME)
	if (currentStored && currentStored !== theme_now) setTheme(currentStored)
	autoresize_frames()
	check_color_change()
}

/**
 * 初始化并应用主题。
 * 读取本地存储，恢复上次的主题设置（包括自定义主题），并启动后台检测任务。
 * @returns {Promise<void>}
 */
export const applyTheme = async () => {
	const storedTheme = localStorage.getItem(STORAGE_KEY_THEME)
	const customCss = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
	const customUrl = localStorage.getItem(STORAGE_KEY_CUSTOM_URL)

	if (customCss) injectCustomStyle(customCss)

	setTheme(storedTheme)

	svgInliner(document)
	setTimeout(initLinesBackground, 750)
	setInterval(themeHeartbeat, 1000)

	if (customUrl) try {
		const res = await fetch(customUrl)
		if (!res.ok) throw new Error(`Fetch error: ${res.status}`)
		const data = await res.json()
		const newCss = data.css

		if (newCss && newCss !== customCss) {
			localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, newCss)
			injectCustomStyle(newCss)
		}
	}
	catch (e) {
		console.warn(`Failed to update custom theme from ${customUrl}:`, e)
	}
}

/**
 * 设置当前主题。
 * 如果设置的主题名称与当前存储的自定义主题名称不匹配，会自动清理自定义主题数据。
 * @param {string} theme - 主题名称（例如 'light', 'dark', 'my-custom-theme'）。
 * @returns {Promise<void>}
 */
export async function setTheme(theme) {
	const storedCustomName = localStorage.getItem(STORAGE_KEY_CUSTOM_NAME)
	const storedCustomCss = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
	const storedCustomMjs = localStorage.getItem(STORAGE_KEY_CUSTOM_MJS)

	if (theme === storedCustomName && storedCustomName) {
		if (storedCustomCss) injectCustomStyle(storedCustomCss)
		if (storedCustomMjs) await loadCustomMjs(storedCustomMjs)
	}
	else
		if (theme !== 'auto' && theme) await clearCustomThemeData()

	applyThemeToDOM(theme)
}

/**
 * 设置自定义主题并尝试从 URL 更新配置。
 * @param {string} name - 自定义主题的名称。
 * @param {string} url -包含主题配置（JSON格式，含 css 和 mjs 字段）的远程 URL。
 * @returns {Promise<void>}
 */
export async function setCustomTheme(name, url) {
	localStorage.setItem(STORAGE_KEY_CUSTOM_URL, url)
	localStorage.setItem(STORAGE_KEY_CUSTOM_NAME, name)

	try {
		const res = await fetch(url)
		if (!res.ok) throw new Error('Network response was not ok')
		const data = await res.json()
		const css = data.css
		const mjs = data.mjs

		if (css) await setCustomThemeNoUpdateUrl(name, css, mjs)
	} catch (e) {
		console.error('Failed to fetch custom theme:', e)
	}
}

/**
 * 设置自定义主题（直接使用提供的 CSS 和 MJS，不更新 URL）。
 * @param {string} name - 自定义主题的名称。
 * @param {string} css - 自定义主题的 CSS 内容。
 * @param {string} [mjs] - 自定义主题的 MJS 脚本内容（可选）。
 * @returns {Promise<void>}
 */
export async function setCustomThemeNoUpdateUrl(name, css, mjs) {
	localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, css)
	localStorage.setItem(STORAGE_KEY_CUSTOM_NAME, name)
	if (mjs)
		localStorage.setItem(STORAGE_KEY_CUSTOM_MJS, mjs)
	else
		localStorage.removeItem(STORAGE_KEY_CUSTOM_MJS)

	injectCustomStyle(css)
	if (mjs) await loadCustomMjs(mjs)
	await setTheme(name)
}

/**
 * 注册当主题或颜色模式发生变化时的回调函数。
 * @param {Function} callback - 回调函数，接收 (themeName, isDark) 参数。
 * @returns {void}
 */
export function onThemeChange(callback) {
	try {
		callback(theme_now, is_dark)
	}
	catch (e) {
		console.error(e)
	}
	functions.push(callback)
}

/**
 * 获取当前正在使用的主题名称。
 * @returns {string} - 主题名称。
 */
export function getCurrentTheme() {
	return theme_now
}

/**
 * 导出当前主题配置（支持自定义和内置）。
 * @returns {object} - 包含主题信息的 JSON 对象。
 */
export function exportCurrentTheme() {
	const isCustom = !!localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
	const exportData = {
		name: theme_now,
		type: isCustom ? 'custom' : 'builtin',
	}
	if (isCustom) {
		exportData.css = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
		const mjs = localStorage.getItem(STORAGE_KEY_CUSTOM_MJS)
		if (mjs) exportData.mjs = mjs
		const url = localStorage.getItem(STORAGE_KEY_CUSTOM_URL)
		if (url) exportData.url = url
	}
	return exportData
}

/**
 * 序列化当前主题为可传递的对象。
 * 如果当前主题是自定义主题，包含 CSS 和 MJS；否则只返回主题名称。
 * @returns {object} - 包含主题信息的对象 { name, css?, mjs? }
 */
export function serializeCurrentTheme() {
	const themeName = theme_now
	const customName = localStorage.getItem(STORAGE_KEY_CUSTOM_NAME)
	const customCss = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
	const customMjs = localStorage.getItem(STORAGE_KEY_CUSTOM_MJS)

	const result = { name: themeName }

	// 如果当前主题是自定义主题，包含其 CSS 和 MJS
	if (themeName === customName && customCss) {
		result.css = customCss
		result.mjs = customMjs
	}

	return result
}

/**
 * 从导出的数据对象中导入并设置主题。
 * @param {object} themeData - 包含 name, type, css, mjs, url 等字段的主题数据对象。
 * @returns {Promise<void>}
 */
export async function importAndSetTheme(themeData) {
	if (!themeData || !themeData.name) return

	if (themeData.type === 'custom' && themeData.css) {
		if (themeData.url) localStorage.setItem(STORAGE_KEY_CUSTOM_URL, themeData.url)
		await setCustomThemeNoUpdateUrl(themeData.name, themeData.css, themeData.mjs)
	} else
		await setTheme(themeData.name)
}

/**
 * 更新当前的颜色状态（亮色/暗色）。
 * 计算背景颜色的亮度并通知所有监听器。
 * @returns {void}
 */
function updateColors() {
	// 使用 getComputedStyle 获取背景颜色的计算值 (即解析 var(--bc))
	const computedStyle = getComputedStyle(document.documentElement)
	const bcColor = computedStyle.getPropertyValue('background-color').trim()

	let metaThemeColor = document.querySelector('meta[name="theme-color"]')
	if (!metaThemeColor) {
		metaThemeColor = document.createElement('meta')
		metaThemeColor.name = 'theme-color'
		document.head.appendChild(metaThemeColor)
	}
	metaThemeColor.content = bcColor

	let lightness = null

	if (bcColor) {
		lightness = parseOklch(bcColor)
		lightness ??= parseRgb(bcColor)
		lightness ??= parseHsl(bcColor)

		if (lightness !== null) {
			const threshold = 55  // 55% 亮度阈值
			is_dark = lightness < threshold
		}
		else // 如果无法解析颜色格式，回退到系统偏好
			is_dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	}
	else // 如果未定义背景色，回退到系统偏好
		is_dark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)

	document.documentElement.setAttribute('color-scheme', is_dark ? 'dark' : 'light')

	updateLinesBackgroundColors()
	for (const func of functions) try {
		func(theme_now, is_dark)
	}
	catch (e) {
		console.error(e)
	}
}

// ----------------------------------------------------------------------
// 事件监听与观察者
// ----------------------------------------------------------------------

// 监听 MutationObserver 以响应 data-theme 属性的变化
const observer = new MutationObserver(mutationsList => {
	for (const mutation of mutationsList)
		if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme')
			setTimeout(themeHeartbeat)
})
observer.observe(document.documentElement, { attributes: true })

// 监听系统颜色偏好变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
	// 只有当设置为 auto 时，才响应系统变化
	const stored = localStorage.getItem(STORAGE_KEY_THEME)
	if (stored === 'auto' || !stored) setTheme('auto')
})

// 页面重新获焦时，重新读取存储中的 CSS、MJS 和主题设置（跨标签页同步）
window.addEventListener('focus', async () => {
	const css = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)
	if (css) injectCustomStyle(css)

	const mjs = localStorage.getItem(STORAGE_KEY_CUSTOM_MJS)
	if (mjs && !currentCustomMjsModule) await loadCustomMjs(mjs)

	const currentTheme = localStorage.getItem(STORAGE_KEY_THEME)
	if (currentTheme && currentTheme !== theme_now)
		await setTheme(currentTheme)
})

// ----------------------------------------------------------------------
// 资源加载
// ----------------------------------------------------------------------

{
	// 预先插入 daisyUI 官方主题 CSS
	const daisyui_theme_style = document.createElement('link')
	daisyui_theme_style.rel = 'stylesheet'
	daisyui_theme_style.href = 'https://cdn.jsdelivr.net/npm/daisyui/themes.css'
	daisyui_theme_style.crossorigin = 'anonymous'
	document.head.prepend(daisyui_theme_style)
}

/**
 * daisyUI 内置支持的主题列表。
 * 从 CDN 动态导入。
 * @type {Promise<string[]>}
 */
export const builtin_themes = await import('https://cdn.jsdelivr.net/npm/daisyui/functions/themeOrder.js').then(m => m.default).catch(() => ['dark', 'light'])
