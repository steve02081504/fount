/**
 * 【文件】`dag/eventPersist.mjs` — 事件落盘后的副作用管线。
 * 【职责】WebSocket 广播 DAG/频道消息、写频道 `messages.jsonl`、刷新 checkpoint、触发信誉/GSH/自动回复与 world AfterAddChatLogEntry。
 * 【原理】非消息类事件仅重建 checkpoint；消息类解密展示内容后双播 `dag_event` 与 `channel_message`；AfterAddChatLogEntry 在 message 落盘后唯一触发。
 * 【数据结构】`messageLine` 含 `eventId`、`hlc`、`prev_event_ids`、`receivedAt`；房间键来自 `groupWsRoomKeyForReplica`。
 * 【关联】`materialize.mjs`、`events/meta.mjs`、`../stream/groupWsHub.mjs`、`../session/autoReply.mjs`、`../session/chatRequest.mjs`。
 */
import { sortedPrevEventIds } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { applyNetworkHint, mergeNetworkPeerPools } from '../../../../../../../scripts/p2p/network.mjs'
import {
	applyDecayCollusionAfterSlash,
	applyReputationResetToScores,
	applySubjectiveSlashFromEvent,
	seedMemberReputationFromIntroducer,
} from '../../../../../../../scripts/p2p/reputation_store.mjs'
import {
	CKG_ENCRYPT_EVENT_TYPES,
	decryptEventContent,
} from '../channel_keys/content.mjs'
import { appendChannelKeyRotate, rotateAllChannelKeys } from '../channel_keys/schedule.mjs'
import { applyChannelKeyRotateEvent } from '../channel_keys/store.mjs'
import { getEventReceivedAt } from '../events/meta.mjs'
import { onRoomCredentialsSyncedFromDag, roomCredentialsFromGroupSettings } from '../federation/roomCredentials.mjs'
import { tryImportFileKeyGrantFromPeerInvite } from '../file_keys/peerInviteImport.mjs'
import { applyFileMasterKeyRotationFromEvent } from '../file_keys/store.mjs'
import { releaseFileChunksAfterDelete } from '../files/deleteGc.mjs'
import { joinPowBonusFromMemberJoin } from '../governance/joinPolicy.mjs'
import { eventsPath, messagesPath, snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'
import { broadcastEvent } from '../stream/groupWsBroadcast.mjs'
import { groupWsRoomKeyForReplica } from '../stream/groupWsRooms.mjs'

import { isSignedBaseCheckpoint } from './checkpointPayload.mjs'
import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState, rebuildAndSaveCheckpoint } from './materialize.mjs'
import { resolveTargetMemberKey } from './reducers/helpers.mjs'

/** 写入频道消息流 JSONL 的事件类型。 */
const PERSIST_MESSAGE_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
])

/**
 * message 落盘后唯一触发 world AfterAddChatLogEntry。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} signPayload 已签名事件
 * @param {unknown} displayContent 解密后展示 content（message）或 message_edit 的 newContent
 * @returns {Promise<void>}
 */
async function invokeAfterAddChatLogEntry(username, groupId, channelId, signPayload, displayContent) {
	if (displayContent?.is_generating) return
	const { resolveWorld } = await import('../session/resolvePart.mjs')
	const world = await resolveWorld(groupId, channelId, username)
	const afterHook = world?.interfaces?.chat?.AfterAddChatLogEntry
	if (!afterHook) return
	const charname = signPayload.charId
		|| displayContent?.charId
		|| null
	const { getChatRequest } = await import('../session/chatRequest.mjs')
	const { getCharReplyFrequency } = await import('../session/triggerReply.mjs')
	const request = await getChatRequest(groupId, charname || undefined, channelId, { replicaUsername: username })
	const replyFrequency = await getCharReplyFrequency(groupId)
	await afterHook(request, replyFrequency)
}
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
 * @param {() => Promise<object>} materializedState 惰性加载物化状态
 * @returns {Promise<void>}
 */
