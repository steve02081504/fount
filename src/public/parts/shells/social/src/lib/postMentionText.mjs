/**
 * 帖子正文：@ 扫描与通知/RPC 可见文本分离（受保护帖不向外泄露正文）。
 */

/**
 * 返回用于 @ 提及扫描的帖子正文（含受保护帖，仅服务端）。
 * @param {object} post 签名 post 事件
 * @returns {string} 用于 @ 提及扫描的正文（含受保护帖，仅服务端）
 */
export function mentionSourceText(post) {
	return String(post?.content?.text || '')
}

/**
 * 返回通知/RPC 可见正文；受保护帖不泄露。
 * @param {object} post 签名 post 事件
 * @returns {string | null} 通知/RPC 可见正文；受保护帖不泄露
 */
export function postTextForNotification(post) {
	const content = post?.content
	if (content?.protected) return null
	return String(content?.text || '')
}
