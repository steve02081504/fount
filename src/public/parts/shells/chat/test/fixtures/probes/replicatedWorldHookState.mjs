/**
 * replicated distribution world 钩子状态。
 */
export const replicatedWorldHookState = {
	hostConnected: 0,
	promptCalls: 0,
	host: null,
	lastFoldIgnored: 0,
	/** 清空计数与 host 引用。 */
	reset() {
		this.hostConnected = 0
		this.promptCalls = 0
		this.host = null
		this.lastFoldIgnored = 0
	},
}
