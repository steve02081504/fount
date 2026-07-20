/**
 * OnGroupEvent 探针（模块级单例）。
 */
export const groupEventProbe = {
	events: [],
	/** 清空已记录事件。 */
	reset() {
		this.events = []
	},
}
