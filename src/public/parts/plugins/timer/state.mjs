/**
 * 活跃频道注册表（仅内存，进程重启后清空）。
 * 键为 `${username}|${char_id}`，值为最近活跃频道的有序数组（最新在前）。
 * @type {Map<string, import('../../../../decl/pluginAPI.ts').chatReplyRequest_t[]>}
 */
const channelRegistry = new Map()

/**
 * 将一个活跃的聊天请求上下文注册到频道注册表中，供定时器回调时使用。
 * @param {string} username
 * @param {string} char_id
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} channel
 */
export function registerChannel(username, char_id, channel) {
	const key = `${username}|${char_id}`
	const channels = channelRegistry.get(key) ?? []
	const filtered = channels.filter(c => c.chat_name !== channel.chat_name)
	filtered.unshift(channel)
	channelRegistry.set(key, filtered.slice(0, 5))
}

/**
 * 获取指定用户和角色的所有已注册活跃频道（最新在前）。
 * @param {string} username
 * @param {string} char_id
 * @returns {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t[]}
 */
export function getChannels(username, char_id) {
	return channelRegistry.get(`${username}|${char_id}`) ?? []
}

/**
 * 待注入通知队列（仅内存）。
 * 键为 `${chatid}|${char_id}`，值为待注入的系统日志条目队列。
 * @type {Map<string, object[]>}
 */
const pendingNotifications = new Map()

/**
 * 存入一条待注入的定时器触发通知，供 GetPrompt 在下次生成时通过 additional_chat_log 注入。
 * @param {string} chatid
 * @param {string} char_id
 * @param {object} entry - 符合 chatLogEntry_t 接口的纯对象。
 */
export function setPendingNotification(chatid, char_id, entry) {
	const key = `${chatid}|${char_id}`
	const queue = pendingNotifications.get(key) ?? []
	queue.push(entry)
	pendingNotifications.set(key, queue)
}

/**
 * 取出（并移除）队首的待注入通知。
 * @param {string} chatid
 * @param {string} char_id
 * @returns {object | null}
 */
export function takePendingNotification(chatid, char_id) {
	const key = `${chatid}|${char_id}`
	const queue = pendingNotifications.get(key)
	if (!queue?.length) return null
	const entry = queue.shift()
	if (!queue.length) pendingNotifications.delete(key)
	return entry
}
