const DEBUG_INFO_BASE = '/api/parts/shells:debug_info'

/**
 * 创建 WebSocket 连接。
 * @param {string} path - WS 路径（如 `/ws/logs`）。
 * @returns {WebSocket} WebSocket 实例。
 */
function createWs(path) {
	const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	return new WebSocket(`${wsProto}//${window.location.host}${path}`)
}

/**
 * 打开日志调用位置对应源码。
 * @param {string} filePath - 文件路径。
 * @param {number} line - 行号。
 * @param {number} column - 列号。
 * @returns {Promise<void>}
 */
export async function openSource(filePath, line, column) {
	const res = await fetch(`${DEBUG_INFO_BASE}/open_source`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ filePath, line, column }),
	})
	if (!res.ok) {
		const data = await res.json().catch(() => ({}))
		throw Object.assign(new Error(data.message || res.statusText), data)
	}
}

/**
 * 创建后台日志 WebSocket 连接。
 * @returns {WebSocket} 日志 WS。
 */
export function createLogsWs() {
	return createWs('/ws/logs')
}

/**
 * 创建 eval REPL WebSocket 连接。
 * @returns {WebSocket} eval WS。
 */
export function createEvalWs() {
	return createWs('/ws/eval')
}
