/**
 * 统一实体身份：人类（operator）与 agent 同 schema，落 entities/{entityHash}/identity.json。
 * operator = charPartName === null 的实体（每登录用户唯一）；ownerEntityHash 为所属关系字段，两类实体均可设。
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { keyPairFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { createGenesisKeyHistory } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'
import {
	ensureNodeDefaults,
	getNodeHash,
	getNodeTransportSettings,
	resolveLocalEntityHashFromRecoveryPubKeyHex,
	saveNodeTransportSettings,
} from 'npm:@steve02081504/fount-p2p/node/identity'

import { events } from '../../../../../../server/events.mjs'
import { assignShellData } from '../../../../../../server/setting_loader.mjs'

import {
	listEntityIdentities,
	readEntityIdentity,
	writeEntityIdentity,
} from './store.mjs'

/** @type {Map<string, string>} key = `${username}\0${entityHash}` */
const pendingRecoverySecrets = new Map()

/** @type {Map<string, { recoveryPub: string, activePub: string, activeSecret: string, recoverySecret: string, entityHash: string, keyGeneration: number, ownerEntityHash: string | null, charPartName: string | null }>} */
const identityCache = new Map()

/** @type {Map<string, string>} username → operator entityHash */
const operatorHashCache = new Map()

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {string} cache key
 */
function cacheKey(username, entityHash) {
	return `${username}\u0000${String(entityHash).toLowerCase()}`
}

/**
 * @param {string} username fount 登录名
 * @param {string} [entityHash] 实体；缺省用 operator
 * @returns {string | null} 一次性 recovery 私钥
 */
export function consumePendingRecoverySecret(username, entityHash) {
	const hash = entityHash
		? String(entityHash).toLowerCase()
		: operatorHashCache.get(username)
	if (!hash) return null
	const key = cacheKey(username, hash)
	const secret = pendingRecoverySecrets.get(key) || null
	pendingRecoverySecrets.delete(key)
	return secret
}

events.on('federation-settings-changed', ({ username }) => {
	for (const key of [...identityCache.keys()])
		if (key.startsWith(`${username}\u0000`)) identityCache.delete(key)
	operatorHashCache.delete(username)
})

/**
 * @param {object | null | undefined} row identity 行
 * @returns {boolean} 是否为有效双钥结构
 */
function isDualKeyIdentity(row) {
	return isHex64(normalizeHex64(row?.recoveryPubKeyHex || ''))
		&& isHex64(normalizeHex64(row?.activePubKeyHex || ''))
		&& isHex64(normalizeHex64(row?.activeSecretKeyHex || ''))
}

/**
 * @param {string} username fount 登录名
 * @param {object} row identity 行（须含 entityHash）
 * @returns {void}
 */
function cacheFromRow(username, row) {
	const entityHash = String(row.entityHash).toLowerCase()
	const ownerRaw = row.ownerEntityHash
	const ownerEntityHash = ownerRaw ? String(ownerRaw).toLowerCase() : null
	const charPartName = row.charPartName ? String(row.charPartName) : null
	identityCache.set(cacheKey(username, entityHash), {
		recoveryPub: normalizeHex64(row.recoveryPubKeyHex),
		activePub: normalizeHex64(row.activePubKeyHex),
		activeSecret: normalizeHex64(row.activeSecretKeyHex),
		recoverySecret: isHex64(normalizeHex64(row.recoverySecretKeyHex || ''))
			? normalizeHex64(row.recoverySecretKeyHex)
			: '',
		entityHash,
		keyGeneration: Number(row.keyGeneration ?? 0),
		ownerEntityHash,
		charPartName,
	})
	if (charPartName === null) operatorHashCache.set(username, entityHash)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string | null>} 无 charPartName 的实体（operator）entityHash
 */
async function findOperatorEntityHash(username) {
	const cached = operatorHashCache.get(username)
	if (cached) return cached
	for (const row of await listEntityIdentities(username))
		if (!row.charPartName) {
			cacheFromRow(username, row)
			return row.entityHash
		}
	return null
}

/**
 * @param {string} username fount 登录名
 * @param {{ charPartName?: string | null, ownerEntityHash?: string | null }} [options] 实体标签；缺省 = operator
 * @returns {Promise<object>} 身份行（含 entityHash）
 */
