/**
 * 【文件】public/src/emojiUsageApi.mjs
 * 【职责】拉取用户常用表情统计（服务端按发送次数排序）。
 * 【原理】GET /emoji-usage/frequent?limit=；供表情选择器「常用」区展示。
 * 【数据结构】limit 默认 32；返回 { emoji, count }[] 类条目。
 * 【关联】ui/emojiPicker.mjs；后端 emoji-usage 路由。
 */
/**
 * 拉取用户常用表情（服务端按发送次数统计）。
 * @param {number} [limit=32] 条数上限
 * @returns {Promise<object[]>} 统计条目
 */
export async function fetchFrequentEmojis(limit = 32) {
	const resp = await fetch(
		`/api/parts/shells:chat/emoji-usage/frequent?limit=${encodeURIComponent(String(limit))}`,
		{ credentials: 'include' },
	)
	if (!resp.ok) return []
	const data = await resp.json()
	return Array.isArray(data.entries) ? data.entries : []
}
