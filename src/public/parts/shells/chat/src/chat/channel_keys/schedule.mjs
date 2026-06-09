import { materializeFromCheckpoint } from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { appendEvent } from '../dag/append.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { buildChannelKeyRotateContent } from './rotate.mjs'
import { applyChannelKeyRotateEvent, loadChannelKeysFile } from './store.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 物化群状态
 */
async function loadStateForChannelKeys(username, groupId) {
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	if (checkpoint?.members_record)
		return materializeFromCheckpoint(checkpoint)
	return (await getState(username, groupId)).state
}

/**
 * 若本地尚无 K_ch：先导入本机 wrap（发消息立即可用），再后台追加 DAG 轮换事件。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function ensureChannelKey(username, groupId, channelId) {
	const id = String(channelId || '').trim()
	if (!id) return
	const file = await loadChannelKeysFile(username, groupId)
	const row = file.channels[id]
	if (row?.generations?.some(g => g?.keyHex)) return

	const state = await loadStateForChannelKeys(username, groupId)
	if (!state.channels[id]) return
	const content = buildChannelKeyRotateContent(state, id)
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const applied = await applyChannelKeyRotateEvent(username, groupId, { content }, sender)
	if (!applied)
		throw new Error(`channel key wrap import failed for ${id}`)
	void appendEvent(username, groupId, {
		type: 'channel_key_rotate',
		channelId: id,
		timestamp: Date.now(),
		content,
		sender,
	}, secretKey, {
		skipCheckpointRebuild: true,
		skipReleaseQuarantined: true,
		publishFederation: false,
	}).catch(console.error)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<object | null>} 签名事件
 */
export async function appendChannelKeyRotate(username, groupId, channelId) {
	const id = String(channelId || '').trim()
	if (!id) return null
	const state = await loadStateForChannelKeys(username, groupId)
	if (!state.channels[id]) return null
	const content = buildChannelKeyRotateContent(state, id)
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	await applyChannelKeyRotateEvent(username, groupId, { content }, sender)
	return appendEvent(username, groupId, {
		type: 'channel_key_rotate',
		channelId: id,
		timestamp: Date.now(),
		content,
		sender,
	}, secretKey, { skipCheckpointRebuild: true })
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object | null>} 批量签名事件
 */
export async function rotateAllChannelKeys(username, groupId) {
	const state = await loadStateForChannelKeys(username, groupId)
	/** @type {object[]} */
	const rotations = []
	for (const channelId of Object.keys(state.channels || {})) {
		const content = buildChannelKeyRotateContent(state, channelId)
		rotations.push(content)
		if (!state.channelKeyGeneration) state.channelKeyGeneration = {}
		state.channelKeyGeneration[channelId] = content.generation
	}
	if (!rotations.length) return null
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	for (const rot of rotations)
		await applyChannelKeyRotateEvent(username, groupId, { content: rot }, sender)
	return appendEvent(username, groupId, {
		type: 'channel_key_rotate_batch',
		timestamp: Date.now(),
		content: { rotations },
		sender,
	}, secretKey, { skipCheckpointRebuild: true, publishFederation: false })
}
