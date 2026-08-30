/**
 * 【文件】public/hub/messages/reactionSignature.mjs
 * 【职责】频道反应映射的稳定序列化签名：增量刷新用它判断反应是否变化，以决定是否修补反应条。
 * 【原理】`reactionsSignature` 须反映会影响渲染的全部内容（有哪些消息、哪些 emoji、哪些投票者），
 * 且与对象键的插入顺序无关。`JSON.stringify` 的 replacer 数组只作用于顶层键（嵌套对象键会被
 * 一并过滤），不能直接用作键排序手段。
 * 【数据结构】`Record<targetEventId, Record<emoji, { voters: string[] }>>`
 * 【关联】../../messages/messageShared.mjs（re-export）、messageRefresh.mjs（etag 比对）
 */

/**
 * 递归规范化：对象键按字典序排序（消除插入顺序差异），数组逐元素处理（元素为字符串时也排序，
 * 保证同一投票者集合顺序稳定）。
 * @param {unknown} value 待规范化值
 * @returns {unknown} 键已排序的规范化结构
 */
function canonicalize(value) {
	if (Array.isArray(value)) {
		const mapped = value.map(canonicalize)
		if (mapped.every(item => typeof item === 'string'))
			return [...mapped].sort()
		return mapped
	}
	if (value && typeof value === 'object') {
		/** @type {Record<string, unknown>} */
		const sorted = {}
		for (const key of Object.keys(value).sort())
			sorted[key] = canonicalize(value[key])
		return sorted
	}
	return value
}

/**
 * @param {Record<string, Record<string, { voters?: string[] }>> | undefined} reactions 反应映射
 * @returns {string} 稳定序列化签名
 */
export function reactionsSignature(reactions) {
	if (!reactions || !Object.keys(reactions).length) return ''
	return JSON.stringify(canonicalize(reactions))
}
