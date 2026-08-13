import { createHash } from 'node:crypto'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { resolveOperatorEntityHash } from '../lib/replica.mjs'

import {
	bridgeIdentityKey,
	loadBridgesDoc,
	saveBridgesDoc,
} from './store.mjs'

/**
 * @param {string | number | null | undefined} platformUserId 平台用户 ID
 * @returns {boolean} 是否为空或配置模板占位符
 */
export function isPlaceholderPlatformUserId(platformUserId) {
	const value = String(platformUserId ?? '')
	if (!value) return true
	return value.includes('your_')
}

/**
 * 平台账号是否已绑定真实 fount 实体（非派生伪 hash）。
 * @param {string} username replica
 * @param {string} platform 平台名
 * @param {string | number} platformUserId 平台用户 ID
 * @returns {boolean} 是否已在 identityMap 绑定
 */
export function isBoundBridgeIdentity(username, platform, platformUserId) {
	const doc = loadBridgesDoc(username)
	return Boolean(doc.identityMap[bridgeIdentityKey(platform, platformUserId)])
}

/**
 * 壳启动时将 Owner 平台账号自动绑定到 operator entityHash。
 * @param {string} username replica
 * @param {string} platform 平台名
 * @param {string | number} platformUserId 平台用户 ID
 * @param {string} [displayName] 展示名
 * @returns {Promise<void>}
 */
export async function claimOperatorBridgeIdentity(username, platform, platformUserId, displayName = '') {
	if (isPlaceholderPlatformUserId(platformUserId)) return
	const entityHash = await resolveOperatorEntityHash(username)
	if (!entityHash) return
	await bindBridgeIdentity(username, {
		platform,
		platformUserId,
		entityHash,
		displayName,
	})
}

/**
 * 将平台 bot 账号绑定到本地 agent entityHash（使 @bot 提及命中 CharUid）。
 * @param {string} username replica
 * @param {string} platform 平台
 * @param {string | number} platformUserId bot 平台用户 ID
 * @param {string} charname 角色名
 * @param {string} [displayName] 展示名
 * @returns {Promise<void>}
 */
export async function claimAgentBridgeIdentity(username, platform, platformUserId, charname, displayName = '') {
	if (isPlaceholderPlatformUserId(platformUserId) || !charname) return
	const { ensureLocalAgentEntityHash } = await import('../../entity/member.mjs')
	const entityHash = await ensureLocalAgentEntityHash(username, charname)
	if (!entityHash) return
	await bindBridgeIdentity(username, {
		platform,
		platformUserId,
		entityHash,
		displayName: displayName || charname,
	})
}

/**
 * 确定性派生桥接伪 entityHash（128 hex，与真实 entityHash 同构）。
 * @param {string} platform 平台名
 * @param {string | number} platformUserId 平台用户 ID
 * @returns {string} 小写 128 hex
 */
export function bridgeEntityHash(platform, platformUserId) {
	return createHash('sha512')
		.update(`fount-bridge:${String(platform)}:${String(platformUserId)}`)
		.digest('hex')
		
}

/**
 * 手动绑定平台账号 ↔ 真实 fount 实体。
 * @param {string} username replica
 * @param {{ platform: string, platformUserId: string | number, entityHash: string, displayName?: string }} args 绑定参数
 * @returns {Promise<void>}
 */
export async function bindBridgeIdentity(username, { platform, platformUserId, entityHash, displayName }) {
	const hash = entityHash || ''
	if (!isEntityHash128(hash)) throw new Error('invalid entityHash')
	const doc = loadBridgesDoc(username)
	doc.identityMap[bridgeIdentityKey(platform, platformUserId)] = hash
	doc.entityReverse[hash] = {
		platform: String(platform),
		platformUserId: String(platformUserId),
		displayName: displayName || '',
	}
	saveBridgesDoc(username, doc)
}

/**
 * 解析平台用户对应的 entityHash，并维护反查表。
 * @param {string} username replica
 * @param {string} platform 平台名
 * @param {string | number} platformUserId 平台用户 ID
 * @param {string} [displayName] 展示名（写入反查表）
 * @returns {Promise<string>} entityHash（小写）
 */
export async function resolveBridgeIdentity(username, platform, platformUserId, displayName = '') {
	const doc = loadBridgesDoc(username)
	const key = bridgeIdentityKey(platform, platformUserId)
	const bound = doc.identityMap[key]
	const hash = bound || bridgeEntityHash(platform, platformUserId)
	const next = {
		platform: String(platform),
		platformUserId: String(platformUserId),
		displayName: String(displayName || doc.entityReverse[hash]?.displayName || '').trim(),
	}
	const prev = doc.entityReverse[hash]
	if (
		prev?.platform !== next.platform
		|| prev?.platformUserId !== next.platformUserId
		|| (prev?.displayName || '') !== next.displayName
	) {
		doc.entityReverse[hash] = next
		saveBridgesDoc(username, doc)
	}
	return hash
}

/**
 * 按 entityHash 查平台用户反查信息。
 * @param {string} username replica
 * @param {string} entityHash entityHash
 * @returns {{ platform: string, platformUserId: string, displayName?: string } | null} 平台用户反查信息或 null
 */
export function lookupBridgeEntityReverse(username, entityHash) {
	const hash = entityHash || ''
	const row = loadBridgesDoc(username).entityReverse[hash]
	if (!row?.platform || row.platformUserId == null) return null
	return {
		platform: String(row.platform),
		platformUserId: String(row.platformUserId),
		displayName: row.displayName ? String(row.displayName) : undefined,
	}
}
