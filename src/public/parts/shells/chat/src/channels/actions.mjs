import {
	createChannel,
	getChannelList,
	getChannel,
	deleteChannel,
	subscribeChannel,
	unsubscribeChannel
} from './channel.mjs'

/**
 * 频道操作
 */
export const actions = {
	/**
	 * 创建频道
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.name - 频道名称
	 * @param {string} params.description - 频道描述
	 * @param {string} params.type - 频道类型
	 * @returns {Promise<string>} 创建成功提示文案
	 */
	async create({ user, name, description, type = 'announcement' }) {
		const channel = await createChannel(user, {
			name,
			description,
			type
		})
		return `Channel created: ${channel.channelId}`
	},

	/**
	 * 列出频道
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @returns {Promise<string>} 频道列表或多行文本
	 */
	async list({ user }) {
		const channels = await getChannelList(user)
		if (channels.length === 0) 
			return 'No channels found'
		
		return channels.map(c => `${c.channelId}: ${c.name} (${c.type})`).join('\n')
	},

	/**
	 * 获取频道详情
	 * @param {object} params - 参数
	 * @param {string} params.channelId - 频道ID
	 * @returns {Promise<string>} 格式化的频道 JSON 字符串
	 */
	async info({ channelId }) {
		const channel = await getChannel(channelId)
		return JSON.stringify(channel, null, 2)
	},

	/**
	 * 订阅频道
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.channelId - 频道ID
	 * @returns {Promise<string>} 订阅成功提示
	 */
	async subscribe({ user, channelId }) {
		await subscribeChannel(user, channelId)
		return `Subscribed to channel: ${channelId}`
	},

	/**
	 * 取消订阅频道
	 * @param {object} params - 参数
	 * @param {string} params.user - 用户名
	 * @param {string} params.channelId - 频道ID
	 * @returns {Promise<string>} 取消订阅成功提示
	 */
	async unsubscribe({ user, channelId }) {
		await unsubscribeChannel(user, channelId)
		return `Unsubscribed from channel: ${channelId}`
	},

	/**
	 * 删除频道
	 * @param {object} params - 参数
	 * @param {string} params.channelId - 频道ID
	 * @returns {Promise<string>} 删除成功提示
	 */
	async delete({ channelId }) {
		await deleteChannel(channelId)
		return `Channel deleted: ${channelId}`
	}
}
