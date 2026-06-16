/**
 * 【文件】files/chunkLruEvict.mjs
 * 【职责】淘汰 refcount 为 0 的本地 `local:` 分块文件（§10.4 LRU），释放磁盘。
 * 【原理】loadChunkRefcounts 得活跃 locator 集；扫描 chunks/*.bin 孤儿按 mtime 排序删除至多 maxOrphans。
 * 【数据结构】返回 { evicted }；DEFAULT_MAX_ORPHAN_CHUNKS=512。
 * 【关联】chunkRefcount、storage local 插件；周期 GC 或上传后触发。
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { groupDir } from '../lib/paths.mjs'
import { getStorage } from '../storage.mjs'

import { loadChunkRefcounts } from './chunkRefcount.mjs'

const DEFAULT_MAX_ORPHAN_CHUNKS = 512

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} chunks 目录
 */
function localChunksDir(username, groupId) {
	return join(groupDir(username, groupId), 'chunks')
}

/**
 * 本节点 refcount 为 0 的本地分块 LRU 淘汰（§10.4；仅 `local:` 插件）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ maxOrphans?: number }} [opts] 单次最多删除块数
 * @returns {Promise<{ evicted: number }>} 删除计数
 */
export async function evictUnreferencedLocalChunks(username, groupId, opts = {}) {
	const maxEvict = Math.max(1, Math.min(2000, Number(opts.maxOrphans) || DEFAULT_MAX_ORPHAN_CHUNKS))
	const refTable = await loadChunkRefcounts(username, groupId)
	const activeLocs = new Set(Object.keys(refTable))

	let dir
	try {
		dir = localChunksDir(username, groupId)
		await stat(dir)
	}
	catch {
		return { evicted: 0 }
	}

	const names = await readdir(dir)
	/** @type {{ name: string, mtimeMs: number }[]} */
	const orphans = []
	for (const name of names) {
		if (!name.endsWith('.bin')) continue
		const locator = `local:${groupId}/chunks/${name}`
		if (activeLocs.has(locator)) continue
		const st = await stat(join(dir, name))
		orphans.push({ name, mtimeMs: st.mtimeMs })
	}
	orphans.sort((a, b) => a.mtimeMs - b.mtimeMs)
	const plugin = getStorage(username)
	let evicted = 0
	for (const row of orphans.slice(0, maxEvict)) {
		const locator = `local:${groupId}/chunks/${row.name}`
		try {
			if (typeof plugin.deleteChunk === 'function')
				await plugin.deleteChunk(locator)
			else
				await unlink(join(dir, row.name))
			evicted++
		}
		catch { /* ignore */ }
	}
	return { evicted }
}
