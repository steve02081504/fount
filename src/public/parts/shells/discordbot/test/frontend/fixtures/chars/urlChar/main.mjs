/**
 * URL `char` 参数回归测试用的占位角色：提供确定性的 Discord 配置模板。
 * 测试隔离节点通过 fixtureCopies 复制到 `chars/urlChar`。
 */
export default {
	interfaces: {
		discord: {
			/**
			 * 提供确定性的 Discord 配置模板。
			 * @returns {object} 模板内容
			 */
			GetBotConfigTemplate: () => ({
				OwnerUserName: 'URL_CHAR_TEMPLATE_OWNER',
				OwnerUserID: 'URL_CHAR_TEMPLATE_OWNER_ID',
			}),
		},
	},
}