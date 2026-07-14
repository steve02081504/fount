import { reduceEntityKeyRevoke, reduceEntityKeyRotate } from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'

import { socialPostKey } from '../federation/post_key.mjs'

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
		pollVotes: new Map(),
		reposts: [],
		followEvents: [],
		following: new Set(),
		blocked: new Set(),
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
	state.deletedPostIds.add(event.content.targetPostId)
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
		choices: [...(event.content.choices || [])],
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
	state.likes.set(socialPostKey(event.content.targetEntityHash, event.content.targetPostId), event)
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
	poll_vote: reducePollVote,
	like: reduceLike,
	unlike: reduceUnlike,
	repost: reduceRepost,
	follow: reduceFollow,
	unfollow: reduceUnfollow,
	block: reduceBlock,
	unblock: reduceUnblock,
	entity_key_rotate: reduceEntityKeyRotate,
	entity_key_revoke: reduceEntityKeyRevoke,
	state_summary: reduceSocialMeta,
	file_share: passthroughReducer,
	follow_approve: passthroughReducer,
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
			lang: edit.content?.lang,
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

	return {
		socialMeta: state.socialMeta,
		posts: visiblePosts,
		postById: Object.fromEntries(state.posts),
		likes: [...state.likes.values()],
		pollVotes: state.pollVotes,
		reposts: state.reposts,
		followEvents: state.followEvents,
		following: [...state.following],
		blocked: [...state.blocked],
		entityKeyHistory: state.entityKeyHistory,
		recoveryPubKeyHex: state.recoveryPubKeyHex,
		tipIds: order.length ? [order[order.length - 1]] : [],
	}
}
