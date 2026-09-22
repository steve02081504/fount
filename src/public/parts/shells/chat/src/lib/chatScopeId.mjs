/**
 * 【文件】src/public/parts/shells/chat/src/lib/chatScopeId.mjs
 * 【职责】把 `(chatName, channelId)` 组合成频道级会话作用域 id，用于按「某频道的某角色」区分生成在途状态与异步通知归属。
 * 【原理】`chatName` 可能是群级（如 `common_chat_<groupId>`），同群不同频道会撞名；附上 `channelId` 才能区分。无频道时退化为 `chatName`。
 * 【关联】async-task/registry.mjs 的归属与活跃频道匹配共用，保证投递口径一致。
 */

/**
 * 组合频道级会话作用域 id。
 * @param {string | null | undefined} chatName 聊天名（可能是群级）
 * @param {string | null | undefined} channelId 频道 id
 * @returns {string} 作用域 id
 */
export function chatScopeId(chatName, channelId) {
	const channel = channelId == null ? '' : String(channelId)
	return channel ? `${chatName ?? ''}::${channel}` : String(chatName ?? '')
}