export async function ensureEntityIdentity(username, options = {}) {
	const charPartName = options.charPartName ? String(options.charPartName) : null
	const ownerEntityHash = options.ownerEntityHash ? String(options.ownerEntityHash).toLowerCase() : null

	if (charPartName === null && ownerEntityHash === null) {
		const opHash = await findOperatorEntityHash(username)
		if (opHash) {
			const disk = await readEntityIdentity(username, opHash)
			if (isDualKeyIdentity(disk)) {
				cacheFromRow(username, { ...disk, entityHash: opHash })
				return { ...disk, entityHash: opHash }
			}
			// 磁盘身份已不存在（数据根切换/被删）：作废缓存，走重建。
			identityCache.delete(cacheKey(username, opHash))
			operatorHashCache.delete(username)
		}
	}
	else if (charPartName) 
		for (const row of await listEntityIdentities(username)) {
			if (row.charPartName !== charPartName) continue
			const hash = String(row.entityHash).toLowerCase()
			const diskOwner = row.ownerEntityHash ? String(row.ownerEntityHash).toLowerCase() : null
			// 既有 agent 未声明主人：回填为 operator（显式指向他人则保留）。
			if (!diskOwner) {
				const operatorHash = await getOperatorEntityHash(username)
				await setEntityOwner(username, hash, operatorHash)
				return loadEntityIdentity(username, hash)
			}
			cacheFromRow(username, row)
			return row
		}
	

	const recovery = keyPairFromSeed(randomBytes(32))
	const active = keyPairFromSeed(randomBytes(32))
	const recoveryPubKeyHex = Buffer.from(recovery.publicKey).toString('hex')
	const recoverySecretKeyHex = Buffer.from(recovery.secretKey).toString('hex')
	const activePubKeyHex = Buffer.from(active.publicKey).toString('hex')
	const activeSecretKeyHex = Buffer.from(active.secretKey).toString('hex')
	const entityHash = resolveLocalEntityHashFromRecoveryPubKeyHex(recoveryPubKeyHex)
	if (!entityHash || !isEntityHash128(entityHash)) throw new Error('failed to derive entityHash')

	const existing = await readEntityIdentity(username, entityHash)
	if (isDualKeyIdentity(existing)) {
		const row = { ...existing, entityHash }
		cacheFromRow(username, row)
		return row
	}

	const keyHistory = createGenesisKeyHistory(recoveryPubKeyHex, activePubKeyHex)
	const row = {
		recoveryPubKeyHex,
		recoverySecretKeyHex,
		activePubKeyHex,
		activeSecretKeyHex,
		keyGeneration: 0,
		keyHistory,
		ownerEntityHash,
		charPartName,
		createdAt: Date.now(),
	}
	await writeEntityIdentity(username, entityHash, row)
	pendingRecoverySecrets.set(cacheKey(username, entityHash), recoverySecretKeyHex)
	const withHash = { ...row, entityHash }
	cacheFromRow(username, withHash)
	await syncProfileOwnerField(username, entityHash, ownerEntityHash)
	return withHash
}

/**
 * 将 identity 的 ownerEntityHash 同步到联邦可见的 profile.json。
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @param {string | null} ownerEntityHash 所属
 * @returns {Promise<void>}
 */
async function syncProfileOwnerField(username, entityHash, ownerEntityHash) {
	try {
		const { ensureLocalEntityProfile, updateProfile } = await import('./profile.mjs')
		await ensureLocalEntityProfile(username, entityHash)
		await updateProfile(username, entityHash, { ownerEntityHash }, {
			skipPresentation: true,
			identityOwnerSync: true,
		})
	}
	catch { /* profile 运行时未就绪时跳过 */ }
}

/**
 * 设置实体所属主人（identity + profile 双写，并向本机已加入群 fanout `member_owner_update`）。
 * @param {string} username fount 登录名
 * @param {string} entityHash 被设主人的实体
 * @param {string | null} ownerEntityHash 主人 entityHash；null/空 清除
 * @returns {Promise<object>} 更新后的身份行（含 entityHash）
 */
