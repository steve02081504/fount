import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { keyPairFromSeed } from '../../scripts/p2p/crypto.mjs'
import { resolveLocalOperatorEntityHash } from '../../scripts/p2p/entity/replica.mjs'
import { isHex64, normalizeHex64 } from '../../scripts/p2p/hexIds.mjs'
import {
	ensureNodeDefaults,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
} from '../../scripts/p2p/node/identity.mjs'
import { createGenesisKeyHistory } from '../../scripts/p2p/operator_key_chain.mjs'
import { events } from '../events.mjs'
import { assignShellData } from '../setting_loader.mjs'

import { readOperatorIdentity, writeOperatorIdentity } from './entity_store.mjs'

/** @type {Map<string, string>} */
const pendingRecoverySecrets = new Map()

/** @type {Map<string, { recoveryPub: string, activePub: string, activeSecret: string, entityHash: string | null, keyGeneration: number }>} */
const operatorCache = new Map()

/**
 * @param {string} username fount 登录名
 * @returns {string | null} 一次性 recovery 私钥（仅建号后首次 bootstrap）
 */
export function consumePendingRecoverySecret(username) {
	const secret = pendingRecoverySecrets.get(username) || null
	pendingRecoverySecrets.delete(username)
	return secret
}

events.on('federation-settings-changed', ({ username }) => {
	operatorCache.delete(username)
})

/**
 * @param {object | null | undefined} row operator.json 行
 * @returns {boolean} 是否为新版双钥结构
 */
function isDualKeyIdentity(row) {
	return isHex64(normalizeHex64(row?.recoveryPubKeyHex || ''))
		&& isHex64(normalizeHex64(row?.activePubKeyHex || ''))
		&& isHex64(normalizeHex64(row?.activeSecretKeyHex || ''))
}

/**
 * @param {string} username fount 登录名
 * @param {object} row operator.json
 * @returns {void}
 */
function cacheFromRow(username, row) {
	operatorCache.set(username, {
		recoveryPub: normalizeHex64(row.recoveryPubKeyHex),
		activePub: normalizeHex64(row.activePubKeyHex),
		activeSecret: normalizeHex64(row.activeSecretKeyHex),
		entityHash: resolveLocalOperatorEntityHash(row.recoveryPubKeyHex),
		keyGeneration: Number(row.keyGeneration ?? 0),
	})
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<object>} operator 身份（含 recovery/active 公钥）
 */
export async function ensureOperatorIdentity(username) {
	const cached = operatorCache.get(username)
	if (cached?.recoveryPub && cached.activePub)
		return readOperatorIdentity(username)

	const existing = await readOperatorIdentity(username)
	if (isDualKeyIdentity(existing)) {
		cacheFromRow(username, existing)
		return existing
	}

	const recovery = keyPairFromSeed(randomBytes(32))
	const active = keyPairFromSeed(randomBytes(32))
	const recoveryPubKeyHex = Buffer.from(recovery.publicKey).toString('hex')
	const recoverySecretKeyHex = Buffer.from(recovery.secretKey).toString('hex')
	const activePubKeyHex = Buffer.from(active.publicKey).toString('hex')
	const activeSecretKeyHex = Buffer.from(active.secretKey).toString('hex')
	const keyHistory = createGenesisKeyHistory(recoveryPubKeyHex, activePubKeyHex)
	const row = {
		recoveryPubKeyHex,
		activePubKeyHex,
		activeSecretKeyHex,
		keyGeneration: 0,
		keyHistory,
		createdAt: Date.now(),
	}
	await writeOperatorIdentity(username, row)
	pendingRecoverySecrets.set(username, recoverySecretKeyHex)
	cacheFromRow(username, row)
	return row
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} 64 hex 活跃 operator 公钥（联邦 wire 兼容字段名）
 */
export async function ensureOperatorPubKey(username) {
	const row = await ensureOperatorIdentity(username)
	return normalizeHex64(row.activePubKeyHex)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} 64 hex 活跃 operator 私钥
 */
export async function getOperatorSecretKey(username) {
	await ensureOperatorIdentity(username)
	return operatorCache.get(username)?.activeSecret || ''
}

/**
 * @param {string} username fount 登录名
 * @returns {string} 64 hex 活跃 operator 私钥（须已 ensure）
 */
export function getOperatorSecretKeySync(username) {
	const secret = operatorCache.get(username)?.activeSecret
	if (!isHex64(secret)) throw new Error('operator secret not loaded — await ensureOperatorIdentity first')
	return secret
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string>} 64 hex recovery 公钥
 */
export async function getRecoveryPubKeyHex(username) {
	const row = await ensureOperatorIdentity(username)
	return normalizeHex64(row.recoveryPubKeyHex)
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<number>} 当前活跃钥代际
 */
export async function getOperatorKeyGeneration(username) {
	await ensureOperatorIdentity(username)
	return operatorCache.get(username)?.keyGeneration ?? 0
}

/**
 * @param {string} username fount 登录名
 * @returns {Promise<string | null>} operator entityHash
 */
export async function resolveOperatorEntityHashForUser(username) {
	await ensureOperatorIdentity(username)
	return operatorCache.get(username)?.entityHash || null
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
 * @returns {Promise<object>} 新活跃钥对 + 代际（写盘前调用方须先 append rotate 事件）
 */
export async function generateNextActiveKeyPair(username) {
	const row = await ensureOperatorIdentity(username)
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
 * @param {object} patch 新活跃钥与代际
 * @returns {Promise<object>} 更新后的 operator.json
 */
export async function commitActiveKeyRotation(username, patch) {
	const prev = await ensureOperatorIdentity(username)
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
		...prev,
		activePubKeyHex,
		activeSecretKeyHex,
		keyGeneration,
		keyHistory,
	}
	await writeOperatorIdentity(username, row)
	cacheFromRow(username, row)
	events.emit('federation-settings-changed', { username })
	return row
}

/**
 * @param {string} username fount 登录名
 * @param {object} patch revoke 后新活跃钥
 * @returns {Promise<object>} 更新后的 operator.json
 */
export async function commitActiveKeyRevoke(username, patch) {
	return commitActiveKeyRotation(username, patch)
}

/**
 * @param {string} username fount 登录名
 * @returns {object} 节点传输 + operator 公钥（HTTP federation GET 体）
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
		identityPubKeyHex: normalizeHex64(row.activePubKeyHex),
		keyGeneration: Number(row.keyGeneration ?? 0),
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
