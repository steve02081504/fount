import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { listKnownFollowersOf } from '../../federation/follower/index.mjs'
import { buildLikedFeedItems, buildProfileFeedItems, buildSinglePostFeedItem, listReplies } from '../../feed/home.mjs'
import { loadFollowingForActor } from '../../following.mjs'
import { createAuthorProfileLoader } from '../../lib/authorProfileSummary.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'
import { getEntityProfile } from '../../lib/entityProfile.mjs'
import { loadMutedKeywords, replaceMutedKeywords } from '../../mutedKeywords.mjs'
import { updateSocialMeta } from '../../socialMeta.mjs'
import { getTimelineMaterialized } from '../../timeline/materialize.mjs'

import { makeViewerOptions } from './helpers.mjs'

/**
 * 物化 following 去掉自引用后的计数。
 * @param {string[]} following 关注列表
 * @param {string} entityHash 主体
 * @returns {number} 计数
 */
function countFollowing(following, entityHash) {
	const self = entityHash.toLowerCase()
	return (following || []).filter(hash => String(hash).toLowerCase() !== self).length
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 资料 / 列表 / 屏蔽词方法
 */
export function createProfileMethods(apiContext) {
	const viewerOptions = makeViewerOptions(apiContext)
	return {
		/**
		 * @param {{ hideFromDiscovery?: boolean }} patch meta 补丁
		 * @returns {Promise<object>} 更新后的 socialMeta
		 */
		async updateMeta(patch = {}) {
			await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
			return updateSocialMeta(apiContext.username, apiContext.entityHash, patch)
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<object>} 资料卡
		 */
		async profile(entityHash) {
			const hash = String(entityHash).toLowerCase()
			const profile = await getEntityProfile(apiContext.username, hash)
			const view = await getTimelineMaterialized(apiContext.username, hash)
			const { following } = await loadFollowingForActor(apiContext.username, apiContext.entityHash)
			const knownFollowers = await listKnownFollowersOf(hash)
			return {
				entityHash: hash,
				profile,
				postCount: view.posts.length,
				followingCount: countFollowing(view.following || [], hash),
				followerCount: knownFollowers.length,
				isFollowing: following.includes(hash),
				socialMeta: view.socialMeta,
			}
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @param {{ limit?: number, cursor?: string }} [options] 分页
		 * @returns {Promise<object>} 时间线帖
		 */
		async profilePosts(entityHash, options = {}) {
			return buildProfileFeedItems(apiContext.username, String(entityHash).toLowerCase(), { ...options, ...viewerOptions() })
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<object>} 点赞流
		 */
		async profileLikes(entityHash) {
			return buildLikedFeedItems(apiContext.username, String(entityHash).toLowerCase(), viewerOptions())
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<{ following: object[] }>} 关注列表（含资料摘要）
		 */
		async profileFollowing(entityHash) {
			const owner = String(entityHash).toLowerCase()
			const view = await getTimelineMaterialized(apiContext.username, owner)
			const loadProfile = createAuthorProfileLoader(apiContext.username)
			const following = []
			for (const hash of view.following || []) {
				const id = String(hash).toLowerCase()
				if (id === owner) continue
				following.push({
					entityHash: id,
					profile: await loadProfile(id),
				})
			}
			return { following }
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<{ followers: object[] }>} 已知粉丝列表（含资料摘要）
		 */
		async profileFollowers(entityHash) {
			const owner = String(entityHash).toLowerCase()
			const known = await listKnownFollowersOf(owner)
			const loadProfile = createAuthorProfileLoader(apiContext.username)
			const seen = new Set()
			const followers = []
			for (const row of known) {
				const id = String(row.entityHash || '').toLowerCase()
				if (!id || id === owner || seen.has(id)) continue
				seen.add(id)
				followers.push({
					entityHash: id,
					profile: await loadProfile(id),
				})
			}
			return { followers }
		},
		/**
		 * @param {string} entityHash 作者
		 * @param {string} postId 帖 id
		 * @returns {Promise<object | null>} 单帖 feed item
		 */
		async postFeedItem(entityHash, postId) {
			return buildSinglePostFeedItem(
				apiContext.username,
				String(entityHash).toLowerCase(),
				String(postId),
				viewerOptions(),
			)
		},
		/**
		 * @param {string} entityHash 作者
		 * @param {string} postId 帖 id
		 * @returns {Promise<{ replies: object[] }>} 回复列表
		 */
		async profileReplies(entityHash, postId) {
			return {
				replies: await listReplies(apiContext.username, String(entityHash).toLowerCase(), String(postId), viewerOptions()),
			}
		},
		/**
		 * @returns {Promise<{ entries: object[] }>} 本实体 block/hide 列表
		 */
		async personalLists() {
			const [blockedEntries, hiddenEntries] = await Promise.all([
				loadPersonalBlockEntries(apiContext.entityHash),
				loadPersonalHideEntries(apiContext.entityHash),
			])
			return {
				entries: [
					...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
					...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
				],
			}
		},
		/**
		 * 本地关键词/标签屏蔽（不联邦）。
		 */
		mutedKeywords: {
			/**
			 * @returns {Promise<{ entries: object[] }>} 屏蔽词表
			 */
			async list() {
				return loadMutedKeywords(apiContext.username, apiContext.entityHash)
			},
			/**
			 * @param {object[]} entries 条目
			 * @returns {Promise<{ entries: object[] }>} 写入结果
			 */
			async replace(entries) {
				return replaceMutedKeywords(apiContext.username, apiContext.entityHash, entries)
			},
		},
	}
}
