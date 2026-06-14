/**
 * 【文件】`dag/eventPersist.mjs` — 事件落盘后的副作用管线。
 * 【职责】WebSocket 广播 DAG/频道消息、写频道 `messages.jsonl`、刷新 checkpoint、触发信誉/GSH/自动回复等钩子。
 * 【原理】非消息类事件仅重建 checkpoint；消息类解密展示内容后双播 `dag_event` 与 `channel_message`；信誉与 GSH 轮换在物化状态可用后异步应用。
 * 【数据结构】`messageLine` 含 `eventId`、`hlc`、`prev_event_ids`、`receivedAt`；房间键来自 `groupWsRoomKeyForReplica`。
 * 【关联】`materialize.mjs`、`events/meta.mjs`、`../stream/groupWsHub.mjs`、`../session/autoReply.mjs`。
 */
import { isSignedBaseCheckpoint } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { sortedPrevEventIds } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import {
	applyDecayCollusionAfterSlash,
	applyReputationResetToScores,
	applySubjectiveSlashFromEvent,
	seedMemberReputationFromIntroducer,
} from '../../../../../../../scripts/p2p/reputation_user.mjs'
import {
	CKG_ENCRYPT_EVENT_TYPES,
	decryptEventContent,
} from '../channel_keys/content.mjs'
import { appendChannelKeyRotate, rotateAllChannelKeys } from '../channel_keys/schedule.mjs'
import { applyChannelKeyRotateEvent } from '../channel_keys/store.mjs'
import { getEventReceivedAt } from '../events/meta.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { onMqttCredentialsSyncedFromDag, mqttCredentialsFromGroupSettings } from '../federation/mqttCredentials.mjs'
import { tryImportFileKeyGrantFromPeerInvite } from '../file_keys/peerInviteImport.mjs'
import { applyFileMasterKeyRotationFromEvent } from '../file_keys/store.mjs'
import { releaseFileChunksAfterDelete } from '../files/deleteGc.mjs'
import { eventsPath, messagesPath, snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'
import { broadcastEvent } from '../stream/groupWsHub.mjs'
import { groupWsRoomKeyForReplica } from '../stream/groupWsRooms.mjs'

import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState, rebuildAndSaveCheckpoint } from './materialize.mjs'

/** 写入频道消息流 JSONL 的事件类型。 */
const PERSIST_MESSAGE_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
])

/**
 * @param {object} signPayload 已落盘事件
 * @returns {string} 目标成员 pubKeyHash（小写 hex），无效时为空串
 */
function slashTargetPubKeyHash(signPayload) {
	return signPayload.content?.targetPubKeyHash?.trim().toLowerCase() || ''
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} signPayload 已落盘事件
 * @returns {Promise<void>}
 */
async function applyReputationHooks(username, groupId, signPayload) {
	if (!signPayload.type) return

	/**
	 *
	 */
	const decayAfterSlash = async () => {
		const target = slashTargetPubKeyHash(signPayload)
		if (!target) return
		const { state } = await getState(username, groupId)
		await applyDecayCollusionAfterSlash(username, target, state.inviteEdges)
	}

	if (signPayload.type === 'reputation_slash') {
		await applySubjectiveSlashFromEvent(username, groupId, signPayload, async (u, g) => readJsonl(eventsPath(u, g), { sanitize: sanitizeFederatedEvent }))
		await decayAfterSlash()
	}
	else if (['member_kick', 'member_ban'].includes(signPayload.type))
		await decayAfterSlash()
	else if (signPayload.type === 'reputation_reset') {
		const target = slashTargetPubKeyHash(signPayload)
		if (target) await applyReputationResetToScores(username, target)
	}
	if (signPayload.type === 'member_join') {
		const sender = signPayload.sender.trim().toLowerCase()
		const { state } = await getState(username, groupId)
		const inviteEdge = [...state.inviteEdges].reverse()
			.find(edge => edge.to.trim().toLowerCase() === sender)
		const introducer = signPayload.content?.introducerPubKeyHash?.trim().toLowerCase() || ''
		const repEdge = Number.isFinite(inviteEdge?.reputationEdge) ? inviteEdge.reputationEdge : 1
		const edgeFromJoin = state.members[sender]?.repEdgeFromIntroducer ?? repEdge
		await seedMemberReputationFromIntroducer(username, sender, introducer, edgeFromJoin)
	}
}

/**
 * DAG 事件落盘后：WebSocket 广播、按需写频道消息行并刷新 checkpoint。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 已持久化的签名事件对象
 * @param {{ checkpointOwnerSecretKey?: Uint8Array }} [persistOpts] checkpoint 签名私钥
 * @returns {Promise<void>}
 */
