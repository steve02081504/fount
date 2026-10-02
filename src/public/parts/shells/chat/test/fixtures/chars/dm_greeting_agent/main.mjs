/** 频道独立开场 probe，不依赖 AI。 */
export default {
	info: { 'zh-CN': { name: '问候测试角色', description: '频道问候回归测试', version: '1.0.0', author: 'fount' } },
	interfaces: {
		chat: {
			/**
			 * @param {object} request 请求
			 * @returns {Promise<object>} 开场
			 */
			async GetGreeting(request) {
				return { content: `hello:${request.extension.channelId}` }
			},
			/** @returns {Promise<object>} 固定回复 */
			async GetReply() { return { content: 'reply' } },
		},
	},
}
