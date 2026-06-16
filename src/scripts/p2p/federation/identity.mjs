import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { events } from '../../../server/events.mjs'
import { assignShellData, loadData, saveData } from '../../../server/setting_loader.mjs'
import { keyPairFromSeed } from '../crypto.mjs'
import { isHex64 } from '../hexIds.mjs'
import { normalizeMailboxSettings } from '../mailbox/settings.mjs'

const NODE_SEED_HEX_RE = /^[0-9a-f]{64}$/iu

/**
 * @param {string} username 用户名
 * @returns {ReturnType<typeof getFederationSettings>} 合并后的配置
 */
export function ensureFederationDefaults(username) {
	ensureNodeIdentityPubKey(username)
	ensureNodeSeed(username)
	const data = loadData(username, 'federation') || {}
	if (!data.mailbox) {
		data.mailbox = normalizeMailboxSettings({})
		saveData(username, 'federation')
	}
	return getFederationSettings(username)
}

/**
 * @param {string} username 用户名
 * @returns {string} 64 hex 节点种子（持久化于 federation 设置）
 */
export function ensureNodeSeed(username) {
	const data = loadData(username, 'federation') || {}
	const existing = String(data.nodeSeedHex || '').trim().toLowerCase()
	if (NODE_SEED_HEX_RE.test(existing)) return existing
	const nodeSeedHex = randomBytes(32).toString('hex')
	data.nodeSeedHex = nodeSeedHex
	saveData(username, 'federation')
	return nodeSeedHex
}

/**
 * @param {string} username 用户名
 * @returns {string} 64 位公钥 hex
 */
export function ensureNodeIdentityPubKey(username) {
	const { identityPubKeyHex } = getFederationSettings(username)
	if (isHex64(identityPubKeyHex)) return identityPubKeyHex
	const { publicKey, secretKey } = keyPairFromSeed(randomBytes(32))
	return saveFederationSettings(username, {
		identityPubKeyHex: Buffer.from(publicKey).toString('hex'),
		identitySecretKeyHex: Buffer.from(secretKey).toString('hex'),
	}).identityPubKeyHex
}

/**
 * @param {string} username 用户名
 * @returns {{ relayUrls: string[], batterySaver: boolean, identityPubKeyHex: string }} 节点联邦配置
 */
export function getFederationSettings(username) {
	const data = loadData(username, 'federation') || {}
	const relayUrls = Array.isArray(data.relayUrls)
		? data.relayUrls.map(url => String(url).trim()).filter(url => url.startsWith('wss://'))
		: []
	const batterySaver = !!data.batterySaver
	const identityPubKeyHex = String(data.identityPubKeyHex || '').trim().toLowerCase().replace(/^0x/iu, '')
	return { relayUrls, batterySaver, identityPubKeyHex }
}

/**
 * 服务端内部：读取联邦 identity 私钥（不通过 HTTP 暴露）。
 * @param {string} username 用户名
 * @returns {string} 64 位私钥 hex
 */
export function getFederationIdentitySecret(username) {
	ensureNodeIdentityPubKey(username)
	const data = loadData(username, 'federation') || {}
	return String(data.identitySecretKeyHex || '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * @param {string} username 用户名
 * @param {object} patch 部分字段
 * @returns {ReturnType<typeof getFederationSettings>} 合并后的节点联邦配置
 */
export function saveFederationSettings(username, patch) {
	const data = loadData(username, 'federation')
	delete data.enabled
	if (patch.batterySaver != null) data.batterySaver = !!patch.batterySaver
	if (patch.relayUrls)
		data.relayUrls = patch.relayUrls.map(url => url.trim()).filter(url => url.startsWith('wss://'))
	if (patch.identityPubKeyHex && isHex64(patch.identityPubKeyHex))
		data.identityPubKeyHex = patch.identityPubKeyHex.trim().toLowerCase().replace(/^0x/iu, '')
	if (patch.identitySecretKeyHex && isHex64(patch.identitySecretKeyHex))
		data.identitySecretKeyHex = patch.identitySecretKeyHex.trim().toLowerCase().replace(/^0x/iu, '')
	if (patch.dmIntroNonce != null) {
		const normalized = String(patch.dmIntroNonce || '').trim()
		if (normalized.length >= 16)
			assignShellData(username, 'chat', 'dmIntro', { nonce: normalized, rotatedAt: Date.now() })
	}
	if (patch.mailbox)
		data.mailbox = normalizeMailboxSettings({ ...data.mailbox, ...patch.mailbox })
	saveData(username, 'federation')
	events.emit('federation-settings-changed', { username })
	return getFederationSettings(username)
}

/**
 * 持久化 DM intro nonce（shellData chat/dmIntro，供 P2P API 写入）。
 * @param {string} username 用户
 * @param {string} nonce base64url nonce
 * @returns {{ nonce: string, rotatedAt: number }} 写入行
 */
export function setDmIntroNonce(username, nonce) {
	const normalized = String(nonce || '').trim()
	if (normalized.length < 16) throw new Error('dmIntro nonce too short')
	const row = { nonce: normalized, rotatedAt: Date.now() }
	assignShellData(username, 'chat', 'dmIntro', row)
	return row
}
