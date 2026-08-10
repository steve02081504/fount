import { readFile, writeFile, mkdir } from 'node:fs/promises'

import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { indexDocument, getShardMeta, queryIndex, removeDocument, loadActiveDocs } from '../../../../../scripts/search/invertedIndex.mjs'

import { socialPostKey } from './federation/post_key.mjs'
import { extractHashtagsFromText } from './lib/hashtags.mjs'
import { postMatchesQuery } from './lib/postQuery.mjs'
import {
	socialReplyIndexPath,
	socialSearchIndexPath,
	socialTrendingIndexPath,
} from './paths.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'
import { listLocalTimelineDirs } from './timeline/ownerIndex.mjs'
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
 * @returns {Promise<object | null>} 原始趋势文件
 */
async function readTrendingFile(username) {
	try {
		return JSON.parse(await readFile(socialTrendingIndexPath(username), 'utf8'))
	}
	catch {
		return null
	}
}

/**
 * @param {unknown} raw 原始趋势文件
 * @returns {Record<string, number> | null} 合法计数表；否则 null
 */
function parseTrendingCounts(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	/** @type {Record<string, number>} */
	const counts = {}
	for (const [tag, count] of Object.entries(raw)) {
		if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
		if (count) counts[tag] = count
	}
	return counts
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
 * 从本地物化时间线重建话题计数（跳过 Markdown 代码区）。
 * @param {string} username replica
 * @returns {Promise<Record<string, number>>} 重建后的计数
 */
async function rebuildTrendingCounts(username) {
	/** @type {Record<string, number>} */
	const counts = {}
	for (const owner of await listLocalTimelineDirs(username)) {
		const view = await getTimelineMaterialized(username, owner)
		for (const post of view.posts || []) {
			const content = await maybeDecryptPostContent(username, owner, post.content)
			if (!content?.text) continue
			for (const tag of extractHashtagsFromText(content.text))
				counts[tag] = (counts[tag] || 0) + 1
		}
	}
	return counts
}

/**
 * 读取话题计数；文件缺失返回空，形状不对则扔掉重建。
 * @param {string} username replica
 * @returns {Promise<Record<string, number>>} 话题计数
 */
async function loadTrendingCounts(username) {
	return withAsyncMutex(`social-trending:${username}`, async () => {
		const raw = await readTrendingFile(username)
		if (raw == null) return {}
		const parsed = parseTrendingCounts(raw)
		if (parsed) return { ...parsed }

		const counts = await rebuildTrendingCounts(username)
		await writeTrendingCounts(username, counts)
		return counts
	})
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
		const raw = await readTrendingFile(username)
		const parsed = parseTrendingCounts(raw)
		if (raw != null && !parsed) {
			await writeTrendingCounts(username, await rebuildTrendingCounts(username))
			return
		}
		/** @type {Record<string, number>} */
		const counts = parsed ? { ...parsed } : {}
		for (const tag of tags) {
			const next = Math.max(0, (counts[tag] || 0) + delta)
			if (next) counts[tag] = next
			else delete counts[tag]
		}
		await writeTrendingCounts(username, counts)
	})
}

/**
 * 按新旧正文差量调整 trending（空话题自动从计数表删除）。
 * @param {string} username replica
 * @param {string} [oldText] 旧正文
 * @param {string} [newText] 新正文
 * @returns {Promise<void>}
 */
async function reconcileTrendingTags(username, oldText, newText) {
	const before = new Set(oldText ? extractHashtagsFromText(oldText) : [])
	const after = new Set(newText ? extractHashtagsFromText(newText) : [])
	const removed = [...before].filter(tag => !after.has(tag))
	const added = [...after].filter(tag => !before.has(tag))
	if (removed.length) await bumpTrendingTags(username, removed, -1)
	if (added.length) await bumpTrendingTags(username, added, 1)
}

/**
 * 生成帖子的搜索索引字段。
 * @param {string} ownerEntityHash 作者
 * @param {string} postId 帖 ID
 * @param {object} [content] 帖正文
 * @returns {object} 索引 fields
 */
