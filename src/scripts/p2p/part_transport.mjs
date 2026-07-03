import { sendToNode } from './trust_graph.mjs'

/**
 * Shell 定向发包（无信誉图参数）。
 * @param {string} username replica
 * @param {string} toNodeHash 64 hex
 * @param {string} actionName Trystero action
 * @param {unknown} payload 载荷
 * @returns {Promise<boolean>} 是否已发送
 */
export function sendToNodeHash(username, toNodeHash, actionName, payload) {
	return sendToNode(username, toNodeHash, actionName, payload)
}
