/** Social 分享深链联邦：主动连接分享者 / 作者节点，以及来源节点屏蔽。 */

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

/**
 * 将来源节点写入节点级 denylist（scope: node）；非 2xx 时拒绝，供调用方 handleError。
 * @param {string} nodeHash 来源节点 64 位 hex
 * @returns {Promise<object>} 更新后的 denylist
 */
export async function blockFederationSourceNode(nodeHash) {
	const response = await fetch('/api/p2p/denylist', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ scope: 'node', value: nodeHash }),
	})
	if (!response.ok)
		throw new Error(await response.text() || `block-node HTTP ${response.status}`)
	return response.json().catch(() => ({}))
}
