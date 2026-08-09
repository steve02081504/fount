import { Buffer } from 'node:buffer'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { publishPublicFile } from 'npm:@steve02081504/fount-p2p/files/public_manifest'
import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { localesForUser } from '../../../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../../../server/auth/index.mjs'

import {
	profileAvatarFileUrl,
	profileBannerFileUrl,
	profileSfwAvatarFileUrl,
	profileSfwBannerFileUrl,
} from './filesUrl.mjs'
import {
	applyAvatarToAllLocales,
	applySfwAvatarToAllLocales,
	normalizeLocalizedMap,
	resolveProfilePresentation,
} from './localized.mjs'
import { resolveAgentCharPartName } from './member.mjs'
import { getInfoDefaultsForEntity } from './presentation.mjs'

export { computeEffectiveStatus } from './presenceStatus.mjs'

const MANUAL_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible', 'away', 'busy'])
const PROFILE_JSON = 'profile.json'
const PUBLIC_PROFILE_PATH = 'profile.json'
/** handle：2–32 位小写 `[a-z0-9_.-]`；空串表示清除。不要求全局唯一。 */
const HANDLE_RE = /^[a-z0-9_.-]{2,32}$/
const THEME_COLOR_RE = /^#[\da-f]{6}$/i

/** entityHash → 负缓存截止时间（仅远端拉取失败）；有界 LRU + TTL */
const REMOTE_PROFILE_NEGATIVE_CACHE_MAX = 2048
const REMOTE_PROFILE_NEGATIVE_TTL_MS = 60_000
/** @type {ReturnType<typeof createLruMap<string, number>>} */
const remoteProfileNegativeCache = createLruMap(REMOTE_PROFILE_NEGATIVE_CACHE_MAX)
/** 远端 EVFS profile 拉取上限；超时回落本地默认/磁盘资料，避免资料卡 HTTP 挂死 */
export const REMOTE_PROFILE_FETCH_TIMEOUT_MS = 2500

/**
 * 删除已过期的负缓存条目。
 * @returns {void}
 */
function sweepRemoteProfileNegativeCache() {
	const now = Date.now()
	for (const [entityHash, until] of remoteProfileNegativeCache)
		if (until <= now) remoteProfileNegativeCache.delete(entityHash)
}

/**
 * @param {string} entityHash 128 hex
 * @returns {boolean} 负缓存是否仍有效（命中则应跳过远端拉取）
 */
function isRemoteProfileNegativelyCached(entityHash) {
	const until = remoteProfileNegativeCache.get(entityHash)
	if (until == null) return false
	if (until <= Date.now()) {
		remoteProfileNegativeCache.delete(entityHash)
		return false
	}
	remoteProfileNegativeCache.touch(entityHash, until)
	return true
}

/**
 * @param {string} entityHash 128 hex
 * @returns {void}
 */
function markRemoteProfileNegative(entityHash) {
	sweepRemoteProfileNegativeCache()
	remoteProfileNegativeCache.touch(entityHash, Date.now() + REMOTE_PROFILE_NEGATIVE_TTL_MS)
}

/**
 * @template T
 * @param {Promise<T>} promise 目标
 * @param {number} timeoutMs 超时毫秒
 * @param {string} label 超时错误文案
 * @returns {Promise<T>} 成功值；超时抛错
 */
function raceTimeout(promise, timeoutMs, label) {
	if (!(timeoutMs > 0)) return promise
	let timer
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(label)), timeoutMs)
		}),
	])
}

/**
 * @param {string} replicaUsername replica
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 逻辑路径
 * @param {(username: string, entityHash: string, path: string) => Promise<Uint8Array | Buffer | null>} [readPlain] 可注入（测试）
 * @returns {Promise<Uint8Array | Buffer | null>} 明文或 null
 */
