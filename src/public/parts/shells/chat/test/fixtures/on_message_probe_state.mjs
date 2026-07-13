/**
 * onMessage 探针 fixture 共享状态（globalThis，跨 user 目录复制后仍可用）。
 * @returns {{ events: object[], replies: number, returnValue: boolean, reset: () => void }} probe 状态视图
 */
export function onMessageProbeState() {
	const key = '__fountOnMessageProbe'
	if (!globalThis[key])
		globalThis[key] = { events: [], replies: 0, returnValue: true }
	return {
		/** @returns {object[]} 已记录的 onMessage 事件 */
		get events() { return globalThis[key].events },
		/** @returns {number} GetReply 调用次数 */
		get replies() { return globalThis[key].replies },
		/** @returns {boolean} onMessage 返回值 */
		get returnValue() { return globalThis[key].returnValue },
		/**
		 *
		 */
		set returnValue(value) { globalThis[key].returnValue = value },
		/** 清空 probe 状态。 */
		reset() {
			globalThis[key].events = []
			globalThis[key].replies = 0
			globalThis[key].returnValue = true
		},
	}
}