function postIndexFields(ownerEntityHash, postId, content) {
	const replyTo = content?.replyTo
	return {
		entityHash: ownerEntityHash,
		postId,
		...replyTo?.entityHash && replyTo?.postId
			? { replyToEntityHash: replyTo.entityHash, replyToPostId: replyTo.postId }
			: {},
	}
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
	/** @type {string[]} */
	const pendingTags = []
	for (const post of view.posts || []) {
		const content = await maybeDecryptPostContent(username, ownerEntityHash, post.content)
		if (!content?.text) continue
		await indexDocument(indexDir, ownerEntityHash, {
			id: post.id,
			text: content.text,
			ts: Number(post.hlc?.wall || Date.now()),
			fields: postIndexFields(ownerEntityHash, post.id, content),
		})
		const replyTo = content.replyTo
		if (replyTo?.entityHash && replyTo?.postId)
			await indexReplyRef(username, ownerEntityHash, post.id, replyTo.entityHash, replyTo.postId, Number(post.hlc?.wall || Date.now()))
		pendingTags.push(...extractHashtagsFromText(content.text))
	}
	await withAsyncMutex(`social-trending:${username}`, async () => {
		const raw = await readTrendingFile(username)
		const parsed = parseTrendingCounts(raw)
		if (raw != null && !parsed) {
			await writeTrendingCounts(username, await rebuildTrendingCounts(username))
			return
		}
		if (!pendingTags.length) return
		/** @type {Record<string, number>} */
		const counts = parsed ? { ...parsed } : {}
		for (const tag of pendingTags)
			counts[tag] = (counts[tag] || 0) + 1
		await writeTrendingCounts(username, counts)
	})
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
		if (!postId) return
		const docs = await loadActiveDocs(indexDir, owner)
		const doc = docs.get(postId)
		if (doc) await unindexDeletedPost(username, owner, {
			id: postId,
			content: {
				text: doc.text,
				replyTo: doc.fields?.replyToEntityHash && doc.fields?.replyToPostId
					? {
						entityHash: doc.fields.replyToEntityHash,
						postId: doc.fields.replyToPostId,
					}
					: undefined,
			},
		})

		await removeDocument(indexDir, owner, postId)
		return
	}

	if (row.type === 'post_edit') {
		const postId = String(row.content?.targetPostId || '').trim()
		if (!postId) return
		const content = await maybeDecryptPostContent(username, owner, row.content)
		if (!content?.text) return
		const docs = await loadActiveDocs(indexDir, owner)
		const oldText = docs.get(postId)?.text || ''
		await indexDocument(indexDir, owner, {
			id: postId,
			text: content.text,
			ts: Number(row.hlc?.wall || row.timestamp || Date.now()),
			fields: postIndexFields(owner, postId, content),
		})
		await reconcileTrendingTags(username, oldText, content.text)
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
		fields: postIndexFields(owner, postId, content),
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
 * @returns {Promise<{ tags: { tag: string, count: number }[] }>} 热门话题（显示时核活并补满）
 */
export async function readTrendingHashtagCounts(username, limit = 12) {
	return withAsyncMutex(`social-trending:${username}`, async () => {
		const raw = await readTrendingFile(username)
		if (raw == null) return { tags: [] }
		let parsed = parseTrendingCounts(raw)
		if (!parsed) {
			parsed = await rebuildTrendingCounts(username)
			await writeTrendingCounts(username, parsed)
		}
		const ranked = Object.entries(parsed)
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		if (!ranked.length) return { tags: [] }

		// 显示路径：一遍扫帖，去掉当前提取规则下已无帖的登记；再按原排名取满 limit。
		const pending = new Set(ranked.map(([tag]) => tag))
		for (const owner of await listLocalTimelineDirs(username)) {
			if (!pending.size) break
			const view = await getTimelineMaterialized(username, owner)
			for (const post of view.posts || []) {
				if (!pending.size) break
				const content = await maybeDecryptPostContent(username, owner, post.content)
				if (!content?.text) continue
				for (const tag of extractHashtagsFromText(content.text))
					pending.delete(tag)
			}
		}
		if (pending.size) {
			const next = { ...parsed }
			for (const tag of pending) delete next[tag]
			await writeTrendingCounts(username, next)
			parsed = next
		}

		return {
			tags: ranked
				.filter(([tag]) => !pending.has(tag))
				.slice(0, limit)
				.map(([tag, count]) => ({ tag, count })),
		}
	})
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