async function readRemoteProfilePlain(replicaUsername, entityHash, logicalPath, readPlain) {
	if (readPlain) return readPlain(replicaUsername, entityHash, logicalPath)
	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	return readPublicFile(replicaUsername, entityHash, logicalPath)
}

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
		sfw_banner: '',
		defaultEmojiPackId: '',
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
	const sfw_banner = String(profileData.sfw_banner ?? '').trim()
	const defaultEmojiPackId = String(profileData.defaultEmojiPackId ?? '').trim()
	const activePub = String(profileData.activePubKeyHex || '').trim().toLowerCase()
	return {
		entityHash: profileData.entityHash,
		nodeHash: profileData.nodeHash,
		subjectHash: profileData.subjectHash,
		ownerEntityHash: ownerRaw ? String(ownerRaw).trim().toLowerCase() : null,
		handle,
		themeColor,
		banner,
		sfw_banner,
		defaultEmojiPackId,
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
		sfw_banner: stored.sfw_banner || '',
		defaultEmojiPackId: stored.defaultEmojiPackId || '',
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
 * 远端实体：经 EVFS 拉签名 profile 落盘（显式路径用；带负缓存与超时）。
 * @param {string} replicaUsername replica
 * @param {string} entityHash 128 hex
 * @param {{ timeoutMs?: number, readPlain?: (username: string, entityHash: string, path: string) => Promise<Uint8Array | Buffer | null> }} [options] 超时与可读注入
 * @returns {Promise<object | null>} 落盘后的 stored profile，或 null
 */
export async function fetchAndCacheRemoteProfile(replicaUsername, entityHash, options = {}) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed || isWritableLocalEntity(parsed.entityHash)) return null
	if (isRemoteProfileNegativelyCached(parsed.entityHash)) return null

	let plain
	try {
		plain = await raceTimeout(
			readRemoteProfilePlain(replicaUsername, parsed.entityHash, PUBLIC_PROFILE_PATH, options.readPlain),
			options.timeoutMs ?? REMOTE_PROFILE_FETCH_TIMEOUT_MS,
			'remote profile fetch timeout',
		)
	}
	catch {
		markRemoteProfileNegative(parsed.entityHash)
		return null
	}
	if (!plain) {
		markRemoteProfileNegative(parsed.entityHash)
		return null
	}
	let payload
	try {
		payload = JSON.parse(plain.toString('utf8'))
	}
	catch {
		markRemoteProfileNegative(parsed.entityHash)
		return null
	}
	if (String(payload?.entityHash || '').toLowerCase() !== parsed.entityHash) {
		markRemoteProfileNegative(parsed.entityHash)
		return null
	}
	const defaultProfile = getDefaultProfile(parsed.entityHash, parsed)
	const stored = toStoredProfile({ ...defaultProfile, ...payload, entityHash: parsed.entityHash })
	await getEntityStore().writeEntityJson(parsed.entityHash, PROFILE_JSON, stored)
	remoteProfileNegativeCache.delete(parsed.entityHash)
	return stored
}

/**
 * @param {string | null | undefined} replicaUsername 查看者 / 副本用户
 * @returns {boolean} 是否启用 SFW
 */
