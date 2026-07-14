/**
 * 统一实体身份：人类（operator）与 agent 同 schema，落 entities/{entityHash}/identity.json。
 * operator = ownerEntityHash === null 的实体。
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'

import { keyPairFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { resolveLocalEntityHashFromRecoveryPubKeyHex } from 'npm:@steve02081504/fount-p2p/node/identity'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import {
	ensureNodeDefaults,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
} from 'npm:@steve02081504/fount-p2p/node/identity'
import { createGenesisKeyHistory } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'
import { readJsonFile } from 'npm:@steve02081504/fount-p2p/utils/json_io'
import { events } from '../../../../../../server/events.mjs'
import { assignShellData } from '../../../../../../server/setting_loader.mjs'

import {
	legacyOperatorJsonPath,
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
	const ownerEntityHash = ownerRaw == null || ownerRaw === ''
		? null
		: String(ownerRaw).toLowerCase()
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
		charPartName: row.charPartName == null || row.charPartName === ''
			? null
			: String(row.charPartName),
	})
	if (ownerEntityHash === null) operatorHashCache.set(username, entityHash)
}

/**
 * 旧 settings/operator.json → entities/{hash}/identity.json 一次性搬迁。
 * @param {string} username fount 登录名
 * @returns {Promise<object | null>} 搬迁后的身份行，或 null
 */
async function migrateLegacyOperatorIdentity(username) {
	const legacy = await readJsonFile(legacyOperatorJsonPath(username))
	if (!isDualKeyIdentity(legacy)) return null
	const entityHash = resolveLocalEntityHashFromRecoveryPubKeyHex(legacy.recoveryPubKeyHex)
	if (!entityHash || !isEntityHash128(entityHash)) return null
	const existing = await readEntityIdentity(username, entityHash)
	if (isDualKeyIdentity(existing)) {
		await unlink(legacyOperatorJsonPath(username)).catch(() => { })
		return { ...existing, entityHash, ownerEntityHash: null, charPartName: null }
	}
	const row = {
		recoveryPubKeyHex: normalizeHex64(legacy.recoveryPubKeyHex),
		activePubKeyHex: normalizeHex64(legacy.activePubKeyHex),
		activeSecretKeyHex: normalizeHex64(legacy.activeSecretKeyHex),
		keyGeneration: Number(legacy.keyGeneration ?? 0),
		keyHistory: Array.isArray(legacy.keyHistory) ? legacy.keyHistory : createGenesisKeyHistory(
			normalizeHex64(legacy.recoveryPubKeyHex),
			normalizeHex64(legacy.activePubKeyHex),
		),
		ownerEntityHash: null,
		charPartName: null,
		createdAt: legacy.createdAt ?? Date.now(),
	}
	await writeEntityIdentity(username, entityHash, row)
	await unlink(legacyOperatorJsonPath(username)).catch(() => { })
	return { ...row, entityHash }
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string | null>} null-owner 实体的 entityHash
 */
async function findOperatorEntityHash(username) {
	const cached = operatorHashCache.get(username)
	if (cached) return cached
	const migrated = await migrateLegacyOperatorIdentity(username)
	if (migrated) {
		cacheFromRow(username, migrated)
		return migrated.entityHash
	}
	for (const row of await listEntityIdentities(username)) {
		if (row.ownerEntityHash == null || row.ownerEntityHash === '') {
			cacheFromRow(username, row)
			return row.entityHash
		}
	}
	return null
}

/**
 * @param {string} username fount 登录名
 * @param {{ charPartName?: string | null, ownerEntityHash?: string | null }} [opts] 实体标签；缺省 = operator
 * @returns {Promise<object>} 身份行（含 entityHash）
 */
export async function ensureEntityIdentity(username, opts = {}) {
	const charPartName = opts.charPartName == null || opts.charPartName === ''
		? null
		: String(opts.charPartName)
	const ownerEntityHash = opts.ownerEntityHash == null || opts.ownerEntityHash === ''
		? null
		: String(opts.ownerEntityHash).toLowerCase()

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
	else if (charPartName) {
		for (const row of await listEntityIdentities(username)) {
			if (row.charPartName === charPartName) {
				cacheFromRow(username, row)
				return row
			}
		}
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
		await updateProfile(username, entityHash, { ownerEntityHash }, { skipPresentation: true })
	}
	catch { /* profile 运行时未就绪时跳过 */ }
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
 * @returns {Promise<string>} 64 hex recovery 私钥；缺失时为空串（旧 identity）
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
	return ensureEntityIdentity(username, { charPartName: name, ownerEntityHash })
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
		.filter(row => row.charPartName && row.ownerEntityHash)
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
