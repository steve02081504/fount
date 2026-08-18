/**
 * URL `char` 参数回归测试用的占位角色：提供确定性的 Telegram 配置模板。
 * 测试隔离节点通过 fixtureCopies 复制到 `chars/urlChar`。
 */
export default {
	interfaces: {
		telegram: {
			/** @returns {object} 提供确定性的 Telegram 配置模板。 */
			GetBotConfigTemplate: () => ({
				OwnerUserID: 'URL_CHAR_TEMPLATE_OWNER',
				MediaGroupFlushMs: 1234,
			}),
		},
	},
}
