import { readFile, writeFile, mkdir } from 'node:fs/promises'

import { socialPostKey } from './federation/post_key.mjs'
import { withAsyncMutex } from '../../../../../scripts/p2p/utils/async_mutex.mjs'
import { indexDocument, getShardMeta, queryIndex, removeDocument } from '../../../../../scripts/search/invertedIndex.mjs'

import { extractHashtagsFromText } from './lib/hashtags.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import {
	socialReplyIndexPath,
	socialSearchIndexPath,
	socialTrendingIndexPath,
} from './paths.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'
import { maybeDecryptPostContent } from './vault_crypto/vault.mjs'

/**
 * @param {string} username replica
 * @returns {Promise<Record<string, object[]>>} reply 反向索引
 */
async function readReplyIndex(username) {
	try {
		return JSON.parse(await readFile(socialReplyIndexPath(username), 'utf8'))
	}
	catch {
		return {}
	}
}

/**
 * @param {string} username replica
 * @param {Record<string, object[]>} index reply 索引
 * @returns {Promise<void>}
 */
async function writeReplyIndex(username, index) {
	await mkdir(socialSearchIndexPath(username), { recursive: true })
	await writeFile(socialReplyIndexPath(username), `${JSON.stringify(index)}\n`, 'utf8')
}

/**
 * @param {string} username replica
 * @returns {Promise<Record<string, number>>} 话题计数
 */
async function readTrendingCounts(username) {
	try {
		return JSON.parse(await readFile(socialTrendingIndexPath(username), 'utf8'))
	}
	catch {
		return {}
	}
}

/**
 * @param {string} username replica
 * @param {Record<string, number>} counts 计数
 * @returns {Promise<void>}
 */
async function writeTrendingCounts(username, counts) {
	await mkdir(socialSearchIndexPath(username), { recursive: true })
	await writeFile(socialTrendingIndexPath(username), `${JSON.stringify(counts)}\n`, 'utf8')
}

/**
 * @param {string} username replica
 * @param {string[]} tags 话题
 * @param {number} delta 增量
 * @returns {Promise<void>}
 */
async function bumpTrendingTags(username, tags, delta) {
	if (!tags.length || !delta) return
	await withAsyncMutex(`social-trending:${username}`, async () => {
		const counts = await readTrendingCounts(username)
		for (const tag of tags) {
			const next = Math.max(0, (counts[tag] || 0) + delta)
			if (next) counts[tag] = next
			else delete counts[tag]
		}
		await writeTrendingCounts(username, counts)
	})
}

/**
 * @param {string} username replica
 * @param {string} ownerEntityHash 时间线 owner
 * @returns {Promise<void>}
 */
async function ensureTimelineIndexed(username, ownerEntityHash) {
	const indexDir = socialSearchIndexPath(username)
	const meta = await getShardMeta(indexDir, ownerEntityHash)
	if ((meta.docCount || 0) > 0) return
	const view = await getTimelineMaterialized(username, ownerEntityHash)
	for (const post of view.posts || []) {
		const content = await maybeDecryptPostContent(username, ownerEntityHash, post.content)
		if (!content?.text) continue
		await indexDocument(indexDir, ownerEntityHash, {
			id: post.id,
			text: content.text,
			ts: Number(post.hlc?.wall || Date.now()),
			fields: { entityHash: ownerEntityHash, postId: post.id },
		})
		const replyTo = content.replyTo
		if (replyTo?.entityHash && replyTo?.postId)
			await indexReplyRef(username, ownerEntityHash, post.id, replyTo.entityHash, replyTo.postId, Number(post.hlc?.wall || Date.now()))
		for (const tag of extractHashtagsFromText(content.text))
			await bumpTrendingTags(username, [tag], 1)
	}
}

/**
 * @param {string} username replica
 * @param {string} replyEntityHash 回复作者
 * @param {string} replyPostId 回复帖 ID
 * @param {string} targetEntityHash 被回复作者
 * @param {string} targetPostId 被回复帖 ID
 * @param {number} ts 时间戳
 * @returns {Promise<void>}
 */
