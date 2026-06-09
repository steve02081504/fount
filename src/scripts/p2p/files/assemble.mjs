import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers'

import { FEDERATION_CHUNK_MAX_BYTES } from '../constants.mjs'
import {
	encryptConvergentPlaintext,
	encryptRandomPlaintext,
	wrapContentKey,
} from '../key_crypto.mjs'

import { normalizeFileManifest, publicTransferKeyDescriptor } from './manifest.mjs'

/** @type {Record<string, (plain: Buffer) => { contentHash: string, ciphertextHash: string, raw: Buffer, contentKey?: Buffer }>} */
const ENCRYPTION_STRATEGIES = {
	/**
	 * @param {Buffer} plain 明文
	 * @returns {{ contentHash: string, ciphertextHash: string, raw: Buffer }} 分块结果
	 */
	plain: (plain) => {
		const contentHash = createHash('sha256').update(plain).digest('hex')
		return { contentHash, ciphertextHash: contentHash, raw: plain }
	},
	/**
	 * @param {Buffer} plain 明文
	 * @returns {{ contentHash: string, ciphertextHash: string, raw: Buffer }} 分块结果
	 */
	convergent: (plain) => encryptConvergentPlaintext(plain),
	/**
	 * @param {Buffer} plain 明文
	 * @returns {{ contentHash: string, ciphertextHash: string, raw: Buffer, contentKey: Buffer }} 分块结果
	 */
	random: (plain) => encryptRandomPlaintext(plain),
}

/**
 * @typedef {import('./manifest.mjs').FileManifest} FileManifest
 * @typedef {import('./manifest.mjs').CeMode} CeMode
 */

/**
 * @param {CeMode} ceMode 模式
 * @returns {(plain: Buffer) => { contentHash: string, ciphertextHash: string, raw: Buffer, contentKey?: Buffer }} 加密策略
 */
function encryptionStrategyFor(ceMode) {
	const strategy = ENCRYPTION_STRATEGIES[ceMode]
	if (!strategy) throw new Error(`unknown ceMode: ${ceMode}`)
	return strategy
}

/**
 * @param {Buffer | Uint8Array} plaintext 明文
 * @param {CeMode} ceMode 模式
 * @returns {{ contentHash: string, parts: Array<{ hash: string, size: number, raw: Buffer }>, contentKey?: Buffer }} 加密结果
 */
export function encryptPlaintextToParts(plaintext, ceMode = 'convergent') {
	const plain = Buffer.from(plaintext)
	const enc = encryptionStrategyFor(ceMode)(plain)
	return {
		contentHash: enc.contentHash,
		parts: [{ hash: enc.ciphertextHash, size: enc.raw.length, raw: enc.raw }],
		contentKey: enc.contentKey,
	}
}

/**
 * 将明文拆分为多块加密（大文件）。
 * @param {Buffer | Uint8Array} plaintext 明文
 * @param {CeMode} ceMode 模式
 * @returns {{ contentHash: string, parts: Array<{ hash: string, size: number, raw: Buffer }>, contentKey?: Buffer }} 分块加密结果
 */
export function encryptPlaintextToMultiParts(plaintext, ceMode = 'convergent') {
	const plain = Buffer.from(plaintext)
	const contentHash = createHash('sha256').update(plain).digest('hex')
	if (plain.length <= FEDERATION_CHUNK_MAX_BYTES)
		return encryptPlaintextToParts(plain, ceMode)

	/** @type {Array<{ hash: string, size: number, raw: Buffer }>} */
	const parts = []
	let contentKey = null
	for (let offset = 0; offset < plain.length; offset += FEDERATION_CHUNK_MAX_BYTES) {
		const slice = plain.subarray(offset, offset + FEDERATION_CHUNK_MAX_BYTES)
		const enc = encryptionStrategyFor(ceMode)(slice)
		if (ceMode === 'random') contentKey = enc.contentKey
		parts.push({ hash: enc.ciphertextHash, size: enc.raw.length, raw: enc.raw })
	}
	return { contentHash, parts, contentKey: contentKey || undefined }
}

/**
 * 异步多块加密，周期性让出事件循环。
 * @param {Buffer | Uint8Array} plaintext 明文
 * @param {CeMode} ceMode 模式
 * @returns {Promise<{ contentHash: string, parts: Array<{ hash: string, size: number, raw: Buffer }>, contentKey?: Buffer }>} 分块加密结果
 */
