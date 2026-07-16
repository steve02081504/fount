import { discoverWithNetwork } from '../../discover/network.mjs'
import { buildHomeFeed } from '../../feed/home.mjs'
import { buildForYouFeed } from '../../feed/ranking.mjs'
import { suggestMentions } from '../../lib/mentionSuggest.mjs'
import { searchPosts } from '../../search.mjs'
import { maintainSocialTimeline } from '../../timeline/materialize.mjs'
import { syncFollowingTimelines } from '../../timeline/sync.mjs'
import { buildTrendingHashtags } from '../../trending/hashtags.mjs'

import { makeViewerOptions } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} feed / 搜索 / 探索 / 话题方法
 */
export function createFeedMethods(apiContext) {
	const viewerOptions = makeViewerOptions(apiContext)
	return {
		/**
		 * @param {{ mode?: 'home' | 'forYou', limit?: number, cursor?: string, ranking?: string }} [options] feed 选项
		 * @returns {Promise<object>} feed
		 */
		async feed(options = {}) {
			const mode = options.mode || (options.ranking === 'for_you' ? 'forYou' : 'home')
			options = { ...options, ...viewerOptions() }
			/**
			 * @returns {Promise<object>} 本页 feed
			 */
			const build = () => mode === 'forYou'
				? buildForYouFeed(apiContext.username, options)
				: buildHomeFeed(apiContext.username, options)
			let result = await build()
			const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
			if (!options.cursor && result.items.length < limit) {
				const { backfillPosts } = await import('../../federation/backfill.mjs')
				await backfillPosts(apiContext.username, {
					viewerEntityHash: options.viewerEntityHash,
					/**
					 * @returns {Promise<boolean>} 本地是否已足够
					 */
					enough: async () => {
						result = await build()
						return result.items.length >= limit
					},
				})
				result = await build()
			}
			return result
		},
		/**
		 * @returns {Promise<{ synced: true }>} 同步结果
		 */
		async syncFollowing() {
			await syncFollowingTimelines(apiContext.username)
			return { synced: true }
		},
		/**
		 * @param {string} query 查询串
		 * @param {{ limit?: number, cursor?: string }} [options] 选项
		 * @returns {Promise<object>} 搜索结果
		 */
		async search(query, options = {}) {
			return searchPosts(apiContext.username, {
				q: String(query || ''),
				...options,
				...viewerOptions(),
			})
		},
		/**
		 * @param {string} tag 话题
		 * @param {boolean} [follow] 是否订阅
		 * @returns {Promise<object>} 结果
		 */
		async followTopic(tag, follow = true) {
			const { setTagFollow } = await import('../../topics.mjs')
			return setTagFollow(apiContext.username, apiContext.entityHash, tag, follow !== false)
		},
		/**
		 * @returns {Promise<{ tags: string[] }>} 已订阅话题
		 */
		async followedTopics() {
			const { listFollowedTags } = await import('../../topics.mjs')
			return listFollowedTags(apiContext.username, apiContext.entityHash)
		},
		/**
		 * @param {string} tag 话题
		 * @param {{ limit?: number, cursor?: string }} [options] 分页
		 * @returns {Promise<object>} 话题帖流
		 */
		async topicPosts(tag, options = {}) {
			const { buildTopicFeed } = await import('../../topics.mjs')
			return buildTopicFeed(apiContext.username, tag, { ...options, ...viewerOptions() })
		},
		/**
		 * @param {{ limit?: number, cursor?: string }} [options] 分页
		 * @returns {Promise<object>} 短视频流
		 */
		async videosFeed(options = {}) {
			const { buildVideosFeed } = await import('../../videosFeed.mjs')
			options = { ...options, ...viewerOptions() }
			let result = await buildVideosFeed(apiContext.username, options)
			const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
			if (!options.cursor && result.items.length < limit) {
				const { backfillPosts } = await import('../../federation/backfill.mjs')
				await backfillPosts(apiContext.username, {
					viewerEntityHash: options.viewerEntityHash,
					mediaOnly: true,
					/**
					 * @returns {Promise<boolean>} 本地是否已足够
					 */
					enough: async () => {
						result = await buildVideosFeed(apiContext.username, options)
						return result.items.length >= limit
					},
				})
				result = await buildVideosFeed(apiContext.username, options)
			}
			return result
		},
		/**
		 * @param {string} query 搜索词
		 * @param {{ maxHits?: number }} [options] 选项
		 * @returns {Promise<{ query: string, entities: object[] }>} 实体网络搜索
		 */
		async searchEntities(query, options = {}) {
			const { searchEntitiesNetwork } = await import('../../../../chat/src/entity/entitySearch.mjs')
			return searchEntitiesNetwork(apiContext.username, query, {
				viewerEntityHash: apiContext.entityHash,
				maxHits: options.maxHits,
			})
		},
		/**
		 * @param {{ limit?: number }} [options] 选项
		 * @returns {Promise<object>} 探索账户
		 */
		async explore(options = {}) {
			return discoverWithNetwork(apiContext.username, {
				type: 'social_discover_request',
				n: Number(options.limit) || 20,
			}, viewerOptions())
		},
		/**
		 * @param {{ limit?: number, mediaOnly?: boolean }} [options] 选项
		 * @returns {Promise<object>} 探索帖
		 */
		async explorePosts(options = {}) {
			return discoverWithNetwork(apiContext.username, {
				type: 'social_post_discover_request',
				n: Number(options.limit) || 20,
				mediaOnly: options.mediaOnly === true,
			}, viewerOptions())
		},
		/**
		 * @param {{ limit?: number }} [options] 选项
		 * @returns {Promise<object>} 热门话题
		 */
		async trendingHashtags(options = {}) {
			if (options.scope === 'nearby') {
				const { buildNearbyTrendingHashtags } = await import('../../trending/network.mjs')
				return buildNearbyTrendingHashtags(apiContext.username, { ...options, ...viewerOptions() })
			}
			return buildTrendingHashtags(apiContext.username, { ...options, ...viewerOptions() })
		},
		/**
		 * @param {string} q 前缀
		 * @param {{ limit?: number }} [options] 选项
		 * @returns {Promise<object>} @ 建议
		 */
		async suggestMentions(q, options = {}) {
			return suggestMentions(apiContext.username, String(q || ''), Number(options.limit) || 20, apiContext.entityHash)
		},
		/**
		 * @param {string} entityHash 时间线 owner
		 * @returns {Promise<{ checkpointEventId: string | null }>} 维护结果
		 */
		async maintainTimeline(entityHash) {
			const snapshot = await maintainSocialTimeline(apiContext.username, String(entityHash).toLowerCase())
			return { checkpointEventId: snapshot.checkpoint_event_id }
		},
	}
}
