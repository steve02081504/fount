/**
 * UserAPI_t 类型别名。
 * @typedef {import('../../../../../src/decl/userAPI.ts').UserAPI_t} UserAPI_t
 */

/**
 * 人设默认导出对象。
 * @type {UserAPI_t}
 */
export default {
	// 人设的基本信息
	info: {
		'zh-CN': {
			name: '<人设名>', // 人设的名字
			avatar: '<头像的url地址，可以留空，也可以是fount本地文件>', // 人设的头像
			description: '<一句话简介>', // 人设的简短介绍
			description_markdown: '<简介，支持markdown语法>', // 人设的详细介绍
			version: '0.0.0', // 人设的版本号
			author: '<作者名>', // 人设的作者
			home_page: '', // 人设的主页
			tags: ['<标签>', '<可以多个>'], // 人设的标签
		}
	},
	interfaces: {
		chat: {
			/**
			 * 获取用户人设注入给角色的提示。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} - 单段提示词。
			 */
			GetPrompt: async args => {
				return {
					text: [{
						content: '<人设内容>',
						important: 0
					}],
					additional_chat_log: [],
					extension: {}
				}
			},
		}
	}
}
