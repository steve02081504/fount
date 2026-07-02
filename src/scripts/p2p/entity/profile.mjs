import { parseEntityHash } from '../entity_id.mjs'
import { getEntityStore } from '../node/instance.mjs'

import { profileAvatarFileUrl } from './files/url.mjs'
import {
	applyAvatarToAllLocales,
	normalizeLocalizedMap,
	resolveProfilePresentation,
} from './localized_core.mjs'
import { resolveInfoDefaultsForEntity } from './presentation_registry.mjs'
import { isWritableLocalEntity } from './replica.mjs'

/** 超过该毫秒未心跳则视为离线 */
const HEARTBEAT_STALE_MS = 120_000

const MANUAL_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible', 'away', 'busy', 'offline'])
const PROFILE_JSON = 'profile.json'

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {{ nodeHash: string, subjectHash: string }} parsed parseEntityHash 结果
 * @returns {object} 默认资料
 */
function getDefaultProfile(entityHash, parsed) {
	return {
		entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
		localized: {},
		status: 'online',
		customStatus: '',
		lastSeenAt: 0,
		stats: {
			joinedAt: Date.now(),
			messageCount: 0,
			groupCount: 0,
			channelCount: 0,
		},
	}
}

/**
 * @param {object} profileData 原始对象
 * @returns {object} 可写入磁盘的资料
 */
function toStoredProfile(profileData) {
	return {
		entityHash: profileData.entityHash,
		nodeHash: profileData.nodeHash,
		subjectHash: profileData.subjectHash,
		localized: normalizeLocalizedMap(profileData.localized),
		status: profileData.status || 'online',
		customStatus: String(profileData.customStatus || '').trim(),
		lastSeenAt: profileData.lastSeenAt || 0,
		stats: {
			joinedAt: profileData.stats?.joinedAt || Date.now(),
			messageCount: profileData.stats?.messageCount || 0,
			groupCount: profileData.stats?.groupCount || 0,
			channelCount: profileData.stats?.channelCount || 0,
		},
	}
}

/**
 * @param {object} profile 用户资料
 * @param {string} [viewerEntityHash] 查看者 entityHash
 * @param {{ isSelf?: boolean }} [options] isSelf 为 true 时隐身对本人可见
 * @returns {string} effectiveStatus
 */
export function computeEffectiveStatus(profile, viewerEntityHash, options = {}) {
	const stored = String(profile?.status || 'online')
	const isSelf = options.isSelf
		?? (viewerEntityHash && profile?.entityHash === viewerEntityHash)
	const lastSeen = profile?.lastSeenAt || 0
	const recentlySeen = lastSeen > 0 && Date.now() - lastSeen < HEARTBEAT_STALE_MS

	if (stored === 'invisible')
		return isSelf ? 'invisible' : 'offline'

	if (!recentlySeen)
		return 'offline'

	return stored
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [replicaUsername] 展示默认字段用
 * @param {{ groupId?: string, skipPresentation?: boolean, locales?: string[], infoDefaults?: object }} [options] 选项
 * @returns {Promise<object>} 资料对象
 */
export async function getProfile(entityHash, replicaUsername = null, options = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) throw new Error('invalid entityHash')

	const store = getEntityStore()
	const defaultProfile = getDefaultProfile(parsed.entityHash, parsed)
	let stored = defaultProfile

	const onDisk = await store.readEntityJson(parsed.entityHash, PROFILE_JSON)
	if (onDisk)
		stored = toStoredProfile({ ...defaultProfile, ...onDisk })
	else if (isWritableLocalEntity(parsed.entityHash))
		await store.writeEntityJson(parsed.entityHash, PROFILE_JSON, stored)

	const locales = options.locales || ['zh-CN', 'en-UK']
	const merged = {
		...stored,
		entityHash: parsed.entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
	}

	if (options.skipPresentation) return merged

	let infoDefaults = options.infoDefaults
	if (!infoDefaults && replicaUsername)
		infoDefaults = await resolveInfoDefaultsForEntity(replicaUsername, parsed.entityHash, locales)
	if (!infoDefaults)
		infoDefaults = { name: `${parsed.subjectHash.slice(0, 8)}…${parsed.subjectHash.slice(-4)}`, avatar: '', description: '', description_markdown: '', version: '', author: '', home_page: '', issue_page: '', tags: [], links: [] }

	const resolved = resolveProfilePresentation(merged, locales, infoDefaults)
	return {
		...merged,
		...resolved,
		infoDefaults,
		localeKeys: Object.keys(merged.localized),
	}
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<void>}
 */
