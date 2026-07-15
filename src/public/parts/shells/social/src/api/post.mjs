import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { sanitizeMediaRefs, resolveSensitiveMedia } from '../lib/mediaRefs.mjs'
import { assertPollVoteAllowed } from '../lib/poll.mjs'
import { loadTaste } from '../taste/store.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'

/**
 * @param {import('./client.mjs').SocialApiContext} ctx API 上下文
 * @returns {Promise<boolean>} 是否公开反应
 */
async function shouldPublishReactions(ctx) {
	const taste = await loadTaste(ctx.username, ctx.entityHash)
	return taste.privacy.publishReactions !== false
}

/**
 * @param {import('./client.mjs').SocialApiContext} ctx API 上下文
 * @param {string} type 事件类型
 * @param {string} owner 帖作者
 * @param {string} id 帖 id
 * @returns {Promise<object>} 签名事件
 */
async function commitReaction(ctx, type, owner, id) {
	await assertKnownPostTarget(ctx, owner)
	const fanout = await shouldPublishReactions(ctx)
	return commitTimelineEvent(ctx.username, ctx.entityHash, {
		type,
		content: { targetEntityHash: owner, targetPostId: id },
	}, { fanout })
}

/**
 * 构造绑定到某帖的 Post 鸭子类型。
 * @param {import('./client.mjs').SocialApiContext} ctx API 上下文
 * @param {string} entityHash 帖作者 entityHash
 * @param {string} postId 帖 id
 * @param {object} [snapshot] 可选已知快照（event / content）
 * @returns {object} Post
 */
