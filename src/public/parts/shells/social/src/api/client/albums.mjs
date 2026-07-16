import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { buildPostFeedItem } from '../../feed/buildItem.mjs'
import { loadViewerContext } from '../../feed/home.mjs'
import { createFeedItemBuildContext } from '../../feed/iterate.mjs'
import { canViewAlbum, canViewPost } from '../../feedVisibility.mjs'
import { albumsForPostFromView } from '../../lib/albumRefs.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'
import { setPostVisibility } from '../../lib/postVisibility.mjs'
import {
	minVisibilitySpec,
	normalizeVisibilitySpec,
	visibilitySpecFromContent,
	visibilitySpecsEqual,
	visibilitySpecToContentFields,
} from '../../lib/visibilitySpec.mjs'
import { commitTimelineEvent } from '../../timeline/append.mjs'
import { getTimelineMaterialized } from '../../timeline/materialize.mjs'
import { DEFAULT_ALBUM_ID } from '../../timeline/reducers.mjs'
import { maybeDecryptPostContent } from '../../vault_crypto/vault.mjs'

/**
 * 重算帖子密级 = 所属真实相册中最公开档位；无所属则保持不变。
 * @param {string} username replica
 * @param {string} entityHash owner
 * @param {Iterable<string>} postIds 受影响帖
 * @returns {Promise<void>}
 */
export async function reconcileAlbumPostVisibility(username, entityHash, postIds) {
	const owner = String(entityHash).toLowerCase()
	const view = await getTimelineMaterialized(username, owner)
	const unique = [...new Set([...postIds].map(String))]
	for (const postId of unique) {
		const albumIds = (view.albumsByPost?.[postId] || []).filter(id => id !== DEFAULT_ALBUM_ID)
		if (!albumIds.length) continue
		const specs = albumIds.map(id => view.albums?.[id]).filter(Boolean)
		const target = minVisibilitySpec(specs)
		if (!target) continue
		const row = view.postById?.[postId]
		if (!row) continue
		const plain = await maybeDecryptPostContent(username, owner, row.content, owner)
		if (!plain) continue
		if (visibilitySpecsEqual(visibilitySpecFromContent(plain), target)) continue
		await setPostVisibility(username, owner, postId, target)
	}
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} albums 方法
 */
