/**
 * 【文件】`dag/append.mjs` — 本地 DAG 事件追加主路径。
 */
import { mkdir } from 'node:fs/promises'

import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { computeAppendHlcAndPrev } from 'npm:@steve02081504/fount-p2p/timeline/append_core'

import { CKG_ENCRYPT_EVENT_TYPES, encryptEventContent, isCkgEncryptedContent, plaintextCkgContentFields } from '../channel_keys/content.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from '../federation/room.mjs'
import { shouldRebindFederationRoomForEvent } from '../federation/rosterChange.mjs'
import { checkMessageRateLimit } from '../governance/messageRateLimit.mjs'
import { groupDir, eventsPath } from '../lib/paths.mjs'

import { commitSignedChatEvent } from './commitSignedEvent.mjs'
import { buildMemberJoinBindingFields } from './entityBinding.mjs'
import { SESSION_EVENT_TYPES } from './eventTypes.mjs'
import { validateIngestAuthz } from './ingest.mjs'
import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState } from './materialize.mjs'
import { releasePendingIngestEvents, releaseQuarantinedEvents } from './remoteIngest.mjs'
import { signLocalChatEvent } from './signLocalEvent.mjs'

/** §2.1 低功耗模式下禁止本地发起的重量级治理变更类型。 */
const BATTERY_SAVER_BLOCKED_LOCAL_TYPES = new Set([
	'member_kick', 'member_ban', 'member_unban',
	'role_create', 'role_update', 'role_delete', 'role_assign', 'role_revoke',
	'channel_create', 'channel_update', 'channel_delete', 'channel_permissions_update',
	'group_settings_update',
	'file_master_key_rotate',
])

/**
 * @param {Uint8Array} secretKey 签名种子
 * @param {object} state 物化群状态
 * @param {object} options append 选项
 * @returns {object} 传给 `commitSignedChatEvent` 的选项
 */
function commitOptsFromAppend(secretKey, state, options) {
	return {
		checkpointOwnerSecretKey: secretKey,
		federationState: state,
		publishFederation: options.publishFederation !== false,
		skipCheckpointRebuild: options.skipCheckpointRebuild,
		skipGenesisSideEffects: options.skipGenesisSideEffects,
		federationExistingSlotOnly: options.federationExistingSlotOnly,
		ingress: options.ingress,
	}
}

/**
 * 追加一条 DAG 事件：校验 → 签名 → 落盘；联邦发布与 quarantine 释放由选项控制。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} event 待追加事件体
 * @param {Uint8Array} secretKey 签名种子
 * @param {{ state?: object, skipValidateIngestAuthz?: boolean, skipReleaseQuarantined?: boolean, publishFederation?: boolean, skipCheckpointRebuild?: boolean, skipGenesisSideEffects?: boolean, federationExistingSlotOnly?: boolean, federationJoinTimeoutMs?: number }} [options] 追加选项
 * @returns {Promise<object>} 写入后的完整签名载荷对象
 */
export async function appendEvent(username, groupId, event, secretKey, options = {}) {
	if (!secretKey) throw new Error('appendEvent requires secretKey')
	const state = options.state ?? (await getState(username, groupId)).state

	if (BATTERY_SAVER_BLOCKED_LOCAL_TYPES.has(event.type) && state.groupSettings?.batterySaver)
		throw new Error(`batterySaver mode: governance event '${event.type}' is read-only`)

	const rateCheck = await checkMessageRateLimit(username, groupId, state, event)
	if (!rateCheck.ok) throw new Error(rateCheck.reason || 'message rate limit exceeded')

	if (!options.skipValidateIngestAuthz)
		await validateIngestAuthz(username, groupId, event, { source: 'local', state })
	await mkdir(groupDir(username, groupId), { recursive: true })
	const previous = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	// session_* 为本机元数据：仍落 events.jsonl，但不得占据联邦 tip frontier，
	// 否则后续世界/消息事件会挂上对端没有的 session 父节点，物化折叠会丢成员。
	const previousForTips = previous.filter(row => !SESSION_EVENT_TYPES.has(row?.type))
	const { hlc, prev_event_ids: prevFromCaller } = computeAppendHlcAndPrev(previousForTips, event, { multiTip: true })

	const { signPayload, wirePayload } = await signLocalChatEvent({
		username,
		groupId,
		event,
		secretKey,
		state,
		hlc,
		prev_event_ids: prevFromCaller,
	})

	await commitSignedChatEvent(username, groupId, wirePayload, commitOptsFromAppend(secretKey, state, options))
	if (options.skipReleaseQuarantined !== true) {
		await releaseQuarantinedEvents(username, groupId)
		await releasePendingIngestEvents(username, groupId)
	}
	if (shouldRebindFederationRoomForEvent(wirePayload)) {
		invalidateFederationRoomCache(username, groupId)
		void ensureFederationRoom(username, groupId).catch(error => {
			console.error('federation: local rebind after roster event failed', error)
		})
	}

	return wirePayload
}

/**
 * 本机写路径：按实体解析群成员 signer；`member_join` 无 binding 时自动附加实体声明。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {object} event 事件体（勿设 sender）
 * @param {{ entityHash?: string } & object} [appendOptions] 传给 `appendEvent`；`entityHash` 缺省为 operator
 * @returns {Promise<object>} 签名后事件
 */
export async function appendSignedLocalEvent(username, groupId, event, appendOptions = {}) {
	const { entityHash: entityHashOpt, ...restOpts } = appendOptions
	const { sender, secretKey, entityHash } = await resolveLocalEventSigner(username, groupId, entityHashOpt)
	let eventBody = { ...event }
	delete eventBody.sender

	if (eventBody.type === 'member_join') {
		const content = { ...eventBody.content }
		if (!content.bindingSig) {
			Object.assign(content, await buildMemberJoinBindingFields(username, entityHash, sender))
			eventBody = { ...eventBody, content }
		}
		else if (!content.entityHash)
			content.entityHash = entityHash
		if (content.ownerEntityHash === undefined) 
			try {
				const { loadEntityIdentity } = await import('../../entity/identity.mjs')
				const idRow = await loadEntityIdentity(username, entityHash)
				if (idRow.ownerEntityHash)
					content.ownerEntityHash = idRow.ownerEntityHash
			}
			catch { /* 无本地身份时跳过 */ }
		
		eventBody = { ...eventBody, content }
	}

	const state = restOpts.state ?? (await getState(username, groupId)).state
	await validateIngestAuthz(username, groupId, { ...eventBody, sender }, { source: 'local', state })
	if (CKG_ENCRYPT_EVENT_TYPES.has(eventBody.type) && eventBody.content && !isCkgEncryptedContent(eventBody.content)) {
		const channelId = eventBody.channelId || 'default'
		const { ensureChannelKey } = await import('../channel_keys/schedule.mjs')
		await ensureChannelKey(username, groupId, channelId)
		eventBody = {
			...eventBody,
			content: await encryptEventContent(username, groupId, channelId, eventBody.content, plaintextCkgContentFields(eventBody.type)),
		}
	}
	return appendEvent(username, groupId, { ...eventBody, sender }, secretKey, {
		...restOpts,
		state,
		skipValidateIngestAuthz: true,
	})
}
