/**
 * 【文件】`dag/lifecycle.mjs` — 群 DAG 生命周期（创建/确保/拆除）。
 * 【职责】创世写入元数据、默认频道、群设置、默认角色与 `member_join`；合并 DAG tips；删除本机群副本数据。
 * 【原理】`createGroup` 顺序 append 多条创世事件后物化；`ensureGroup` 在 `events.jsonl` 缺失时建群；`mergeDagTips` 用多父 `dag_tip_merge` 汇合分叉；拆除时释放文件引用并清联邦/会话缓存。
 * 【数据结构】返回 `{ groupId, checkpoint, defaultChannelId }` 或 `{ groupId, created }`。
 * 【关联】`append.mjs`、`materialize.mjs`、`events/hlcPolicy.mjs`、`../federation/room.mjs`。
 */
import { randomUUID } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'

import { createDefaultRoles } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { DEFAULT_STREAM_GENERATING_IDLE_MS } from 'npm:@steve02081504/fount-p2p/core/constants'
import { sortedPrevEventIds } from 'npm:@steve02081504/fount-p2p/dag/index'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/governance/branch'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { geti18nForUser } from '../../../../../../../scripts/i18n/index.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { syncEntityProfileFromPersona } from '../../profile/syncFromPersona.mjs'
import { DEFAULT_HLC_MAX_SKEW_MS } from '../events/hlcPolicy.mjs'
import { isGroupFederationActive } from '../federation/groupFederation.mjs'
import { ensureFederationRoom, teardownFederationRoomForGroup } from '../federation/room.mjs'
import { DEFAULT_SIGNALING_APP_ID, mintRoomSecret } from '../federation/roomCredentials.mjs'
import { initGroupFileMasterKey } from '../file_keys/store.mjs'
import { releaseFileStorageRefs } from '../files/groupFiles.mjs'
import { safeRm } from '../lib/fsSafe.mjs'
import { groupDir, eventsPath } from '../lib/paths.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'
import { invalidateKnownMemberIndex } from '../mailbox/memberIndex.mjs'
import { purgeGroupSession } from '../session/wsLifecycle.mjs'
import { dropGroupReplicaRegistration } from '../ws/groupWsRooms.mjs'

import { appendEvent } from './append.mjs'
import { checkEventPermission } from './authorizeEvent.mjs'
import { buildMemberJoinBindingFields } from './entityBinding.mjs'
import { applyEvent, emptyMaterializedState } from './groupMaterializedState.mjs'
import { getLocalSignerForNewGroup, resolveLocalEventSigner } from './localSigner.mjs'
import { getState } from './materialize.mjs'

/** 建群创世事件：跳过逐条 checkpoint 重建与联邦出站。 */
const GENESIS_APPEND_OPTS = {
	skipCheckpointRebuild: true,
	skipGenesisSideEffects: true,
	publishFederation: false,
	skipReleaseQuarantined: true,
}

/**
 * 将当前所有 DAG 叶合并为单条多父事件（§0 多父汇合）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} sender 成员键
 * @param {Uint8Array} [secretKey] 可选私钥种子
 * @returns {Promise<object>} 签名后事件
 */
export async function mergeDagTips(username, groupId, sender, secretKey) {
	const rows = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	const tips = computeDagTipIdsFromEvents(rows)
	if (tips.length < 2) throw httpError(409, 'dag_tip_merge: fewer than 2 tips')
	return appendEvent(username, groupId, {
		type: 'dag_tip_merge',
		sender,
		timestamp: Date.now(),
		content: { mergedTipCount: tips.length },
		prev_event_ids: sortedPrevEventIds(tips),
	}, secretKey)
}

/**
 * 远程 member_join 落盘后：若本机有权且存在多叶分叉，追加 dag_tip_merge 将新人支并入共识。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function convergeDagTipsIfAuthorized(username, groupId) {
	const rows = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	const tips = computeDagTipIdsFromEvents(rows)
	if (tips.length < 2) return

	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const { state } = await getState(username, groupId)
	if (!(await checkEventPermission(state, { type: 'dag_tip_merge' }, sender)).ok) return

	try {
		await mergeDagTips(username, groupId, sender, secretKey)
	}
	catch {
		// 竞态：并发 ingest/merge 后 tips 可能已收敛
	}
}

/**
 * 创建新群：写入创世 `group_meta_update`、默认频道与默认频道设置事件。
 * @param {string} username 用户名
 * @param {object} body 建群参数
 * @returns {Promise<{ groupId: string, checkpoint: object | null, defaultChannelId: string }>} 新群元数据
 */
