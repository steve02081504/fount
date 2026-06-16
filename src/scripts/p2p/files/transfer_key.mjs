import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import {
	decryptConvergentCiphertext,
	decryptRandomCiphertext,
	unwrapContentKey,
} from '../key_crypto.mjs'

/**
 * @typedef {import('./manifest.mjs').FileManifest} FileManifest
 * @typedef {import('./manifest.mjs').TransferKeyDescriptor} TransferKeyDescriptor
 */

/**
 * @param {TransferKeyDescriptor} descriptor 传递密钥描述符
 * @param {FileManifest} manifest manifest
 * @param {{ getGroupFileMasterKey?: (groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>, getVaultMasterKey?: (entityHash: string) => Promise<Buffer | string | null> }} deps 密钥源
 * @returns {Promise<Buffer | null>} contentKey；plain/convergent 返回 null（按 contentHash 派生）
 */
export async function resolveContentKey(descriptor, manifest, deps = {}) {
	const type = descriptor?.type || 'public'
	if (type === 'public' || manifest.ceMode === 'plain' || manifest.ceMode === 'convergent')
		return null

	if (type === 'file-master-key-wrap') {
		const groupId = descriptor.groupId
		const fileId = descriptor.fileId
		if (!groupId || !fileId || !descriptor.wrappedKey || !deps.getGroupFileMasterKey) return null
		const groupKey = await deps.getGroupFileMasterKey(String(groupId), descriptor.keyGeneration)
		if (!groupKey) return null
		return unwrapContentKey(descriptor.wrappedKey, groupKey, fileId)
	}

	if (type === 'vault-wrap') {
		const entityHash = descriptor.entityHash
		const fileId = descriptor.fileId
		if (!entityHash || !fileId || !descriptor.wrappedKey || !deps.getVaultMasterKey) return null
		const vaultKey = await deps.getVaultMasterKey(String(entityHash))
		if (!vaultKey) return null
		return unwrapContentKey(descriptor.wrappedKey, vaultKey, fileId)
	}

	return null
}

/**
 * @param {Buffer | Uint8Array} encryptedPartBytes 密文块
 * @param {FileManifest} manifest manifest
 * @param {Buffer | null} contentKey random 模式密钥
 * @returns {Buffer | null} 明文
 */
export function decryptPart(encryptedPartBytes, manifest, contentKey) {
	if (manifest.ceMode === 'plain')
		return Buffer.from(encryptedPartBytes)

	if (manifest.ceMode === 'convergent')
		return decryptConvergentCiphertext(encryptedPartBytes, manifest.contentHash)

	if (manifest.ceMode === 'random' && contentKey)
		return decryptRandomCiphertext(encryptedPartBytes, contentKey, manifest.contentHash)

	return null
}

/**
 * @param {FileManifest} manifest manifest
 * @param {Array<Buffer | Uint8Array>} partBytes 按序密文块
 * @param {{ getGroupFileMasterKey?: Function, getVaultMasterKey?: Function }} deps 密钥源
 * @returns {Promise<Buffer | null>} 完整明文
 */
export async function assembleManifestPlaintext(manifest, partBytes, deps = {}) {
	if (partBytes.length !== manifest.parts.length) return null
	const contentKey = await resolveContentKey(manifest.transferKeyDescriptor, manifest, deps)
	/** @type {Buffer[]} */
	const plains = []
	for (let index = 0; index < manifest.parts.length; index++) {
		const plain = decryptPart(partBytes[index], manifest, contentKey)
		if (!plain) return null
		plains.push(plain)
	}
	const merged = Buffer.concat(plains)
	if (manifest.contentHash)
		if (createHash('sha256').update(merged).digest('hex') !== manifest.contentHash.toLowerCase()) return null

	return merged
}
