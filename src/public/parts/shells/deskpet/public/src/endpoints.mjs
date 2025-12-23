/**
 * 桌面宠物 shell 的客户端 API 端点。
 */

/**
 * 使用错误处理获取数据。
 * @param {string} url - URL。
 * @param {object} [options={}] - 选项。
 * @returns {Promise<any>} - 响应数据。
 */
async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `HTTP error! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 获取正在运行的宠物列表。
 * @returns {Promise<any>} - 正在运行的宠物列表。
 */
export async function getRunningPetList() {
	return fetchDataWithHandling('/api/parts/shells:deskpet/getrunningpetlist')
}

/**
 * 启动宠物。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function startPet(charname) {
	return fetchDataWithHandling('/api/parts/shells:deskpet/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}

/**
 * 停止宠物。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function stopPet(charname) {
	return fetchDataWithHandling('/api/parts/shells:deskpet/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}