export async function createGroup(username, body) {
	const groupId = body.groupId || randomUUID()
	await mkdir(groupDir(username, groupId), { recursive: true })
	const owner = String(body.ownerPubKeyHash || '').trim().toLowerCase()
	if (!owner) throw new Error('ownerPubKeyHash required')
	const { getOperatorEntityHash, loadEntityIdentity } = await import('../../entity/identity.mjs')
	const entityHash = body.entityHash || await getOperatorEntityHash(username)
	const memberJoinSecretKey = body.secretKey
	const genesisSecretKey = memberJoinSecretKey || (await getLocalSignerForNewGroup(username, groupId, entityHash)).secretKey
	const genesisSender = owner
	let declaredOwner = body.ownerEntityHash
	if (declaredOwner === undefined) 
		try {
			declaredOwner = (await loadEntityIdentity(username, entityHash)).ownerEntityHash
		}
		catch {
			declaredOwner = null
		}
	

	/** @param {object} event 创世事件体（含 sender） */
	const genesisAppend = async event => {
		const signed = await appendEvent(username, groupId, event, genesisSecretKey, {
			...GENESIS_APPEND_OPTS,
			state,
		})
		state = applyEvent(state, signed)
	}

	let state = emptyMaterializedState()
	state.groupId = groupId

	await genesisAppend({
		type: 'group_meta_update',
		sender: genesisSender,
		timestamp: Date.now(),
		content: {
			name: body.name || await geti18nForUser(username, 'chat.group.defaults.groupMetaName'),
			description: body.description ?? '',
			...body.friendBinding ? { friendBinding: body.friendBinding } : {},
		},
	})

	const initialChannelId = body.defaultChannelId || 'default'
	await genesisAppend({
		type: 'channel_create',
		sender: genesisSender,
		timestamp: Date.now(),
		content: {
			channelId: initialChannelId,
			type: body.defaultChannelType || 'text',
			name: body.defaultChannelName || await geti18nForUser(username, 'chat.group.defaults.defaultChannelName'),
			syncScope: 'group',
		},
	})

	await genesisAppend({
		type: 'group_settings_update',
		sender: genesisSender,
		timestamp: Date.now(),
		content: {
			defaultChannelId: initialChannelId,
			streamGeneratingIdleMs: DEFAULT_STREAM_GENERATING_IDLE_MS,
			hlcMaxSkewMs: DEFAULT_HLC_MAX_SKEW_MS,
			streamingSfuWss: null,
			maxDagPayloadBytes: 262_144,
			maxPeers: 24,
			trustedPeerSlots: 8,
			explorePeerSlots: 4,
			gossipTtl: 2,
			wantIdsBudget: 16,
			batterySaver: false,
			eventRetentionDepth: 200_000,
			eventRetentionMs: 365 * 24 * 3600 * 1000,
			messageContentRetentionMs: 0,
			...body.enableGroupFederation ? {
				signalingAppId: DEFAULT_SIGNALING_APP_ID,
				roomSecret: mintRoomSecret(),
				federationPartitionCount: 8,
				rtcConnectionBudgetMax: 32,
				rtcJoinRatePerMin: 12,
			} : {},
			autoChannelGc: true,
		},
	})

	for (const [roleId, roleDef] of Object.entries(createDefaultRoles()))
		await genesisAppend({
			type: 'role_create',
			sender: genesisSender,
			timestamp: Date.now(),
			content: {
				roleId,
				name: roleDef.name,
				color: roleDef.color,
				position: roleDef.position,
				permissions: roleDef.permissions,
				isDefault: roleDef.isDefault,
				isHoisted: roleDef.isHoisted,
			},
		})

	const binding = await buildMemberJoinBindingFields(username, entityHash, owner)
	await genesisAppend({
		type: 'member_join',
		sender: owner,
		timestamp: Date.now(),
		content: {
			roles: ['founder'],
			homeNodeHash: getLocalNodeHash(),
			...binding,
			...declaredOwner ? { ownerEntityHash: declaredOwner } : {},
			...body.charname ? { charname: body.charname } : {},
		},
	})

	await syncEntityProfileFromPersona(username, groupId)

	await initGroupFileMasterKey(username, groupId)

	const { rotateAllChannelKeys } = await import('../channel_keys/schedule.mjs')
	await rotateAllChannelKeys(username, groupId)

	invalidateKnownMemberIndex(username)
	const defaultChannelId = state.groupSettings?.defaultChannelId ?? initialChannelId
	return {
		groupId,
		checkpoint: null,
		defaultChannelId,
	}
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组/会话 ID
 * @param {object} [options] 建群参数
 * @returns {Promise<{ groupId: string, created: boolean }>} 群 ID 与是否新建
 */
export async function ensureGroup(username, groupId, options = {}) {
	let out
	try {
		await access(eventsPath(username, groupId))
		out = { groupId, created: false }
	}
	catch {
		const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, groupId)
		await createGroup(username, {
			groupId,
			name: options.name || await geti18nForUser(username, 'chat.group.defaults.dmChatName'),
			description: options.description,
			defaultChannelName: options.defaultChannelName
				|| await geti18nForUser(username, 'chat.group.defaults.defaultChannelName'),
			ownerPubKeyHash,
			secretKey,
		})
		out = { groupId, created: true }
	}
	const { state } = await getState(username, groupId)
	if (isGroupFederationActive(state.groupSettings))
		void ensureFederationRoom(username, groupId, {
			channelId: options.defaultChannelId || 'default',
		}).catch(console.error)
	return out
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<void>}
 */