export function createAlbumsMethods(apiContext) {
	return {
		albums: {
			/**
			 * @param {object} draft 创建草稿
			 * @returns {Promise<object>} 相册
			 */
			async create(draft = {}) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				const albumId = String(draft.albumId || randomUUID()).trim()
				if (!albumId || albumId === DEFAULT_ALBUM_ID)
					throw httpError(400, 'invalid albumId')
				const view = await getTimelineMaterialized(apiContext.username, apiContext.entityHash)
				if (view.albums?.[albumId] && !view.albums[albumId].virtual)
					throw httpError(409, 'album exists')
				const spec = normalizeVisibilitySpec(draft)
				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_create',
					content: {
						albumId,
						name: String(draft.name || albumId).trim().slice(0, 80) || albumId,
						description: String(draft.description || '').trim().slice(0, 500),
						...visibilitySpecToContentFields(spec),
					},
				})
				return { albumId, event }
			},

			/**
			 * @param {string} albumId id
			 * @param {object} patch 更新
			 * @returns {Promise<object>} 结果
			 */
			async update(albumId, patch = {}) {
				const id = String(albumId || '').trim()
				if (!id || id === DEFAULT_ALBUM_ID) throw httpError(400, 'cannot update default album')
				const view = await getTimelineMaterialized(apiContext.username, apiContext.entityHash)
				const album = view.albums?.[id]
				if (!album || album.virtual) throw httpError(404, 'album not found')
				const next = {
					...album,
					...patch,
					albumId: id,
					visibility: patch.visibility ?? album.visibility,
					minFollowMs: patch.minFollowMs ?? album.minFollowMs,
					allow: patch.allow ?? album.allow,
					except: patch.except ?? album.except,
				}
				const spec = normalizeVisibilitySpec(next)
				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_update',
					content: {
						albumId: id,
						name: String(next.name || album.name).trim().slice(0, 80),
						description: String(next.description ?? album.description ?? '').trim().slice(0, 500),
						...visibilitySpecToContentFields(spec),
					},
				})
				await reconcileAlbumPostVisibility(apiContext.username, apiContext.entityHash, album.postIds || [])
				return { albumId: id, event }
			},

			/**
			 * @param {string} albumId id
			 * @param {{ deletePosts?: boolean }} [options] 删除选项
			 * @returns {Promise<object>} 结果
			 */
			async delete(albumId, options = {}) {
				const id = String(albumId || '').trim()
				if (!id || id === DEFAULT_ALBUM_ID) throw httpError(400, 'cannot delete default album')
				const view = await getTimelineMaterialized(apiContext.username, apiContext.entityHash)
				const album = view.albums?.[id]
				if (!album || album.virtual) throw httpError(404, 'album not found')
				const postIds = [...album.postIds || []]
				if (options.deletePosts)
					for (const postId of postIds)
						await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
							type: 'post_delete',
							content: { targetPostId: postId },
						})

				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_delete',
					content: { albumId: id },
				})
				if (!options.deletePosts)
					await reconcileAlbumPostVisibility(apiContext.username, apiContext.entityHash, postIds)
				return { albumId: id, event, deletedPosts: Boolean(options.deletePosts) }
			},

			/**
			 * @param {string} albumId 相册
			 * @param {string} postId 帖
			 * @returns {Promise<object>} 结果
			 */
			async addPost(albumId, postId) {
				const id = String(albumId || '').trim()
				const pid = String(postId || '').trim()
				if (!id || id === DEFAULT_ALBUM_ID || !pid) throw httpError(400, 'invalid album/post')
				const view = await getTimelineMaterialized(apiContext.username, apiContext.entityHash)
				if (!view.albums?.[id] || view.albums[id].virtual) throw httpError(404, 'album not found')
				if (!view.postById?.[pid]) throw httpError(404, 'post not found')
				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_post_add',
					content: { albumId: id, postId: pid },
				})
				await reconcileAlbumPostVisibility(apiContext.username, apiContext.entityHash, [pid])
				return { event }
			},

			/**
			 * @param {string} albumId 相册
			 * @param {string} postId 帖
			 * @returns {Promise<object>} 结果
			 */
			async removePost(albumId, postId) {
				const id = String(albumId || '').trim()
				const pid = String(postId || '').trim()
				if (!id || id === DEFAULT_ALBUM_ID || !pid) throw httpError(400, 'invalid album/post')
				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_post_remove',
					content: { albumId: id, postId: pid },
				})
				await reconcileAlbumPostVisibility(apiContext.username, apiContext.entityHash, [pid])
				return { event }
			},

			/**
			 * @param {string} postId 帖
			 * @param {string} fromAlbumId 源
			 * @param {string} toAlbumId 目标
			 * @returns {Promise<object>} 结果
			 */
			async movePost(postId, fromAlbumId, toAlbumId) {
				const pid = String(postId || '').trim()
				const from = String(fromAlbumId || '').trim()
				const to = String(toAlbumId || '').trim()
				if (!pid || !to || to === DEFAULT_ALBUM_ID) throw httpError(400, 'invalid move')
				if (from && from !== DEFAULT_ALBUM_ID)
					await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
						type: 'album_post_remove',
						content: { albumId: from, postId: pid },
					})
				await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'album_post_add',
					content: { albumId: to, postId: pid },
				})
				await reconcileAlbumPostVisibility(apiContext.username, apiContext.entityHash, [pid])
				return { postId: pid, fromAlbumId: from || null, toAlbumId: to }
			},

			/**
			 * @param {string} [entityHash] owner；缺省自身
			 * @returns {Promise<object[]>} 相册列表
			 */
			async list(entityHash) {
				const owner = String(entityHash || apiContext.entityHash).toLowerCase()
				const viewerContext = await loadViewerContext(apiContext.username, apiContext.entityHash)
				const view = await getTimelineMaterialized(apiContext.username, owner)
				const albums = Object.values(view.albums || {})
					.filter(album => canViewAlbum(album, owner, viewerContext))
					.map(album => summarizeAlbum(album))
				return albums
			},

			/**
			 * @param {string} entityHash owner
			 * @param {string} albumId id
			 * @returns {Promise<object>} 相册详情 + 成员帖
			 */
			async get(entityHash, albumId) {
				const owner = String(entityHash || apiContext.entityHash).toLowerCase()
				const id = String(albumId || '').trim() || DEFAULT_ALBUM_ID
				const viewerContext = await loadViewerContext(apiContext.username, apiContext.entityHash)
				const view = await getTimelineMaterialized(apiContext.username, owner)
				const album = view.albums?.[id]
				if (!album) throw httpError(404, 'album not found')
				if (!canViewAlbum(album, owner, viewerContext)) throw httpError(404, 'album not found')

				const itemContext = await createFeedItemBuildContext(
					apiContext.username,
					new Set([owner]),
					apiContext.entityHash,
				)
				/**
				 * @param {string} _author 作者（忽略，用外层 owner）
				 * @param {string} postId 帖 id
				 * @returns {{ albumId: string, name: string }[]} 可见相册
				 */
				itemContext.albumsForPost = (_author, postId) => albumsForPostFromView(view, owner, postId, viewerContext)

				/** @type {object[]} */
				const items = []
				for (const postId of album.postIds || []) {
					const post = view.postById?.[postId]
					if (!post) continue
					const enriched = { ...post, entityHash: owner }
					if (!canViewPost(enriched, viewerContext)) continue
					items.push(await buildPostFeedItem(apiContext.username, owner, post, itemContext))
				}
				return { album: summarizeAlbum(album), items }
			},
		},
	}
}

/**
 * @param {object} album 相册
 * @returns {object} 摘要
 */
function summarizeAlbum(album) {
	return {
		albumId: album.albumId,
		name: album.name,
		description: album.description || '',
		visibility: album.visibility || 'public',
		minFollowMs: album.minFollowMs,
		allow: album.allow,
		except: album.except,
		postIds: [...album.postIds || []],
		postCount: (album.postIds || []).length,
		virtual: Boolean(album.virtual),
	}
}
