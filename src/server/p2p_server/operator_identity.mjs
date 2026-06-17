import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { keyPairFromSeed } from '../../scripts/p2p/crypto.mjs'
import { isHex64 } from '../../scripts/p2p/hexIds.mjs'
import {
	ensureNodeDefaults,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
} from '../../scripts/p2p/node/identity.mjs'
import { resolveLocalOperatorEntityHash } from '../../scripts/p2p/entity/replica.mjs'
import { events } from '../events.mjs'
import { assignShellData } from '../setting_loader.mjs'

import { readOperatorIdentity, writeOperatorIdentity } from './entity_store.mjs'

/** @type {Map<string, { pub: string, secret: string, entityHash: string | null }>} */
const operatorCache = new Map()

events.on('federation-settings-changed', ({ username }) => {
	operatorCache.delete(username)
})

/**
 * @param {string} username
 * @returns {Promise<string>}
 */
export async function ensureOperatorPubKey(username) {
	const cached = operatorCache.get(username)
	if (cached?.pub && isHex64(cached.pub)) return cached.pub
	const existing = await readOperatorIdentity(username)
	const pub = String(existing?.identityPubKeyHex || '').trim().toLowerCase()
	if (isHex64(pub)) {
		operatorCache.set(username, {
			pub,
			secret: String(existing?.identitySecretKeyHex || '').trim().toLowerCase(),
			entityHash: resolveLocalOperatorEntityHash(pub),
		})
		return pub
	}
	const { publicKey, secretKey } = keyPairFromSeed(randomBytes(32))
	const identityPubKeyHex = Buffer.from(publicKey).toString('hex')
	const identitySecretKeyHex = Buffer.from(secretKey).toString('hex')
	await writeOperatorIdentity(username, { identityPubKeyHex, identitySecretKeyHex })
	operatorCache.set(username, {
		pub: identityPubKeyHex,
		secret: identitySecretKeyHex,
		entityHash: resolveLocalOperatorEntityHash(identityPubKeyHex),
	})
	return identityPubKeyHex
}

/**
 * @param {string} username
 * @returns {Promise<string>}
 */
export async function getOperatorSecretKey(username) {
	await ensureOperatorPubKey(username)
	return operatorCache.get(username)?.secret || ''
}

/**
 * @param {string} username
 * @returns {string}
 */
export function getOperatorSecretKeySync(username) {
	const secret = operatorCache.get(username)?.secret
	if (!isHex64(secret)) throw new Error('operator secret not loaded — await ensureOperatorPubKey first')
	return secret
}

/**
 * @param {string} username
 * @returns {Promise<string | null>}
 */
export async function resolveOperatorEntityHashForUser(username) {
	await ensureOperatorPubKey(username)
	return operatorCache.get(username)?.entityHash || null
}

/**
 * @param {string} username
 * @returns {Promise<string>}
 */
export async function getOperatorEntityHash(username) {
	const hash = await resolveOperatorEntityHashForUser(username)
	if (!hash) throw new Error('operator identity not configured')
	return hash
}

/**
 * @param {string} username
 * @returns {object} 节点传输 + operator 公钥（HTTP federation GET 体）
 */
export async function getFederationViewForUser(username) {
	ensureNodeDefaults()
	await ensureOperatorPubKey(username)
	const transport = getNodeTransportSettings()
	const identityPubKeyHex = String((await readOperatorIdentity(username))?.identityPubKeyHex || '').trim().toLowerCase()
	return {
		nodeHash: getNodeHash(),
		relayUrls: transport.relayUrls,
		batterySaver: transport.batterySaver,
		mailbox: transport.mailbox,
		identityPubKeyHex,
	}
}

/**
 * @param {string} username
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function saveFederationViewForUser(username, patch) {
	if (patch.batterySaver != null || patch.relayUrls || patch.mailbox)
		saveNodeTransportSettings({
			...patch.batterySaver != null ? { batterySaver: patch.batterySaver } : {},
			...patch.relayUrls ? { relayUrls: patch.relayUrls } : {},
			...patch.mailbox ? { mailbox: patch.mailbox } : {},
		})
	if (patch.identityPubKeyHex && isHex64(patch.identityPubKeyHex)) {
		const prev = await readOperatorIdentity(username) || {}
		await writeOperatorIdentity(username, {
			...prev,
			identityPubKeyHex: patch.identityPubKeyHex.trim().toLowerCase(),
			...patch.identitySecretKeyHex && isHex64(patch.identitySecretKeyHex)
				? { identitySecretKeyHex: patch.identitySecretKeyHex.trim().toLowerCase() }
				: {},
		})
	}
	if (patch.dmIntroNonce != null) {
		const normalized = String(patch.dmIntroNonce || '').trim()
		if (normalized.length >= 16)
			assignShellData(username, 'chat', 'dmIntro', { nonce: normalized, rotatedAt: Date.now() })
	}
	events.emit('federation-settings-changed', { username })
	return getFederationViewForUser(username)
}

/**
 * @param {string} username
 * @param {string} nonce
 * @returns {{ nonce: string, rotatedAt: number }}
 */
export function setDmIntroNonce(username, nonce) {
	const normalized = String(nonce || '').trim()
	if (normalized.length < 16) throw new Error('dmIntro nonce too short')
	const row = { nonce: normalized, rotatedAt: Date.now() }
	assignShellData(username, 'chat', 'dmIntro', row)
	return row
}