export async function deleteGroupData(username, groupId) {
	await safeRm(groupDir(username, groupId), { recursive: true, force: true })
}

/**
 * 物化后发现本机签名身份已非活跃成员时，拆除 replica（踢出/封禁/退群联邦同步等）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object} state 已物化群状态
 * @returns {Promise<boolean>} 是否已删除本机目录
 */
export async function maybePurgeLocalReplicaIfLeft(username, groupId, state) {
	if (await resolveActiveMemberKeyForLocalUser(username, groupId, state)) return false
	// 只读 peek：本函数在 getState 内被调用，resolveLocalEventSigner 会回调 getState 造成无限递归。
	const { peekLocalSignerPubKeyHash } = await import('./localSigner.mjs')
	const memberKey = await peekLocalSignerPubKeyHash(username, groupId)
	if (!memberKey) return false
	const record = state.members?.[memberKey]
	if (!record || record.status === 'active') return false

	await removeLocalGroupReplica(username, groupId)
	return true
}

/**
 * 拆除本机群副本：释放文件引用、断开联邦、清内存并删除磁盘目录。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {{ state?: object }} [options] 可选已物化状态（退群路径复用，避免二次全量物化）
 * @returns {Promise<void>}
 */
export async function removeLocalGroupReplica(username, groupId, options = {}) {
	const state = options.state ?? (await getState(username, groupId, { skipLeftPurge: true })).state
	const fileIndex = state.messageOverlay?.fileIndex
	const fileMetas = fileIndex instanceof Map
		? [...fileIndex.values()]
		: Object.values(state.fileIndex || {})
	for (const meta of fileMetas)
		if (meta && !meta.deleted) await releaseFileStorageRefs(username, meta)

	// 删盘前 await 联邦 slot 的 leave（带短超时），杜绝删盘后 werift 持连泄漏。
	await teardownFederationRoomForGroup(username, groupId)
	// 清理兜底补齐调度器槽，防止 scheduleByKey 随删群无界增长。
	const { cancelScheduledCatchUp } = await import('../federation/catchUpScheduler.mjs')
	cancelScheduledCatchUp(username, groupId)
	purgeGroupSession(groupId)
	dropGroupReplicaRegistration(groupId)
	await deleteGroupData(username, groupId)
}
