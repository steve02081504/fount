/**
 * write-path 钩子计数（AddChatLogEntry / AfterAdd / BeforeUserSend）。
 */
export const writePathHookState = {
	addCalls: [],
	afterCalls: [],
	beforeSendCalls: [],
	/** 清空计数。 */
	reset() {
		this.addCalls.length = 0
		this.afterCalls.length = 0
		this.beforeSendCalls.length = 0
	},
}