export async function broadcastAndPersist(username, groupId, signPayload, persistOpts = {}) {
	if (signPayload.type === 'file_delete' && signPayload.content?.fileId) {
		const { state } = await getState(username, groupId)
		await releaseFileChunksAfterDelete(username, groupId, String(signPayload.content.fileId), state)
	}

	const roomKey = groupWsRoomKeyForReplica(username, groupId)
	broadcastEvent(roomKey, { type: 'dag_event', event: signPayload })
	if (!persistOpts.skipGenesisSideEffects) {
		await applyReputationHooks(username, groupId, signPayload)
		await applyFileMasterKeyRotationFromEvent(username, groupId, signPayload)
		await tryImportFileKeyGrantFromPeerInvite(username, groupId, signPayload)
	}
	if (signPayload.type === 'channel_key_rotate') {
		const { sender } = await resolveLocalEventSigner(username, groupId)
		await applyChannelKeyRotateEvent(username, groupId, signPayload, sender)
	}
	if (signPayload.type === 'channel_key_rotate_batch') {
		const { sender } = await resolveLocalEventSigner(username, groupId)
		for (const rot of signPayload.content?.rotations || [])
			await applyChannelKeyRotateEvent(username, groupId, { content: rot }, sender)
	}
	if (!PERSIST_MESSAGE_TYPES.has(signPayload.type)) {
		const existingCheckpoint = await safeReadJson(snapshotPath(username, groupId))
		const deferCheckpointForBootstrapJoin = signPayload.type === 'member_join'
			&& !isSignedBaseCheckpoint(existingCheckpoint)
		if (!persistOpts.skipCheckpointRebuild && !deferCheckpointForBootstrapJoin)
			await rebuildAndSaveCheckpoint(username, groupId, { ...persistOpts, skipChannelGc: true })
		if (!persistOpts.skipGenesisSideEffects) 
			if (signPayload.type === 'channel_permissions_update') {
				const channelId = String(signPayload.content?.channelId || '').trim()
				if (channelId) await appendChannelKeyRotate(username, groupId, channelId)
			}
			else if (signPayload.type === 'member_join') {
				const { convergeDagTipsIfAuthorized } = await import('./lifecycle.mjs')
				await convergeDagTipsIfAuthorized(username, groupId)
			}
			else if (['member_kick', 'role_assign', 'role_revoke'].includes(signPayload.type))
				await rotateAllChannelKeys(username, groupId)
		
		return
	}
	const channelId = signPayload.channelId || 'default'
	const storedContent = signPayload.content
	let displayContent = storedContent
	let sidecarContent = storedContent
	if (CKG_ENCRYPT_EVENT_TYPES.has(signPayload.type)) {
		const result = await decryptEventContent(username, groupId, channelId, storedContent)
		if (result.ok) {
			displayContent = result.content
			sidecarContent = result.content
		}
		else {
			displayContent = {
				decryptFailed: true,
				pendingGeneration: result.generation ?? null,
			}
			sidecarContent = displayContent
		}
	}
	const messageLine = {
		eventId: signPayload.id,
		type: signPayload.type,
		content: sidecarContent,
		sender: signPayload.sender,
		charId: signPayload.charId,
		timestamp: signPayload.timestamp,
		hlc: signPayload.hlc,
		prev_event_ids: sortedPrevEventIds(signPayload.prev_event_ids),
		receivedAt: await getEventReceivedAt(username, groupId, signPayload.id) ?? Date.now(),
	}
	await appendJsonlSynced(messagesPath(username, groupId, channelId), messageLine)
	broadcastEvent(roomKey, {
		type: 'channel_message',
		channelId,
		message: { ...messageLine, content: displayContent },
	})
	await rebuildAndSaveCheckpoint(username, groupId, { ...persistOpts, skipChannelGc: true })
	if (signPayload.type === 'message')
		void import('../session/autoReply.mjs').then(({ maybeAutoTriggerCharReply }) =>
			maybeAutoTriggerCharReply(username, groupId, channelId, displayContent, signPayload),
		).catch(error => {
			console.error('maybeAutoTriggerCharReply failed:', error)
		})
	if (signPayload.type === 'group_settings_update' && signPayload.content?.mqttRoomSecret) {
		const { state } = await getState(username, groupId)
		const creds = mqttCredentialsFromGroupSettings({ ...state.groupSettings, ...signPayload.content })
		if (creds) await onMqttCredentialsSyncedFromDag(username, groupId, creds)
	}
}
