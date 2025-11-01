import { __dirname } from '../server/base.mjs'

/**
 * 运行一个工作线程。
 * @param {string} name - 工作线程的名称。
 * @returns {Worker} 新的工作线程实例。
 */
export function runWorker(name) {
	return new Worker(new URL(`./${name}.mjs`, import.meta.url), { type: 'module' })
}
/**
 * 运行一个简单的工作线程并返回一个Promise。
 * @param {string} name - 工作线程的名称。
 * @returns {Promise<any>} 一个解析为工作线程结果的Promise。
 */
export function runSimpleWorker(name) {
	const worker = runWorker(name)
	return new Promise((resolve, reject) => {
		/**
		 * 处理来自工作线程的消息。
		 * @param {MessageEvent} event - 消息事件。
		 * @returns {void}
		 */
		worker.onmessage = event => {
			worker.terminate()
			switch (event.data.type) {
				case 'resolve': {
					return resolve(event.data.data)
				}
				case 'reject': {
					return reject(event.data.data)
				}
			}
		}
		/**
		 * 处理工作线程中的错误。
		 * @param {ErrorEvent} error - 错误事件。
		 * @returns {void}
		 */
		worker.onerror = error => {
			worker.terminate()
			reject(error)
		}
		worker.postMessage({ type: 'init', __dirname })
	})
}