async function indexReplyRef(username, replyEntityHash, replyPostId, targetEntityHash, targetPostId, ts) {
	const key = socialPostKey(targetEntityHash, targetPostId)
	await withAsyncMutex(`social-reply-index:${username}`, async () => {
		const index = await readReplyIndex(username)
		const list = index[key] || []
		const ref = { entityHash: replyEntityHash.toLowerCase(), postId: replyPostId, ts }
		if (!list.some(row => row.entityHash === ref.entityHash && row.postId === ref.postId))
			index[key] = [...list, ref]
		await writeReplyIndex(username, index)
	})
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 被回复作者
 * @param {string} targetPostId 被回复帖 ID
 * @param {string} replyEntityHash 回复作者
 * @param {string} replyPostId 回复帖 ID
 * @returns {Promise<void>}
 */
async function removeReplyRef(username, targetEntityHash, targetPostId, replyEntityHash, replyPostId) {
	const key = socialPostKey(targetEntityHash, targetPostId)
	await withAsyncMutex(`social-reply-index:${username}`, async () => {
		const index = await readReplyIndex(username)
		const list = index[key] || []
		index[key] = list.filter(row => !(row.entityHash === replyEntityHash.toLowerCase() && row.postId === replyPostId))
		if (!index[key].length) delete index[key]
		await writeReplyIndex(username, index)
	})
}

/**
 * 时间线事件落盘后的搜索索引增量更新。
 * @param {string} username replica
 * @param {string} entityHash 时间线 owner
 * @param {object} row 签名事件
 * @returns {Promise<void>}
 */
export async function indexTimelineEventForSearch(username, entityHash, row) {
	const owner = entityHash.toLowerCase()
	const indexDir = socialSearchIndexPath(username)

	if (row.type === 'post_delete') {
		const postId = String(row.content?.targetPostId || row.content?.postId || '').trim()
		if (postId) await removeDocument(indexDir, owner, postId)
		return
	}

	if (row.type !== 'post') return
	const postId = String(row.id || '').trim()
	if (!postId) return

	const content = await maybeDecryptPostContent(username, owner, row.content)
	if (!content?.text) return

	await indexDocument(indexDir, owner, {
		id: postId,
		text: content.text,
		ts: Number(row.hlc?.wall || row.timestamp || Date.now()),
		fields: { entityHash: owner, postId },
	})

	const tags = extractHashtagsFromText(content.text)
	if (tags.length) await bumpTrendingTags(username, tags, 1)

	const replyTo = content.replyTo
	if (replyTo?.entityHash && replyTo?.postId)
		await indexReplyRef(username, owner, postId, replyTo.entityHash, replyTo.postId, Number(row.hlc?.wall || Date.now()))
}

/**
 * @param {string} username replica
 * @param {string[]} ownerEntityHashes 候选 owner 列表
 * @param {string} query 查询
 * @param {number} limit 上限
 * @returns {Promise<Array<{ entityHash: string, postId: string, ts: number, text: string }>>} 索引命中
 */
export async function querySocialPostIndex(username, ownerEntityHashes, query, limit) {
	const indexDir = socialSearchIndexPath(username)
	for (const owner of ownerEntityHashes)
		await ensureTimelineIndexed(username, owner)

	/** @param {object} doc 索引文档
	 *  @returns {boolean} 是否通过子串真值校验 */
	const verifyHit = doc => postMatchesQuery({ content: { text: doc.text }, entityHash: doc.fields?.entityHash }, query)

	return queryIndex({
		indexDir,
		shardKeys: ownerEntityHashes,
		query,
		limit: limit * 3,
		verify: verifyHit,
	}).then(hits => hits.slice(0, limit).map(hit => ({
		entityHash: hit.fields?.entityHash || hit.shardKey,
		postId: hit.fields?.postId || hit.id,
		ts: hit.ts,
		text: hit.text,
	})))
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 被回复作者
 * @param {string} targetPostId 被回复帖 ID
 * @returns {Promise<Array<{ entityHash: string, postId: string, ts: number }>>} 回复引用列表
 */
export async function queryReplyIndex(username, targetEntityHash, targetPostId) {
	const key = socialPostKey(targetEntityHash, targetPostId)
	const index = await readReplyIndex(username)
	return (index[key] || []).slice().sort((a, b) => Number(b.ts) - Number(a.ts))
}

/**
 * @param {string} username replica
 * @param {number} limit 条数
 * @returns {Promise<{ tags: { tag: string, count: number }[] }>} 热门话题计数
 */
export async function readTrendingHashtagCounts(username, limit = 12) {
	const counts = await readTrendingCounts(username)
	const tags = Object.entries(counts)
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }))
	return { tags }
}

/**
 * post 删除时清理 reply 索引与 trending。
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {object} post 物化帖
 * @returns {Promise<void>}
 */
export async function unindexDeletedPost(username, entityHash, post) {
	const content = post?.content
	if (content?.text) {
		const tags = extractHashtagsFromText(content.text)
		if (tags.length) await bumpTrendingTags(username, tags, -1)
	}
	const replyTo = content?.replyTo
	if (replyTo?.entityHash && replyTo?.postId)
		await removeReplyRef(username, replyTo.entityHash, replyTo.postId, entityHash, post.id)
}
