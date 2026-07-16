import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { buildLikedFeedItems, buildProfileFeedItems, listReplies } from '../../feed/home.mjs'
import { loadFollowingForActor } from '../../following.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'
import { getEntityProfile } from '../../lib/entityProfile.mjs'
import { loadMutedKeywords, replaceMutedKeywords } from '../../mutedKeywords.mjs'
import { updateSocialMeta } from '../../socialMeta.mjs'
import { getTimelineMaterialized } from '../../timeline/materialize.mjs'

import { makeViewerOptions } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 资料 / 列表 / 屏蔽词方法
 */
export function createProfileMethods(apiContext) {
	const viewerOptions = makeViewerOptions(apiContext)
	return {
		/**
		 * @param {{ exploreBlurb?: string, hideFromDiscovery?: boolean }} patch meta 补丁
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
			return {
				entityHash: hash,
				profile,
				postCount: view.posts.length,
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
		 * @returns {Promise<{ following: string[] }>} 关注列表
		 */
		async profileFollowing(entityHash) {
			const view = await getTimelineMaterialized(apiContext.username, String(entityHash).toLowerCase())
			return { following: view.following }
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
