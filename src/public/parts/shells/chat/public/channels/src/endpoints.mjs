/**
 * 频道 API 端点
 */

/**
 * 获取频道列表
 * @returns {Promise<object>} 服务端返回的 JSON 解析结果
 */
export async function getChannelList() {
	const response = await fetch('/api/parts/shells:chat/channels/list', {
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 获取频道详情
 * @param {string} channelId - 频道ID
 * @returns {Promise<object>} 频道详情 JSON
 */
export async function getChannel(channelId) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}`, {
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 创建频道
 * @param {object} config - 频道配置
 * @returns {Promise<object>} 创建后的频道对象
 */
export async function createChannel(config) {
	const response = await fetch('/api/parts/shells:chat/channels/create', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		credentials: 'include',
		body: JSON.stringify(config)
	})
	return await response.json()
}

/**
 * 更新频道
 * @param {string} channelId - 频道ID
 * @param {object} updates - 更新内容
 * @returns {Promise<object>} 更新后的频道对象
 */
export async function updateChannel(channelId, updates) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json'
		},
		credentials: 'include',
		body: JSON.stringify(updates)
	})
	return await response.json()
}

/**
 * 删除频道
 * @param {string} channelId - 频道ID
 * @returns {Promise<object>} 删除操作的响应体
 */
export async function deleteChannel(channelId) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}`, {
		method: 'DELETE',
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 订阅频道
 * @param {string} channelId - 频道ID
 * @param {string|null} [greeting] - 入频道问候语，可选
 * @returns {Promise<object>} 订阅结果 JSON
 */
export async function subscribeToChannel(channelId, greeting = null) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}/subscribe`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(greeting ? { greeting } : {})
	})
	return await response.json()
}

/**
 * 取消订阅频道
 * @param {string} channelId - 频道ID
 * @returns {Promise<object>} 取消订阅结果 JSON
 */
export async function unsubscribeFromChannel(channelId) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}/unsubscribe`, {
		method: 'POST',
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 获取频道消息
 * @param {string} channelId - 频道ID
 * @param {number} start - 起始位置
 * @param {number} limit - 数量限制
 * @returns {Promise<object>} 消息列表分页结果
 */
export async function getChannelMessages(channelId, start = 0, limit = 50) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}/messages?start=${start}&limit=${limit}`, {
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 发布消息到频道
 * @param {string} channelId - 频道ID
 * @param {object} message - 消息内容
 * @returns {Promise<object>} 发布后的消息对象
 */
export async function postChannelMessage(channelId, message) {
	const response = await fetch(`/api/parts/shells:chat/channels/${channelId}/post`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		credentials: 'include',
		body: JSON.stringify(message)
	})
	return await response.json()
}