export async function setEntityOwner(username, entityHash, ownerEntityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(hash)) throw new Error('invalid entityHash')
	const nextOwner = ownerEntityHash ? String(ownerEntityHash).trim().toLowerCase() : null
	if (nextOwner && !isEntityHash128(nextOwner)) throw new Error('invalid ownerEntityHash')
	if (nextOwner === hash) throw new Error('cannot set self as owner')

	const prev = await loadEntityIdentity(username, hash)
	const row = {
		...prev,
		ownerEntityHash: nextOwner,
		entityHash: hash,
	}
	await writeEntityIdentity(username, hash, {
		recoveryPubKeyHex: row.recoveryPubKeyHex,
		recoverySecretKeyHex: row.recoverySecretKeyHex,
		activePubKeyHex: row.activePubKeyHex,
		activeSecretKeyHex: row.activeSecretKeyHex,
		keyGeneration: row.keyGeneration,
		keyHistory: row.keyHistory,
		ownerEntityHash: nextOwner,
		charPartName: row.charPartName ?? null,
		createdAt: row.createdAt,
	})
	cacheFromRow(username, row)
	await syncProfileOwnerField(username, hash, nextOwner)

	const { listUserGroups } = await import('../chat/lib/userGroups.mjs')
	const { getState } = await import('../chat/dag/materialize.mjs')
	const { appendSignedLocalEvent } = await import('../chat/dag/append.mjs')
	const { peekLocalSignerPubKeyHash } = await import('../chat/dag/localSigner.mjs')
	for (const groupId of await listUserGroups(username)) 
		try {
			const { state } = await getState(username, groupId, { skipLeftPurge: true })
			const sender = await peekLocalSignerPubKeyHash(username, groupId, hash)
			if (!sender || state.members?.[sender]?.status !== 'active') continue
			if (String(state.members[sender]?.entityHash || '').toLowerCase() !== hash) continue
			await appendSignedLocalEvent(username, groupId, {
				type: 'member_owner_update',
				timestamp: Date.now(),
				content: { ownerEntityHash: nextOwner },
			}, { entityHash: hash })
		}
		catch { /* 非成员 / 无权写则跳过 */ }
	
	return row
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<object>} operator 身份行
 */
export async function ensureOperatorIdentity(username) {
	return ensureEntityIdentity(username, {})
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<object>} 身份行
 */
export async function loadEntityIdentity(username, entityHash) {
	const hash = String(entityHash).toLowerCase()
	const disk = await readEntityIdentity(username, hash)
	if (!isDualKeyIdentity(disk)) {
		// 缓存可能残留已删除数据根的身份：以磁盘为准作废。
		identityCache.delete(cacheKey(username, hash))
		throw new Error(`entity identity not found: ${hash}`)
	}
	const row = { ...disk, entityHash: hash }
	cacheFromRow(username, row)
	return row
}

/**
 * 在本机任意 replica 的 identity 缓存中查找实体活跃公钥（同进程多用户 / 联邦仿真）。
 * @param {string} entityHash 128 hex
 * @returns {string | null} 64 hex 活跃公钥，未托管则为 null
 */
export function findLocalEntityActivePubKey(entityHash) {
	const eh = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(eh)) return null
	for (const cached of identityCache.values())
		if (cached.entityHash === eh) return cached.activePub
	return null
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<string>} 64 hex 活跃公钥
 */
export async function getEntityActivePubKey(username, entityHash) {
	const row = await loadEntityIdentity(username, entityHash)
	return normalizeHex64(row.activePubKeyHex)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} operator 活跃公钥
 */
export async function ensureOperatorPubKey(username) {
	const row = await ensureOperatorIdentity(username)
	return normalizeHex64(row.activePubKeyHex)
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<string>} 64 hex 活跃私钥
 */
export async function getEntitySecretKey(username, entityHash) {
	await loadEntityIdentity(username, entityHash)
	return identityCache.get(cacheKey(username, entityHash))?.activeSecret || ''
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<string>} 64 hex recovery 私钥；缺失时为空串
 */
export async function getEntityRecoverySecretKey(username, entityHash) {
	await loadEntityIdentity(username, entityHash)
	return identityCache.get(cacheKey(username, entityHash))?.recoverySecret || ''
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} operator 活跃私钥
 */
