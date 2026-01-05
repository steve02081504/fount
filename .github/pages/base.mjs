/** @type {import('npm:@sentry/browser')} */
import * as Sentry from 'https://esm.sh/@sentry/browser'
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { svgInliner } from './scripts/svgInliner.mjs'

let skipBreadcrumb = false
Sentry.init({
	dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
	/**
	 * @param {object} breadcrumb - 面包屑对象。
	 * @param {object} hint - 提示对象。
	 * @returns {object | null} 修改后的面包屑，或返回 null 以丢弃它。
	 */
	beforeBreadcrumb: (breadcrumb, hint) => {
		if (skipBreadcrumb) return null
		return breadcrumb
	},
	sendDefaultPii: true,
	integrations: [
		Sentry.browserTracingIntegration()
	],
	// Performance Monitoring
	tracesSampleRate: 1.0,
	tracePropagationTargets: [window.location.origin || 'https://steve02081504.github.io'],
})
console.noBreadcrumb = {
	/**
	 * 写入日志并跳过面包屑记录
	 * @param {...any} args - 要记录的日志
	 */
	log: (...args) => {
		skipBreadcrumb = true
		console.log(...args)
		skipBreadcrumb = false
	}
}

await import('https://cdn.jsdelivr.net/gh/steve02081504/js-polyfill/index.mjs').catch(console.error)

/* global urlParams */
/**
 * 当前应用程序的主题
 */
export let theme_now

/**
 * 自定义样式标签的 ID
 * @constant {string}
 */
const CUSTOM_STYLE_ID = 'custom-theme-style'

/**
 * 将自定义 CSS 注入到页面头部。
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
 * 当前加载的自定义主题 MJS 模块（包含 load 和 unload 函数）
 * @type {Object|null}
 */
let currentCustomMjsModule = null

/**
 * 加载自定义主题的 MJS 脚本。
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
		if (evalResult.error)
			return console.error('Failed to evaluate custom theme MJS:', evalResult.error)

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
 * 设置应用程序的主题。
 * @param {string} theme - 要设置的主题（例如 'dark', 'light', 'auto'）。
 */
export function setTheme(theme) {
	const cachedName = localStorage.getItem('fountCustomThemeName') // fount public中的存储key和fount实例中的不一样
	const cachedCss = localStorage.getItem('fountCustomThemeCss')
	const cachedMjs = localStorage.getItem('fountCustomThemeMjs')
	if (theme_now === cachedName && cachedCss) {
		injectCustomStyle(cachedCss)
		if (cachedMjs) loadCustomMjs(cachedMjs)
	}
	else {
		if (cachedCss) removeCustomStyle()
		if (cachedMjs) unloadCustomMjs()
	}
	if (theme === theme_now) return
	theme_now = theme
	localStorage.setItem('fountTheme', theme)
	if (theme === 'auto') theme = null
	theme ||= window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
	if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
	const bcColor = getComputedStyle(document.documentElement).getPropertyValue('background-color').trim()
	let metaThemeColor = document.querySelector('meta[name="theme-color"]')
	if (!metaThemeColor) {
		metaThemeColor = document.createElement('meta')
		metaThemeColor.name = 'theme-color'
		document.head.appendChild(metaThemeColor)
	}
	metaThemeColor.content = bcColor
}
setTheme(localStorage.getItem('fountTheme') ?? 'dark')

svgInliner(document)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
	setTheme(localStorage.getItem('fountTheme'))
})

/**
 * 设置预渲染。
 * @param {string} [hostUrl] - 主机 URL。
 */
export function setPreRender(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl') ?? 'http://localhost:8931') {
	if (HTMLScriptElement.supports?.('speculationrules')) {
		const specScript = document.createElement('script')
		specScript.type = 'speculationrules'
		specScript.textContent = JSON.stringify({
			prerender: [{
				urls: [hostUrl + '/parts/shells/home']
			}]
		})
		document.head.prepend(specScript)
	}
	else {
		const link = document.createElement('link')
		link.rel = 'prerender'
		link.href = hostUrl + '/parts/shells/home'
		document.head.prepend(link)
	}
}

/**
 * 应用程序的基础目录
 */
export const base_dir = '../'.repeat(window.location.pathname.split('/').length - 3).slice(0, -1)

if ('serviceWorker' in navigator)
	navigator.serviceWorker.register('/sw.js')
		.catch(error => {
			console.error('Service Worker registration failed: ', error)
		})

/**
 * 处理键盘事件。
 * @param {KeyboardEvent} event - 键盘事件。
 * @returns {void}
 */
document.addEventListener('keydown', event => {
	switch (event.key) {
		case 'Escape':
			if (history.length > 1) history.back()
			else window.close()
			break
		case 'F1':
			window.open('https://discord.gg/GtR9Quzq2v', '_blank')
			break
	}
})

; (f => document.readyState === 'complete' ? f() : window.addEventListener('load', f))(async () => {
	try {
		console.noBreadcrumb.log(...await fetch('https://cdn.jsdelivr.net/gh/steve02081504/fount/imgs/icon.js').then(r => r.text()).then(eval))
	} catch (error) { console.error(error) }
	console.log('Curious? Join us and build future together: https://github.com/steve02081504/fount')
})
