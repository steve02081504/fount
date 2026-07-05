/**
 * 【文件】group/groupEmojis.mjs
 * 【职责】群自定义表情（group_emojis）的 manifest 与二进制存储、上传删除及 data URL 持久化。
 * 【原理】每群 replica 磁盘下 manifest.json + binaries/；上传校验 512KB；联邦拉取经 persistGroupEmojiFromDataUrl 落盘；对外暴露 /emojis/:id/data API 路径。
 * 【数据结构】manifest entries（emojiId、mimeType、ext、animated）、Buffer/data URL。
 * 【关联】被 group/routes/groupEmojis.mjs、chat 消息 emoji 用法记录调用；依赖 chat/lib/paths、json_loader。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { putChunk } from '../../../../../../scripts/p2p/files/chunk_store.mjs'
import { prefixedRandomId } from '../../../../../../scripts/p2p/random_id.mjs'
import { groupDir } from '../chat/lib/paths.mjs'

const MAX_EMOJI_BYTES = 512 * 1024

/**
 * @param {Buffer} buffer 图片字节
 * @returns {string} sha256 hex（64 字符）
 */
export function computeEmojiContentHash(buffer) {
	return createHash('sha256').update(buffer).digest('hex')
}

/**
 * 将表情二进制写入全局 CAS（明文 contentHash）。
 * @param {Buffer} buffer 图片字节
 * @returns {Promise<string>} contentHash
 */
export async function storeEmojiInCas(buffer) {
	const contentHash = computeEmojiContentHash(buffer)
	await putChunk(contentHash, buffer)
	return contentHash
}

/**
 * @param {string} filePath 文件路径
 * @returns {Promise<boolean>} 文件存在则为 true
 */
async function fileExists(filePath) {
	try {
		await fs.access(filePath)
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} group_emojis 根目录
 */
export function groupEmojisRoot(username, groupId) {
	return path.join(groupDir(username, groupId), 'group_emojis')
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} manifest.json 路径
 */
function manifestPath(username, groupId) {
	return path.join(groupEmojisRoot(username, groupId), 'manifest.json')
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} binaries 目录
 */
function binariesDir(username, groupId) {
	return path.join(groupEmojisRoot(username, groupId), 'binaries')
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} manifest 条目列表
 */
export async function loadGroupEmojiManifest(username, groupId) {
	const p = manifestPath(username, groupId)
	if (!await fileExists(p)) return []
	const raw = await loadJsonFile(p)
	return Array.isArray(raw?.entries) ? raw.entries : []
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object[]} entries manifest
 * @returns {Promise<void>}
 */
async function saveGroupEmojiManifest(username, groupId, entries) {
	const root = groupEmojisRoot(username, groupId)
	if (!await fileExists(root)) await fs.mkdir(root, { recursive: true })
	if (!await fileExists(binariesDir(username, groupId)))
		await fs.mkdir(binariesDir(username, groupId), { recursive: true })
	await saveJsonFile(manifestPath(username, groupId), { entries })
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<object | null>} manifest 条目
 */
export async function getGroupEmojiEntry(username, groupId, emojiId) {
	const entries = await loadGroupEmojiManifest(username, groupId)
	return entries.find(e => e?.emojiId === emojiId) || null
}

/**
 * @param {object} entry manifest 条目
 * @returns {string} 磁盘文件名
 */
function binaryFilename(entry) {
	return `${entry.emojiId}${entry.ext || '.png'}`
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} 二进制绝对路径
 */
export async function resolveGroupEmojiBinaryPath(username, groupId, emojiId) {
	const entry = await getGroupEmojiEntry(username, groupId, emojiId)
	if (!entry) return null
	const filePath = path.join(binariesDir(username, groupId), binaryFilename(entry))
	return await fileExists(filePath) ? filePath : null
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object } | null>} 二进制与 manifest 条目；无文件时为 null
 */
export async function readGroupEmojiBinary(username, groupId, emojiId) {
	const entry = await getGroupEmojiEntry(username, groupId, emojiId)
	if (!entry) return null
	const filePath = path.join(binariesDir(username, groupId), binaryFilename(entry))
	if (!await fileExists(filePath)) return null
	return {
		buffer: await fs.readFile(filePath),
		mimeType: entry.mimeType || 'image/png',
		entry,
	}
}

/**
 * @param {Buffer} buffer 图片字节
 * @param {string} mimeType MIME
 * @returns {string} data URL 字符串
 */
