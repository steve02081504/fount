/**
 * local distribution world 钩子计数。
 */
export const localWorldHookState = {
	promptCalls: 0,
	viewerCalls: 0,
	chatPluginsCalls: 0,
	/** 清空计数。 */
	reset() {
		this.promptCalls = 0
		this.viewerCalls = 0
		this.chatPluginsCalls = 0
	},
}
