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
