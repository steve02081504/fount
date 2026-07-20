/**
 * 物化群状态 reducer 共用补丁（避免 groupMaterializedState ↔ reducers 循环依赖）。
 */

/**
 * @param {object} state 物化状态
 * @param {object} event DAG 事件
 * @returns {object} 更新 groupId 后的 state
 */
export function withGroupId(state, event) {
	if (event?.groupId) state.groupId = event.groupId
	return state
}

/**
 * 空 AI 会话配置（由 session_* DAG 事件物化）。
 * @returns {object} 初始 session 物化字段
 */
export function createEmptySessionState() {
	return {
		chars: {},
		world: null,
		channelWorlds: {},
		personas: {},
		charFrequencies: {},
	}
}