async function applyReputationHooks(username, groupId, signPayload, materializedState) {
	if (!signPayload.type) return

	/**
	 *
	 */
	const decayAfterSlash = async () => {
		const target = slashTargetPubKeyHash(signPayload)
		if (!target) return
		const state = await materializedState()
		await applyDecayCollusionAfterSlash( target, state.inviteEdges)
	}

	if (signPayload.type === 'reputation_slash') {
		await applySubjectiveSlashFromEvent(username, groupId, signPayload, async (u, g) => readJsonl(eventsPath(u, g), { sanitize: stripDagEventLocalExtensions }))
		await decayAfterSlash()
	}
	else if (['member_kick', 'member_ban'].includes(signPayload.type)) {
		await decayAfterSlash()
		if (signPayload.type === 'member_ban') {
			const { blockEntriesFromBanContent } = await import('../governance/banRules.mjs')
			const { addGroupBlockedPeers, addDenylistFromBanContent } = await import('../../../../../../../scripts/p2p/denylist.mjs')
			const state = await materializedState()
			const entries = blockEntriesFromBanContent(signPayload.content)
			const targetKey = resolveTargetMemberKey(signPayload.content)
			const home = normalizeHex64(state.members?.[targetKey]?.homeNodeHash)
			if (isHex64(home) && !entries.some(entry => entry.scope === 'node' && entry.value === home))
				entries.push({ scope: 'node', value: home })
			addGroupBlockedPeers(groupId, entries)
			await addDenylistFromBanContent(signPayload.content, groupId)
			void import('../federation/shun.mjs')
				.then(({ notifyFedShunAfterMemberBan }) => notifyFedShunAfterMemberBan(username, groupId, signPayload))
				.catch(console.error)
		}
	}
	else if (signPayload.type === 'reputation_reset') {
		const target = slashTargetPubKeyHash(signPayload)
		if (target) await applyReputationResetToScores( target)
	}
	if (signPayload.type === 'member_join') {
		const sender = signPayload.sender.trim().toLowerCase()
		const state = await materializedState()
		const inviteEdge = [...state.inviteEdges].reverse()
			.find(edge => edge.to.trim().toLowerCase() === sender)
		const introducer = signPayload.content?.introducerPubKeyHash?.trim().toLowerCase() || ''
		const repEdge = Number.isFinite(inviteEdge?.reputationEdge) ? inviteEdge.reputationEdge : 1
		const edgeFromJoin = state.members[sender]?.repEdgeFromIntroducer ?? repEdge
		const powBonus = joinPowBonusFromMemberJoin(state, signPayload)
		await seedMemberReputationFromIntroducer(sender, introducer, edgeFromJoin, powBonus)
		if (introducer) {
			const introNodeHash = state.members[introducer]?.homeNodeHash
				|| state.members[introducer]?.nodeHash
			if (introNodeHash && isHex64(String(introNodeHash).trim())) {
				mergeNetworkPeerPools({ explorePeers: [String(introNodeHash).trim()] })
				applyNetworkHint({
					nodeHash: String(introNodeHash).trim(),
					source: `introducer:${introducer.slice(0, 8)}`,
					kind: 'member_join_introducer',
					weight: 0.35,
					groupId,
					ttlMs: 7 * 24 * 60 * 60 * 1000,
				})
			}
		}
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
	/** @type {object | null} */
	let cachedState = persistOpts.state ?? null
	/** @returns {Promise<object>} 物化群状态（单次缓存） */
	async function materializedState() {
		if (!cachedState) cachedState = (await getState(username, groupId)).state
		return cachedState
	}

	if (signPayload.type === 'file_delete' && signPayload.content?.fileId) 
		await releaseFileChunksAfterDelete(username, groupId, String(signPayload.content.fileId), await materializedState())
	

	const roomKey = groupWsRoomKeyForReplica(groupId)
	broadcastEvent(roomKey, { type: 'dag_event', event: signPayload })
	if (!persistOpts.skipGenesisSideEffects) {
		await applyReputationHooks(username, groupId, signPayload, materializedState)
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
		

		if (signPayload.type === 'group_settings_update' && signPayload.content?.roomSecret) {
			const state = await materializedState()
			const creds = roomCredentialsFromGroupSettings({ ...state.groupSettings, ...signPayload.content })
			if (creds) await onRoomCredentialsSyncedFromDag(username, groupId, creds)
		}
		return
	}
	const channelId = signPayload.channelId || 'default'
	const storedContent = signPayload.content
	let displayContent = storedContent
	let sidecarContent = storedContent
	let decryptResult = null
	if (CKG_ENCRYPT_EVENT_TYPES.has(signPayload.type)) {
		decryptResult = await decryptEventContent(username, groupId, channelId, storedContent)
		if (decryptResult.ok) {
			displayContent = decryptResult.content
			sidecarContent = decryptResult.content
		}
		else {
			displayContent = null
			sidecarContent = null
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
		...decryptResult && !decryptResult.ok
			? {
				decryptView: {
					failed: true,
					...decryptResult.generation != null ? { pendingGeneration: decryptResult.generation } : {},
				},
			}
			: {},
	}
	const channelMessagesPath = messagesPath(username, groupId, channelId)
	const existingMessageLines = await readJsonl(channelMessagesPath, { sanitize: stripDagEventLocalExtensions })
	const messageIdNorm = String(signPayload.id).trim().toLowerCase()
	if (!existingMessageLines.some(row => String(row.eventId).trim().toLowerCase() === messageIdNorm))
		await appendJsonlSynced(channelMessagesPath, messageLine)
	broadcastEvent(roomKey, {
		type: 'channel_message',
		channelId,
		message: { ...messageLine, content: displayContent },
	})
	await rebuildAndSaveCheckpoint(username, groupId, { ...persistOpts, skipChannelGc: true })
	if (signPayload.type === 'message') {
		void import('../session/autoReply.mjs').then(({ maybeAutoTriggerCharReply }) =>
			maybeAutoTriggerCharReply(username, groupId, channelId, displayContent, signPayload),
		).catch(error => {
			console.error('maybeAutoTriggerCharReply failed:', error)
		})
		try {
			await invokeAfterAddChatLogEntry(username, groupId, channelId, signPayload, displayContent)
		}
		catch (error) {
			console.error('AfterAddChatLogEntry failed:', error)
		}
	}
	else if (signPayload.type === 'message_edit') {
		const edited = displayContent?.newContent ?? displayContent
		if (edited && !edited.is_generating)
			try {
				await invokeAfterAddChatLogEntry(username, groupId, channelId, signPayload, edited)
			}
			catch (error) {
				console.error('AfterAddChatLogEntry failed:', error)
			}
	}
}
