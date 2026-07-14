import { randomUUID } from 'node:crypto'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
	setPersonalHidden,
	setPersonalMuted,
} from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getFederationViewForUser, resolveOperatorEntityHashForUser } from '../../../chat/src/entity/identity.mjs'
import { discoverWithNetwork } from '../discover/network.mjs'
import { dispatchFollowEvent } from '../dispatch.mjs'
import { resolveSocialEntity } from '../federation/hosting.mjs'
import { buildPostFeedItem } from '../feed/buildItem.mjs'
import { createFeedItemBuildContext } from '../feed/iterate.mjs'
import { buildForYouFeed } from '../feed/ranking.mjs'
import { buildHomeFeed, buildLikedFeedItems, buildProfileFeedItems, listReplies } from '../feed.mjs'
import { loadFollowingForActor, setFollow } from '../following.mjs'
import { listReceivedReports, resolveReport, submitReport } from '../governance/report.mjs'
import { getNotificationsSeenAt, parseNotificationTypesFilter, setNotificationsSeenAt } from '../inbox.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'
import { buildEmojiMediaRefsForPost } from '../lib/emojiPostEmbed.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { suggestMentions } from '../lib/mentionSuggest.mjs'
import { normalizePollDraft } from '../lib/poll.mjs'
import { buildNotifications } from '../notifications.mjs'
import { setPersonalBlock } from '../personalBlock.mjs'
import {
	addSavedPost,
	createSavedFolder,
	deleteSavedFolder,
	enrichSavedPosts,
	loadSavedPosts,
	removeSavedPost,
	renameSavedFolder,
	searchSavedPosts,
} from '../savedPosts.mjs'
import { searchPosts } from '../search.mjs'
import { updateSocialMeta } from '../socialMeta.mjs'
import { getVaultFileByShareId, registerVaultFile } from '../socialVaultIndex.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized, maintainSocialTimeline } from '../timeline/materialize.mjs'
import { syncFollowingTimelines, syncTimelineForEntity } from '../timeline/sync.mjs'
import { buildTrendingHashtags } from '../trending/hashtags.mjs'
import { autoApproveFollower } from '../vault_crypto/followApprove.mjs'
import { buildFollowApprovePayload, maybeDecryptPostContent, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

import { createPost } from './post.mjs'

/**
 * @typedef {{ username: string, entityHash: string, charPartName?: string }} SocialApiContext
 */

/**
 * 解析 SocialClient 绑定实体：缺省 operator；指定时须为本 username 托管的本地实体。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<{ entityHash: string, charPartName?: string }>} 绑定实体
 */
export async function resolveSocialClientEntity(username, entityHash) {
	const requested = String(entityHash || '').trim().toLowerCase()
	if (requested) {
		const resolved = await resolveSocialEntity(requested, username)
		if (!resolved?.local || resolved.replicaUsername !== username)
			throw httpError(403, 'invalid entityHash')
		return {
			entityHash: resolved.entityHash,
			...resolved.charPartName ? { charPartName: resolved.charPartName } : {},
		}
	}
	const operator = await resolveOperatorEntityHashForUser(username)
	if (!operator)
		throw httpError(403, 'configure Chat federation identity first (same P2P entity as Social)')
	return { entityHash: operator }
}

/**
 * @param {SocialApiContext} ctx API 上下文
 * @returns {object} SocialClient 鸭子类型
 */
export function createSocialClient(ctx) {
	/**
	 * @returns {{ viewerEntityHash: string }} 读侧观看者选项
	 */
	const viewerOpts = () => ({ viewerEntityHash: ctx.entityHash })

	return {
		entityHash: ctx.entityHash,
		/**
		 * 发帖或按 id 取帖：`post({ text })` → Post；`post(entityHash, postId)` → Post。
		 * @param {object | string} arg1 发帖草稿或作者 entityHash
		 * @param {string} [postId] 取帖时的 postId
		 * @returns {Promise<object>} Post
		 */
		async post(arg1, postId) {
			if (typeof arg1 === 'string')
				return this.getPost(arg1, postId)
			return createTimelinePost(ctx, arg1 || {})
		},
		/**
		 * @param {string} entityHash 作者
		 * @param {string} id 帖 id
		 * @returns {Promise<object>} Post
		 */
		async getPost(entityHash, id) {
			const owner = String(entityHash).toLowerCase()
			const view = await getTimelineMaterialized(ctx.username, owner)
			const row = view.postById[String(id)]
			const content = row
				? await maybeDecryptPostContent(ctx.username, owner, row.content) || row.content
				: null
			return createPost(ctx, owner, id, { content, event: row || null })
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async follow(target) {
			return setFollowRelation(ctx, target, true)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unfollow(target) {
			return setFollowRelation(ctx, target, false)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async block(target) {
			return setBlockRelation(ctx, target, true)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unblock(target) {
			return setBlockRelation(ctx, target, false)
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async hide(target) {
			const hash = await requireKnownTarget(ctx, target)
			const hidden = await setPersonalHidden(ctx.entityHash, hash, true)
			return { entityHash: hash, hidden }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unhide(target) {
			const hash = await requireKnownTarget(ctx, target)
			const hidden = await setPersonalHidden(ctx.entityHash, hash, false)
			return { entityHash: hash, hidden }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async mute(target) {
			const hash = await requireKnownTarget(ctx, target)
			await setPersonalMuted(ctx.entityHash, hash, true)
			return { entityHash: hash, muted: true }
		},
		/**
		 * @param {string} target 目标 entityHash
		 * @returns {Promise<object>} 关系结果
		 */
		async unmute(target) {
			const hash = await requireKnownTarget(ctx, target)
			await setPersonalMuted(ctx.entityHash, hash, false)
			return { entityHash: hash, muted: false }
		},
		/**
		 * @param {string} follower 关注者 Ed25519 pubKeyHex
		 * @returns {Promise<object>} follow_approve 事件
		 */
		async approveFollow(follower) {
			const followerPubKeyHex = String(follower)
			const payload = await buildFollowApprovePayload(ctx.username, ctx.entityHash, followerPubKeyHex)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'follow_approve',
				content: payload,
			})
		},
		/**
		 * @param {string | { targetEntityHash: string, targetPostId?: string, reason?: string, category?: string }} target 举报目标或载荷
		 * @returns {Promise<object>} 已签名举报
		 */
		async report(target) {
			const body = typeof target === 'string'
				? { targetEntityHash: target }
				: { ...target }
			return submitReport(ctx.username, {
				...body,
				reporterEntityHash: ctx.entityHash,
			})
		},
		/**
		 * @param {{ limit?: number }} [opts] 分页
		 * @returns {Promise<object>} 收到的举报列表
		 */
		async listReports(opts = {}) {
			return listReceivedReports(ctx.username, opts)
		},
		/**
		 * @param {{ reportId: string, action: 'dismiss' | 'mute_author' | 'hide_post' }} input 处置
		 * @returns {Promise<object>} 处置记录
		 */
		async resolveReport(input) {
			return resolveReport(ctx.username, ctx.entityHash, input)
		},
		/**
		 * @param {{ mode?: 'home' | 'forYou', limit?: number, cursor?: string, ranking?: string }} [opts] feed 选项
		 * @returns {Promise<object>} feed
		 */
		async feed(opts = {}) {
			const mode = opts.mode || (opts.ranking === 'for_you' ? 'forYou' : 'home')
			const options = { ...opts, ...viewerOpts() }
			return mode === 'forYou'
				? buildForYouFeed(ctx.username, options)
				: buildHomeFeed(ctx.username, options)
		},
		/**
		 * @returns {Promise<{ synced: true }>} 同步结果
		 */
		async syncFollowing() {
			await syncFollowingTimelines(ctx.username)
			return { synced: true }
		},
		/**
		 * @param {{ limit?: number, cursor?: string, types?: string | string[] }} [opts] 通知选项
		 * @returns {Promise<object>} 通知页
		 */
		async notifications(opts = {}) {
			const types = Array.isArray(opts.types)
				? opts.types
				: parseNotificationTypesFilter(opts.types)
			return buildNotifications(ctx.username, {
				...viewerOpts(),
				limit: opts.limit,
				cursor: opts.cursor,
				types,
			})
		},
		/**
		 * @returns {Promise<number>} 已读水位
		 */
		async notificationsSeenAt() {
			return getNotificationsSeenAt(ctx.username, ctx.entityHash)
		},
		/**
		 * @param {number} [ts] 水位；缺省 = now
		 * @returns {Promise<number>} 写入后的水位
		 */
		async setNotificationsSeenAt(ts) {
			const at = Number(ts) || Date.now()
			setNotificationsSeenAt(ctx.username, ctx.entityHash, at)
			return at
		},
		/**
		 * @param {string} query 查询串
		 * @param {{ limit?: number, cursor?: string }} [opts] 选项
		 * @returns {Promise<object>} 搜索结果
		 */
		async search(query, opts = {}) {
			return searchPosts(ctx.username, {
				q: String(query || ''),
				...opts,
				...viewerOpts(),
			})
		},
		/**
		 * @param {{ limit?: number }} [opts] 选项
		 * @returns {Promise<object>} 探索账户
		 */
		async explore(opts = {}) {
			return discoverWithNetwork(ctx.username, {
				type: 'social_discover_request',
				n: Number(opts.limit) || 20,
			}, viewerOpts())
		},
		/**
		 * @param {{ limit?: number, mediaOnly?: boolean }} [opts] 选项
		 * @returns {Promise<object>} 探索帖
		 */
		async explorePosts(opts = {}) {
			return discoverWithNetwork(ctx.username, {
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
			return buildTrendingHashtags(ctx.username, opts)
		},
		/**
		 * @param {string} q 前缀
		 * @param {{ limit?: number }} [opts] 选项
		 * @returns {Promise<object>} @ 建议
		 */
		async suggestMentions(q, opts = {}) {
			return suggestMentions(ctx.username, String(q || ''), Number(opts.limit) || 20)
		},
		/**
		 * @returns {{ list: Function, add: Function, remove: Function, createFolder: Function, renameFolder: Function, deleteFolder: Function, search: Function }} 收藏命名空间
		 */
		get saved() {
			return {
				/**
				 * @returns {Promise<object>} 收藏结构（含预览）
				 */
				async list() {
					return enrichSavedPosts(ctx.username, await loadSavedPosts(ctx.username))
				},
				/**
				 * @param {{ entityHash: string, postId: string }} ref 帖引用
				 * @param {string | null} [folderId] 文件夹
				 * @returns {Promise<object>} 写入后结构
				 */
				async add(ref, folderId = null) {
					return addSavedPost(ctx.username, ref, folderId)
				},
				/**
				 * @param {{ entityHash: string, postId: string }} ref 帖引用
				 * @param {string} [folderId] 文件夹；省略则全局移除
				 * @returns {Promise<object>} 写入后结构
				 */
				async remove(ref, folderId) {
					return removeSavedPost(ctx.username, ref, folderId)
				},
				/**
				 * @param {string} name 文件夹名
				 * @returns {Promise<object>} 写入后结构
				 */
				async createFolder(name) {
					return createSavedFolder(ctx.username, name)
				},
				/**
				 * @param {string} folderId 文件夹 id
				 * @param {string} name 新名
				 * @returns {Promise<object>} 写入后结构
				 */
				async renameFolder(folderId, name) {
					return renameSavedFolder(ctx.username, folderId, name)
				},
				/**
				 * @param {string} folderId 文件夹 id
				 * @returns {Promise<object>} 写入后结构
				 */
				async deleteFolder(folderId) {
					return deleteSavedFolder(ctx.username, folderId)
				},
				/**
				 * @param {string} query 搜索串
				 * @param {{ limit?: number }} [opts] 选项
				 * @returns {Promise<object>} 匹配收藏
				 */
				async search(query, opts = {}) {
					return searchSavedPosts(ctx.username, query, opts)
				},
			}
		},
		/**
		 * @returns {{ registerFile: Function, getFile: Function }} vault 命名空间
		 */
		get vault() {
			return {
				/**
				 * @param {object} manifest 文件清单
				 * @returns {Promise<{ entry: object, event: object }>} 注册结果
				 */
				async registerFile(manifest) {
					const entry = await registerVaultFile(ctx.username, ctx.entityHash, manifest)
					const event = await commitTimelineEvent(ctx.username, ctx.entityHash, {
						type: 'file_share',
						content: {
							shareId: entry.shareId,
							fileId: entry.fileId,
							name: entry.name,
							mimeType: entry.mimeType,
							size: entry.size,
							visibility: entry.visibility,
						},
					}, { fanout: false })
					return { entry, event }
				},
				/**
				 * @param {string} shareId 分享 id
				 * @param {string} [ownerEntityHash] 缺省 = 本实体
				 * @returns {Promise<object | null>} vault 索引项
				 */
				async getFile(shareId, ownerEntityHash) {
					const owner = String(ownerEntityHash || ctx.entityHash).toLowerCase()
					return getVaultFileByShareId(ctx.username, owner, String(shareId))
				},
			}
		},
		/**
		 * @param {{ exploreBlurb?: string, hideFromDiscovery?: boolean }} patch meta 补丁
		 * @returns {Promise<object>} 更新后的 socialMeta
		 */
		async updateMeta(patch = {}) {
			await ensureEntitySocialReady(ctx.username, ctx.entityHash)
			return updateSocialMeta(ctx.username, ctx.entityHash, patch)
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<object>} 资料卡
		 */
		async profile(entityHash) {
			const hash = String(entityHash).toLowerCase()
			const profile = await getEntityProfile(ctx.username, hash)
			const view = await getTimelineMaterialized(ctx.username, hash)
			const { following } = await loadFollowingForActor(ctx.username, ctx.entityHash)
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
		 * @param {{ limit?: number, cursor?: string }} [opts] 分页
		 * @returns {Promise<object>} 时间线帖
		 */
		async profilePosts(entityHash, opts = {}) {
			return buildProfileFeedItems(ctx.username, String(entityHash).toLowerCase(), opts)
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<object>} 点赞流
		 */
		async profileLikes(entityHash) {
			return buildLikedFeedItems(ctx.username, String(entityHash).toLowerCase())
		},
		/**
		 * @param {string} entityHash 目标实体
		 * @returns {Promise<{ following: string[] }>} 关注列表
		 */
		async profileFollowing(entityHash) {
			const view = await getTimelineMaterialized(ctx.username, String(entityHash).toLowerCase())
			return { following: view.following }
		},
		/**
		 * @param {string} entityHash 作者
		 * @param {string} postId 帖 id
		 * @returns {Promise<{ replies: object[] }>} 回复列表
		 */
		async profileReplies(entityHash, postId) {
			return {
				replies: await listReplies(ctx.username, String(entityHash).toLowerCase(), String(postId)),
			}
		},
		/**
		 * @returns {Promise<{ entries: object[] }>} 本实体 block/hide 列表
		 */
		async personalLists() {
			const [blockedEntries, hiddenEntries] = await Promise.all([
				loadPersonalBlockEntries(ctx.entityHash),
				loadPersonalHideEntries(ctx.entityHash),
			])
			return {
				entries: [
					...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
					...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
				],
			}
		},
		/**
		 * @param {string} entityHash 时间线 owner
		 * @returns {Promise<{ checkpointEventId: string | null }>} 维护结果
		 */
		async maintainTimeline(entityHash) {
			const snapshot = await maintainSocialTimeline(ctx.username, String(entityHash).toLowerCase())
			return { checkpointEventId: snapshot.checkpoint_event_id }
		},
	}
}

/**
 * 获取以指定实体自签的 SocialClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<object>} SocialClient
 */
export async function getSocialClient(username, entityHash) {
	const entity = await resolveSocialClientEntity(username, entityHash)
	return createSocialClient({ username, ...entity })
}

/**
 * @param {string} target 目标
 * @returns {string} 规范化 entityHash
 */
function normalizeTarget(target) {
	const hash = String(target || '').toLowerCase()
	if (!isEntityHash128(hash)) throw httpError(400, 'invalid entityHash')
	return hash
}

/**
 * @param {SocialApiContext} ctx 上下文
 * @param {string} target 目标
 * @returns {Promise<string>} 已知社交目标 entityHash
 */
async function requireKnownTarget(ctx, target) {
	const hash = normalizeTarget(target)
	if (!await isKnownSocialTarget(ctx.username, hash))
		throw httpError(400, 'unknown entity')
	return hash
}

/**
 * @param {SocialApiContext} ctx 上下文
 * @param {string} target 目标
 * @param {boolean} follow 关注/取关
 * @returns {Promise<object>} 关系结果
 */
async function setFollowRelation(ctx, target, follow) {
	const hash = normalizeTarget(target)
	await setFollow(ctx.username, ctx.entityHash, hash, follow)
	if (follow) {
		await dispatchFollowEvent(ctx.username, ctx.entityHash, hash)
		const targetEntity = await resolveSocialEntity(hash)
		if (targetEntity?.local && targetEntity.replicaUsername) {
			const followerPubKeyHex = (await getFederationViewForUser(ctx.username)).activePubKeyHex
			if (followerPubKeyHex)
				await autoApproveFollower(targetEntity.replicaUsername, hash, followerPubKeyHex)
		}
		await syncTimelineForEntity(ctx.username, hash)
	}
	return { entityHash: hash, isFollowing: follow }
}

/**
 * @param {SocialApiContext} ctx 上下文
 * @param {string} target 目标
 * @param {boolean} block 拉黑/解除
 * @returns {Promise<object>} 关系结果
 */
async function setBlockRelation(ctx, target, block) {
	const hash = normalizeTarget(target)
	if (!await isKnownSocialTarget(ctx.username, hash))
		throw httpError(400, 'unknown entity')
	await ensureEntitySocialReady(ctx.username, ctx.entityHash)
	await setPersonalBlock(ctx.username, ctx.entityHash, hash, block)
	return { entityHash: hash, blocked: block }
}

/**
 * @param {SocialApiContext} ctx 上下文
 * @param {object} draft 发帖草稿
 * @returns {Promise<object>} Post
 */
async function createTimelinePost(ctx, draft) {
	await ensureEntitySocialReady(ctx.username, ctx.entityHash)
	const resolved = await resolveSocialEntity(ctx.entityHash, ctx.username)
	const charPartName = draft.charPartName
		|| ctx.charPartName
		|| (resolved?.kind === 'agent' ? resolved.charPartName : null)
	const visibility = draft.visibility === 'followers' ? 'followers' : 'public'
	const draftContent = {
		text: String(draft.text),
		mediaRefs: [
			...draft.mediaRefs ?? [],
			...await buildEmojiMediaRefsForPost(ctx.username, String(draft.text)),
		],
		replyTo: draft.replyTo,
		quoteRef: draft.quoteRef,
		groupRef: draft.groupRef,
		lang: draft.lang || 'zh-CN',
		visibility,
		...draft.contentWarning ? { contentWarning: String(draft.contentWarning).trim().slice(0, 200) } : {},
	}
	if (draft.poll)
		draftContent.poll = normalizePollDraft(draft.poll)

	const signed = await commitTimelineEvent(ctx.username, ctx.entityHash, {
		type: 'post',
		charPartName,
		content: await maybeEncryptPostContent(ctx.username, ctx.entityHash, randomUUID(), draftContent, visibility),
	})
	const itemContext = await createFeedItemBuildContext(ctx.username, new Set([ctx.entityHash]), ctx.entityHash)
	const item = await buildPostFeedItem(ctx.username, ctx.entityHash, { ...signed, postId: signed.id }, itemContext)
	pushFeedUpdate(ctx.username, { type: 'post', item })
	return createPost(ctx, ctx.entityHash, signed.id, { event: signed, content: draftContent })
}
