/**
 * 通用 emoji pack 磁盘存储：`{packsRoot}/{packId}/{manifest.json,binaries/}`。
 * 群 / 实体适配器只提供 packsRoot 与 source。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { prefixedRandomId } from 'npm:@steve02081504/fount-p2p/core/random_id'
import { putChunk } from 'npm:@steve02081504/fount-p2p/files/chunk/store'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

/** 单张表情二进制上限（字节）。 */
export const MAX_EMOJI_BYTES = 512 * 1024

/** packId / 磁盘段：与 inline token pack 位一致。 */
const SAFE_PACK_ID_RE = /^[\w.-]+$/u
/** 允许落盘的扩展名。 */
const SAFE_EMOJI_EXT = new Set(['.png', '.gif', '.webp', '.jpg', '.jpeg'])

/**
 * @param {unknown} packId 候选
 * @returns {boolean} 是否为规范、路径安全的 packId
 */
export function isSafePackId(packId) {
	const id = packId || ''
	return !!id && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\') && SAFE_PACK_ID_RE.test(id)
}

/**
 * @param {unknown} packId 候选
 * @returns {string} 规范 packId
 */
export function assertSafePackId(packId) {
	const id = packId || ''
	if (!isSafePackId(id)) throw new Error('invalid packId')
	return id
}

/**
 * @param {unknown} emojiId 候选
 * @returns {string} 规范 emojiId
 */
export function assertSafeEmojiId(emojiId) {
	const id = emojiId || ''
	if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('\0'))
		throw new Error('invalid emojiId')
	return id
}

/**
 * @param {unknown} ext 扩展名
 * @returns {string} 白名单扩展名
 */
function assertSafeExt(ext) {
	const value = ext || ''
	const normalized = value.startsWith('.') ? value : `.${value}`
	if (!SAFE_EMOJI_EXT.has(normalized)) throw new Error('invalid emoji ext')
	return normalized
}

/**
 * @param {Buffer} buffer 图片字节
 * @returns {string} sha256 hex
 */
export function computeEmojiContentHash(buffer) {
	return createHash('sha256').update(buffer).digest('hex')
}

/**
 * @param {Buffer} buffer 图片字节
 * @returns {Promise<string>} contentHash
 */
export async function storeEmojiInCas(buffer) {
	const contentHash = computeEmojiContentHash(buffer)
	await putChunk(contentHash, buffer)
	return contentHash
}

/**
 * @param {string} filePath 路径
 * @returns {Promise<boolean>} 是否存在
 */
export async function fileExists(filePath) {
	try {
		await fs.access(filePath)
		return true
	}
	catch {
		return false
	}
}

/**
 * @param {object} item manifest item
 * @returns {string} 磁盘文件名
 */
export function binaryFilename(item) {
	const emojiId = assertSafeEmojiId(item.emojiId)
	const ext = assertSafeExt(item.ext || (String(item.mimeType || '').includes('gif') ? '.gif' : '.png'))
	return `${emojiId}${ext}`
}

/**
 * @param {string} mimeType MIME
 * @returns {string} 扩展名
 */
export function extFromMime(mimeType) {
	return String(mimeType || '').includes('gif') ? '.gif' : '.png'
}

/**
 * @param {string} name 显示名
 * @returns {Record<string, { name: string, alt?: string }>} locale 切片
 */
export function localizedFromName(name) {
	const n = name || ''
	if (!n) return {}
	return { 'en-UK': { name: n } }
}

/**
 * @param {object} item 用量项
 * @returns {string} 显示名
 */
export function itemDisplayName(item) {
	const loc = item?.localized
	if (loc && typeof loc === 'object')
		for (const slice of Object.values(loc)) {
			const name = String(slice?.name || '').trim()
			if (name) return name
		}
	return String(item?.name || item?.emojiId || '').trim()
}

/**
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @returns {string} 包目录
 */
export function packDir(packsRoot, packId) {
	return path.join(packsRoot, assertSafePackId(packId))
}

/**
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @returns {string} manifest 路径
 */
export function packManifestPath(packsRoot, packId) {
	return path.join(packDir(packsRoot, packId), 'manifest.json')
}

/**
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @returns {string} binaries 目录
 */
export function packBinariesDir(packsRoot, packId) {
	return path.join(packDir(packsRoot, packId), 'binaries')
}

/**
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {object} [localized] locale 切片
 * @returns {object} 空 manifest
 */
export function emptyPackManifest(source, packId, localized = {}) {
	return {
		packId: packId || '',
		source: source && typeof source === 'object' ? source : { kind: 'unknown', id: '' },
		localized: localized && typeof localized === 'object' ? localized : {},
		items: [],
	}
}

/**
 * @param {string} packsRoot 包根目录
 * @returns {Promise<string[]>} packId 列表
 */
