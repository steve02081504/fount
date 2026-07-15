import { httpError } from '../../../../../../scripts/http_error.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { assertPollVoteAllowed } from '../lib/poll.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'

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
			await assertKnownPostTarget(ctx, owner)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'like',
				content: { targetEntityHash: owner, targetPostId: id },
			})
		},
		/**
		 * @returns {Promise<object>} unlike 事件
		 */
		async unlike() {
			await assertKnownPostTarget(ctx, owner)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'unlike',
				content: { targetEntityHash: owner, targetPostId: id },
			})
		},
		/**
		 * @returns {Promise<object>} dislike 事件（与 like 互斥，reducer 侧清 like）
		 */
		async dislike() {
			await assertKnownPostTarget(ctx, owner)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'dislike',
				content: { targetEntityHash: owner, targetPostId: id },
			})
		},
		/**
		 * @returns {Promise<object>} undislike 事件
		 */
		async undislike() {
			await assertKnownPostTarget(ctx, owner)
			return commitTimelineEvent(ctx.username, ctx.entityHash, {
				type: 'undislike',
				content: { targetEntityHash: owner, targetPostId: id },
			})
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
		 * @param {{ text?: string, mediaRefs?: object[], lang?: string, contentWarning?: string }} patch 编辑补丁
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
				mediaRefs: patch.mediaRefs ?? decrypted.mediaRefs,
				lang: patch.lang || decrypted.lang || 'zh-CN',
				...patch.contentWarning !== undefined
					? { contentWarning: String(patch.contentWarning).trim().slice(0, 200) }
					: decrypted.contentWarning ? { contentWarning: decrypted.contentWarning } : {},
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
