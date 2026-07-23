import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { sanitizeIceServersForSettings } from '../../lib/iceServers.mjs'

import { recordFileMasterKeyRotation } from './files.mjs'
import { withGroupId } from './state.mjs'

/**
 * @param {unknown} value 事件中的原始数值
 * @returns {number} 限制在 [-1, 1] 的声誉边权
 */
export function clampRepEdge(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return 1
	return Math.max(-1, Math.min(1, number))
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const governanceReducers = {
	/**
	 * 处理 `group_meta_update` 事件：合并更新群名称、描述、头像等元数据。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	group_meta_update(state, event) {
		withGroupId(state, event)
		Object.assign(state.groupMeta, event.content)
		return state
	},

	/**
	 * 处理 `group_settings_update` 事件：合并群设置并可选更新委派群主。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	group_settings_update(state, event) {
		withGroupId(state, event)
		const content = { ...event.content }
		const ownerHash = content.delegatedOwnerPubKeyHash
		delete content.delegatedOwnerPubKeyHash
		if (content.iceServers !== undefined)
			content.iceServers = sanitizeIceServersForSettings(content.iceServers)
		if (Object.keys(content).length)
			Object.assign(state.groupSettings, content)
		if (ownerHash !== undefined)
			state.delegatedOwnerPubKeyHash = isHex64(ownerHash) ? ownerHash : null
		return state
	},

	/**
	 * 处理 `reputation_slash` 事件：向信誉账本追加 slash 记录。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	reputation_slash(state, event) {
		withGroupId(state, event)
		const targetPubKeyHash = event.content?.targetPubKeyHash
		if (targetPubKeyHash)
			state.reputationLedger.push({
				targetPubKeyHash,
				sender: event.sender,
				timestamp: event.timestamp,
				kind: 'slash',
				payloadRef: event.id,
			})

		return state
	},

	/**
	 * 处理 `reputation_reset` 事件：清除目标 slash 记录并追加 reset 条目。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	reputation_reset(state, event) {
		withGroupId(state, event)
		const targetPubKeyHash = event.content?.targetPubKeyHash
		if (targetPubKeyHash) {
			state.reputationLedger = state.reputationLedger.filter(
				entry => !(entry?.kind === 'slash' && entry?.targetPubKeyHash === targetPubKeyHash),
			)
			state.reputationLedger.push({
				targetPubKeyHash,
				sender: event.sender,
				timestamp: event.timestamp,
				kind: 'reset',
			})
		}
		return state
	},

	/**
	 * 处理 `dag_tip_merge` 事件：拓扑合并占位，不修改物化状态。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 原样返回的 state
	 */
	dag_tip_merge(state, event) {
		withGroupId(state, event)
		return state
	},

	/**
	 * 处理 `file_master_key_rotate` 事件：记录 GSH 密钥轮换事件。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	file_master_key_rotate(state, event) {
		withGroupId(state, event)
		recordFileMasterKeyRotation(state, event, 'rotate')
		return state
	},

	/**
	 * 处理 `peer_invite` 事件：追加邀请边（含信誉边权与 GSH 授予标记）。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	peer_invite(state, event) {
		withGroupId(state, event)
		const { content } = event
		const from = content.from || null
		const to = content.to || null
		if (from && to) {
			const edge = { from, to, at: event.timestamp }
			if (content.reputationEdge !== undefined) edge.reputationEdge = clampRepEdge(content.reputationEdge)
			if (content.fileKeyWraps) edge.fileKeyWraps = true
			state.inviteEdges.push(edge)
		}
		return state
	},

	/**
	 * @param {object} state 物化群状态
	 * @param {object} event state_summary 事件
	 * @returns {object} 更新后的 state
	 */
	state_summary(state, event) {
		withGroupId(state, event)
		void event
		return state
	},
}