export async function listPackIds(packsRoot) {
	if (!await fileExists(packsRoot)) return []
	const ents = await fs.readdir(packsRoot, { withFileTypes: true })
	return ents.filter(e => e.isDirectory()).map(e => e.name)
}

/**
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @param {{ kind: string, id: string }} [defaultSource] 缺省 source
 * @returns {Promise<object | null>} manifest
 */
export async function loadPackManifest(packsRoot, packId, defaultSource) {
	if (!isSafePackId(packId)) return null
	const pid = packId || ''
	const p = packManifestPath(packsRoot, pid)
	if (!await fileExists(p)) return null
	const raw = await loadJsonFile(p)
	if (!raw || typeof raw !== 'object') return null
	return {
		...raw,
		packId: String(raw.packId || pid),
		source: raw.source && typeof raw.source === 'object'
			? raw.source
			: defaultSource || { kind: 'unknown', id: '' },
		localized: raw.localized && typeof raw.localized === 'object' ? raw.localized : {},
		items: Array.isArray(raw.items) ? raw.items : [],
	}
}

/**
 * @param {string} packsRoot 包根目录
 * @param {object} manifest pack manifest
 * @returns {Promise<void>}
 */
export async function savePackManifest(packsRoot, manifest) {
	const packId = manifest.packId || ''
	const root = packDir(packsRoot, packId)
	const binDir = packBinariesDir(packsRoot, packId)
	if (!await fileExists(root)) await fs.mkdir(root, { recursive: true })
	if (!await fileExists(binDir)) await fs.mkdir(binDir, { recursive: true })
	await saveJsonFile(packManifestPath(packsRoot, packId), {
		...manifest,
		packId,
		source: manifest.source || { kind: 'unknown', id: '' },
		localized: manifest.localized || {},
		items: manifest.items || [],
	})
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} [defaultSource] 缺省 source
 * @returns {Promise<object[]>} pack 列表
 */
export async function listPacks(packsRoot, defaultSource) {
	const ids = await listPackIds(packsRoot)
	/** @type {object[]} */
	const packs = []
	for (const packId of ids) {
		const m = await loadPackManifest(packsRoot, packId, defaultSource)
		if (m) packs.push(m)
	}
	return packs
}

/**
 * @param {object} manifest pack manifest
 * @returns {object} 摘要
 */