export async function encryptPlaintextToMultiPartsAsync(plaintext, ceMode = 'convergent') {
	const plain = Buffer.from(plaintext)
	const contentHash = createHash('sha256').update(plain).digest('hex')
	if (plain.length <= FEDERATION_CHUNK_MAX_BYTES)
		return encryptPlaintextToParts(plain, ceMode)

	/** @type {Array<{ hash: string, size: number, raw: Buffer }>} */
	const parts = []
	let contentKey = null
	for (let offset = 0; offset < plain.length; offset += FEDERATION_CHUNK_MAX_BYTES) {
		if (offset > 0) await new Promise(resolve => setImmediate(resolve))
		const slice = plain.subarray(offset, offset + FEDERATION_CHUNK_MAX_BYTES)
		const enc = encryptionStrategyFor(ceMode)(slice)
		if (ceMode === 'random') contentKey = enc.contentKey
		parts.push({ hash: enc.ciphertextHash, size: enc.raw.length, raw: enc.raw })
	}
	return { contentHash, parts, contentKey: contentKey || undefined }
}

/**
 * @param {object} params 参数
 * @param {string} params.ownerEntityHash 128 hex
 * @param {string} params.logicalPath EVFS 路径
 * @param {Buffer | Uint8Array} params.plaintext 明文
 * @param {string} [params.name] 文件名
 * @param {string} [params.mimeType] MIME
 * @param {CeMode} [params.ceMode] 加密模式
 * @param {import('./manifest.mjs').TransferKeyDescriptor} [params.transferKeyDescriptor] 传递密钥
 * @param {object} [params.meta] 元数据
 * @returns {FileManifest} manifest（未写盘）
 */
export function buildFileManifest(params) {
	const {
		ownerEntityHash,
		logicalPath,
		plaintext,
		name,
		mimeType = 'application/octet-stream',
		ceMode = 'convergent',
		transferKeyDescriptor,
		meta,
	} = params
	const enc = encryptPlaintextToParts(plaintext, ceMode)
	const manifest = normalizeFileManifest({
		ownerEntityHash: ownerEntityHash.toLowerCase(),
		logicalPath: logicalPath.replace(/^\/+/, ''),
		name: name || logicalPath.split('/').pop() || 'file',
		mimeType,
		size: Buffer.from(plaintext).length,
		contentHash: enc.contentHash,
		ceMode,
		parts: enc.parts.map(part => ({ hash: part.hash, size: part.size })),
		transferKeyDescriptor: transferKeyDescriptor || publicTransferKeyDescriptor(ceMode),
		meta,
	})
	if (!manifest) throw new Error('invalid manifest')
	return manifest
}

/**
 * 由已加密分块构建 manifest（vault / file-master-key-wrap 等需自定义 transferKeyDescriptor）。
 * @param {object} params 与 buildFileManifest 相同字段（不含 plaintext 重加密）
 * @param {{ contentHash: string, parts: Array<{ hash: string, size: number, raw?: Buffer }> }} enc 加密结果
 * @returns {FileManifest} manifest
 */
export function buildFileManifestFromEnc(params, enc) {
	const {
		ownerEntityHash,
		logicalPath,
		plaintext,
		name,
		mimeType = 'application/octet-stream',
		ceMode = 'convergent',
		transferKeyDescriptor,
		meta,
	} = params
	const manifest = normalizeFileManifest({
		ownerEntityHash: ownerEntityHash.toLowerCase(),
		logicalPath: logicalPath.replace(/^\/+/, ''),
		name: name || logicalPath.split('/').pop() || 'file',
		mimeType,
		size: Buffer.from(plaintext).length,
		contentHash: enc.contentHash,
		ceMode,
		parts: enc.parts.map(part => ({ hash: part.hash, size: part.size })),
		transferKeyDescriptor: transferKeyDescriptor || publicTransferKeyDescriptor(ceMode),
		meta,
	})
	if (!manifest) throw new Error('invalid manifest')
	return manifest
}

/**
 * @param {string} groupId 群 ID
 * @param {Buffer} contentKey 随机 contentKey
 * @param {Buffer | string} H 群/vault 秘密
 * @param {string} fileId 文件 ID
 * @param {number} keyGeneration 密钥代次
 * @returns {import('./manifest.mjs').TransferKeyDescriptor} 传输密钥描述
 */
export function fileMasterKeyWrapDescriptor(groupId, fileId, contentKey, H, keyGeneration = 0) {
	return {
		type: 'file-master-key-wrap',
		groupId,
		fileId,
		keyGeneration,
		wrappedKey: wrapContentKey(contentKey, H, fileId),
	}
}

/**
 * @param {string} entityHash owner
 * @param {string} fileId 文件 ID
 * @param {Buffer} contentKey 随机密钥
 * @param {Buffer | string} H vault H
 * @returns {import('./manifest.mjs').TransferKeyDescriptor} 传输密钥描述
 */
export function vaultWrapDescriptor(entityHash, fileId, contentKey, H) {
	return {
		type: 'vault-wrap',
		entityHash: entityHash.toLowerCase(),
		fileId,
		wrappedKey: wrapContentKey(contentKey, H, fileId),
	}
}
