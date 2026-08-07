/** Social 分享深链联邦：主动连接分享者 / 作者节点。 */

/**
 * 主动连接目标联邦节点；非 2xx 时拒绝，供调用方 handleError。
 * @param {string} targetNodeHash 目标节点 hash
 * @returns {Promise<Response>} 成功时的 fetch 响应
 */
export async function connectFederationNode(targetNodeHash) {
	const response = await fetch('/api/p2p/federation/connect-node', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetNodeHash }),
	})
	if (!response.ok)
		throw new Error(await response.text() || `connect-node HTTP ${response.status}`)
	return response
}
