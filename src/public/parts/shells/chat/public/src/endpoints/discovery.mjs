/**
 * 【文件】public/src/endpoints/discovery.mjs
 * 【职责】用户级群发现索引 API 客户端。
 * 【关联】hub/discoveryPanel.mjs；后端 endpoints/discovery.mjs。
 */
import { chatFetch } from './groupClient.mjs'

/**
 * @param {{ limit?: number }} [options] 分页
 * @returns {Promise<{ entries: object[] }>} 发现索引条目
 */
export async function fetchDiscoveryIndex(options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	const qs = params.toString()
	return chatFetch(`/discovery${qs ? `?${qs}` : ''}`)
}

/**
 * 触发全网发现 gossip（本机已加入群）。
 * @returns {Promise<void>}
 */
export async function refreshDiscoveryGossip() {
	await chatFetch('/discovery/refresh', { method: 'POST' })
}
