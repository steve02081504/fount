import { Buffer } from 'node:buffer'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { publishPublicFile } from 'npm:@steve02081504/fount-p2p/files/public_manifest'
import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'

import { localesForUser } from '../../../../../../scripts/locale.mjs'

import { resolveAgentCharPartNameForUser } from './agentHost.mjs'
import { profileAvatarFileUrl, profileBannerFileUrl } from './filesUrl.mjs'
import {
	applyAvatarToAllLocales,
	normalizeLocalizedMap,
	resolveProfilePresentation,
} from './localized.mjs'
import { getInfoDefaultsForEntity } from './presentation.mjs'

/** 超过该毫秒未心跳则视为离线 */
const HEARTBEAT_STALE_MS = 120_000

const MANUAL_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible', 'away', 'busy', 'offline'])
const PROFILE_JSON = 'profile.json'
const PUBLIC_PROFILE_PATH = 'profile.json'
/** handle：2–32 位小写 `[a-z0-9_.-]`；空串表示清除。不要求全局唯一。 */
const HANDLE_RE = /^[a-z0-9_.-]{2,32}$/
const THEME_COLOR_RE = /^#[\da-f]{6}$/i

/** entityHash → 负缓存截止时间（仅远端拉取失败） */
const remoteProfileNegativeCache = new Map()
const REMOTE_PROFILE_NEGATIVE_TTL_MS = 60_000

/**
 * 规范化实体 handle；空串表示未设置。非法输入抛错（调用方应校验）。
 * @param {unknown} value 原始值
 * @returns {string} 小写 handle 或 ''
 */
