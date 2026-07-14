import { getUserByReq } from '../../../../../../server/auth/index.mjs'

/**
 * 从请求解析会话用户并以 operator 身份取得 ChatClient（HTTP 永不接受实体覆盖）。
 * @param {import('npm:express').Request} req Express 请求
 * @returns {Promise<{ username: string, client: object }>} 用户名与 client
 */
export async function chatClientFromReq(req) {
	const { username } = getUserByReq(req)
	const { getChatClient } = await import('../api/index.mjs')
	return { username, client: await getChatClient(username) }
}

/**
 * @param {unknown} raw 查询或 body 中的频道 id
 * @returns {string | undefined} 去空白后的频道 id
 */
export function optionalChannelId(raw) {
	const id = String(raw || '').trim()
	return id || undefined
}

/**
 * @param {string} groupId 群 ID
 * @param {string | undefined} hintedChannelId 调用方提示频道
 * @param {string} username replica 登录名
 * @returns {Promise<string>} 解析后的频道 id
 */
export async function resolveGroupChannel(groupId, hintedChannelId, username) {
	const { resolveGroupChannelId } = await import('../chat/lib/channelId.mjs')
	return resolveGroupChannelId(username, groupId, hintedChannelId)
}
