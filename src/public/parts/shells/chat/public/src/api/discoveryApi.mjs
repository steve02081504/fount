/**
 * 用户级群发现索引 API 客户端。
 */

/**
 * @param {{ limit?: number }} [options] 分页
 * @returns {Promise<{ entries: object[] }>} 发现索引条目
 */
export async function fetchDiscoveryIndex(options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	const qs = params.toString()
	const resp = await fetch(`/api/parts/shells:chat/discovery${qs ? `?${qs}` : ''}`, {
		credentials: 'include',
	})
	const data = await resp.json()
	if (!resp.ok) throw new Error(data.error || resp.statusText)
	return data
}

/**
 * 触发全网发现 gossip（本机已加入群）。
 * @returns {Promise<void>}
 */
export async function refreshDiscoveryGossip() {
	await fetch('/api/parts/shells:chat/discovery/refresh', {
		method: 'POST',
		credentials: 'include',
	})
}
