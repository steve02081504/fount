/**
 * @file deskpet/public/src/endpoints.mjs
 * @description 桌面宠物 shell 的客户端 API 端点。
 * @namespace deskpet.public.endpoints
 */

/**
 * @function fetchDataWithHandling
 * @memberof deskpet.public.endpoints
 * @description 使用错误处理获取数据。
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
 * @function getRunningPetList
 * @memberof deskpet.public.endpoints
 * @description 获取正在运行的宠物列表。
 * @returns {Promise<any>} - 正在运行的宠物列表。
 */
export async function getRunningPetList() {
	return fetchDataWithHandling('/api/shells/deskpet/getrunningpetlist')
}

/**
 * @function startPet
 * @memberof deskpet.public.endpoints
 * @description 启动宠物。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function startPet(charname) {
	return fetchDataWithHandling('/api/shells/deskpet/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}

/**
 * @function stopPet
 * @memberof deskpet.public.endpoints
 * @description 停止宠物。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function stopPet(charname) {
	return fetchDataWithHandling('/api/shells/deskpet/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}
