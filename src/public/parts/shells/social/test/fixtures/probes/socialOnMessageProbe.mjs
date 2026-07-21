/**
 * Social OnMessage 探针状态（模块级单例）。
 */
export const socialOnMessageProbe = {
	events: [],
	returnValue: true,
	/** 清空探针状态。 */
	reset() {
		this.events = []
		this.returnValue = true
	},
}
