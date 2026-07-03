/**
 * 【文件】public/src/api/groupClient.mjs
 * 【职责】联邦群 HTTP 客户端底座：统一 BASE、路径编码与 JSON fetch，供各 api/*.mjs 复用。
 * 【原理】groupPath 对各段 encodeURIComponent；groupFetch 拼接 /api/parts/shells:chat/groups/ 并 credentials:include，json 选项自动设 Content-Type；非 2xx 抛 Error(data.error)。groupRequest 为 Hub 常用的 groupId+endpoint 快捷封装。
 * 【数据结构】GROUPS_BASE 常量；groupFetch(path, RequestInit&{json?})、groupPath(groupId,...segments)、groupRequest(groupId, endpoint, method, body)。
 * 【关联】groupApi 及各子模块 re-export 的底层；后端 src/group/routes。
 */
import { GROUPS_CLIENT_PREFIX } from '../../../src/group/routes/path.mjs'

const GROUPS_BASE = GROUPS_CLIENT_PREFIX

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
 * 对 `/api/parts/shells:chat/groups/` 发起请求并解析 JSON。
 * @param {string} path 相对 `groups/` 的路径（空串表示群集合根）
 * @param {RequestInit & { json?: object }} [opts] 额外 fetch 选项；`json` 会序列化为请求体
 * @returns {Promise<any>} 成功时的响应 JSON
 */
export async function groupFetch(path, opts = {}) {
	const { json, ...init } = opts
	const suffix = path ? `/${path}` : ''
	const response = await fetch(`${GROUPS_BASE}${suffix}`, {
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
 * Hub / 设置面板用：对指定群的 REST 子路径发起请求。
 * @param {string} groupId 群 ID
 * @param {string} endpoint `groups/:id/` 之后的子路径
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method] HTTP 方法
 * @param {object} [body] JSON 请求体
 * @returns {Promise<any>} 响应 JSON
 */
export function groupRequest(groupId, endpoint, method = 'GET', body) {
	const path = endpoint ? `${groupPath(groupId)}/${endpoint}` : groupPath(groupId)
	const opts = { method }
	if (body != null && method !== 'GET' && method !== 'HEAD') opts.json = body
	return groupFetch(path, opts)
}
