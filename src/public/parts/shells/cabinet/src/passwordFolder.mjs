import { Buffer } from 'node:buffer'
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import { ensureParentDir } from './io.mjs'
import { encryptedFolderIndexPath } from './paths.mjs'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

/**
 * @param {string} password 密码
 * @param {Buffer} salt salt
 * @returns {Buffer} 派生密钥
 */
export function derivePasswordKey(password, salt) {
	return scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
}

/**
 * @param {Buffer} key AES key
 * @param {object | string} plaintext JSON 或字符串
 * @returns {{ iv: string, ciphertext: string, auth_tag: string }} 信封
 */
export function encryptJson(key, plaintext) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const data = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)
	const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		auth_tag: cipher.getAuthTag().toString('base64'),
	}
}

/**
 * @param {Buffer} key AES key
 * @param {{ iv: string, ciphertext: string, auth_tag: string }} envelope 信封
 * @returns {string} 明文
 */
export function decryptJson(key, envelope) {
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
	decipher.setAuthTag(Buffer.from(envelope.auth_tag, 'base64'))
	return Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
		decipher.final(),
	]).toString('utf8')
}

/**
 * @param {string} password 密码
 * @returns {{ salt: string, wrapped_folder_key: string, check: string, folder_key: Buffer }} 加密文件夹元数据
 */
export function createFolderEncryption(password) {
	const salt = randomBytes(16)
	const passwordKey = derivePasswordKey(password, salt)
	const folderKey = randomBytes(32)
	const wrap = encryptJson(passwordKey, folderKey.toString('base64'))
	const check = encryptJson(folderKey, 'cabinet-ok')
	return {
		salt: salt.toString('base64'),
		wrapped_folder_key: JSON.stringify(wrap),
		check: JSON.stringify(check),
		folder_key: folderKey,
	}
}

/**
 * @param {string} password 密码
 * @param {{ salt: string, wrapped_folder_key: string, check: string }} encryption 元数据
 * @returns {Buffer} folder key
 */
export function unlockFolderKey(password, encryption) {
	const salt = Buffer.from(encryption.salt, 'base64')
	const passwordKey = derivePasswordKey(password, salt)
	const wrap = JSON.parse(encryption.wrapped_folder_key)
	const folderKey = Buffer.from(decryptJson(passwordKey, wrap), 'base64')
	const check = JSON.parse(encryption.check)
	const plain = decryptJson(folderKey, check)
	if (plain !== 'cabinet-ok') throw new Error('bad password')
	return folderKey
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} folderId 文件夹
 * @param {Buffer} folderKey folder key
 * @param {object} index 子索引
 * @returns {Promise<void>}
 */
export async function saveEncryptedFolderIndex(username, entityHash, cabinetId, folderId, folderKey, index) {
	const path = encryptedFolderIndexPath(username, entityHash, cabinetId, folderId)
	await ensureParentDir(path)
	const envelope = encryptJson(folderKey, index)
	await writeFile(path, JSON.stringify(envelope, null, '\t'), 'utf8')
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} folderId 文件夹
 * @param {Buffer} folderKey folder key
 * @returns {Promise<{ version: number, entries: object[] }>} 子索引
 */
export async function loadEncryptedFolderIndex(username, entityHash, cabinetId, folderId, folderKey) {
	const path = encryptedFolderIndexPath(username, entityHash, cabinetId, folderId)
	try {
		const envelope = JSON.parse(await readFile(path, 'utf8'))
		return JSON.parse(decryptJson(folderKey, envelope))
	}
	catch {
		return { version: 1, entries: [] }
	}
}
