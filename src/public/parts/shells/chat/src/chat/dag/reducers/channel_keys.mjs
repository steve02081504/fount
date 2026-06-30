import { withGroupId } from './helpers.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const channelKeyReducers = {
	/**
	 * @param {object} state 物化群状态
	 * @param {object} event channel_key_rotate 事件
	 * @returns {object} 更新后的 state
	 */
	channel_key_rotate(state, event) {
		withGroupId(state, event)
		const channelId = String(event.content?.channelId || '').trim()
		const generation = Number(event.content?.generation)
		const wraps = event.content?.wraps
		if (!channelId || !Number.isFinite(generation) || !wraps || typeof wraps !== 'object') return state
		if (!state.channelKeyGeneration) state.channelKeyGeneration = {}
		if (!state.channelKeyWraps) state.channelKeyWraps = {}
		state.channelKeyGeneration[channelId] = generation
		// wraps 由 eventPersist → applyChannelKeyRotateEvent 写入密钥侧车；物化态只记 generation。
		state.channelKeyWraps[channelId] = { generation }
		return state
	},

	/**
	 * @param {object} state 物化群状态
	 * @param {object} event channel_key_rotate_batch 事件
	 * @returns {object} 更新后的 state
	 */
	channel_key_rotate_batch(state, event) {
		withGroupId(state, event)
		const rotations = event.content?.rotations
		if (!Array.isArray(rotations)) return state
		if (!state.channelKeyGeneration) state.channelKeyGeneration = {}
		if (!state.channelKeyWraps) state.channelKeyWraps = {}
		for (const rot of rotations) {
			const channelId = String(rot?.channelId || '').trim()
			const generation = Number(rot?.generation)
			const wraps = rot?.wraps
			if (!channelId || !Number.isFinite(generation) || !wraps || typeof wraps !== 'object') continue
			state.channelKeyGeneration[channelId] = generation
			state.channelKeyWraps[channelId] = { generation }
		}
		return state
	},
}
