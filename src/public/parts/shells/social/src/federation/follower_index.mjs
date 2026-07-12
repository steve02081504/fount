import path from 'node:path'

import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getNodeDir } from 'npm:@steve02081504/fount-p2p/node/instance'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { getFollowingScanProvider, getOperatorEntityHashProvider, getReplicaUsernamesProvider } from './follower_index_registry.mjs'

const FOLLOWER_ENTRY_CACHE_MAX = 512
const BUCKET_HEX_PREFIX_LEN = 2

/** @type {ReturnType<typeof createLruMap<string, string[]>>} */
const followerEntryCache = createLruMap(FOLLOWER_ENTRY_CACHE_MAX)

/**
 * @param {string} target targetEntityHash
 * @param {() => Promise<void>} task 突变
 * @returns {Promise<void>}
 */
function queueFollowerIndexMutation(target, task) {
	return withAsyncMutex(`follower-index:${target}`, () => task().catch(err => {
		console.error('follower_index: mutation failed', err)
	}))
}

/**
 * @returns {string} follower 索引根目录
 */
function followerIndexDir() {
	return path.join(getNodeDir(), 'social', 'follower_index')
}

/**
 * @returns {string} 按 hash 前两字符分桶的目录
 */
function followerBucketsDir() {
	return path.join(followerIndexDir(), 'buckets')
}

/**
 * @param {string} targetEntityHash 128 hex
 * @returns {string} 分桶 id（hex 前缀）
 */
function followerBucketId(targetEntityHash) {
	return targetEntityHash.slice(0, BUCKET_HEX_PREFIX_LEN)
}

/**
 * @param {string} bucketId 分桶 id
 * @returns {string} 桶文件路径（多 target 合并为单 JSON，避免百万 inode）
 */
function followerBucketPath(bucketId) {
	return path.join(followerBucketsDir(), `${bucketId}.json`)
}

/**
 * @param {string} bucketId 分桶 id
 * @returns {Promise<Record<string, string[]>>} target → replica 登录名列表
 */
async function readFollowerBucket(bucketId) {
	const { readFile } = await import('node:fs/promises')
	try {
		return JSON.parse(await readFile(followerBucketPath(bucketId), 'utf8'))
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		return {}
	}
}

/**
 * @param {string} bucketId 分桶 id
 * @param {Record<string, string[]>} bucket target → followers
 * @returns {Promise<void>}
 */
async function writeFollowerBucket(bucketId, bucket) {
	const { mkdir, unlink } = await import('node:fs/promises')
	const dir = followerBucketsDir()
	await mkdir(dir, { recursive: true })
	const keys = Object.keys(bucket)
	if (!keys.length) {
		try {
			await unlink(followerBucketPath(bucketId))
		}
		catch { /* missing */ }
		return
	}
	await writeJsonAtomic(followerBucketPath(bucketId), bucket)
}

/**
 * @param {string} target 128 hex
 * @returns {Promise<string[]>} 关注该 target 的 replica 登录名（缓存数组勿原地修改）
 */
async function readFollowerEntry(target) {
	const cached = followerEntryCache.get(target)
	if (cached) {
		followerEntryCache.touch(target, cached)
		return cached
	}
	const bucket = await readFollowerBucket(followerBucketId(target))
	const followers = bucket[target] ? [...bucket[target]] : []
	followerEntryCache.touch(target, followers)
	return followers
}

/**
 * @param {string} target 128 hex
 * @param {string[]} followers replica 登录名
 * @returns {Promise<void>}
 */
async function writeFollowerEntry(target, followers) {
	const bucketId = followerBucketId(target)
	const bucket = await readFollowerBucket(bucketId)
	if (!followers.length) {
		delete bucket[target]
		followerEntryCache.delete(target)
	}
	else {
		const list = [...new Set(followers)]
		bucket[target] = list
		followerEntryCache.touch(target, list)
	}
	await writeFollowerBucket(bucketId, bucket)
}

/**
 * follow/unfollow 后更新反向索引（operator 时间线为真相源，此为查询投影）。
 * @param {string} username replica 登录名
 * @param {string} targetEntityHash 被关注实体
 * @param {boolean} follow true=关注
 * @returns {Promise<void>}
 */
export async function updateFollowerIndex(username, targetEntityHash, follow) {
	const target = targetEntityHash.toLowerCase()
	await queueFollowerIndexMutation(target, async () => {
		const set = new Set(await readFollowerEntry(target))
		if (follow) set.add(username)
		else set.delete(username)
		await writeFollowerEntry(target, [...set])
	})
}

/**
 * operator 时间线 follow/unfollow 事件写入后更新反向索引投影。
 * @param {string} replicaUsername replica 登录名
 * @param {string} timelineOwnerEntityHash 时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function projectFollowerIndexFromTimelineEvent(replicaUsername, timelineOwnerEntityHash, event) {
	if (!['follow', 'unfollow'].includes(event.type)) return
	const resolveOperator = getOperatorEntityHashProvider()
	if (!resolveOperator) return
	const operator = await resolveOperator(replicaUsername)
	if (!operator) return
	const owner = timelineOwnerEntityHash.toLowerCase()
	if (owner !== operator.toLowerCase()) return
	await updateFollowerIndex(
		replicaUsername,
		event.content.targetEntityHash.toLowerCase(),
		event.type === 'follow',
	)
}

/**
 * 哪些本实例 replica 关注了 target（分桶 JSON + LRU，不常驻全量索引）。
 * @param {string} entityHash 被关注实体
 * @returns {Promise<string[]>} replica 登录名
 */
export async function listReplicaUsernamesFollowing(entityHash) {
	const target = entityHash.toLowerCase()
	if (!parseEntityHash(target)) return []
	return readFollowerEntry(target)
}

/**
 * 冷启动：扫描本实例全部 replica operator 时间线，重建 follower 投影（按 hash 前缀分桶）。
 * @returns {Promise<void>}
 */
export async function rebuildFollowerIndex() {
	const scanFollowing = getFollowingScanProvider()
	const listUsers = getReplicaUsernamesProvider()
	const resolveOperator = getOperatorEntityHashProvider()
	if (!scanFollowing || !listUsers || !resolveOperator) return
	/** @type {Record<string, Record<string, Set<string>>>} */
	const scratch = {}
	for (const username of listUsers()) {
		const operator = await resolveOperator(username)
		if (!operator) continue
		for (const rawTarget of await scanFollowing(username)) {
			const target = rawTarget.toLowerCase()
			if (!parseEntityHash(target)) continue
			const bucketId = followerBucketId(target)
			scratch[bucketId] ??= {}
			scratch[bucketId][target] ??= new Set()
			scratch[bucketId][target].add(username)
		}
	}
	const { mkdir, readdir, unlink } = await import('node:fs/promises')
	const bucketsDir = followerBucketsDir()
	await mkdir(bucketsDir, { recursive: true })
	for (const name of await readdir(bucketsDir).catch(() => [])) {
		if (!name.endsWith('.json')) continue
		await unlink(path.join(bucketsDir, name)).catch(() => {})
	}
	followerEntryCache.clear()
	for (const [bucketId, targets] of Object.entries(scratch)) {
		/** @type {Record<string, string[]>} */
		const bucket = {}
		for (const [target, set] of Object.entries(targets))
			bucket[target] = [...set]
		await writeFollowerBucket(bucketId, bucket)
		for (const [target, list] of Object.entries(bucket))
			followerEntryCache.touch(target, list)
	}
}
