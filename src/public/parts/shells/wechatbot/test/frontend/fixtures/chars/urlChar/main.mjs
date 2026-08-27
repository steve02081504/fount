/**
 * URL `char` 参数回归测试用的占位角色：提供确定性的 WeChat 配置模板。
 * 测试隔离节点通过 fixtureCopies 复制到 `chars/urlChar`。
 */
export default {
	interfaces: {
		wechat: {
			/**
			 * 提供确定性的 WeChat 配置模板。
			 * @returns {object} 模板内容
			 */
			GetBotConfigTemplate: () => ({
				OwnerWeChatId: 'URL_CHAR_TEMPLATE_OWNER',
				OwnerPromptName: 'URL_CHAR_TEMPLATE_PROMPT',
			}),
		},
	},
}
