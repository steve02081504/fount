import { httpError } from '../../../../../../scripts/http_error.mjs'
import { primaryLocaleForUser } from '../../../../../../scripts/locale.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { sanitizeMediaRefs, resolveSensitiveMedia } from '../lib/mediaRefs.mjs'
import { assertPollVoteAllowed } from '../lib/poll.mjs'
import { loadTaste } from '../taste/store.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'

/**
 * @param {import('./client/helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {Promise<boolean>} 是否公开反应
 */
async function shouldPublishReactions(apiContext) {
	const taste = await loadTaste(apiContext.username, apiContext.entityHash)
	return taste.privacy.publishReactions !== false
}

/**
 * @param {import('./client/helpers.mjs').SocialApiContext} apiContext API 上下文
 * @param {string} type 事件类型
 * @param {string} owner 帖作者
 * @param {string} id 帖 id
 * @returns {Promise<object>} 签名事件
 */
async function commitReaction(apiContext, type, owner, id) {
	await assertKnownPostTarget(apiContext, owner)
	const fanout = await shouldPublishReactions(apiContext)
	return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
		type,
		content: { targetEntityHash: owner, targetPostId: id },
	}, { fanout })
}

/**
 * 构造绑定到某帖的 Post 鸭子类型。
 * @param {import('./client/helpers.mjs').SocialApiContext} apiContext API 上下文
 * @param {string} entityHash 帖作者 entityHash
 * @param {string} postId 帖 id
 * @param {object} [snapshot] 可选已知快照（event / content）
 * @returns {object} Post
 */
