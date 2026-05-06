const BASE = '/api/parts/shells:debug_info'

/**
 * 获取自动更新是否已启用。
 * @returns {Promise<{enabled: boolean}>} 自动更新状态。
 */
export async function getAutoUpdateEnabled() {
	const res = await fetch(`${BASE}/auto_update_enabled`)
	return res.json()
}

/**
 * 触发服务器重启以应用更新。
 * @returns {Promise<{ok: boolean, data: object}>} 响应状态及数据。
 */
export async function postRestart() {
	const res = await fetch(`${BASE}/restart`, { method: 'POST' })
	return { ok: res.ok, data: await res.json().catch(() => ({})) }
}

/**
 * 获取系统信息及后端连通性检测结果。
 * @returns {Promise<object>} 系统信息对象。
 */
export async function getSystemInfo() {
	const res = await fetch(`${BASE}/system_info`)
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	return res.json()
}

/**
 * 打开日志调用位置对应源码。
 * @param {string} filePath - 文件路径。
 * @param {number} line - 行号。
 * @param {number} column - 列号。
 * @returns {Promise<{success: boolean, message?: string}>} 打开结果。
 */
export async function openSource(filePath, line, column) {
	const res = await fetch(`${BASE}/open_source`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ filePath, line, column }),
	})
	return res.json()
}

/**
 * 创建后台日志 WebSocket 连接。
 * @returns {WebSocket} 日志 WS。
 */
export function createLogsWs() {
	const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	return new WebSocket(`${wsProto}//${window.location.host}/ws/logs`)
}
