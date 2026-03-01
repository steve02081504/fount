/**
 * preloadrunner：在 iframe 内拉取预加载列表，用 link rel="preload" / modulepreload 预取资源后通知 parent 移除 iframe。
 */

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
 * @param {{ url: string, type: keyof typeof typeMap }} item - 资源项。
 * @returns {Promise<void>} - 加载完成的 Promise。
 */
function loadOne(item) {
	const { url, type } = item
	return new Promise((resolve) => {
		const el = document.createElement('link')
		Object.assign(el, typeMap[type])
		el.href = url
		/**
		 * 加载完成时 resolve。
		 * @returns {void}
		 */
		el.onload = el.onerror = () => resolve()
		document.head.appendChild(el)
	})
}

/**
 * 运行预加载。
 * @returns {Promise<void>} - 预加载完成的 Promise。
 */
async function run() {
	const response = await fetch('/preloadrunner/data.json', { credentials: 'include' })
	if (!response.ok) return
	const list = await response.json()
	await Promise.all(list.map(loadOne))
	try { window.parent.postMessage({ type: 'preloadrunner-done' }, '*') } catch (_) {}
}

run()
