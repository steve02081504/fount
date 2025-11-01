/**
 * 当前聊天ID。
 * @type {string|null}
 */
export let currentChatId = null

/**
 * 调用API。
 * @param {string} endpoint - 端点。
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method='POST'] - 方法。
 * @param {object} [body] - 正文。
 * @returns {Promise<any>} - 响应数据。
 */
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/shells/chat/${currentChatId}/${endpoint}`,
		{
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

/**
 * 创建新聊天。
 * @returns {Promise<string>} - 新聊天的ID。
 */
export async function createNewChat() {
	const response = await fetch('/api/shells/chat/new', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	currentChatId = data.chatid
	return data.chatid
}

/**
 * 添加角色。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export function addCharacter(charname) {
	return callApi('char', 'POST', { charname })
}

/**
 * 移除角色。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export function removeCharacter(charname) {
	return callApi(`char/${charname}`, 'DELETE')
}

/**
 * 设置世界。
 * @param {string} worldname - 世界名称。
 * @returns {Promise<any>} - 响应数据。
 */
export function setWorld(worldname) {
	return callApi('world', 'PUT', { worldname })
}

/**
 * 设置角色。
 * @param {string} personaname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export function setPersona(personaname) {
	return callApi('persona', 'PUT', { personaname })
}

/**
 * 触发角色回复。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 响应数据。
 */
export function triggerCharacterReply(charname) {
	return callApi('trigger-reply', 'POST', { charname })
}

/**
 * 设置角色回复频率。
 * @param {string} charname - 角色名称。
 * @param {number} frequency - 回复频率。
 * @returns {Promise<any>} - 响应数据。
 */
export function setCharReplyFrequency(charname, frequency) {
	return callApi(`char/${charname}/frequency`, 'PUT', { frequency })
}

/**
 * 添加用户回复。
 * @param {string} reply - 回复内容。
 * @returns {Promise<any>} - 响应数据。
 */
export function addUserReply(reply) {
	return callApi('message', 'POST', { reply })
}

/**
 * 删除消息。
 * @param {number} index - 消息索引。
 * @returns {Promise<any>} - 响应数据。
 */
export function deleteMessage(index) {
	return callApi(`message/${index}`, 'DELETE')
}

/**
 * 编辑消息。
 * @param {number} index - 消息索引。
 * @param {string} content - 消息内容。
 * @returns {Promise<any>} - 响应数据。
 */
export function editMessage(index, content) {
	return callApi(`message/${index}`, 'PUT', { content })
}

/**
 * 获取角色列表。
 * @returns {Promise<any>} - 角色列表。
 */
export function getCharList() {
	return callApi('chars', 'GET')
}

/**
 * 获取聊天记录。
 * @param {number} start - 开始索引。
 * @param {number} end - 结束索引。
 * @returns {Promise<any>} - 聊天记录。
 */
export function getChatLog(start, end) {
	return callApi(`log?start=${start}&end=${end}`, 'GET')
}

/**
 * 获取聊天记录长度。
 * @returns {Promise<any>} - 聊天记录长度。
 */
export function getChatLogLength() {
	return callApi('log/length', 'GET')
}

/**
 * 修改时间线。
 * @param {number} delta - 时间增量。
 * @returns {Promise<any>} - 响应数据。
 */
export function modifyTimeLine(delta) {
	return callApi('timeline', 'PUT', { delta })
}

/**
 * 获取初始数据。
 * @returns {Promise<any>} - 初始数据。
 */
export function getInitialData() {
	return callApi('initial-data', 'GET')
}

if (window.location.hash)
	currentChatId = window.location.hash.substring(1)