export async function getOperatorSecretKey(username) {
	const row = await ensureOperatorIdentity(username)
	return getEntitySecretKey(username, row.entityHash)
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {string} 64 hex 活跃私钥（须已 load）
 */
export function getEntitySecretKeySync(username, entityHash) {
	const secret = identityCache.get(cacheKey(username, entityHash))?.activeSecret
	if (!isHex64(secret)) throw new Error('entity secret not loaded — await loadEntityIdentity first')
	return secret
}

/**
 * @param {string} username fount 登录名
 * @returns {string} operator 活跃私钥
 */
export function getOperatorSecretKeySync(username) {
	const hash = operatorHashCache.get(username)
	if (!hash) throw new Error('operator secret not loaded — await ensureOperatorIdentity first')
	return getEntitySecretKeySync(username, hash)
}

/**
 * @param {string} username fount 登录名
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<string>} 64 hex recovery 公钥
 */
export async function getRecoveryPubKeyHex(username, entityHash) {
	if (entityHash) {
		const row = await loadEntityIdentity(username, entityHash)
		return normalizeHex64(row.recoveryPubKeyHex)
	}
	const row = await ensureOperatorIdentity(username)
	return normalizeHex64(row.recoveryPubKeyHex)
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<number>} 当前活跃钥代际
 */
export async function getEntityKeyGeneration(username, entityHash) {
	await loadEntityIdentity(username, entityHash)
	return identityCache.get(cacheKey(username, entityHash))?.keyGeneration ?? 0
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<number>} operator 钥代际
 */
export async function getOperatorKeyGeneration(username) {
	const row = await ensureOperatorIdentity(username)
	return getEntityKeyGeneration(username, row.entityHash)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string | null>} operator entityHash
 */
export async function resolveOperatorEntityHashForUser(username) {
	await ensureOperatorIdentity(username)
	return operatorHashCache.get(username) || null
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} operator entityHash
 */
export async function getOperatorEntityHash(username) {
	const hash = await resolveOperatorEntityHashForUser(username)
	if (!hash) throw new Error('operator identity not configured')
	return hash
}

/**
 * @param {string} username fount 登录名
 * @param {string} charPartName chars/ 下目录名
 * @returns {Promise<object>} agent 身份行（惰性创建）
 */
export async function ensureAgentEntityIdentity(username, charPartName) {
	const name = String(charPartName || '').trim()
	if (!name) throw new Error('charPartName required')
	const ownerEntityHash = await getOperatorEntityHash(username)
	const row = await ensureEntityIdentity(username, { charPartName: name, ownerEntityHash })
	try {
		const { syncAgentProfileFromCharPart } = await import('../profile/syncFromCharPart.mjs')
		await syncAgentProfileFromCharPart(username, row.entityHash, { force: false })
	}
	catch { /* part 未装好或头像拉取失败时不阻断身份创建 */ }
	return row
}

/**
 * @param {string} username fount 登录名
 * @param {string} [entityHash] 128 hex；缺省 = operator
 * @returns {Promise<object>} 新活跃钥对 + 代际
 */
export async function generateNextActiveKeyPair(username, entityHash) {
	const hash = entityHash || await getOperatorEntityHash(username)
	const row = await loadEntityIdentity(username, hash)
	const nextGen = Number(row.keyGeneration ?? 0) + 1
	const { publicKey, secretKey } = keyPairFromSeed(randomBytes(32))
	return {
		prevGeneration: Number(row.keyGeneration ?? 0),
		keyGeneration: nextGen,
		activePubKeyHex: Buffer.from(publicKey).toString('hex'),
		activeSecretKeyHex: Buffer.from(secretKey).toString('hex'),
		recoveryPubKeyHex: normalizeHex64(row.recoveryPubKeyHex),
	}
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @param {object} patch 新活跃钥与代际
 * @returns {Promise<object>} 更新后的身份行
 */
export async function commitEntityKeyRotation(username, entityHash, patch) {
	const prev = await loadEntityIdentity(username, entityHash)
	const activePubKeyHex = normalizeHex64(patch.activePubKeyHex || '')
	const activeSecretKeyHex = normalizeHex64(patch.activeSecretKeyHex || '')
	const keyGeneration = Number(patch.keyGeneration)
	if (!isHex64(activePubKeyHex) || !isHex64(activeSecretKeyHex) || !Number.isFinite(keyGeneration))
		throw new Error('invalid active key rotation patch')

	const keyHistory = Array.isArray(prev.keyHistory) ? [...prev.keyHistory] : []
	keyHistory.push({
		generation: keyGeneration,
		activePubKeyHex,
		attestedBy: 'active',
		validFrom: Date.now(),
	})
	const row = {
		recoveryPubKeyHex: prev.recoveryPubKeyHex,
		recoverySecretKeyHex: prev.recoverySecretKeyHex,
		activePubKeyHex,
		activeSecretKeyHex,
		keyGeneration,
		keyHistory,
		ownerEntityHash: prev.ownerEntityHash ?? null,
		charPartName: prev.charPartName ?? null,
		createdAt: prev.createdAt,
	}
	await writeEntityIdentity(username, entityHash, row)
	cacheFromRow(username, { ...row, entityHash: String(entityHash).toLowerCase() })
	events.emit('federation-settings-changed', { username })
	return { ...row, entityHash: String(entityHash).toLowerCase() }
}

/**
 * @param {string} username fount 登录名
 * @param {object} patch 新活跃钥与代际
 * @returns {Promise<object>} 更新后的 operator 身份
 */
export async function commitActiveKeyRotation(username, patch) {
	const entityHash = await getOperatorEntityHash(username)
	return commitEntityKeyRotation(username, entityHash, patch)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<object>} 节点传输 + 实体公钥（HTTP federation GET 体）
 */
export async function getFederationViewForUser(username) {
	ensureNodeDefaults()
	const row = await ensureOperatorIdentity(username)
	const transport = getNodeTransportSettings()
	return {
		nodeHash: getNodeHash(),
		relayUrls: transport.relayUrls,
		batterySaver: transport.batterySaver,
		mailbox: transport.mailbox,
		recoveryPubKeyHex: normalizeHex64(row.recoveryPubKeyHex),
		activePubKeyHex: normalizeHex64(row.activePubKeyHex),
		keyGeneration: Number(row.keyGeneration ?? 0),
		entityHash: row.entityHash,
	}
}

/**
 * @param {string} username fount 登录名
 * @param {object} patch federation 部分字段
 * @returns {Promise<object>} 保存后的 federation 视图
 */
export async function saveFederationViewForUser(username, patch) {
	if (patch.batterySaver != null || patch.relayUrls || patch.mailbox)
		saveNodeTransportSettings({
			...patch.batterySaver != null ? { batterySaver: patch.batterySaver } : {},
			...patch.relayUrls ? { relayUrls: patch.relayUrls } : {},
			...patch.mailbox ? { mailbox: patch.mailbox } : {},
		})
	if (patch.dmIntroNonce != null) {
		const normalized = String(patch.dmIntroNonce || '').trim()
		if (normalized.length >= 16)
			assignShellData(username, 'chat', 'dmIntro', { nonce: normalized, rotatedAt: Date.now() })
	}
	events.emit('federation-settings-changed', { username })
	return getFederationViewForUser(username)
}

/**
 * @param {string} username fount 登录名
 * @param {string} nonce DM intro nonce
 * @returns {{ nonce: string, rotatedAt: number }} 写入后的 nonce 行
 */
export function setDmIntroNonce(username, nonce) {
	const normalized = String(nonce || '').trim()
	if (normalized.length < 16) throw new Error('dmIntro nonce too short')
	const row = { nonce: normalized, rotatedAt: Date.now() }
	assignShellData(username, 'chat', 'dmIntro', row)
	return row
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<{ entityHash: string, charPartName: string }[]>} 本地 agent 实体列表
 */
export async function listLocalAgentIdentities(username) {
	const rows = await listEntityIdentities(username)
	return rows
		.filter(row => row.charPartName)
		.map(row => ({
			entityHash: String(row.entityHash).toLowerCase(),
			charPartName: String(row.charPartName),
		}))
}

/**
 * @param {string} username fount 登录名
 * @param {string} entityHash 128 hex
 * @returns {Promise<string | null>} charPartName
 */
export async function resolveCharPartNameForEntity(username, entityHash) {
	const hash = String(entityHash).toLowerCase()
	const cached = identityCache.get(cacheKey(username, hash))
	if (cached) return cached.charPartName
	const disk = await readEntityIdentity(username, hash)
	if (!disk?.charPartName) return null
	cacheFromRow(username, { ...disk, entityHash: hash })
	return String(disk.charPartName)
}
