/**
 * 联邦帖文 part_query 出站行与入站清洗（discover / search 共用）。
 */
import { isPublicDiscoverable } from '../lib/visibilitySpec.mjs'

/**
 * 出站：把本机帖压成联邦查询行。
 * @param {object} post 物化帖
 * @param {string} entityHash 作者
 * @param {string} nodeHash 本节点
 * @param {{ visibilityMode?: 'public' | 'preserve' }} [options] visibility 策略
 * @returns {object | null} 查询行；缺字段时 null
 */
export function federatedPostQueryRow(post, entityHash, nodeHash, options = {}) {
	const postId = String(post?.id || '').trim()
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!post || !postId || !hash) return null
	const visibilityMode = options.visibilityMode === 'preserve' ? 'preserve' : 'public'
	const visibility = visibilityMode === 'public' || isPublicDiscoverable(post.content)
		? 'public'
		: post.content?.visibility
	return {
		entityHash: hash,
		postId,
		text: String(post.content?.text || '').slice(0, 500),
		hlc: post.hlc || null,
		mediaRefs: (post.content?.mediaRefs || []).slice(0, 4),
		nodeHash: String(nodeHash || '').toLowerCase(),
		event: {
			id: post.id,
			type: 'post',
			content: {
				text: post.content?.text,
				mediaRefs: post.content?.mediaRefs,
				visibility,
				tags: post.content?.tags,
			},
			hlc: post.hlc,
			timestamp: post.timestamp,
			signer: post.signer,
			signature: post.signature,
		},
	}
}

/**
 * 入站清洗：仅公开可见摘录，截断文本/媒体/标签。
 * @param {unknown} raw 网络行
 * @param {{ mediaOnly?: boolean }} [options] 过滤
 * @returns {{ entityHash: string, postId: string, event: object, nodeHash: string, hlc: unknown } | null} 清洗行
 */
export function sanitizeFederatedPostQueryRow(raw, options = {}) {
	if (!raw || typeof raw !== 'object') return null
	const entityHash = String(/** @type {{ entityHash?: unknown }} */raw.entityHash || '').trim().toLowerCase()
	const postId = String(/** @type {{ postId?: unknown }} */raw.postId || '').trim()
	const event = /** @type {{ event?: object }} */raw.event
	if (!entityHash || !postId || !event) return null
	if (!isPublicDiscoverable(event.content)) return null
	if (options.mediaOnly && !(Array.isArray(event.content?.mediaRefs) && event.content.mediaRefs.length))
		return null
	return {
		entityHash,
		postId,
		hlc: event.hlc || /** @type {{ hlc?: unknown }} */raw.hlc || null,
		nodeHash: String(/** @type {{ nodeHash?: unknown }} */raw.nodeHash || '').toLowerCase(),
		event: {
			...event,
			id: postId,
			type: 'post',
			content: {
				text: String(event.content?.text || '').slice(0, 2000),
				mediaRefs: Array.isArray(event.content?.mediaRefs) ? event.content.mediaRefs.slice(0, 16) : [],
				visibility: 'public',
				tags: Array.isArray(event.content?.tags) ? event.content.tags.slice(0, 16) : undefined,
			},
		},
	}
}

/**
 * @param {unknown} row 查询行
 * @returns {string} 去重键
 */
export function federatedPostRowKey(row) {
	if (!row || typeof row !== 'object') return ''
	const entityHash = String(/** @type {{ entityHash?: unknown }} */row.entityHash || '').toLowerCase()
	const postId = String(/** @type {{ postId?: unknown }} */row.postId || '')
	return entityHash && postId ? `${entityHash}:${postId}` : ''
}
