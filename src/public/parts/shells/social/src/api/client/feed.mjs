import { discoverWithNetwork } from '../../discover/network.mjs'
import { buildHomeFeed } from '../../feed/home.mjs'
import { buildForYouFeed } from '../../feed/ranking.mjs'
import { suggestMentions } from '../../lib/mentionSuggest.mjs'
import { searchPosts } from '../../search.mjs'
import { maintainSocialTimeline } from '../../timeline/materialize.mjs'
import { syncFollowingTimelines } from '../../timeline/sync.mjs'
import { buildTrendingHashtags } from '../../trending/hashtags.mjs'

import { makeViewerOpts } from './helpers.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} feed / 搜索 / 探索 / 话题方法
 */
export function createFeedMethods(apiContext) {
	const viewerOpts = makeViewerOpts(apiContext)
	return {
		/**
		 * @param {{ mode?: 'home' | 'forYou', limit?: number, cursor?: string, ranking?: string }} [opts] feed 选项
		 * @returns {Promise<object>} feed
		 */
		async feed(opts = {}) {
			const mode = opts.mode || (opts.ranking === 'for_you' ? 'forYou' : 'home')
			const options = { ...opts, ...viewerOpts() }
			/**
			 * @returns {Promise<object>} 本页 feed
			 */
			const build = () => mode === 'forYou'
				? buildForYouFeed(apiContext.username, options)
				: buildHomeFeed(apiContext.username, options)
			let result = await build()
			const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
			if (!opts.cursor && result.items.length < limit) {
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
		 * @param {{ limit?: number, cursor?: string }} [opts] 选项
		 * @returns {Promise<object>} 搜索结果
		 */
		async search(query, opts = {}) {
			return searchPosts(apiContext.username, {
				q: String(query || ''),
				...opts,
				...viewerOpts(),
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
		 * @param {{ limit?: number, cursor?: string }} [opts] 分页
		 * @returns {Promise<object>} 话题帖流
		 */
		async topicPosts(tag, opts = {}) {
			const { buildTopicFeed } = await import('../../topics.mjs')
			return buildTopicFeed(apiContext.username, tag, { ...opts, ...viewerOpts() })
		},
		/**
		 * @param {{ limit?: number, cursor?: string }} [opts] 分页
		 * @returns {Promise<object>} 短视频流
		 */
		async videosFeed(opts = {}) {
			const { buildVideosFeed } = await import('../../videosFeed.mjs')
			const options = { ...opts, ...viewerOpts() }
			let result = await buildVideosFeed(apiContext.username, options)
			const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50)
			if (!opts.cursor && result.items.length < limit) {
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
		 * @param {{ maxHits?: number }} [opts] 选项
		 * @returns {Promise<{ query: string, entities: object[] }>} 实体网络搜索
		 */
		async searchEntities(query, opts = {}) {
			const { searchEntitiesNetwork } = await import('../../../../chat/src/entity/entitySearch.mjs')
			return searchEntitiesNetwork(apiContext.username, query, {
				viewerEntityHash: apiContext.entityHash,
				maxHits: opts.maxHits,
			})
		},
		/**
		 * @param {{ limit?: number }} [opts] 选项
		 * @returns {Promise<object>} 探索账户
		 */
		async explore(opts = {}) {
			return discoverWithNetwork(apiContext.username, {
				type: 'social_discover_request',
				n: Number(opts.limit) || 20,
			}, viewerOpts())
		},
		/**
		 * @param {{ limit?: number, mediaOnly?: boolean }} [opts] 选项
		 * @returns {Promise<object>} 探索帖
		 */
		async explorePosts(opts = {}) {
			return discoverWithNetwork(apiContext.username, {
				type: 'social_post_discover_request',
				n: Number(opts.limit) || 20,
				mediaOnly: opts.mediaOnly === true,
			}, viewerOpts())
		},
		/**
		 * @param {{ limit?: number }} [opts] 选项
		 * @returns {Promise<object>} 热门话题
		 */
		async trendingHashtags(opts = {}) {
			if (opts.scope === 'nearby') {
				const { buildNearbyTrendingHashtags } = await import('../../trending/network.mjs')
				return buildNearbyTrendingHashtags(apiContext.username, { ...opts, ...viewerOpts() })
			}
			return buildTrendingHashtags(apiContext.username, { ...opts, ...viewerOpts() })
		},
		/**
		 * @param {string} q 前缀
		 * @param {{ limit?: number }} [opts] 选项
		 * @returns {Promise<object>} @ 建议
		 */
		async suggestMentions(q, opts = {}) {
			return suggestMentions(apiContext.username, String(q || ''), Number(opts.limit) || 20, apiContext.entityHash)
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
