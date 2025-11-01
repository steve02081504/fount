/**
 * @file home/public/src/endpoints.mjs
 * @description 主页 shell 的客户端 API 端点。
 * @namespace home.public.endpoints
 */

/**
 * @function getHomeRegistry
 * @memberof home.public.endpoints
 * @description 获取主页注册表。
 * @returns {Promise<any>} - 主页注册表。
 */
export async function getHomeRegistry() {
	return fetch('/api/shells/home/gethomeregistry').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
