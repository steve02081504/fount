/**
 * 浏览器端调试日志写入工具。
 * 将调试数据通过 API 提交到服务端 `debug_logs/` 目录。
 * @param {string} name 日志文件名（不含扩展名，服务端会追加 `.log`）。
 * @param {unknown} data 要写入的调试数据。
 * @returns {Promise<void>}
 */
export async function debugLog(name, data) {
	await fetch('/api/test/debug-log', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, data }),
	})
}
