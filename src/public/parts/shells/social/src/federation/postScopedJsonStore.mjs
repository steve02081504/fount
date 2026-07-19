/**
 * 逐帖 JSON 投影（note / poll / reaction）共用脚手架。
 */
import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

import { socialPostKey } from './post_key.mjs'

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {{ target: string, postId: string } | null} 规范化键
 */
export function normalizePostTarget(targetEntityHash, postId) {
	const target = String(targetEntityHash || '').trim().toLowerCase()
	const id = normalizeHex64(String(postId || '').trim())
	if (!parseEntityHash(target) || !isHex64(id)) return null
	return { target, postId: id }
}

/**
 * @template T
 * @param {object} options 配置
 * @param {string} options.dirName shells/social 子目录
 * @param {() => T} options.empty 空投影工厂
 * @param {(raw: object | null | undefined) => T} options.normalize 读盘规范化
 * @param {number} [options.cacheMax=512] LRU 容量
 * @param {string} [options.mutexPrefix] mutex 前缀
 * @returns {{ filePath: Function, read: Function, write: Function, withMutex: Function }} 存储
 */
export function createPostScopedJsonStore({
	dirName,
	empty,
	normalize,
	cacheMax = 512,
	mutexPrefix = dirName,
}) {
	/** @type {ReturnType<typeof createLruMap<string, T>>} */
	const cache = createLruMap(cacheMax)

	/**
	 * @param {string} username replica
	 * @param {string} targetEntityHash 帖作者
	 * @param {string} postId 帖 id
	 * @returns {string} 路径
	 */
	function filePath(username, targetEntityHash, postId) {
		const ids = normalizePostTarget(targetEntityHash, postId)
		if (!ids) throw new Error(`invalid ${dirName} target`)
		return path.join(getUserDictionary(username), 'shells/social', dirName, ids.target, `${ids.postId}.json`)
	}

	/**
	 * @param {string} username replica
	 * @param {string} targetEntityHash 帖作者
	 * @param {string} postId 帖 id
	 * @returns {Promise<T>} 投影
	 */
	async function read(username, targetEntityHash, postId) {
		const ids = normalizePostTarget(targetEntityHash, postId)
		if (!ids) return empty()
		const key = socialPostKey(ids.target, ids.postId)
		const cached = cache.get(key)
		if (cached) {
			cache.touch(key, cached)
			return cached
		}
		const { readFile } = await import('node:fs/promises')
		try {
			const normalized = normalize(JSON.parse(await readFile(filePath(username, ids.target, ids.postId), 'utf8')))
			cache.touch(key, normalized)
			return normalized
		}
		catch (err) {
			if (err?.code !== 'ENOENT') throw err
			const blank = empty()
			cache.touch(key, blank)
			return blank
		}
	}

	/**
	 * @param {string} username replica
	 * @param {string} targetEntityHash 帖作者
	 * @param {string} postId 帖 id
	 * @param {T} data 投影
	 * @returns {Promise<void>}
	 */
	async function write(username, targetEntityHash, postId, data) {
		const ids = normalizePostTarget(targetEntityHash, postId)
		if (!ids) return
		const key = socialPostKey(ids.target, ids.postId)
		const { mkdir } = await import('node:fs/promises')
		const file = filePath(username, ids.target, ids.postId)
		await mkdir(path.dirname(file), { recursive: true })
		await writeJsonAtomic(file, data)
		cache.touch(key, data)
	}

	/**
	 * @param {string} targetEntityHash 帖作者
	 * @param {string} postId 帖 id
	 * @param {() => Promise<void>} fn 临界区
	 * @returns {Promise<void>}
	 */
	function withMutex(targetEntityHash, postId, fn) {
		const ids = normalizePostTarget(targetEntityHash, postId)
		if (!ids) return Promise.resolve()
		return withAsyncMutex(`${mutexPrefix}:${socialPostKey(ids.target, ids.postId)}`, fn)
	}

	return { filePath, read, write, withMutex }
}
