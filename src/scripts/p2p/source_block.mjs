/**
 * part_query 响应来源节点（`queryNetwork` 的 `sources`）屏蔽判定与取值。
 */
import { isSubjectBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'

/**
 * 来源节点是否命中全局节点 denylist（scope: node）。
 * 本地行来源为空，永不被过滤。
 * @param {string} nodeHash 来源节点 64 位 hex
 * @returns {boolean} 是否被屏蔽
 */
export function isSourceNodeBlocked(nodeHash) {
	const value = String(nodeHash || '').trim()
	return Boolean(value) && isSubjectBlocked({ nodeHash: value })
}

/**
 * 从 `queryNetwork` 返回的 `sources` 映射取某行的来源节点。
 * @param {Map<string, string[]> | undefined} sources rowKey→来源节点
 * @param {string} rowKey 去重键
 * @returns {string[]} 来源节点；无则空数组
 */
export function sourceNodesOf(sources, rowKey) {
	if (!sources || !rowKey) return []
	return sources.get(rowKey) || []
}