export function normalizeEntityHandle(value) {
	const handle = String(value ?? '').trim().toLowerCase()
	if (!handle) return ''
	if (!HANDLE_RE.test(handle)) throw new Error('invalid handle')
	return handle
}

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
		ownerEntityHash: null,
		handle: '',
		themeColor: '',
		banner: '',
		activePubKeyHex: '',
		keyGeneration: 0,
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
	const ownerRaw = profileData.ownerEntityHash
	let handle = ''
	try {
		handle = normalizeEntityHandle(profileData.handle)
	}
	catch { handle = '' }
	const themeRaw = String(profileData.themeColor ?? '').trim()
	const themeColor = THEME_COLOR_RE.test(themeRaw) ? themeRaw.toLowerCase() : ''
	const banner = String(profileData.banner ?? '').trim()
	const activePub = String(profileData.activePubKeyHex || '').trim().toLowerCase()
	return {
		entityHash: profileData.entityHash,
		nodeHash: profileData.nodeHash,
		subjectHash: profileData.subjectHash,
		ownerEntityHash: ownerRaw ? String(ownerRaw).trim().toLowerCase() : null,
		handle,
		themeColor,
		banner,
		activePubKeyHex: /^[\da-f]{64}$/i.test(activePub) ? activePub : '',
		keyGeneration: Number(profileData.keyGeneration ?? 0) || 0,
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
 * 签名公开发布物：静态展示字段 + handle + 活跃公钥（建 DM 用）。
 * @param {object} stored 本地 profile
 * @returns {object} 可 JSON 序列化的公开体
 */
function toPublicProfilePayload(stored) {
	return {
		entityHash: stored.entityHash,
		nodeHash: stored.nodeHash,
		subjectHash: stored.subjectHash,
		ownerEntityHash: stored.ownerEntityHash,
		handle: stored.handle || '',
		themeColor: stored.themeColor || '',
		banner: stored.banner || '',
		activePubKeyHex: stored.activePubKeyHex || '',
		keyGeneration: Number(stored.keyGeneration ?? 0) || 0,
		localized: stored.localized,
	}
}

/**
 * @param {string} replicaUsername replica
 * @param {string} entityHash 128 hex
 * @param {object} stored 本地 profile
 * @returns {Promise<void>}
 */
async function publishStaticProfile(replicaUsername, entityHash, stored) {
	const { getEntityRecoverySecretKey, getRecoveryPubKeyHex, getEntityActivePubKey } = await import('./identity.mjs')
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(replicaUsername, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(replicaUsername, entityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex) return
	let activePubKeyHex = stored.activePubKeyHex || ''
	let keyGeneration = Number(stored.keyGeneration ?? 0) || 0
	if (!activePubKeyHex) 
		try {
			activePubKeyHex = await getEntityActivePubKey(replicaUsername, entityHash)
			const { readEntityIdentity } = await import('./store.mjs')
			const row = await readEntityIdentity(replicaUsername, entityHash)
			if (row) keyGeneration = Number(row.keyGeneration ?? 0) || 0
		}
		catch { /* 无本地身份则保持空 */ }
	
	const plaintext = Buffer.from(JSON.stringify(toPublicProfilePayload({
		...stored,
		activePubKeyHex,
		keyGeneration,
	})), 'utf8')
	await publishPublicFile({
		ownerEntityHash: entityHash,
		logicalPath: PUBLIC_PROFILE_PATH,
		plaintext,
		name: 'profile.json',
		mimeType: 'application/json',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})
}

/**
 * @param {object} profile 用户资料
 * @param {string} [viewerEntityHash] 查看者 entityHash
 * @param {{ isSelf?: boolean }} [options] isSelf 为 true 时隐身对本人可见
 * @returns {string} 有效状态
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
/**
 * 远端实体：经 EVFS 拉签名 profile 落盘（显式路径用；带负缓存）。
 * @param {string} replicaUsername replica
 * @param {string} entityHash 128 hex
 * @returns {Promise<object | null>} 落盘后的 stored profile，或 null
 */
export async function fetchAndCacheRemoteProfile(replicaUsername, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || isWritableLocalEntity(parsed.entityHash)) return null
	const now = Date.now()
	const negUntil = remoteProfileNegativeCache.get(parsed.entityHash) || 0
	if (negUntil > now) return null

	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const plain = await readPublicFile(replicaUsername, parsed.entityHash, PUBLIC_PROFILE_PATH)
	if (!plain) {
		remoteProfileNegativeCache.set(parsed.entityHash, now + REMOTE_PROFILE_NEGATIVE_TTL_MS)
		return null
	}
	let payload
	try {
		payload = JSON.parse(plain.toString('utf8'))
	}
	catch {
		remoteProfileNegativeCache.set(parsed.entityHash, now + REMOTE_PROFILE_NEGATIVE_TTL_MS)
		return null
	}
	if (String(payload?.entityHash || '').toLowerCase() !== parsed.entityHash) {
		remoteProfileNegativeCache.set(parsed.entityHash, now + REMOTE_PROFILE_NEGATIVE_TTL_MS)
		return null
	}
	const defaultProfile = getDefaultProfile(parsed.entityHash, parsed)
	const stored = toStoredProfile({ ...defaultProfile, ...payload, entityHash: parsed.entityHash })
	await getEntityStore().writeEntityJson(parsed.entityHash, PROFILE_JSON, stored)
	remoteProfileNegativeCache.delete(parsed.entityHash)
	return stored
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [replicaUsername] 展示默认字段用
 * @param {{ groupId?: string, skipPresentation?: boolean, locales?: string[], infoDefaults?: object, fetchRemote?: boolean }} [options] 选项；`fetchRemote` 仅显式查看/搜索路径
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
	else if (isWritableLocalEntity(parsed.entityHash)) {
		await store.writeEntityJson(parsed.entityHash, PROFILE_JSON, stored)
		if (replicaUsername)
			await publishStaticProfile(replicaUsername, parsed.entityHash, stored).catch(() => {})
	}
	else if (options.fetchRemote && replicaUsername) {
		const remote = await fetchAndCacheRemoteProfile(replicaUsername, parsed.entityHash)
		if (remote) stored = remote
	}

	const locales = options.locales || localesForUser(replicaUsername)
	const merged = {
		...stored,
		entityHash: parsed.entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
	}

	if (options.skipPresentation) return merged

	let { infoDefaults } = options
	if (!infoDefaults && replicaUsername)
		infoDefaults = await getInfoDefaultsForEntity(replicaUsername, parsed.entityHash, locales)
	if (!infoDefaults)
		infoDefaults = { name: `${parsed.subjectHash.slice(0, 8)}…${parsed.subjectHash.slice(-4)}`, avatar: '', description: '', description_markdown: '', version: '', author: '', home_page: '', issue_page: '', tags: [], links: [] }

	const resolved = resolveProfilePresentation(merged, locales, infoDefaults)
	const charPartName = replicaUsername
		? resolveAgentCharPartNameForUser(replicaUsername, parsed.entityHash)
		: null
	return {
		...merged,
		...resolved,
		infoDefaults,
		localeKeys: Object.keys(merged.localized),
		charPartName: charPartName || null,
	}
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<object>} 心跳时间戳
 */
export async function recordHeartbeat(replicaUsername, entityHash) {
	void replicaUsername
	const profile = await getProfile(entityHash, null, { skipPresentation: true })
	profile.lastSeenAt = Date.now()
	await getEntityStore().writeEntityJson(entityHash, PROFILE_JSON, toStoredProfile(profile))
	return { lastSeenAt: profile.lastSeenAt }
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新内容
 * @param {{ groupId?: string, skipPresentation?: boolean, locales?: string[], identityOwnerSync?: boolean }} [options] 选项；`identityOwnerSync` 仅供 setEntityOwner 回写 profile
 * @returns {Promise<object>} 更新后的资料
 */
export async function updateProfile(replicaUsername, entityHash, updates, options = {}) {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	// 所属关系必须经 setEntityOwner（identity + 群 fanout）；禁止只写 profile 造成 Chat 内容权失灵。
	if (updates.ownerEntityHash !== undefined && !options.identityOwnerSync) {
		const { setEntityOwner } = await import('./identity.mjs')
		await setEntityOwner(replicaUsername, entityHash, updates.ownerEntityHash)
		const { ownerEntityHash: _owner, ...rest } = updates
		updates = rest
		if (!Object.keys(updates).length) {
			if (options.skipPresentation)
				return getProfile(entityHash, replicaUsername, { groupId: options.groupId, skipPresentation: true })
			const locales = options.locales || localesForUser(replicaUsername)
			const profile = await getProfile(entityHash, replicaUsername, { groupId: options.groupId, skipPresentation: true })
			const infoDefaults = await getInfoDefaultsForEntity(replicaUsername, entityHash, locales)
			const resolved = resolveProfilePresentation(profile, locales, infoDefaults)
			return { ...profile, ...resolved, infoDefaults, localeKeys: Object.keys(profile.localized) }
		}
	}

	const profile = await getProfile(entityHash, replicaUsername, {
		groupId: options.groupId,
		skipPresentation: true,
	})
	const parsed = parseEntityHash(entityHash)

	const localized = updates.localized != null
		? normalizeLocalizedMap(updates.localized)
		: profile.localized

	let handle = profile.handle || ''
	if (updates.handle !== undefined)
		handle = normalizeEntityHandle(updates.handle)

	let activePubKeyHex = profile.activePubKeyHex || ''
	let keyGeneration = Number(profile.keyGeneration ?? 0) || 0
	try {
		const { getEntityActivePubKey } = await import('./identity.mjs')
		const { readEntityIdentity } = await import('./store.mjs')
		activePubKeyHex = await getEntityActivePubKey(replicaUsername, entityHash)
		const row = await readEntityIdentity(replicaUsername, entityHash)
		if (row) keyGeneration = Number(row.keyGeneration ?? 0) || 0
	}
	catch { /* keep prior */ }

	const updatedProfile = toStoredProfile({
		...profile,
		entityHash: parsed.entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
		ownerEntityHash: updates.ownerEntityHash !== undefined
			? updates.ownerEntityHash
			: profile.ownerEntityHash,
		handle,
		themeColor: updates.themeColor !== undefined
			? THEME_COLOR_RE.test(String(updates.themeColor || '').trim())
				? String(updates.themeColor).trim().toLowerCase()
				: ''
			: profile.themeColor || '',
		banner: updates.banner !== undefined
			? String(updates.banner || '').trim()
			: profile.banner || '',
		activePubKeyHex,
		keyGeneration,
		localized,
		status: updates.status != null ? updates.status : profile.status,
		customStatus: updates.customStatus != null ? updates.customStatus : profile.customStatus,
		lastSeenAt: updates.lastSeenAt != null ? updates.lastSeenAt : profile.lastSeenAt,
		stats: updates.stats ? { ...profile.stats, ...updates.stats } : profile.stats,
	})

	await getEntityStore().writeEntityJson(entityHash, PROFILE_JSON, updatedProfile)

	const staticTouched = updates.localized !== undefined
		|| updates.ownerEntityHash !== undefined
		|| updates.handle !== undefined
		|| updates.themeColor !== undefined
		|| updates.banner !== undefined
	if (staticTouched)
		await publishStaticProfile(replicaUsername, entityHash, updatedProfile).catch(() => {})

	if (options.skipPresentation) return updatedProfile
	const locales = options.locales || localesForUser(replicaUsername)
	const infoDefaults = await getInfoDefaultsForEntity(replicaUsername, entityHash, locales)
	const resolved = resolveProfilePresentation(updatedProfile, locales, infoDefaults)
	return { ...updatedProfile, ...resolved, infoDefaults, localeKeys: Object.keys(updatedProfile.localized) }
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {Buffer} fileBuffer 文件缓冲区
 * @param {string} filename 文件名
 * @param {string} [mimeType] MIME
 * @returns {Promise<string>} 头像 URL
 */
export async function uploadAvatar(replicaUsername, entityHash, fileBuffer, filename, mimeType = 'image/png') {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const { getEntityRecoverySecretKey, getRecoveryPubKeyHex } = await import('./identity.mjs')
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(replicaUsername, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(replicaUsername, entityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex)
		throw new Error('recovery key unavailable for public avatar publish')

	await publishPublicFile({
		ownerEntityHash: entityHash,
		logicalPath: 'profile/avatar',
		plaintext: fileBuffer,
		name: filename || 'avatar',
		mimeType: mimeType || 'image/png',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})

	const avatarUrl = profileAvatarFileUrl(entityHash)
	const profile = await getProfile(entityHash, replicaUsername, { skipPresentation: true })
	await updateProfile(replicaUsername, entityHash, {
		localized: applyAvatarToAllLocales(profile.localized, avatarUrl),
	}, { skipPresentation: true })
	return avatarUrl
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {Buffer} fileBuffer 文件缓冲区
 * @param {string} filename 文件名
 * @param {string} [mimeType] MIME
 * @returns {Promise<string>} 横幅 URL
 */
export async function uploadBanner(replicaUsername, entityHash, fileBuffer, filename, mimeType = 'image/png') {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const { getEntityRecoverySecretKey, getRecoveryPubKeyHex } = await import('./identity.mjs')
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(replicaUsername, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(replicaUsername, entityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex)
		throw new Error('recovery key unavailable for public banner publish')

	await publishPublicFile({
		ownerEntityHash: entityHash,
		logicalPath: 'profile/banner',
		plaintext: fileBuffer,
		name: filename || 'banner',
		mimeType: mimeType || 'image/png',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})

	const bannerUrl = profileBannerFileUrl(entityHash)
	await updateProfile(replicaUsername, entityHash, { banner: bannerUrl }, { skipPresentation: true })
	return bannerUrl
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
 * @param {string} replicaUsername 副本用户名 所有者
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
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<object>} 本节点实体资料
 */
export async function ensureLocalEntityProfile(replicaUsername, entityHash) {
	void replicaUsername
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not on local node')
	return getProfile(entityHash, replicaUsername, { skipPresentation: true })
}
