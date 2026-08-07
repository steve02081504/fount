/** Social 分享深链联邦：主动连接分享者 / 作者节点。 */

/**
 * 触发即返回（调用方按需 `.catch` 处理网络错误；不检查 HTTP 状态）。
 * @param {string} targetNodeHash 目标节点 hash
 * @returns {Promise<Response>} fetch 响应
 */
export function connectFederationNode(targetNodeHash) {
	return fetch('/api/p2p/federation/connect-node', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetNodeHash }),
	})
}
