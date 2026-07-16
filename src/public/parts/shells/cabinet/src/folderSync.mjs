import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getCabinet, loadPersonalIndex, savePersonalIndex, updateCabinet } from './cabinets.mjs'
import { normalizeEntry, patchEntry } from './entryModel.mjs'
import { evfsBlobPath, syncStatePath } from './paths.mjs'
import { putCabinetEvfsFile } from './publish.mjs'

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null
/** @type {Set<string>} */
const busy = new Set()

/**
 * @returns {void}
 */
export function startFolderSyncScheduler() {
	if (timer) return
	timer = setInterval(() => {
		// 绑定同步由显式 API / 测试触发；定时器占位避免 Load/Unload 空转
	}, 60_000)
}

/**
 * @returns {void}
 */
export function stopFolderSyncScheduler() {
	if (timer) clearInterval(timer)
	timer = null
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @returns {Promise<{ pulled: number, pushed: number }>} 统计
 */
export async function runCabinetSync(username, entityHash, cabinetId) {
	const key = `${username}:${cabinetId}`
	if (busy.has(key)) return { pulled: 0, pushed: 0 }
	busy.add(key)
	try {
		const cabinet = await getCabinet(username, entityHash, cabinetId)
		if (!cabinet?.sync_binding?.path) return { pulled: 0, pushed: 0 }
		const localRoot = path.resolve(String(cabinet.sync_binding.path))
		await mkdir(localRoot, { recursive: true })
		const snapshot = await loadSnapshot(username, cabinetId)
		const index = await loadPersonalIndex(username, entityHash, cabinetId)
		const pulled = await pullCabinetToDisk(username, entityHash, index, localRoot, snapshot)
		const pushed = await pushDiskToCabinet(username, entityHash, cabinet, index, localRoot, snapshot)
		await savePersonalIndex(username, entityHash, cabinetId, index)
		await saveSnapshot(username, cabinetId, snapshot)
		return { pulled, pushed }
	}
	finally {
		busy.delete(key)
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<{ files: Record<string, object> }>} 快照
 */
async function loadSnapshot(username, cabinetId) {
	try {
		return JSON.parse(await readFile(syncStatePath(username, cabinetId), 'utf8'))
	}
	catch {
		return { files: {} }
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {object} snapshot 快照
 * @returns {Promise<void>}
 */
async function saveSnapshot(username, cabinetId, snapshot) {
	const p = syncStatePath(username, cabinetId)
	await mkdir(p.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await writeFile(p, JSON.stringify(snapshot, null, '\t'), 'utf8')
}

/**
 * 先拉：柜 → 本地目录（冲突覆盖本地）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {{ entries: object[] }} index 柜索引
 * @param {string} localRoot 本地根目录
 * @param {{ files: Record<string, object> }} snapshot 同步快照
 * @returns {Promise<number>} 变更数
 */
async function pullCabinetToDisk(username, entityHash, index, localRoot, snapshot) {
	let count = 0
	const fileEntries = index.entries.filter(entry => entry.kind === 'file' && entry.evfs_path)
	/** @type {Set<string>} */
	const seen = new Set()
	const { loadFileManifest, readManifestPlaintext } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	for (const entry of fileEntries) {
		const rel = entryRelPath(index.entries, entry)
		seen.add(rel)
		const dest = path.join(localRoot, rel)
		const fingerprint = `${entry.size}:${entry.modified?.at || 0}`
		const prev = snapshot.files[rel]
		if (prev && prev.fingerprint === fingerprint) continue
		await mkdir(path.dirname(dest), { recursive: true })
		try {
			const manifest = await loadFileManifest(entityHash, entry.evfs_path)
			if (!manifest) continue
			const plain = await readManifestPlaintext(username, manifest)
			await writeFile(dest, plain)
			snapshot.files[rel] = {
				size: entry.size,
				mtime: entry.modified?.at || Date.now(),
				fingerprint,
				entry_id: entry.id,
			}
			count++
		}
		catch { /* skip */ }
	}
	for (const rel of Object.keys(snapshot.files)) {
		if (seen.has(rel)) continue
		await rm(path.join(localRoot, rel), { force: true })
		delete snapshot.files[rel]
		count++
	}
	return count
}

/**
 * 再推：本地目录 → 柜（冲突覆盖柜）。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {{ entries: object[] }} index 柜索引
 * @param {string} localRoot 本地根目录
 * @param {{ files: Record<string, object> }} snapshot 同步快照
 * @returns {Promise<number>} 变更数
 */
async function pushDiskToCabinet(username, entityHash, cabinet, index, localRoot, snapshot) {
	let count = 0
	const diskFiles = await walkDisk(localRoot)
	/** @type {Set<string>} */
	const seen = new Set()
	for (const file of diskFiles) {
		seen.add(file.rel)
		const prev = snapshot.files[file.rel]
		const fingerprint = `${file.size}:${file.mtime}`
		if (prev && prev.fingerprint === fingerprint) continue
		const plaintext = await readFile(file.full)
		let entry = prev?.entry_id
			? index.entries.find(row => row.id === prev.entry_id)
			: index.entries.find(row => entryRelPath(index.entries, row) === file.rel && row.kind === 'file')
		const parentId = ensureFolderPath(index, path.dirname(file.rel).replace(/\\/g, '/'), entityHash)
		if (!entry) {
			const blobId = randomUUID()
			const logicalPath = evfsBlobPath(cabinet.cabinet_id, blobId)
			await putCabinetEvfsFile(username, entityHash, {
				logical_path: logicalPath,
				plaintext,
				name: path.basename(file.rel),
				mime_type: 'application/octet-stream',
				visibility: cabinet.visibility,
			})
			entry = normalizeEntry({
				kind: 'file',
				name: path.basename(file.rel),
				parent_id: parentId,
				size: plaintext.length,
				mime_type: 'application/octet-stream',
				evfs_path: logicalPath,
				attrs: { hidden: false, system: true },
			}, entityHash)
			index.entries.push(entry)
		}
		else {
			await putCabinetEvfsFile(username, entityHash, {
				logical_path: entry.evfs_path,
				plaintext,
				name: entry.name,
				mime_type: entry.mime_type,
				visibility: cabinet.visibility,
			})
			const pos = index.entries.findIndex(row => row.id === entry.id)
			index.entries[pos] = patchEntry(entry, { size: plaintext.length }, entityHash)
			entry = index.entries[pos]
		}
		snapshot.files[file.rel] = {
			size: plaintext.length,
			mtime: file.mtime,
			fingerprint,
			entry_id: entry.id,
		}
		count++
	}
	for (const rel of Object.keys(snapshot.files)) {
		if (seen.has(rel)) continue
		const entryId = snapshot.files[rel].entry_id
		index.entries = index.entries.filter(row => row.id !== entryId)
		delete snapshot.files[rel]
		count++
	}
	return count
}

/**
 * @param {object[]} entries 条目
 * @param {object} entry 条目
 * @returns {string} 相对路径
 */
function entryRelPath(entries, entry) {
	const parts = [entry.name]
	let parentId = entry.parent_id
	const guard = new Set()
	while (parentId && !guard.has(parentId)) {
		guard.add(parentId)
		const parent = entries.find(row => row.id === parentId)
		if (!parent) break
		parts.unshift(parent.name)
		parentId = parent.parent_id
	}
	return parts.join('/')
}

/**
 * @param {object} index 索引
 * @param {string} relDir 相对目录
 * @param {string} entityHash 实体
 * @returns {string | null} 父文件夹 id
 */
function ensureFolderPath(index, relDir, entityHash) {
	if (!relDir || relDir === '.' || relDir === '/') return null
	const parts = relDir.split('/').filter(Boolean)
	let parentId = null
	for (const name of parts) {
		let folder = index.entries.find(row =>
			row.kind === 'folder' && row.name === name && (row.parent_id || null) === parentId)
		if (!folder) {
			folder = normalizeEntry({
				kind: 'folder',
				name,
				parent_id: parentId,
				attrs: { hidden: false, system: true },
			}, entityHash)
			index.entries.push(folder)
		}
		parentId = folder.id
	}
	return parentId
}

/**
 * @param {string} root 根
 * @returns {Promise<Array<{ rel: string, full: string, size: number, mtime: number }>>} 文件列表
 */
async function walkDisk(root) {
	/** @type {Array<{ rel: string, full: string, size: number, mtime: number }>} */
	const out = []
	/**
	 * @param {string} dir 目录
	 * @param {string} prefix 前缀
	 * @returns {Promise<void>}
	 */
	async function walk(dir, prefix) {
		let names
		try {
			names = await readdir(dir)
		}
		catch {
			return
		}
		for (const name of names) {
			const full = path.join(dir, name)
			const info = await stat(full)
			const rel = prefix ? `${prefix}/${name}` : name
			if (info.isDirectory()) await walk(full, rel)
			else out.push({ rel, full, size: info.size, mtime: info.mtimeMs })
		}
	}
	await walk(root, '')
	return out
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{ path?: string | null, interval_ms?: number }} binding 绑定
 * @returns {Promise<object>} 更新后的柜
 */
export async function setSyncBinding(username, entityHash, cabinetId, binding) {
	const sync_binding = binding?.path
		? {
			path: String(binding.path),
			interval_ms: Number(binding.interval_ms) || 60_000,
		}
		: null
	return updateCabinet(username, entityHash, cabinetId, { sync_binding })
}