export function createPost(apiContext, entityHash, postId, snapshot = null) {
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
			return commitReaction(apiContext, 'like', owner, id)
		},
		/**
		 * @returns {Promise<object>} unlike 事件
		 */
		async unlike() {
			return commitReaction(apiContext, 'unlike', owner, id)
		},
		/**
		 * @returns {Promise<object>} dislike 事件（与 like 互斥，reducer 侧清 like）
		 */
		async dislike() {
			return commitReaction(apiContext, 'dislike', owner, id)
		},
		/**
		 * @returns {Promise<object>} undislike 事件
		 */
		async undislike() {
			return commitReaction(apiContext, 'undislike', owner, id)
		},
		/**
		 * @param {string} [comment] 转发附言
		 * @returns {Promise<object>} repost 事件
		 */
		async repost(comment = '') {
			await assertKnownPostTarget(apiContext, owner)
			return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
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
			const view = await getTimelineMaterialized(apiContext.username, owner)
			const post = view.postById[id]
			if (!post) throw httpError(404, 'post not found')
			const signerOpts = await resolveOwnerContentSigner(apiContext, owner)
			const decrypted = await maybeDecryptPostContent(apiContext.username, owner, post.content) || post.content || {}
			const visibility = decrypted.visibility || post.content?.visibility || 'public'
			const draftContent = {
				targetPostId: id,
				text: String(patch.text ?? decrypted.text ?? ''),
				mediaRefs: sanitizeMediaRefs(patch.mediaRefs ?? decrypted.mediaRefs),
				locale: patch.locale || decrypted.locale || primaryLocaleForUser(apiContext.username),
				...patch.contentWarning !== undefined
					? { contentWarning: String(patch.contentWarning).trim().slice(0, 200) }
					: decrypted.contentWarning ? { contentWarning: decrypted.contentWarning } : {},
				...resolveSensitiveMedia(
					patch.sensitiveMedia !== undefined ? patch.sensitiveMedia : decrypted.sensitiveMedia,
					patch.contentWarning !== undefined ? patch.contentWarning : decrypted.contentWarning,
				) ? { sensitiveMedia: true } : {},
			}
			return commitTimelineEvent(apiContext.username, owner, {
				type: 'post_edit',
				content: await maybeEncryptPostContent(apiContext.username, owner, id, draftContent, visibility),
			}, signerOpts)
		},
		/**
		 * 删除帖子：作者自签，或作者所属主人以自身钥签到作者时间线。
		 * @returns {Promise<object>} post_delete 事件
		 */
		async delete() {
			const view = await getTimelineMaterialized(apiContext.username, owner)
			if (!view.postById[id]) throw httpError(404, 'post not found')
			const signerOpts = await resolveOwnerContentSigner(apiContext, owner)
			return commitTimelineEvent(apiContext.username, owner, {
				type: 'post_delete',
				content: { targetPostId: id },
			}, signerOpts)
		},
		/**
		 * @param {number[]} optionIds 投票选项下标
		 * @returns {Promise<object>} poll_vote 事件
		 */
		async pollVote(optionIds) {
			await assertKnownPostTarget(apiContext, owner)
			const choices = await assertPollVoteAllowed(apiContext.username, owner, id, optionIds)
			return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
				type: 'poll_vote',
				content: { targetEntityHash: owner, targetPostId: id, choices },
			})
		},
		/**
		 * @param {string} text 补充正文
		 * @returns {Promise<object>} post_note 事件
		 */
		async addNote(text) {
			await assertKnownPostTarget(apiContext, owner)
			const cleaned = String(text || '').trim().slice(0, 2000)
			if (!cleaned) throw httpError(400, 'note text required')
			return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
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
			await assertKnownPostTarget(apiContext, owner)
			const noteId = String(noteEventId || '').trim().toLowerCase()
			if (!noteId) throw httpError(400, 'noteEventId required')
			return commitTimelineEvent(apiContext.username, apiContext.entityHash, {
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
			const { summarizeNotes } = await import('../federation/note/index.mjs')
			const { pullPostNotes } = await import('../federation/note/pull.mjs')
			await pullPostNotes(apiContext.username, owner, id).catch(() => null)
			return summarizeNotes(apiContext.username, owner, id)
		},
		/**
		 * 作者精选 / 取消精选回复。
		 * @param {{ replierEntityHash: string, replyPostId: string, feature?: boolean }} options 选项
		 * @returns {Promise<object>} 事件
		 */
		async featureReply(options = {}) {
			const signerOpts = await resolveOwnerContentSigner(apiContext, owner)
			const replierEntityHash = String(options.replierEntityHash || '').trim().toLowerCase()
			const replyPostId = String(options.replyPostId || '').trim()
			if (!replierEntityHash || !replyPostId) throw httpError(400, 'replierEntityHash and replyPostId required')
			return commitTimelineEvent(apiContext.username, owner, {
				type: options.feature === false ? 'reply_unfeature' : 'reply_feature',
				content: { targetPostId: id, replierEntityHash, replyPostId },
			}, signerOpts)
		},
	}
}

/**
 * @param {import('./client/helpers.mjs').SocialApiContext} apiContext 上下文
 * @param {string} owner 作者 entityHash
 * @returns {Promise<void>}
 */
async function assertKnownPostTarget(apiContext, owner) {
	if (!await isKnownSocialTarget(apiContext.username, owner))
		throw httpError(400, 'unknown entity')
}

/**
 * 作者自签 → 空 options；所属主人外签 → `{ signerEntityHash }`。
 * @param {import('./client/helpers.mjs').SocialApiContext} apiContext 上下文
 * @param {string} postOwner 帖作者 entityHash
 * @returns {Promise<{ signerEntityHash?: string }>} commit 选项
 */
async function resolveOwnerContentSigner(apiContext, postOwner) {
	if (apiContext.entityHash === postOwner) return {}
	const profile = await getEntityProfile(apiContext.username, postOwner)
	const ownerEntity = String(profile?.ownerEntityHash || '').trim().toLowerCase()
	if (!ownerEntity || ownerEntity !== apiContext.entityHash)
		throw httpError(403, 'can only manage own posts or owned entity posts')
	return { signerEntityHash: apiContext.entityHash }
}