export async function recordHeartbeat(replicaUsername, entityHash) {
	void replicaUsername
	const profile = await getProfile(entityHash, null, { skipPresentation: true })
	profile.lastSeenAt = Date.now()
	await getEntityStore().writeEntityJson(entityHash, PROFILE_JSON, toStoredProfile(profile))
	return { lastSeenAt: profile.lastSeenAt }
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新内容
 * @param {{ groupId?: string, skipPresentation?: boolean, locales?: string[] }} [options] 选项
 * @returns {Promise<object>} 更新后的资料
 */
export async function updateProfile(replicaUsername, entityHash, updates, options = {}) {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const profile = await getProfile(entityHash, replicaUsername, {
		groupId: options.groupId,
		skipPresentation: true,
	})
	const parsed = parseEntityHash(entityHash)

	const localized = updates.localized != null
		? normalizeLocalizedMap(updates.localized)
		: profile.localized

	const updatedProfile = toStoredProfile({
		...profile,
		entityHash: parsed.entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
		localized,
		status: updates.status != null ? updates.status : profile.status,
		customStatus: updates.customStatus != null ? updates.customStatus : profile.customStatus,
		lastSeenAt: updates.lastSeenAt != null ? updates.lastSeenAt : profile.lastSeenAt,
		stats: updates.stats ? { ...profile.stats, ...updates.stats } : profile.stats,
	})

	await getEntityStore().writeEntityJson(entityHash, PROFILE_JSON, updatedProfile)
	if (options.skipPresentation) return updatedProfile
	const locales = options.locales || ['zh-CN', 'en-UK']
	const infoDefaults = await resolveInfoDefaultsForEntity(replicaUsername, entityHash, locales)
	const resolved = resolveProfilePresentation(updatedProfile, locales, infoDefaults)
	return { ...updatedProfile, ...resolved, infoDefaults, localeKeys: Object.keys(updatedProfile.localized) }
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {Buffer} fileBuffer 文件缓冲区
 * @param {string} filename 文件名
 * @returns {Promise<string>} 头像 URL
 */
export async function uploadAvatar(replicaUsername, entityHash, fileBuffer, filename) {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const { putFileManifest } = await import('./files/evfs.mjs')
	await putFileManifest({
		ownerEntityHash: entityHash,
		logicalPath: 'profile/avatar',
		plaintext: fileBuffer,
		name: filename || 'avatar',
		mimeType: 'image/png',
		ceMode: 'convergent',
	})

	const avatarUrl = profileAvatarFileUrl(entityHash)
	const profile = await getProfile(entityHash, replicaUsername, { skipPresentation: true })
	await updateProfile(replicaUsername, entityHash, {
		localized: applyAvatarToAllLocales(profile.localized, avatarUrl),
	}, { skipPresentation: true })
	return avatarUrl
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<object>} 统计字段
 */
export async function getStats(entityHash) {
	const profile = await getProfile(entityHash)
	return profile.stats
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {string} status 状态
 * @param {string} [customStatus] 自定义状态
 * @returns {Promise<{ status: string, customStatus: string, lastSeenAt: number }>} 更新后的状态字段
 */
export async function updateStatus(replicaUsername, entityHash, status, customStatus = '') {
	if (!MANUAL_STATUSES.has(status))
		throw new Error('invalid status')
	const updated = await updateProfile(replicaUsername, entityHash, {
		status,
		customStatus,
		lastSeenAt: Date.now(),
	}, { skipPresentation: true })
	return {
		status: updated.status,
		customStatus: updated.customStatus,
		lastSeenAt: updated.lastSeenAt,
	}
}

/**
 * 确保本节点操作者实体目录存在。
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<object>} 本节点实体资料
 */
export async function ensureLocalEntityProfile(replicaUsername, entityHash) {
	void replicaUsername
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not on local node')
	return getProfile(entityHash, replicaUsername, { skipPresentation: true })
}
