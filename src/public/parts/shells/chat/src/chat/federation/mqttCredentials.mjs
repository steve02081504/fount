/**
 * 群级 Trystero MQTT 凭证：从物化 groupSettings 读取，入群 bootstrap / peer hint 作 catch-up 覆盖。
 */
import { randomUUID } from 'node:crypto'

import {
	clearFederationBootstrap,
	peekFederationBootstrap,
	peekPeerMqttHint,
	peekPreferredMqttOverride,
} from './bootstrapStore.mjs'
import { loadFederationGroupSettings, requireDagDeps } from './deps.mjs'
import { isMqttCredentialsStale } from './mqttStale.mjs'
import { LOGIC_SYNC_PARTITION, partitionRoomName } from './partitions.mjs'

/** 默认 MQTT App ID（创世 group_settings 写入同值）。 */
export const DEFAULT_MQTT_APP_ID = 'fount-group-fed'

/**
 * @returns {string} 新房间口令
 */
export function mintMqttRoomSecret() {
	return randomUUID()
}

/**
 * Trystero 房间名：ECDH DM 用 `dm:<tag>`，否则 `fount-fed-<groupId>`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<string>} MQTT 房间 id
 */
export async function resolveTrysteroFedRoomName(username, groupId) {
	const dag = requireDagDeps()
	const loadGroupState = dag.getStateForFederation
	if (!loadGroupState) return `fount-fed-${groupId}`
	const { state } = await loadGroupState(username, groupId)
	const { groupMeta } = state
	if (groupMeta?.dmKind === 'ecdh' && groupMeta.dmSessionTag)
		return `dm:${groupMeta.dmSessionTag.trim().toLowerCase()}`
	return `fount-fed-${groupId}`
}

/**
 * @param {object} settings 物化 groupSettings
 * @returns {{ mqttAppId: string, mqttRoomSecret: string } | null} 物化凭证或 null
 */
export function mqttCredentialsFromGroupSettings(settings) {
	if (!settings?.mqttRoomSecret) return null
	return {
		mqttAppId: settings.mqttAppId || DEFAULT_MQTT_APP_ID,
		mqttRoomSecret: settings.mqttRoomSecret,
	}
}

/**
 * @param {{ mqttAppId: string, mqttRoomSecret: string }} a 凭证 A
 * @param {{ mqttAppId: string, mqttRoomSecret: string }} b 凭证 B
 * @returns {boolean} 是否相同口令
 */
function credsEqual(a, b) {
	return a.mqttRoomSecret === b.mqttRoomSecret && a.mqttAppId === b.mqttAppId
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [partitionId] MQTT 分区 id（默认 sync）
 * @returns {Promise<{ appId: string, password: string, roomId: string, source: 'dag' | 'bootstrap' | 'peer_hint' }>} Trystero 连接参数
 */
export async function resolveGroupMqttCredentials(username, groupId, partitionId = LOGIC_SYNC_PARTITION) {
	const baseRoomId = await resolveTrysteroFedRoomName(username, groupId)
	const roomId = partitionRoomName(baseRoomId, partitionId || LOGIC_SYNC_PARTITION)
	const settings = await loadFederationGroupSettings(username, groupId)
	const fromDag = mqttCredentialsFromGroupSettings(settings)
	const override = peekPreferredMqttOverride(username, groupId)
	const stale = isMqttCredentialsStale(username, groupId)

	const useOverride = override?.mqttRoomSecret && (
		stale
		|| !fromDag
		|| !credsEqual(fromDag, override)
	)

	if (useOverride) {
		const source = peekFederationBootstrap(username, groupId) ? 'bootstrap' : 'peer_hint'
		return {
			appId: override.mqttAppId || DEFAULT_MQTT_APP_ID,
			password: override.mqttRoomSecret,
			roomId,
			source,
			partitionId,
		}
	}

	if (fromDag) {
		if (!stale && !peekPeerMqttHint(username, groupId))
			clearFederationBootstrap(username, groupId)
		return {
			appId: fromDag.mqttAppId,
			password: fromDag.mqttRoomSecret,
			roomId,
			source: 'dag',
			partitionId,
		}
	}

	const bootstrap = peekFederationBootstrap(username, groupId)
	if (bootstrap?.mqttRoomSecret)
		return {
			appId: bootstrap.mqttAppId,
			password: bootstrap.mqttRoomSecret,
			roomId,
			source: 'bootstrap',
			partitionId,
		}

	throw new Error(`group ${groupId} has no mqttRoomSecret in settings; use a fresh invite link or rotate room secret`)
}

/**
 * DAG 已 ingest 新口令且与 override 一致时调用。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ mqttAppId?: string, mqttRoomSecret: string }} dagCreds 物化口令
 * @returns {void}
 */
export async function onMqttCredentialsSyncedFromDag(username, groupId, dagCreds) {
	if (!dagCreds?.mqttRoomSecret) return
	const override = peekPreferredMqttOverride(username, groupId)
	if (!override || credsEqual(dagCreds, override))
		clearFederationBootstrap(username, groupId)
	const { clearMqttCredentialsStale } = await import('./mqttStale.mjs')
	clearMqttCredentialsStale(username, groupId)
	const { getFederationPartitionSlot } = await import('./registry.mjs')
	const { LOGIC_SYNC_PARTITION } = await import('./partitions.mjs')
	const existing = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	if (existing && existing.mqttPassword !== dagCreds.mqttRoomSecret) {
		const { invalidateFederationRoomCache } = await import('./room.mjs')
		invalidateFederationRoomCache(username, groupId)
	}
}
