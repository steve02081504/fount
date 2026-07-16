import { reduceEntityKeyRevoke, reduceEntityKeyRotate } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'

import { socialPostKey } from '../federation/post_key.mjs'
import { normalizeVisibilitySpec, visibilitySpecToContentFields } from '../lib/visibilitySpec.mjs'

/** 虚拟默认相册 id（无事件、不参与密级派生） */
export const DEFAULT_ALBUM_ID = 'default'

/**
 * Social 时间线物化 reducer 表。
 */

/**
 * @returns {object} social 时间线物化初始状态
 */
export function createSocialTimelineState() {
	return {
		socialMeta: {},
		posts: new Map(),
		postEdits: new Map(),
		deletedPostIds: new Set(),
		likes: new Map(),
		dislikes: new Map(),
		pollVotes: new Map(),
		reposts: [],
		followEvents: [],
		following: new Set(),
		blocked: new Set(),
		/** @type {Set<string>} */
		followedTags: new Set(),
		/** @type {Map<string, Set<string>>} targetPostId → featured reply keys */
		featuredReplies: new Map(),
		/** @type {Map<string, object>} liveId → live_start event */
		activeLives: new Map(),
		/** @type {Map<string, Record<string, string>>} tagHash → locale → label */
		tagNames: new Map(),
		/** @type {Map<string, object>} albumId → album */
		albums: new Map(),
		/** @type {Map<string, Set<string>>} postId → albumIds */
		albumsByPost: new Map(),
		entityKeyHistory: [],
		recoveryPubKeyHex: null,
	}
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceSocialMeta(state, event) {
	Object.assign(state.socialMeta, event.content)
	if (event.content?.recoveryPubKeyHex)
		state.recoveryPubKeyHex = String(event.content.recoveryPubKeyHex).trim().toLowerCase()
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reducePost(state, event) {
	state.posts.set(event.id, { ...event, postId: event.id })
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reducePostDelete(state, event) {
	const postId = event.content.targetPostId
	state.deletedPostIds.add(postId)
	const albumIds = state.albumsByPost.get(postId)
	if (albumIds) {
		for (const albumId of albumIds) {
			const album = state.albums.get(albumId)
			if (album) album.postIds = album.postIds.filter(id => id !== postId)
		}
		state.albumsByPost.delete(postId)
	}
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reducePostVisibilitySet(state, event) {
	const targetPostId = event.content?.targetPostId
	if (!targetPostId) return state
	const base = state.posts.get(targetPostId)
	if (!base) return state
	const nextContent = event.content?.content
	if (!nextContent || typeof nextContent !== 'object') return state
	// 完整 content 快照已含历史编辑；清空 postEdits 避免 finalize 把明文 patch 叠到密文信封上
	state.postEdits.delete(targetPostId)
	state.posts.set(targetPostId, {
		...base,
		content: nextContent,
		edited: base.edited || Boolean(base.revisions?.length),
	})
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceAlbumCreate(state, event) {
	const albumId = String(event.content?.albumId || event.id || '').trim()
	if (!albumId || albumId === DEFAULT_ALBUM_ID) return state
	const spec = normalizeVisibilitySpec(event.content)
	state.albums.set(albumId, {
		albumId,
		name: String(event.content?.name || albumId).trim().slice(0, 80) || albumId,
		description: String(event.content?.description || '').trim().slice(0, 500),
		...visibilitySpecToContentFields(spec),
		postIds: [],
		createdEventId: event.id,
	})
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceAlbumUpdate(state, event) {
	const albumId = String(event.content?.albumId || '').trim()
	if (!albumId || albumId === DEFAULT_ALBUM_ID) return state
	const existing = state.albums.get(albumId)
	if (!existing) return reduceAlbumCreate(state, event)
	const spec = normalizeVisibilitySpec({ ...existing, ...event.content })
	const name = event.content?.name != null
		? String(event.content.name).trim().slice(0, 80) || existing.name
		: existing.name
	const description = event.content?.description != null
		? String(event.content.description).trim().slice(0, 500)
		: existing.description
	state.albums.set(albumId, {
		...existing,
		name,
		description,
		...visibilitySpecToContentFields(spec),
	})
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceAlbumDelete(state, event) {
	const albumId = String(event.content?.albumId || '').trim()
	if (!albumId || albumId === DEFAULT_ALBUM_ID) return state
	const album = state.albums.get(albumId)
	if (!album) return state
	for (const postId of album.postIds) {
		const set = state.albumsByPost.get(postId)
		if (!set) continue
		set.delete(albumId)
		if (!set.size) state.albumsByPost.delete(postId)
	}
	state.albums.delete(albumId)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceAlbumPostAdd(state, event) {
	const albumId = String(event.content?.albumId || '').trim()
	const postId = String(event.content?.postId || '').trim()
	if (!albumId || !postId || albumId === DEFAULT_ALBUM_ID) return state
	const album = state.albums.get(albumId)
	if (!album) return state
	if (!album.postIds.includes(postId)) album.postIds.push(postId)
	const set = state.albumsByPost.get(postId) || new Set()
	set.add(albumId)
	state.albumsByPost.set(postId, set)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceAlbumPostRemove(state, event) {
	const albumId = String(event.content?.albumId || '').trim()
	const postId = String(event.content?.postId || '').trim()
	if (!albumId || !postId) return state
	const album = state.albums.get(albumId)
	if (album) album.postIds = album.postIds.filter(id => id !== postId)
	const set = state.albumsByPost.get(postId)
	if (set) {
		set.delete(albumId)
		if (!set.size) state.albumsByPost.delete(postId)
	}
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reducePostEdit(state, event) {
	const targetPostId = event.content.targetPostId
	if (!targetPostId) return state
	const list = state.postEdits.get(targetPostId) || []
	list.push(event)
	state.postEdits.set(targetPostId, list)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reducePollVote(state, event) {
	const key = socialPostKey(event.content.targetEntityHash, event.content.targetPostId)
	state.pollVotes.set(key, {
		choices: [...event.content.choices || []],
		at: event.hlc?.wall || event.timestamp || Date.now(),
	})
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceLike(state, event) {
	const key = socialPostKey(event.content.targetEntityHash, event.content.targetPostId)
	state.likes.set(key, event)
	state.dislikes.delete(key)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceUnlike(state, event) {
	state.likes.delete(socialPostKey(event.content.targetEntityHash, event.content.targetPostId))
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceDislike(state, event) {
	const key = socialPostKey(event.content.targetEntityHash, event.content.targetPostId)
	state.dislikes.set(key, event)
	state.likes.delete(key)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceUndislike(state, event) {
	state.dislikes.delete(socialPostKey(event.content.targetEntityHash, event.content.targetPostId))
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceTagName(state, event) {
	const tagHash = String(event.content?.tagHash || '').trim().toLowerCase()
	const locale = String(event.content?.locale || '').trim()
	const label = String(event.content?.label || '').trim().slice(0, 64)
	if (!tagHash || !locale || !label) return state
	const existing = state.tagNames.get(tagHash) || {}
	state.tagNames.set(tagHash, { ...existing, [locale]: label })
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceRepost(state, event) {
	state.reposts.push(event)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceFollow(state, event) {
	state.following.add(event.content.targetEntityHash.toLowerCase())
	state.followEvents.push(event)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceUnfollow(state, event) {
	state.following.delete(event.content.targetEntityHash.toLowerCase())
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceTagFollow(state, event) {
	const tag = String(event.content?.tag || '').trim().toLowerCase()
	if (tag) state.followedTags.add(tag)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceTagUnfollow(state, event) {
	const tag = String(event.content?.tag || '').trim().toLowerCase()
	if (tag) state.followedTags.delete(tag)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceReplyFeature(state, event) {
	const targetPostId = String(event.content?.targetPostId || '').trim()
	const replier = String(event.content?.replierEntityHash || '').trim().toLowerCase()
	const replyPostId = String(event.content?.replyPostId || '').trim()
	if (!targetPostId || !replier || !replyPostId) return state
	const key = `${replier}:${replyPostId}`
	const set = state.featuredReplies.get(targetPostId) || new Set()
	set.add(key)
	state.featuredReplies.set(targetPostId, set)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceReplyUnfeature(state, event) {
	const targetPostId = String(event.content?.targetPostId || '').trim()
	const replier = String(event.content?.replierEntityHash || '').trim().toLowerCase()
	const replyPostId = String(event.content?.replyPostId || '').trim()
	if (!targetPostId || !replier || !replyPostId) return state
	const set = state.featuredReplies.get(targetPostId)
	if (!set) return state
	set.delete(`${replier}:${replyPostId}`)
	if (!set.size) state.featuredReplies.delete(targetPostId)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceLiveStart(state, event) {
	const liveId = String(event.content?.liveId || event.id || '').trim().toLowerCase()
	if (liveId) state.activeLives.set(liveId, event)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceLiveEnd(state, event) {
	const liveId = String(event.content?.liveId || '').trim().toLowerCase()
	if (liveId) state.activeLives.delete(liveId)
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceBlock(state, event) {
	state.blocked.add(event.content.targetEntityHash.toLowerCase())
	return state
}

/**
 * @param {object} state 折叠状态
 * @param {object} event DAG 事件
 * @returns {object} 更新后状态
 */
function reduceUnblock(state, event) {
	state.blocked.delete(event.content.targetEntityHash.toLowerCase())
	return state
}

/**
 * @param {object} state 物化状态
 * @returns {object} 原样返回
 */
function passthroughReducer(state) {
	return state
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const SOCIAL_TIMELINE_REDUCERS = {
	social_meta: reduceSocialMeta,
	post: reducePost,
	post_edit: reducePostEdit,
	post_delete: reducePostDelete,
	post_visibility_set: reducePostVisibilitySet,
	poll_vote: reducePollVote,
	post_note: passthroughReducer,
	note_vote: passthroughReducer,
	like: reduceLike,
	unlike: reduceUnlike,
	dislike: reduceDislike,
	undislike: reduceUndislike,
	tag_name: reduceTagName,
	repost: reduceRepost,
	follow: reduceFollow,
	unfollow: reduceUnfollow,
	tag_follow: reduceTagFollow,
	tag_unfollow: reduceTagUnfollow,
	reply_feature: reduceReplyFeature,
	reply_unfeature: reduceReplyUnfeature,
	live_start: reduceLiveStart,
	live_end: reduceLiveEnd,
	block: reduceBlock,
	unblock: reduceUnblock,
	entity_key_rotate: reduceEntityKeyRotate,
	entity_key_revoke: reduceEntityKeyRevoke,
	state_summary: reduceSocialMeta,
	file_share: passthroughReducer,
	follow_approve: passthroughReducer,
	album_create: reduceAlbumCreate,
	album_update: reduceAlbumUpdate,
	album_delete: reduceAlbumDelete,
	album_post_add: reduceAlbumPostAdd,
	album_post_remove: reduceAlbumPostRemove,
}

/**
 * @param {object} state materializeFromEvents 的原始折叠状态
 * @param {string[]} order 拓扑序 event id 列表
 * @returns {object} 对外物化视图
 */
export function finalizeSocialTimelineView(state, order) {
	for (const deletedId of state.deletedPostIds)
		state.posts.delete(deletedId)

	for (const [postId, edits] of state.postEdits.entries()) {
		const base = state.posts.get(postId)
		if (!base || !edits.length) continue
		const latest = edits[edits.length - 1]
		const { targetPostId: _ignored, ...patch } = latest.content || {}
		const revisions = edits.slice(0, -1).map(edit => ({
			text: edit.content?.text,
			mediaRefs: edit.content?.mediaRefs,
			contentWarning: edit.content?.contentWarning,
			locale: edit.content?.locale,
			at: edit.hlc?.wall || edit.timestamp,
			eventId: edit.id,
		}))
		state.posts.set(postId, {
			...base,
			content: { ...base.content, ...patch },
			edited: true,
			revisions,
		})
	}

	const visiblePosts = [...state.posts.values()]
		.sort((earlierPost, laterPost) => {
			const earlierWall = earlierPost.hlc?.wall || 0
			const laterWall = laterPost.hlc?.wall || 0
			if (earlierWall !== laterWall) return laterWall - earlierWall
			return laterPost.id.localeCompare(earlierPost.id)
		})

	const linkedPostIds = new Set(state.albumsByPost.keys())
	const defaultPostIds = visiblePosts
		.filter(post => {
			if (linkedPostIds.has(post.id)) return false
			if (post.content?.hasMedia) return true
			const refs = post.content?.mediaRefs
			return Array.isArray(refs) && refs.length > 0
		})
		.map(post => post.id)

	const albums = Object.fromEntries(state.albums)
	albums[DEFAULT_ALBUM_ID] = {
		albumId: DEFAULT_ALBUM_ID,
		name: 'default',
		description: '',
		visibility: 'public',
		postIds: defaultPostIds,
		virtual: true,
	}

	return {
		socialMeta: state.socialMeta,
		posts: visiblePosts,
		postById: Object.fromEntries(state.posts),
		likes: [...state.likes.values()],
		dislikes: [...state.dislikes.values()],
		tagNames: Object.fromEntries(state.tagNames),
		pollVotes: state.pollVotes,
		reposts: state.reposts,
		followEvents: state.followEvents,
		following: [...state.following],
		followedTags: [...state.followedTags],
		featuredReplies: Object.fromEntries(
			[...state.featuredReplies.entries()].map(([postId, set]) => [postId, [...set]]),
		),
		activeLives: Object.fromEntries(state.activeLives),
		blocked: [...state.blocked],
		albums,
		albumsByPost: Object.fromEntries(
			[...state.albumsByPost.entries()].map(([postId, set]) => [postId, [...set]]),
		),
		entityKeyHistory: state.entityKeyHistory,
		recoveryPubKeyHex: state.recoveryPubKeyHex,
		tipIds: order.length ? [order[order.length - 1]] : [],
	}
}
