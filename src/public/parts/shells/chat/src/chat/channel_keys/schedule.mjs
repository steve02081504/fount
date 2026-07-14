import { appendEvent } from '../dag/append.mjs'
import { checkEventPermission } from '../dag/authorizeEvent.mjs'
import { materializeFromCheckpoint } from '../dag/groupMaterializedState.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { buildChannelKeyRotateContent } from './rotate.mjs'
import { applyChannelKeyRotateEvent, loadChannelKeysFile } from './store.mjs'

/**
 * 本机签名身份是否有权对频道发起 `channel_key_rotate`。
 * @param {object} state 物化群状态
 * @param {string} sender 本机签名 pubKeyHash
 * @param {string} channelId 频道 ID
 * @returns {Promise<boolean>} 有权轮换则为 true
 */
async function localCanRotateChannelKey(state, sender, channelId) {
	return (await checkEventPermission(state, { type: 'channel_key_rotate', channelId }, sender)).ok
}

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
 * 若本地尚无 K_ch：先写侧车（发消息立即可用），再静默追加 DAG 轮换事件。
 *
 * 顺序 intentional：侧车是读密钥真相源；DAG 事件可能因 `publishFederation: false` 晚于侧车，
 * 联邦同伴不可见此次 bootstrap 轮换，但本机可立即加密/解密。
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
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	if (!await localCanRotateChannelKey(state, sender, id)) return null
	const content = buildChannelKeyRotateContent(state, id)
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
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	/** @type {object[]} */
	const rotations = []
	for (const channelId of Object.keys(state.channels || {})) {
		if (!await localCanRotateChannelKey(state, sender, channelId)) continue
		const content = buildChannelKeyRotateContent(state, channelId)
		rotations.push(content)
		if (!state.channelKeyGeneration) state.channelKeyGeneration = {}
		state.channelKeyGeneration[channelId] = content.generation
	}
	if (!rotations.length) return null
	for (const rot of rotations)
		await applyChannelKeyRotateEvent(username, groupId, { content: rot }, sender)
	return appendEvent(username, groupId, {
		type: 'channel_key_rotate_batch',
		timestamp: Date.now(),
		content: { rotations },
		sender,
	}, secretKey, { skipCheckpointRebuild: true, publishFederation: false })
}