function viewerSfw(replicaUsername) {
	if (!replicaUsername) return false
	return !!getUserByUsername(replicaUsername)?.sfw
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [replicaUsername] 展示默认字段用
 * @param {{ groupId?: string, skipPresentation?: boolean, locales?: string[], infoDefaults?: object, fetchRemote?: boolean, forceRemote?: boolean, remoteTimeoutMs?: number, readPlain?: (username: string, entityHash: string, path: string) => Promise<Uint8Array | Buffer | null> }} [options] 选项；`fetchRemote` 仅显式查看/搜索路径；`forceRemote` 跳过负缓存再拉
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
			await publishStaticProfile(replicaUsername, parsed.entityHash, stored).catch(() => { })
	}

	if (!isWritableLocalEntity(parsed.entityHash) && options.fetchRemote && replicaUsername) {
		if (options.forceRemote)
			remoteProfileNegativeCache.delete(parsed.entityHash)
		const remote = await fetchAndCacheRemoteProfile(replicaUsername, parsed.entityHash, {
			timeoutMs: options.remoteTimeoutMs,
			readPlain: options.readPlain,
		})
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

	const sfw = viewerSfw(replicaUsername)
	const resolved = resolveProfilePresentation(merged, locales, infoDefaults, { sfw })
	const charPartName = replicaUsername
		? resolveAgentCharPartName(replicaUsername, parsed.entityHash)
		: null
	return {
		...merged,
		...resolved,
		// 顶层 banner 保持磁盘原值，展示用 displayBanner（已按 sfw overlay）
		banner: merged.banner || '',
		sfw_banner: merged.sfw_banner || '',
		displayBanner: resolved.banner || '',
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
			const resolved = resolveProfilePresentation(profile, locales, infoDefaults, { sfw: viewerSfw(replicaUsername) })
			return {
				...profile,
				...resolved,
				banner: profile.banner || '',
				sfw_banner: profile.sfw_banner || '',
				displayBanner: resolved.banner || '',
				infoDefaults,
				localeKeys: Object.keys(profile.localized),
			}
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
		sfw_banner: updates.sfw_banner !== undefined
			? String(updates.sfw_banner || '').trim()
			: profile.sfw_banner || '',
		defaultEmojiPackId: updates.defaultEmojiPackId !== undefined
			? String(updates.defaultEmojiPackId || '').trim()
			: profile.defaultEmojiPackId || '',
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
		|| updates.sfw_banner !== undefined
		|| updates.defaultEmojiPackId !== undefined
	if (staticTouched)
		await publishStaticProfile(replicaUsername, entityHash, updatedProfile)

	if (updates.defaultEmojiPackId !== undefined) {
		const { ensureEntitySocialReady } = await import('../../../social/src/lib/bootstrap.mjs')
		const { updateSocialMeta } = await import('../../../social/src/socialMeta.mjs')
		await ensureEntitySocialReady(replicaUsername, entityHash)
		await updateSocialMeta(replicaUsername, entityHash, {
			defaultEmojiPackId: updatedProfile.defaultEmojiPackId || null,
		})
	}

	if (options.skipPresentation) return updatedProfile
	const locales = options.locales || localesForUser(replicaUsername)
	const infoDefaults = await getInfoDefaultsForEntity(replicaUsername, entityHash, locales)
	const resolved = resolveProfilePresentation(updatedProfile, locales, infoDefaults, { sfw: viewerSfw(replicaUsername) })
	return {
		...updatedProfile,
		...resolved,
		banner: updatedProfile.banner || '',
		sfw_banner: updatedProfile.sfw_banner || '',
		displayBanner: resolved.banner || '',
		infoDefaults,
		localeKeys: Object.keys(updatedProfile.localized),
	}
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {Buffer} fileBuffer 文件缓冲区
 * @param {string} filename 文件名
 * @param {string} [mimeType] MIME
 * @param {{ sfw?: boolean }} [options] `sfw` 时写入 profile/sfw_avatar
 * @returns {Promise<string>} 头像 URL
 */
export async function uploadAvatar(replicaUsername, entityHash, fileBuffer, filename, mimeType = 'image/png', options = {}) {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const { getEntityRecoverySecretKey, getRecoveryPubKeyHex } = await import('./identity.mjs')
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(replicaUsername, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(replicaUsername, entityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex)
		throw new Error('recovery key unavailable for public avatar publish')

	const sfw = !!options.sfw
	await publishPublicFile({
		ownerEntityHash: entityHash,
		logicalPath: sfw ? 'profile/sfw_avatar' : 'profile/avatar',
		plaintext: fileBuffer,
		name: filename || (sfw ? 'sfw_avatar' : 'avatar'),
		mimeType: mimeType || 'image/png',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})

	const avatarUrl = sfw ? profileSfwAvatarFileUrl(entityHash) : profileAvatarFileUrl(entityHash)
	const profile = await getProfile(entityHash, replicaUsername, { skipPresentation: true })
	await updateProfile(replicaUsername, entityHash, {
		localized: sfw
			? applySfwAvatarToAllLocales(profile.localized, avatarUrl)
			: applyAvatarToAllLocales(profile.localized, avatarUrl),
	}, { skipPresentation: true })
	return avatarUrl
}

/**
 * @param {string} replicaUsername 副本用户名 所有者
 * @param {string} entityHash 128 位 entityHash
 * @param {Buffer} fileBuffer 文件缓冲区
 * @param {string} filename 文件名
 * @param {string} [mimeType] MIME
 * @param {{ sfw?: boolean }} [options] `sfw` 时写入 profile/sfw_banner
 * @returns {Promise<string>} 横幅 URL
 */
export async function uploadBanner(replicaUsername, entityHash, fileBuffer, filename, mimeType = 'image/png', options = {}) {
	if (!isWritableLocalEntity(entityHash))
		throw new Error('entity not writable on this replica')

	const { getEntityRecoverySecretKey, getRecoveryPubKeyHex } = await import('./identity.mjs')
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(replicaUsername, entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(replicaUsername, entityHash)
	if (!recoverySecretKeyHex || !recoveryPubKeyHex)
		throw new Error('recovery key unavailable for public banner publish')

	const sfw = !!options.sfw
	await publishPublicFile({
		ownerEntityHash: entityHash,
		logicalPath: sfw ? 'profile/sfw_banner' : 'profile/banner',
		plaintext: fileBuffer,
		name: filename || (sfw ? 'sfw_banner' : 'banner'),
		mimeType: mimeType || 'image/png',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})

	const bannerUrl = sfw ? profileSfwBannerFileUrl(entityHash) : profileBannerFileUrl(entityHash)
	await updateProfile(replicaUsername, entityHash, sfw
		? { sfw_banner: bannerUrl }
		: { banner: bannerUrl }, { skipPresentation: true })
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
