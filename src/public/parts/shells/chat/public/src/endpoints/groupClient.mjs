/**
 * 【文件】public/src/endpoints/groupClient.mjs
 * 【职责】Chat shell HTTP 客户端底座：CHAT_API 前缀下的 JSON fetch，以及 groups 子路径封装。
 * 【原理】chatFetch 拼 `${CHAT_API_CLIENT_PREFIX}${path}`（path 以 / 开头）；groupFetch 为 groups/ 内部包装；groupPath 对各段 encodeURIComponent；非 2xx 抛 Error(data.error)。仅供 endpoints/* 使用，不对 UI 导出 path 客户端。
 * 【数据结构】chatFetch(path, RequestInit&{json?})、groupFetch、groupPath。
 * 【关联】各 endpoints/*.mjs（groupCore/Channel/…）与后端 src/group/routes。
 */
import { CHAT_API_CLIENT_PREFIX } from '../../shared/apiPaths.mjs'

/**
 * 构建 `groups/:groupId/...` 相对路径（各段均 URL 编码）。
 * @param {string} groupId 群 ID
 * @param {...string} segments 后续路径段
 * @returns {string} 相对 `groups/` 的路径
 */
export function groupPath(groupId, ...segments) {
	return [encodeURIComponent(groupId), ...segments.map(s => encodeURIComponent(String(s)))].join('/')
}

/**
 * 对 `/api/parts/shells:chat` 下任意子路径发起请求并解析 JSON。
 * @param {string} path 以 `/` 开头的路径（相对 CHAT_API 前缀）
 * @param {RequestInit & { json?: object }} [options] 额外 fetch 选项；`json` 会序列化为请求体
 * @returns {Promise<any>} 成功时的响应 JSON
 */
export async function chatFetch(path, options = {}) {
	const { json, ...init } = options
	const response = await fetch(`${CHAT_API_CLIENT_PREFIX}${path}`, {
		...init,
		credentials: 'include',
		headers: json
			? { 'Content-Type': 'application/json', ...init.headers }
			: init.headers,
		body: json ? JSON.stringify(json) : init.body,
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || `HTTP ${response.status}`)
	}
	return response.json()
}

/**
 * 对 `/api/parts/shells:chat/groups/` 发起请求并解析 JSON。
 * @param {string} path 相对 `groups/` 的路径（空串表示群集合根）
 * @param {RequestInit & { json?: object }} [options] 额外 fetch 选项；`json` 会序列化为请求体
 * @returns {Promise<any>} 成功时的响应 JSON
 */
export function groupFetch(path, options = {}) {
	const suffix = path ? `/${path}` : ''
	return chatFetch(`/groups${suffix}`, options)
}