export function packSummary(manifest) {
	return {
		packId: manifest.packId,
		source: manifest.source,
		localized: manifest.localized || {},
		itemCount: Array.isArray(manifest.items) ? manifest.items.length : 0,
	}
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {{ packId?: string, localized?: object }} [fields] 创建字段
 * @returns {Promise<object>} 新建 manifest
 */
export async function createPack(packsRoot, source, fields = {}) {
	const packId = assertSafePackId((fields.packId || '') || prefixedRandomId('pack_'))
	const existing = await loadPackManifest(packsRoot, packId, source)
	if (existing) throw new Error('pack already exists')
	const manifest = emptyPackManifest(source, packId, fields.localized)
	await savePackManifest(packsRoot, manifest)
	return manifest
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {{ localized?: object }} patch 更新
 * @returns {Promise<object>} 更新后 manifest
 */
export async function updatePack(packsRoot, source, packId, patch = {}) {
	const manifest = await loadPackManifest(packsRoot, packId, source)
	if (!manifest) throw new Error('pack not found')
	if (patch.localized && typeof patch.localized === 'object')
		manifest.localized = patch.localized
	await savePackManifest(packsRoot, manifest)
	return manifest
}

/**
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @returns {Promise<boolean>} 是否删除
 */
export async function deletePack(packsRoot, packId) {
	if (!isSafePackId(packId)) return false
	const root = packDir(packsRoot, packId)
	if (!await fileExists(root)) return false
	await fs.rm(root, { recursive: true, force: true })
	return true
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @returns {Promise<object | null>} 条目
 */
export async function getPackEmojiEntry(packsRoot, source, packId, emojiId) {
	const manifest = await loadPackManifest(packsRoot, packId, source)
	return manifest?.items?.find(e => e?.emojiId === emojiId) || null
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @returns {Promise<{ buffer: Buffer, mimeType: string, entry: object, packId: string } | null>} 二进制
 */
export async function readPackEmojiBinary(packsRoot, source, packId, emojiId) {
	const entry = await getPackEmojiEntry(packsRoot, source, packId, emojiId)
	if (!entry) return null
	const filePath = path.join(packBinariesDir(packsRoot, packId), binaryFilename(entry))
	if (!await fileExists(filePath)) return null
	return {
		buffer: await fs.readFile(filePath),
		mimeType: entry.mimeType || 'image/png',
		entry,
		packId,
	}
}

/**
 * 写入表情二进制 + CAS + 更新 manifest（先落盘再记 hash，最后 save）。
 * @param {string} packsRoot 包根目录
 * @param {string} packId pack id
 * @param {object} manifest manifest（就地更新 items）
 * @param {object} entry 条目（须含 emojiId / ext）
 * @param {Buffer} buffer 图片字节
 * @returns {Promise<object>} 带 contentHash 的条目
 */
async function writeEmojiEntry(packsRoot, packId, manifest, entry, buffer) {
	assertSafePackId(packId)
	assertSafeEmojiId(entry.emojiId)
	entry.ext = assertSafeExt(entry.ext || extFromMime(entry.mimeType))
	const binDir = packBinariesDir(packsRoot, packId)
	if (!await fileExists(binDir)) await fs.mkdir(binDir, { recursive: true })
	await fs.writeFile(path.join(binDir, binaryFilename(entry)), buffer)
	entry.contentHash = await storeEmojiInCas(buffer)
	await savePackManifest(packsRoot, manifest)
	return entry
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {Buffer} buffer 图片字节
 * @param {string} originalname 原始文件名
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @param {string} [uploadedBy] 上传者标记
 * @returns {Promise<object>} 新条目
 */
export async function uploadPackEmoji(packsRoot, source, packId, buffer, originalname, mimeType, name, uploadedBy = '') {
	if (buffer.byteLength > MAX_EMOJI_BYTES) throw new Error('emoji file too large')
	const pid = assertSafePackId(packId)
	let manifest = await loadPackManifest(packsRoot, pid, source)
	if (!manifest)
		manifest = await createPack(packsRoot, source, { packId: pid })
	const ext = path.extname(originalname || '').toLowerCase() || extFromMime(mimeType)
	const emojiId = prefixedRandomId('emoji_')
	const displayName = String(name || originalname || emojiId).slice(0, 64)
	const entry = {
		emojiId,
		localized: localizedFromName(displayName),
		name: displayName,
		mimeType: mimeType || 'image/png',
		ext,
		animated: String(mimeType || '').includes('gif'),
		uploadedAt: Date.now(),
		uploadedBy: uploadedBy || '',
	}
	manifest.items.push(entry)
	await writeEmojiEntry(packsRoot, pid, manifest, entry, buffer)
	return { ...entry, packId: manifest.packId }
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @returns {Promise<boolean>} 是否删除
 */
export async function deletePackEmoji(packsRoot, source, packId, emojiId) {
	const manifest = await loadPackManifest(packsRoot, packId, source)
	if (!manifest) return false
	const entry = manifest.items.find(e => e?.emojiId === emojiId)
	if (!entry) return false
	manifest.items = manifest.items.filter(e => e?.emojiId !== emojiId)
	await savePackManifest(packsRoot, manifest)
	const filePath = path.join(packBinariesDir(packsRoot, packId), binaryFilename(entry))
	if (await fileExists(filePath)) await fs.unlink(filePath)
	return true
}

/**
 * @param {Buffer} buffer 图片字节
 * @param {string} mimeType MIME
 * @returns {string} data URL
 */
export function bufferToDataUrl(buffer, mimeType) {
	const baseMime = String(mimeType || 'image/png').split(';')[0].trim() || 'image/png'
	return `data:${baseMime};base64,${buffer.toString('base64')}`
}

/**
 * @param {string} packsRoot 包根目录
 * @param {{ kind: string, id: string }} source 来源
 * @param {string} packId pack id
 * @param {string} emojiId emoji id
 * @param {string} dataUrl data URL
 * @param {string} mimeType MIME
 * @param {string} [name] 显示名
 * @param {string} [uploadedBy] 上传者
 * @returns {Promise<object>} 条目
 */
export async function persistEmojiFromDataUrl(packsRoot, source, packId, emojiId, dataUrl, mimeType, name, uploadedBy = 'federation') {
	const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl)
	if (!match) throw new Error('invalid dataUrl')
	const buffer = Buffer.from(match[2], 'base64')
	if (buffer.byteLength > MAX_EMOJI_BYTES) throw new Error('emoji file too large')
	const pid = assertSafePackId(packId)
	const eid = assertSafeEmojiId(emojiId)
	let manifest = await loadPackManifest(packsRoot, pid, source)
	if (!manifest) {
		manifest = emptyPackManifest(source, pid)
		await savePackManifest(packsRoot, manifest)
		manifest = await loadPackManifest(packsRoot, pid, source)
	}
	const existing = manifest.items.find(e => e?.emojiId === eid)
	const resolvedMime = match[1] || mimeType || 'image/png'
	const ext = extFromMime(resolvedMime)
	const displayName = name || itemDisplayName(existing) || eid
	const entry = existing || {
		emojiId: eid,
		localized: localizedFromName(displayName),
		name: displayName,
		mimeType: resolvedMime,
		ext,
		animated: resolvedMime.includes('gif'),
		uploadedAt: Date.now(),
		uploadedBy,
	}
	if (!existing) manifest.items.push(entry)
	else Object.assign(entry, { mimeType: resolvedMime, ext })
	await writeEmojiEntry(packsRoot, pid, manifest, entry, buffer)
	return { ...entry, packId: pid }
}
