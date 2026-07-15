/**
 * local distribution world 钩子计数。
 */
export const localWorldHookState = {
	promptCalls: 0,
	viewerCalls: 0,
	/** 清空计数。 */
	reset() {
		this.promptCalls = 0
		this.viewerCalls = 0
	},
}
