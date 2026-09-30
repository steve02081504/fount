/**
 * 【文件】public/hub/stream/stateRefresh.mjs
 * 【职责】群 `/state` 重取的单调请求序号：作废过期响应并统一经 `setState` 写回。
 */
import { getGroupState } from '../../src/endpoints/groupCore.mjs'
import { captureGroupContext } from '../core/groupContext.mjs'
import { setState } from '../core/state.mjs'

/** @type {Map<string, number>} groupId → 最新请求序号 */
const stateRequestSeq = new Map()

/**
 * 重新抓取群 `/state` 并写回 `context.currentState`（仅最新请求生效）。
 * @param {string} groupId 群 ID
 * @param {{ renderSidebar?: boolean }} [options] 选项：`renderSidebar` 时同步重建频道侧栏
 * @returns {Promise<object | null>} 被采用的 state；请求已过期或群已切换时返回 null
 */
export async function refreshGroupState(groupId, { renderSidebar = false } = {}) {
	if (!groupId) return null
	const stillCurrent = captureGroupContext(groupId)
	const seq = (stateRequestSeq.get(groupId) ?? 0) + 1
	stateRequestSeq.set(groupId, seq)
	/**
	 * 本请求是否仍为最新且群视图未变。
	 * @returns {boolean} 未被更新请求或切群取代则 true
	 */
	const current = () => stateRequestSeq.get(groupId) === seq && stillCurrent()
	let state
	try {
		state = await getGroupState(groupId)
	}
	catch {
		return null
	}
	if (!current()) return null
	setState('context.currentState', state)
	if (renderSidebar) {
		const { renderHubChannelSidebar } = await import('../sidebar/index.mjs')
		if (current()) await renderHubChannelSidebar(state)
	}
	return state
}
