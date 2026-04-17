/**
 * 当前群组ID（从 URL hash 读取）。
 * @type {string|null}
 */
export let currentGroupId = null

/**
 * 当前频道ID。
 * @type {string|null}
 */
export let currentChannelId = null

/**
 * 当前频道类型。
 * @type {'chat'|'list'|'streaming'}
 */
export let currentChannelType = 'chat'

/**
 * 设置当前频道上下文（由 group.mjs 在切换频道时调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {'chat'|'list'|'streaming'} channelType 频道类型
 * @returns {void}
 */
export function setCurrentChannel(groupId, channelId, channelType = 'chat') {
	currentGroupId = groupId
	currentChannelId = channelId
	currentChannelType = channelType
}

const BASE = '/api/parts/shells:chat'

/**
 * 群级 API 调用（chars/plugins/persona 等与频道无关的操作）。
 * @param {string} endpoint 相对路径端点名
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method] HTTP 方法
 * @param {object} [body] JSON 请求体
 * @returns {Promise<any>} 解析后的响应 JSON
 */
async function callGroupApi(endpoint, method = 'GET', body) {
	const response = await fetch(`${BASE}/groups/${currentGroupId}/${endpoint}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = await response.json().catch(() => 0)
	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), data, { response })
	return data
}

/**
 * 频道通用 API 调用（更新元数据、删除、权限、置顶等）。
 * @param {string} endpoint 相对路径端点名
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method] HTTP 方法
 * @param {object} [body] JSON 请求体
 * @returns {Promise<any>} 解析后的响应 JSON
 */
async function callChannelCommonApi(endpoint, method = 'GET', body) {
	const response = await fetch(`${BASE}/groups/${currentGroupId}/channels/common/${currentChannelId}/${endpoint}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = await response.json().catch(() => 0)
	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), data, { response })
	return data
}

/**
 * 频道类型专属 API 调用（消息、日志等，需要 currentChannelType）。
 * @param {string} endpoint 相对路径端点名
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method] HTTP 方法
 * @param {object} [body] JSON 请求体
 * @returns {Promise<any>} 解析后的响应 JSON
 */
