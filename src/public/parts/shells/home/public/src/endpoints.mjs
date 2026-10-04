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

/**
 * 调用邀请 API。
 * @param {string} path 端点后缀
 * @param {RequestInit} [init] 请求选项
 * @returns {Promise<object>} 响应数据
 */
async function invitationRequest(path, init) {
	const response = await fetch(`/api/parts/shells:home/invitation${path}`, {
		credentials: 'include',
		...init,
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
	return data
}

/**
 * 获取邀请进度。
 * @returns {Promise<object>} 邀请进度
 */
export function getInvitationStatus() { return invitationRequest('') }
/**
 * 提交私聊邀请链接。
 * @param {string} link 完整邀请链接
 * @returns {Promise<object>} 提交结果
 */
export function submitInvitation(link) {
	return invitationRequest('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }) })
}
/**
 * 接受本节点自己的邀请。
 * @returns {Promise<object>} 接受结果
 */
export function acceptSelfInvitation() { return invitationRequest('/self', { method: 'POST' }) }
