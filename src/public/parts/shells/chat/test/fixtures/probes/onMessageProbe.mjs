/**
 * OnMessage / GetReply 探针状态（模块级单例；fixture 经 fount/ 导入共享同一实例）。
 */
export const onMessageProbe = {
	events: [],
	/** @type {object[]} 契约判定明细（gentian_shell_contract 等） */
	decisions: [],
	replies: 0,
	returnValue: true,
	/** 清空探针状态。 */
	reset() {
		this.events = []
		this.decisions = []
		this.replies = 0
		this.returnValue = true
	},
}
