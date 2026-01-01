/**
 * 主页 shell 的客户端 API 端点。
 */

/**
 * 从服务器获取主页注册表。
 * 注册表包含了驱动主页UI所需的所有动态数据，例如功能按钮和部件类型定义。
 * @returns {Promise<any>} 一个解析为主页注册表JSON对象的Promise。
 * @throws {Error} 如果API请求失败，则会拒绝Promise并附带错误信息。
 */
export async function getHomeRegistry() {
	return fetch('/api/parts/shells:home/gethomeregistry').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
