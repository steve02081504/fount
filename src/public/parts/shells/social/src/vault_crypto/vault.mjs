import { Buffer } from 'node:buffer'
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

import {
	deriveSocialPostKey,
	generateFileMasterKey,
	wrapKeyEcies,
} from '../../../../../../scripts/p2p/key_crypto.mjs'
import { vaultGroupId } from '../federation/namespace.mjs'
import { vaultStatePath } from '../paths.mjs'

/** @type {'gsh'} followers 帖文 content 加密 scheme */
const GSH_SCHEME = 'gsh'

/**
 * 读取或初始化 vault 主密钥状态。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @returns {Promise<{ masterKey: string, generation: number }>} vault 主密钥状态
 */
export async function loadVaultMasterKey(username, entityHash) {
	try {
		const raw = JSON.parse(await readFile(vaultStatePath(username, entityHash), 'utf8'))
		return {
			masterKey: String(raw.masterKey || ''),
			generation: Number(raw.generation) || 0,
		}
	}
	catch {
		const state = { masterKey: generateFileMasterKey(), generation: 0 }
		await saveVaultMasterKey(username, entityHash, state)
		return state
	}
}

/**
 * 持久化 vault 主密钥状态。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {{ masterKey: string, generation: number }} state vault 状态
 * @returns {Promise<void>}
 */
export async function saveVaultMasterKey(username, entityHash, state) {
	await mkdir(`${vaultStatePath(username, entityHash).replace(/[/\\][^/\\]+$/, '')}`, { recursive: true })
	await writeFile(vaultStatePath(username, entityHash), JSON.stringify({
		masterKey: state.masterKey,
		generation: state.generation,
	}, null, '\t'), 'utf8')
}

/**
 * 使用 AES-GCM 加密 UTF-8 明文。
 * @param {string} plaintext UTF-8 明文
 * @param {Buffer} key AES key
 * @returns {{ iv: string, ciphertext: string, authTag: string }} AES-GCM 密文信封
 */
function encryptAesGcm(plaintext, key) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
	}
}

/**
 * 使用 AES-GCM 解密密文信封。
 * @param {object} envelope 密文信封
 * @param {Buffer} key AES key
 * @returns {string} 明文
 */
function decryptAesGcm(envelope, key) {
	const iv = Buffer.from(envelope.iv, 'base64')
	const decipher = createDecipheriv('aes-256-gcm', key, iv)
	decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
	return Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
		decipher.final(),
	]).toString('utf8')
}

/**
 * 对 followers 可见帖加密 content。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {string} postKeyId 帖子密钥 id（client 生成 UUID，独立于 event.id）
 * @param {object} content 明文 content
 * @param {string} visibility public|followers
 * @returns {Promise<object>} 加密后的 content 或原文
 */
export async function maybeEncryptPostContent(username, entityHash, postKeyId, content, visibility) {
	if (visibility !== 'followers') return content
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const key = deriveSocialPostKey(masterKey, postKeyId)
	const payload = JSON.stringify(content)
	const encrypted = encryptAesGcm(payload, key)
	return {
		scheme: GSH_SCHEME,
		postKeyId,
		generation: 0,
		visibility: 'followers',
		...encrypted,
	}
}

/**
 * 解密 vault 加密帖 content；失败返回 null。
 * @param {string} username 用户
 * @param {string} entityHash owner
 * @param {object} content 事件 content
 * @returns {object | null} 解密后 content；无法解密返回 null
 */
export async function maybeDecryptPostContent(username, entityHash, content) {
	if (!content) return null
	if (content.scheme !== GSH_SCHEME) return content
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	const key = deriveSocialPostKey(masterKey, content.postKeyId)
	try {
		return JSON.parse(decryptAesGcm(content, key))
	}
	catch {
		return null
	}
}

/**
 * 构建 follow_approve 事件的 vault 载荷片段。
 * @param {string} username owner 用户
 * @param {string} entityHash owner
 * @param {string} followerPubKeyHex 关注者公钥
 * @returns {Promise<object>} follow_approve 载荷片段
 */
export async function buildFollowApprovePayload(username, entityHash, followerPubKeyHex) {
	const { masterKey } = await loadVaultMasterKey(username, entityHash)
	return {
		targetPubKeyHex: followerPubKeyHex,
		encrypted_H: wrapKeyEcies(masterKey, followerPubKeyHex),
		vaultGroupId: vaultGroupId(entityHash),
	}
}

/**
 * 生成新的 vault 文件 UUID。
 * @returns {string} 新 fileId
 */
export function newVaultFileId() {
	return randomUUID()
}
