/**
 * preloadrunner：在 iframe 内拉取预加载列表，用 link rel="preload" / modulepreload 预取资源后通知 parent 移除 iframe。
 */

import { runWithConcurrencyPerGroup } from '/scripts/lib/concurrency.mjs'

/**
 * 每个 hostname 的预取并发上限。
 * 列表里绝大多数资源集中在少数第三方 CDN（esm.sh 的模块、jsDelivr 的样式），
 * 一次性把几十个请求全丢给同一个对端会被限流；而按 host 分别限流既不会打爆单个对端，
 * 也不会让一个慢站点挡住别的站点。
 */
const PRELOAD_CONCURRENCY_PER_HOST = 6

/**
 * 单个预取项的上限（毫秒）。
 * `link` 的 load/error 并非一定会触发（例如被判为「未被使用」而被浏览器取消的 preload），
 * 没有上限时一个挂住的项会永久占住一个槽位，后面的项永远不开始，`preloadrunner-done` 也就发不出去。
 */
const PRELOAD_ITEM_TIMEOUT_MS = 5000

const typeMap = {
	mjs: {
		rel: 'modulepreload',
		as: 'script',
	},
	css: {
		rel: 'preload',
		as: 'style',
	},
	js: {
		rel: 'preload',
		as: 'script',
	},
	resource: {
		rel: 'preload',
		as: 'fetch',
		crossOrigin: 'anonymous',
	},
}

/**
 * 加载单个资源。
 * @param {{ url: string, type: keyof typeof typeMap }} item - 资源项。
 * @returns {Promise<void>} - 加载完成（或超过单项上限）的 Promise。
 */
function loadOne(item) {
	const { url, type } = item
	return new Promise(resolve => {
		const el = document.createElement('link')
		Object.assign(el, typeMap[type])
		el.href = url
		/**
		 * 加载成功 / 失败 / 超时都放行，避免一个挂住的项占死槽位。
		 * @returns {void}
		 */
		const finish = () => {
			clearTimeout(timer)
			resolve()
		}
		const timer = setTimeout(finish, PRELOAD_ITEM_TIMEOUT_MS)
		el.onload = el.onerror = finish
		document.head.appendChild(el)
	})
}

/**
 * 取预取项所属的 hostname，用于按 host 分别限流。
 * @param {{ url: string }} item - 预取项
 * @returns {string} hostname
 */
function hostOf(item) {
	return new URL(item.url).hostname
}

/**
 * 运行预加载。
 * @returns {Promise<void>} - 预加载完成的 Promise。
 */
async function run() {
	const response = await fetch('/preloadrunner/data.json', { credentials: 'include' })
	if (!response.ok) return
	const list = await response.json()
	// 列表由服务端 mergeAndDedupe 按「被引用次数」降序给出，常用的排前面；组内保持该顺序。
	await runWithConcurrencyPerGroup(list, {
		limit: PRELOAD_CONCURRENCY_PER_HOST,
		keyOf: hostOf,
		worker: loadOne,
	})
	try { window.parent.postMessage({ type: 'preloadrunner-done' }, window.location.origin) } catch (_) { }
}

/**
 * 预取失败时上报并通知 parent 移除 iframe。
 * @param {unknown} error - 抛出的错误
 * @returns {Promise<void>} 无返回值
 */
async function reportPreloadFailure(error) {
	const Sentry = await import('https://esm.sh/@sentry/browser')
	Sentry.captureException(error)
	window.parent.postMessage({ type: 'preloadrunner-done' }, window.location.origin)
}

run().catch(reportPreloadFailure)
