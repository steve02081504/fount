/**
 * OnMessage / GetReply 探针状态（模块级单例；fixture 经 fount/ 导入共享同一实例）。
 */
export const onMessageProbe = {
	events: [],
	replies: 0,
	returnValue: true,
	/** 清空探针状态。 */
	reset() {
		this.events = []
		this.replies = 0
		this.returnValue = true
	},
}