async function callChannelApi(endpoint, method = 'GET', body) {
	const response = await fetch(`${BASE}/groups/${currentGroupId}/channels/${currentChannelType}/${currentChannelId}/${endpoint}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = await response.json().catch(() => 0)
	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), data, { response })
	return data
}

/**
 * 创建新群组。
 * @param {object} [options] 创建选项
 * @param {string} [options.name] 群组显示名称
 * @param {string} [options.defaultChannelName] 默认频道名称
 * @returns {Promise<string>} 新建群组的 groupId
 */
export async function createNewGroup(options = {}) {
	const response = await fetch(`${BASE}/new`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(options),
	})
	const data = await response.json()
	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), data, { response })
	currentGroupId = data.groupId
	return data.groupId
}

// ─── 群级操作 ─────────────────────────────────────────────────────────────────

/**
 * 拉取群初始数据（角色、插件、世界等）。
 * @returns {Promise<any>} 初始数据 JSON
 */
export function getInitialData() { return callGroupApi('initial-data') }
/**
 * 向群中添加角色。
 * @param {string} charname 角色名
 * @returns {Promise<any>} API 响应
 */
export function addCharacter(charname) { return callGroupApi('chars', 'POST', { charname }) }
/**
 * 从群中移除角色。
 * @param {string} charname 角色名
 * @returns {Promise<any>} API 响应
 */
export function removeCharacter(charname) { return callGroupApi(`chars/${charname}`, 'DELETE') }
/**
 * 向群中添加插件。
 * @param {string} pluginname 插件名
 * @returns {Promise<any>} API 响应
 */
export function addPlugin(pluginname) { return callGroupApi('plugins', 'POST', { pluginname }) }
/**
 * 从群中移除插件。
 * @param {string} pluginname 插件名
 * @returns {Promise<any>} API 响应
 */
export function removePlugin(pluginname) { return callGroupApi(`plugins/${pluginname}`, 'DELETE') }
/**
 * 设置当前聊天频道的世界书。
 * @param {string} worldname 世界名
 * @returns {Promise<any>} API 响应
 */
export function setWorld(worldname) { return callChannelApi('world', 'PUT', { worldname }) }
/**
 * 设置用户人格（persona）。
 * @param {string} personaname 人格名
 * @returns {Promise<any>} API 响应
 */
export function setPersona(personaname) { return callGroupApi('persona', 'PUT', { personaname }) }

// ─── chat 频道专属操作 ────────────────────────────────────────────────────────

/**
 * 触发指定角色的 AI 回复。
 * @param {string} charname 角色名
 * @returns {Promise<any>} API 响应
 */
export function triggerCharacterReply(charname) { return callChannelApi('trigger-reply', 'POST', { charname }) }
/**
 * 发送用户消息。
 * @param {object} reply 用户回复载荷
 * @returns {Promise<any>} API 响应
 */
export function addUserReply(reply) { return callChannelApi('message', 'POST', { reply }) }
/**
 * 按索引删除消息。
 * @param {number} index 消息索引
 * @returns {Promise<any>} API 响应
 */
export function deleteMessage(index) { return callChannelApi(`messages/${index}`, 'DELETE') }
/**
 * 按索引编辑消息内容。
 * @param {number} index 消息索引
 * @param {string} content 新文本内容
 * @returns {Promise<any>} API 响应
 */
export function editMessage(index, content) { return callChannelApi(`messages/${index}`, 'PUT', { content }) }
/**
 * 设置消息反馈（赞踩等）。
 * @param {number} index 消息索引
 * @param {object} feedback 反馈对象
 * @returns {Promise<any>} API 响应
 */
export function setMessageFeedback(index, feedback) { return callChannelApi(`messages/${index}/feedback`, 'PUT', feedback) }
/**
 * 获取聊天日志片段。
 * @param {number} start 起始下标（含）
 * @param {number} end 结束下标（不含）
 * @returns {Promise<any>} 日志片段
 */
export function getChatLog(start, end) { return callChannelApi(`log?start=${start}&end=${end}`) }
/**
 * 获取聊天日志条数。
 * @returns {Promise<any>} 长度信息
 */
export function getChatLogLength() { return callChannelApi('log/length') }
/**
 * 调整时间线游标（delta 为偏移量）。
 * @param {number} delta 时间线索引偏移
 * @returns {Promise<any>} API 响应
 */
export function modifyTimeLine(delta) {
	if (isNaN(delta)) throw new TypeError('modifyTimeLine: delta must not be NaN')
	const safeDelta = delta === Infinity ? Number.MAX_SAFE_INTEGER : delta === -Infinity ? Number.MIN_SAFE_INTEGER : delta
	return callChannelApi('timeline', 'PUT', { delta: safeDelta })
}

// ─── 频道通用操作 ─────────────────────────────────────────────────────────────

/**
 * 更新当前频道元数据。
 * @param {object} data 要写入的元数据字段
 * @returns {Promise<any>} API 响应
 */
export function updateChannelMeta(data) { return callChannelCommonApi('', 'PUT', data) }
/**
 * 删除当前频道。
 * @returns {Promise<any>} API 响应
 */
export function deleteChannel() { return callChannelCommonApi('', 'DELETE') }

// 从 hash 初始化当前 groupId/channelId（由 group.mjs 调用，此处不自动执行）

/**
 * 压缩群 checkpoint（生成新检查点 + 裁剪旧 DAG 事件）。
 * @returns {Promise<any>} API 响应
 */
export function compactGroup() { return callGroupApi('compact', 'POST') }

/**
 * 裁剪当前频道消息，保留最近 N 条。
 * @param {number} keepLastN 保留条数
 * @returns {Promise<any>} API 响应
 */
export function pruneChannelMessages(keepLastN) { return callChannelApi('prune-messages', 'POST', { keepLastN }) }

/** UI 错误统一上报（与 {@link import('./utils.mjs').handleUIError} 相同） */
export { handleUIError } from './utils.mjs'

