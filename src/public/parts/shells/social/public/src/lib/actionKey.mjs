/**
 * 构建 `entityHash:postId` action key（entityHash 本身可含冒号）。
 * @param {string} entityHash 作者 entityHash
 * @param {string} postId 帖子 id
 * @returns {string} 复合键
 */
export function formatActionKey(entityHash, postId) {
	return `${entityHash}:${postId}`
}

/**
 * 解析 `entityHash:postId` action key（entityHash 本身可含冒号）。
 * @param {string} actionKey 复合键
 * @returns {{ entityHash: string, postId: string } | null} 解析结果；无法识别为 `null`
 */
export function parseActionKey(actionKey) {
	const sep = actionKey.lastIndexOf(':')
	if (sep < 0) return null
	return {
		entityHash: actionKey.slice(0, sep),
		postId: actionKey.slice(sep + 1),
	}
}

/**
 * 按 data 属性值查询 DOM（对 selector 中的特殊字符做 CSS.escape）。
 * @param {string} attr 属性名（如 `data-repost-for`）
 * @param {string} actionKey 属性值
 * @param {ParentNode} [root=document] 查询根节点
 * @returns {Element | null} 匹配元素或 `null`
 */
export function queryByActionKey(attr, actionKey, root = document) {
	return root.querySelector(`[${attr}="${CSS.escape(actionKey)}"]`)
}
