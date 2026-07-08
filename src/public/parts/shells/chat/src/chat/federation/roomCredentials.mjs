/**
 * 群级 Trystero 房间凭证：从物化 groupSettings 读取，入群 bootstrap / peer hint 作 catch-up 覆盖。
 */
import { randomUUID } from 'node:crypto'

import {
	clearFederationBootstrap,
	peekFederationBootstrap,
	peekPeerRoomHint,
	peekPreferredRoomOverride,
} from './bootstrapStore.mjs'
import { loadFederationGroupSettings, requireDagDeps } from './dagDependencies.mjs'
import { LOGIC_SYNC_PARTITION, partitionRoomName } from './partitions.mjs'

/** 默认信令 App ID（创世 group_settings 写入同值）。 */
export const DEFAULT_SIGNALING_APP_ID = 'fount-group-fed'

/**
 * @returns {string} 新房间口令
 */
export function mintRoomSecret() {
	return randomUUID()
}

/**
 * Trystero 房间名：ECDH DM 用 `dm:<tag>`，否则 `fount-fed-<groupId>`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<string>} 信令房间 id
 */
export async function resolveTrysteroFedRoomName(username, groupId) {
	const dag = requireDagDeps()
	const loadGroupState = dag.getStateForFederation
	if (!loadGroupState) return `fount-fed-${groupId}`
	const { state } = await loadGroupState(username, groupId)
	const { groupMeta } = state
	if (groupMeta?.dmKind === 'ecdh' && groupMeta.dmSessionTag)
		return `dm:${groupMeta.dmSessionTag.trim().toLowerCase()}`
	const override = peekPreferredRoomOverride(username, groupId)
	if (override?.dmSessionTag)
		return `dm:${String(override.dmSessionTag).trim().toLowerCase()}`
	return `fount-fed-${groupId}`
}

/**
 * @param {object} settings 物化 groupSettings
 * @returns {{ signalingAppId: string, roomSecret: string } | null} 物化凭证或 null
 */
export function roomCredentialsFromGroupSettings(settings) {
	if (!settings?.roomSecret) return null
	return {
		signalingAppId: settings.signalingAppId || DEFAULT_SIGNALING_APP_ID,
		roomSecret: settings.roomSecret,
	}
}

/**
 * @param {{ signalingAppId: string, roomSecret: string }} a 凭证 A
 * @param {{ signalingAppId: string, roomSecret: string }} b 凭证 B
 * @returns {boolean} 是否相同口令
 */
function credsEqual(a, b) {
	return a.roomSecret === b.roomSecret && a.signalingAppId === b.signalingAppId
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [partitionId] 分区 id（默认 sync）
 * @returns {Promise<{ appId: string, password: string, roomId: string, source: 'dag' | 'bootstrap' | 'peer_hint' }>} Trystero 连接参数
 */
export async function resolveGroupRoomCredentials(username, groupId, partitionId = LOGIC_SYNC_PARTITION) {
	const baseRoomId = await resolveTrysteroFedRoomName(username, groupId)
	const roomId = partitionRoomName(baseRoomId, partitionId || LOGIC_SYNC_PARTITION)
	const settings = await loadFederationGroupSettings(username, groupId)
	const fromDag = roomCredentialsFromGroupSettings(settings)
	const override = peekPreferredRoomOverride(username, groupId)
	const useOverride = override?.roomSecret && (!fromDag || !credsEqual(fromDag, override))

	if (useOverride) {
		const source = peekFederationBootstrap(username, groupId) ? 'bootstrap' : 'peer_hint'
		return {
			appId: override.signalingAppId || DEFAULT_SIGNALING_APP_ID,
			password: override.roomSecret,
			roomId,
			source,
			partitionId,
		}
	}

	if (fromDag) {
		if (!peekPeerRoomHint(username, groupId))
			clearFederationBootstrap(username, groupId)
		return {
			appId: fromDag.signalingAppId,
			password: fromDag.roomSecret,
			roomId,
			source: 'dag',
			partitionId,
		}
	}

	const bootstrap = peekFederationBootstrap(username, groupId)
	if (bootstrap?.roomSecret)
		return {
			appId: bootstrap.signalingAppId,
			password: bootstrap.roomSecret,
			roomId,
			source: 'bootstrap',
			partitionId,
		}

	throw new Error(`group ${groupId} has no roomSecret in settings; use a fresh invite link or rotate room secret`)
}

/**
 * DAG 已 ingest 新口令且与 override 一致时调用。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ signalingAppId?: string, roomSecret: string }} dagCreds 物化口令
 * @returns {void}
 */
export async function onRoomCredentialsSyncedFromDag(username, groupId, dagCreds) {
	if (!dagCreds?.roomSecret) return
	const override = peekPreferredRoomOverride(username, groupId)
	if (!override || credsEqual(dagCreds, override))
		clearFederationBootstrap(username, groupId)
	const { getFederationPartitionSlot } = await import('./registry.mjs')
	const { LOGIC_SYNC_PARTITION } = await import('./partitions.mjs')
	const existing = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	if (existing && existing.roomSecret !== dagCreds.roomSecret) {
		const { invalidateFederationRoomCache } = await import('./room.mjs')
		invalidateFederationRoomCache(username, groupId)
	}
}
