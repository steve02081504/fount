/**
 * 【文件】files/blobStore.mjs
 * 【职责】用户级 blob 密文/明文缓存与全局 ciphertextHash 引用计数（§10.4 §6 附件仓）。
 * 【原理】shells/chat/blobs 与 files 目录；put/get/release bump refcount；blob_refcounts.json 跨群共享。
 * 【数据结构】locator `blob:{hash}`；plainCache 按 contentHash；normalizeRefcounts 表。
 * 【关联】groupFiles、attachmentRefs GC；paths shellChatRoot。
 */
import { Buffer } from 'node:buffer'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeJsonAtomic } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { BLOB_STORAGE_LOCATOR_RE, isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { shellChatRoot } from '../lib/paths.mjs'

/**
 * @param {string} username 用户
 * @param {string} hashHex contentHash 或 ciphertextHash
 * @returns {string} 绝对路径
 */
function blobPath(username, hashHex) {
	return join(shellChatRoot(username), 'blobs', `${hashHex.toLowerCase()}.bin`)
}

/**
 * @param {string} username 用户
 * @param {string} contentHashHex 明文哈希
 * @returns {string} 绝对路径
 */
function plainCachePath(username, contentHashHex) {
	return join(shellChatRoot(username), 'files', `${contentHashHex.toLowerCase()}.bin`)
}

/**
 * @param {string} username 用户
 * @returns {string} 全局密文引用计数表路径（§10.4）
 */
function blobRefcountPath(username) {
	return join(shellChatRoot(username), 'blob_refcounts.json')
}

/**
 * @param {unknown} raw JSON
 * @returns {Record<string, number>} 哈希 → 引用计数
 */
function normalizeRefcounts(raw) {
	return raw?.refs || raw || {}
}

/**
 * @param {string} username 用户
 * @returns {Promise<Record<string, number>>} 引用计数表
 */
async function loadBlobRefcounts(username) {
	try {
		return normalizeRefcounts(JSON.parse(await readFile(blobRefcountPath(username), 'utf8')))
	}
	catch {
		return {}
	}
}

/**
 * @param {string} username 用户
 * @param {Record<string, number>} table 引用计数表
 * @returns {Promise<void>} 无返回值
 */
async function saveBlobRefcounts(username, table) {
	await mkdir(shellChatRoot(username), { recursive: true })
	await writeJsonAtomic(blobRefcountPath(username), { refs: table })
}

/**
 * 本节点是否已有该密文块。
 * @param {string} username 用户
 * @param {string} ciphertextHashHex 密文 SHA-256
 * @returns {Promise<boolean>} 本节点是否已有该密文文件
 */
export async function hasCiphertextBlob(username, ciphertextHashHex) {
	const h = String(ciphertextHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) return false
	try {
		await readFile(blobPath(username, h))
		return true
	}
	catch {
		return false
	}
}

/**
 * 已有密文块时仅增加引用计数（§10.3 预检 have-it 跳传）。
 * @param {string} username 用户
 * @param {string} ciphertextHashHex 密文哈希
 * @returns {Promise<string>} storageLocator `blob:{hash}`
 */
export async function bumpCiphertextBlobRef(username, ciphertextHashHex) {
	const h = String(ciphertextHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) throw new Error('invalid ciphertextHash')
	const refs = await loadBlobRefcounts(username)
	refs[h] = (refs[h] || 0) + 1
	await saveBlobRefcounts(username, refs)
	return `blob:${h}`
}

/**
 * 写入密文块并增加引用计数。
 * @param {string} username 用户
 * @param {string} ciphertextHashHex 密文哈希
 * @param {Uint8Array | Buffer} raw 密文原始字节
 * @returns {Promise<string>} storageLocator `blob:{hash}`
 */
export async function putCiphertextBlob(username, ciphertextHashHex, raw) {
	const h = String(ciphertextHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) throw new Error('invalid ciphertextHash')
	const path = blobPath(username, h)
	await mkdir(join(shellChatRoot(username), 'blobs'), { recursive: true })
	await writeFile(path, Buffer.from(raw))
	const refs = await loadBlobRefcounts(username)
	refs[h] = (refs[h] || 0) + 1
	await saveBlobRefcounts(username, refs)
	return `blob:${h}`
}

/**
 * 读取密文块。
 * @param {string} username 用户
 * @param {string} locator `blob:{hash}`
 * @returns {Promise<Buffer>} 密文原始字节
 */
export async function getCiphertextBlob(username, locator) {
	const m = String(locator || '').match(BLOB_STORAGE_LOCATOR_RE)
	const h = String(m?.[1] || '').trim().toLowerCase()
	if (!isHex64(h)) throw new Error('invalid blob locator')
	return Buffer.from(await readFile(blobPath(username, h)))
}

/**
 * 授权节点缓存明文（§19 `files/{contentHash}`）。
 * @param {string} username 用户
 * @param {string} contentHashHex 明文哈希
 * @param {Uint8Array | Buffer} plaintext 明文
 * @returns {Promise<void>}
 */
export async function cachePlaintextFile(username, contentHashHex, plaintext) {
	const h = String(contentHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) throw new Error('invalid contentHash')
	await mkdir(join(shellChatRoot(username), 'files'), { recursive: true })
	await writeFile(plainCachePath(username, h), Buffer.from(plaintext))
}

/**
 * 尝试读取明文缓存。
 * @param {string} username 用户
 * @param {string} contentHashHex 明文哈希
 * @returns {Promise<Buffer | null>} 明文或 null
 */
export async function getPlaintextCache(username, contentHashHex) {
	const h = String(contentHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) return null
	try {
		return Buffer.from(await readFile(plainCachePath(username, h)))
	}
	catch {
		return null
	}
}

/**
 * 释放密文块引用；归零时物理删除（§10.4，仅本节点）。
 * @param {string} username 用户
 * @param {string} locator `blob:{hash}`
 * @returns {Promise<boolean>} 是否已物理删除
 */
export async function releaseCiphertextBlob(username, locator) {
	const m = String(locator || '').match(BLOB_STORAGE_LOCATOR_RE)
	const h = String(m?.[1] || '').trim().toLowerCase()
	if (!isHex64(h)) return false
	const refs = await loadBlobRefcounts(username)
	const next = Math.max(0, (refs[h] || 0) - 1)
	if (next > 0) {
		refs[h] = next
		await saveBlobRefcounts(username, refs)
		return false
	}
	delete refs[h]
	await saveBlobRefcounts(username, refs)
	try {
		await unlink(blobPath(username, h))
	}
	catch { /* ignore */ }
	return true
}