export function bufferToDataUrl(buffer, mimeType) {
	const baseMime = String(mimeType || 'image/png').split(';')[0].trim() || 'image/png'
	return `data:${baseMime};base64,${buffer.toString('base64')}`
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {Buffer} buffer 图片
 * @param {string} originalname 原始文件名
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @returns {Promise<object>} 新 manifest 条目
 */
export async function uploadGroupEmoji(username, groupId, buffer, originalname, mimeType, name) {
	if (buffer.byteLength > MAX_EMOJI_BYTES) throw new Error('emoji file too large')
	const ext = path.extname(originalname || '').toLowerCase() || (mimeType.includes('gif') ? '.gif' : '.png')
	const emojiId = prefixedRandomId('emoji_')
	const entry = {
		emojiId,
		name: String(name || originalname || emojiId).slice(0, 64),
		mimeType: mimeType || 'image/png',
		ext,
		animated: mimeType.includes('gif'),
		uploadedAt: Date.now(),
		uploadedBy: username,
	}
	const root = groupEmojisRoot(username, groupId)
	const binDir = binariesDir(username, groupId)
	if (!await fileExists(binDir)) await fs.mkdir(binDir, { recursive: true })
	await fs.writeFile(path.join(binDir, binaryFilename(entry)), buffer)
	const contentHash = await storeEmojiInCas(buffer)
	entry.contentHash = contentHash
	const entries = await loadGroupEmojiManifest(username, groupId)
	entries.push(entry)
	await saveGroupEmojiManifest(username, groupId, entries)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<boolean>} 是否删除成功
 */
export async function deleteGroupEmoji(username, groupId, emojiId) {
	const entries = await loadGroupEmojiManifest(username, groupId)
	const entry = entries.find(e => e?.emojiId === emojiId)
	if (!entry) return false
	const next = entries.filter(e => e?.emojiId !== emojiId)
	await saveGroupEmojiManifest(username, groupId, next)
	const filePath = path.join(binariesDir(username, groupId), binaryFilename(entry))
	if (await fileExists(filePath)) await fs.unlink(filePath)
	return true
}

/**
 * 合并联邦同步的 manifest 条目（可无本地二进制）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} entry manifest 片段（至少含 emojiId）
 * @returns {Promise<object>} 合并后的条目
 */
export async function upsertGroupEmojiManifestEntry(username, groupId, entry) {
	const emojiId = String(entry?.emojiId || '').trim()
	if (!emojiId) throw new Error('emojiId required')
	const entries = await loadGroupEmojiManifest(username, groupId)
	const existing = entries.find(row => row?.emojiId === emojiId)
	const merged = {
		...existing || {
			emojiId,
			name: emojiId,
			mimeType: 'image/png',
			ext: '.png',
			animated: false,
			uploadedAt: Date.now(),
			uploadedBy: 'federation',
		},
		...entry,
		emojiId,
	}
	if (existing) Object.assign(existing, merged)
	else entries.push(merged)
	await saveGroupEmojiManifest(username, groupId, entries)
	return merged
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} emojiId 表情 ID
 * @param {string} dataUrl data URL
 * @param {string} mimeType MIME
 * @param {string} [name] 名称
 * @returns {Promise<object>} manifest 条目
 */
export async function persistGroupEmojiFromDataUrl(username, groupId, emojiId, dataUrl, mimeType, name) {
	const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl)
	if (!match) throw new Error('invalid dataUrl')
	const buffer = Buffer.from(match[2], 'base64')
	const entries = await loadGroupEmojiManifest(username, groupId)
	const existing = entries.find(e => e?.emojiId === emojiId)
	const ext = mimeType.includes('gif') ? '.gif' : '.png'
	const entry = existing || {
		emojiId,
		name: name || emojiId,
		mimeType: match[1] || mimeType,
		ext,
		animated: (match[1] || mimeType).includes('gif'),
		uploadedAt: Date.now(),
		uploadedBy: 'federation',
	}
	if (!existing) entries.push(entry)
	else Object.assign(entry, { mimeType: match[1] || mimeType })
	const binDir = binariesDir(username, groupId)
	if (!await fileExists(binDir)) await fs.mkdir(binDir, { recursive: true })
	await fs.writeFile(path.join(binDir, binaryFilename(entry)), buffer)
	const contentHash = await storeEmojiInCas(buffer)
	entry.contentHash = contentHash
	await saveGroupEmojiManifest(username, groupId, entries)
	return entry
}
