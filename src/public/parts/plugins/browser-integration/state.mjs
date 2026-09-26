/**
 * 活跃频道注册表（仅内存，进程重启后清空）。
 * 键为 `${username}|${char_id}`，值为最近活跃频道的有序数组（最新在前）。
 * @type {Map<string, import('../../../../decl/pluginAPI.ts').chatReplyRequest_t[]>}
 */
const channelRegistry = new Map()

/**
 * 注册一个活跃的聊天请求上下文，供浏览器 JS 回调时触发角色回复。
 * @param {string} username - 用户名。
 * @param {string} char_id - 角色 ID。
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} channel - 聊天请求上下文。
 * @returns {void}
 */
export function registerChannel(username, char_id, channel) {
	if (!username || !char_id) return
	const key = `${username}|${char_id}`
	const channels = channelRegistry.get(key) ?? []
	const filtered = channels.filter(c => c.chat_name !== channel.chat_name)
	filtered.unshift(channel)
	channelRegistry.set(key, filtered.slice(0, 5))
}

/**
 * 获取指定用户与角色的活跃频道（最新在前）。
 * @param {string} username - 用户名。
 * @param {string} char_id - 角色 ID。
 * @returns {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t[]} 聊天请求上下文数组。
 */
export function getChannels(username, char_id) {
	if (!char_id) {
		const matches = []
		for (const [key, channels] of channelRegistry)
			if (key.startsWith(`${username}|`)) matches.push(...channels)
		return matches
	}
	return channelRegistry.get(`${username}|${char_id}`) ?? []
}
