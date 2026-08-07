/**
 * 【文件】public/src/endpoints/social.mjs
 * 【职责】浏览器侧 Social shell REST（非 chat shell 前缀，仍归 chat Hub 使用面：个人拉黑、关注作者）。
 * 【关联】hub/personalFilter.mjs、emoji-packs/index.mjs。
 */

/**
 * @param {string} path 以 / 开头，相对 /api/parts/shells:social
 * @param {RequestInit & { json?: object }} [options] fetch 选项
 * @returns {Promise<any>} JSON
 */
async function socialFetch(path, options = {}) {
	const { json, ...init } = options
	const response = await fetch(`/api/parts/shells:social${path}`, {
		credentials: 'include',
		headers: json ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
		body: json ? JSON.stringify(json) : init.body,
		...init,
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || `HTTP ${response.status}`)
	}
	return response.json()
}

/**
 * 拉黑 / 取消拉黑指定实体（个人级，写入 Social relationships）。
 * @param {string} entityHash 目标实体
 * @param {boolean} block true=拉黑
 * @returns {Promise<any>} 响应
 */
export function postRelationshipBlock(entityHash, block) {
	return socialFetch('/relationships/block', { method: 'POST', json: { entityHash, block } })
}

/**
 * 关注 / 取关指定实体。
 * @param {string} entityHash 目标实体
 * @param {boolean} follow true=关注
 * @returns {Promise<any>} 响应
 */
export function postRelationshipFollow(entityHash, follow) {
	return socialFetch('/relationships/follow', { method: 'POST', json: { entityHash, follow } })
}
