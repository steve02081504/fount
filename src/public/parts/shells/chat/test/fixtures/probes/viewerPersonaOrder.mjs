/**
 * viewer persona GetChatLogForViewer 观测状态。
 */
export const viewerPersonaOrder = {
	called: false,
	worldHiddenStillPresent: false,
	/** 清空观测。 */
	reset() {
		this.called = false
		this.worldHiddenStillPresent = false
	},
}