export function createPost(ctx, entityHash, postId, snapshot = null) {
	const owner = String(entityHash).toLowerCase()
	const id = String(postId)

	return {
		entityHash: owner,
		postId: id,
		event: snapshot?.event || null,
		content: snapshot?.content || null,
		/**
		 * @returns {Promise<object>} like 事件
		 */
		async like() {
			return commitReaction(ctx, 'like', owner, id)
		},
		/**
		 * @returns {Promise<object>} unlike 事件
		 */
		async unlike() {
			return commitReaction(ctx, 'unlike', owner, id)
		},
		/**
		 * @returns {Promise<object>} dislike 事件（与 like 互斥，reducer 侧清 like）
		 */
		async dislike() {
			return commitReaction(ctx, 'dislike', owner, id)
		},
		/**
		 * @returns {Promise<object>} undislike 事件
		 */
		async undislike() {
			return commitReaction(ctx, 'undislike', owner, id)
		},
		/**
		 * @param {string} [comment] 转发附言
		 * @returns {Promise<object>} repost 事件
		 */
		async repost(comment = '') {
			await assertKnownPostTarget(ctx, owner)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'repost',
				content: {
					targetEntityHash: owner,
					targetPostId: id,
					comment: String(comment || ''),
				},
			})
		},
		/**
		 * 编辑帖子：作者自签，或作者所属主人以自身钥签到作者时间线。
		 * @param {{ text?: string, mediaRefs?: object[], locale?: string, contentWarning?: string }} patch 编辑补丁
		 * @returns {Promise<object>} post_edit 事件
		 */
		async edit(patch = {}) {
			const view = await getTimelineMaterialized(ctx.username, owner)
			const post = view.postById[id]
			if (!post) throw httpError(404, 'post not found')
			const signerOpts = await resolveOwnerContentSigner(ctx, owner)
			const decrypted = await maybeDecryptPostContent(ctx.username, owner, post.content) || post.content || {}
			const visibility = decrypted.visibility || post.content?.visibility || 'public'
			const draftContent = {
				targetPostId: id,
				text: String(patch.text ?? decrypted.text ?? ''),
				mediaRefs: sanitizeMediaRefs(patch.mediaRefs ?? decrypted.mediaRefs),
				locale: patch.locale || decrypted.locale || 'zh-CN',
				...patch.contentWarning !== undefined
					? { contentWarning: String(patch.contentWarning).trim().slice(0, 200) }
					: decrypted.contentWarning ? { contentWarning: decrypted.contentWarning } : {},
				...resolveSensitiveMedia(
					patch.sensitiveMedia !== undefined ? patch.sensitiveMedia : decrypted.sensitiveMedia,
					patch.contentWarning !== undefined ? patch.contentWarning : decrypted.contentWarning,
				) ? { sensitiveMedia: true } : {},
			}
			return commitTimelineEvent(ctx.username, owner, {
				type: 'post_edit',
				content: await maybeEncryptPostContent(ctx.username, owner, id, draftContent, visibility),
			}, signerOpts)
		},
		/**
		 * 删除帖子：作者自签，或作者所属主人以自身钥签到作者时间线。
		 * @returns {Promise<object>} post_delete 事件
		 */
		async delete() {
			const view = await getTimelineMaterialized(ctx.username, owner)
			if (!view.postById[id]) throw httpError(404, 'post not found')
			const signerOpts = await resolveOwnerContentSigner(ctx, owner)
			return commitTimelineEvent(ctx.username, owner, {
				type: 'post_delete',
				content: { targetPostId: id },
			}, signerOpts)
		},
		/**
		 * @param {number[]} optionIds 投票选项下标
		 * @returns {Promise<object>} poll_vote 事件
		 */
		async pollVote(optionIds) {
			await assertKnownPostTarget(ctx, owner)
			const choices = await assertPollVoteAllowed(ctx.username, owner, id, optionIds)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'poll_vote',
				content: { targetEntityHash: owner, targetPostId: id, choices },
			})
		},
		/**
		 * @param {string} text 补充正文
		 * @returns {Promise<object>} post_note 事件
		 */
		async addNote(text) {
			await assertKnownPostTarget(ctx, owner)
			const cleaned = String(text || '').trim().slice(0, 2000)
			if (!cleaned) throw httpError(400, 'note text required')
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'post_note',
				content: { targetEntityHash: owner, targetPostId: id, text: cleaned },
			})
		},
		/**
		 * @param {string} noteEventId 补充事件 id
		 * @param {boolean} helpful 是否有用
		 * @returns {Promise<object>} note_vote 事件
		 */
		async voteNote(noteEventId, helpful) {
			await assertKnownPostTarget(ctx, owner)
			const noteId = String(noteEventId || '').trim().toLowerCase()
			if (!noteId) throw httpError(400, 'noteEventId required')
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'note_vote',
				content: {
					targetEntityHash: owner,
					targetPostId: id,
					noteEventId: noteId,
					helpful: helpful === true,
				},
			})
		},
		/**
		 * @returns {Promise<{ notes: object[], topNote: object | null }>} 补充信息汇总
		 */
		async notes() {
			const { summarizeNotes } = await import('../federation/note_index.mjs')
			const { pullPostNotes } = await import('../federation/note_pull.mjs')
			await pullPostNotes(ctx.username, owner, id).catch(() => null)
			return summarizeNotes(ctx.username, owner, id)
		},
	}
}

/**
 * @param {import('./client.mjs').SocialApiContext} ctx 上下文
 * @param {string} owner 作者 entityHash
 * @returns {Promise<void>}
 */
async function assertKnownPostTarget(ctx, owner) {
	if (!await isKnownSocialTarget(ctx.username, owner))
		throw httpError(400, 'unknown entity')
}

/**
 * 作者自签 → 空 opts；所属主人外签 → `{ signerEntityHash }`。
 * @param {import('./client.mjs').SocialApiContext} ctx 上下文
 * @param {string} postOwner 帖作者 entityHash
 * @returns {Promise<{ signerEntityHash?: string }>} commit 选项
 */
async function resolveOwnerContentSigner(ctx, postOwner) {
	if (ctx.entityHash === postOwner) return {}
	const profile = await getEntityProfile(ctx.username, postOwner)
	const ownerEntity = String(profile?.ownerEntityHash || '').trim().toLowerCase()
	if (!ownerEntity || ownerEntity !== ctx.entityHash)
		throw httpError(403, 'can only manage own posts or owned entity posts')
	return { signerEntityHash: ctx.entityHash }
}
