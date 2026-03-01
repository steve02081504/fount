/**
 * 预加载 URL：在非省流模式下通过 0×0 iframe 打开 preloadrunner 页，由该页内拉取列表并预取资源，完成后移除 iframe。
 * @module preloadUrls
 */

/**
 * 在页面加载完成后，若未开启省流，则通过 0×0 iframe 打开 preloadrunner，由其内拉取列表并预取资源，完成后移除 iframe。
 * @returns {Promise<void>} - 预加载完成的 Promise。
 */
export function runPreloadIfNotSaveData() {
	if (navigator.connection?.saveData) return Promise.resolve()
	const iframe = document.createElement('iframe')
	iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
	iframe.src = '/preloadrunner/'
	return new Promise((resolve) => {
		/**
		 * 处理消息事件。
		 * @param {MessageEvent} e - 消息事件。
		 */
		const onMessage = (e) => {
			if (e.data?.type === 'preloadrunner-done' && e.origin === window.location.origin) cleanup()
		}
		/**
		 * 清理 iframe 并移除事件监听。
		 * @returns {void}
		 */
		const cleanup = () => {
			try {
				window.removeEventListener('message', onMessage)
				iframe.remove()
				resolve()
			} catch (_) { }
		}
		window.addEventListener('message', onMessage)
		document.body.appendChild(iframe)
	})
}
