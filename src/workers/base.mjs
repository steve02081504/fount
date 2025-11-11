/**
 * 工作线程的主目录。
 */
export let __dirname
let main
/**
 * 设置工作线程的主函数。
 * @param {Function} fn - 要在工作线程中执行的主函数。
 * @returns {void}
 */
export function setMain(fn) { main = fn }
/**
 * 处理从主线程发送的消息。
 * @param {MessageEvent} e - 消息事件。
 * @returns {Promise<void>}
 */
self.onmessage = async e => {
	switch (e.data.type) {
		case 'init': {
			__dirname = e.data.__dirname
			const result = await main()
			self.postMessage({
				type: 'resolve',
				data: result,
			})
			break
		}
	}
}
/**
 * 捕获工作线程中的错误。
 * @param {ErrorEvent} e - 错误事件。
 * @returns {void}
 */
self.onerror = e => {
	self.postMessage({
		type: 'reject',
		data: e.error?.stack || e.error?.message || e.error || e.message || e,
	})
}
