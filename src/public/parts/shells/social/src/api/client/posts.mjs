import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { primaryLocaleForUser } from '../../../../../../../scripts/locale.mjs'
import { resolveSocialEntity } from '../../federation/hosting.mjs'
import { buildPostFeedItem } from '../../feed/buildItem.mjs'
import { createFeedItemBuildContext } from '../../feed/iterate.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'
import { buildEmojiMediaRefsForPost } from '../../lib/emojiPostEmbed.mjs'
import { isKnownSocialTarget } from '../../lib/entityTarget.mjs'
import { sanitizeMediaRefs, resolveSensitiveMedia } from '../../lib/mediaRefs.mjs'
import { normalizePollDraft } from '../../lib/poll.mjs'
import {
	minVisibilitySpec,
	normalizeVisibilitySpec,
	visibilitySpecToContentFields,
} from '../../lib/visibilitySpec.mjs'
import { commitTimelineEvent } from '../../timeline/append.mjs'
import { getTimelineMaterialized } from '../../timeline/materialize.mjs'
import { maybeDecryptPostContent, maybeEncryptPostContent } from '../../vault_crypto/vault.mjs'
import { pushFeedUpdate } from '../../ws/feedHub.mjs'
import { createPost } from '../post.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} 发帖 / 取帖 / 定时帖方法
 */
export function createPostsMethods(apiContext) {
	return {
		/**
		 * 发帖或按 id 取帖：`post({ text })` → Post；`post(entityHash, postId)` → Post。
		 * @param {object | string} arg1 发帖草稿或作者 entityHash
		 * @param {string} [postId] 取帖时的 postId
		 * @returns {Promise<object>} Post
		 */
		async post(arg1, postId) {
			if (typeof arg1 === 'string')
				return this.getPost(arg1, postId)
			return createTimelinePost(apiContext, arg1 || {})
		},
		/**
		 * @param {string} entityHash 作者
		 * @param {string} id 帖 id
		 * @returns {Promise<object>} Post
		 */
		async getPost(entityHash, id) {
			const owner = String(entityHash).toLowerCase()
			const view = await getTimelineMaterialized(apiContext.username, owner)
			const row = view.postById[String(id)]
			const content = row
				? await maybeDecryptPostContent(apiContext.username, owner, row.content, apiContext.entityHash) || row.content
				: null
			if (row) {
				const { pullPostReactions } = await import('../../federation/reaction/pull.mjs')
				void pullPostReactions(apiContext.username, owner, String(id)).catch(() => null)
			}
			return createPost(apiContext, owner, id, { content, event: row || null })
		},
		/**
		 * @returns {Promise<object[]>} 定时发帖列表
		 */
		async listScheduledPosts() {
			const { listScheduledPosts } = await import('../../lib/scheduledPosts.mjs')
			return listScheduledPosts(apiContext.username, apiContext.entityHash)
		},
		/**
		 * @param {string} scheduledId id
		 * @returns {Promise<object | null>} 取消项
		 */
		async cancelScheduledPost(scheduledId) {
			const { cancelScheduledPost } = await import('../../lib/scheduledPosts.mjs')
			const { cancelScheduledPostTimer } = await import('../../lib/scheduledPostWatcher.mjs')
			const removed = cancelScheduledPost(apiContext.username, apiContext.entityHash, scheduledId)
			if (removed) cancelScheduledPostTimer(apiContext.username, apiContext.entityHash, scheduledId)
			return removed
		},
	}
}

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext 上下文
 * @param {object} draft 发帖草稿
 * @returns {Promise<object>} Post
 */
async function createTimelinePost(apiContext, draft) {
	await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
	const resolved = await resolveSocialEntity(apiContext.entityHash, apiContext.username)
	const charPartName = draft.charPartName
		|| apiContext.charPartName
		|| (resolved?.kind === 'agent' ? resolved.charPartName : null)

	const publishAt = draft.publishAt != null ? Number(draft.publishAt) : NaN
	if (Number.isFinite(publishAt) && publishAt > Date.now()) {
		const { enqueueScheduledPost } = await import('../../lib/scheduledPosts.mjs')
		const { scheduleOneScheduledPost } = await import('../../lib/scheduledPostWatcher.mjs')
		const storedDraft = { ...draft }
		delete storedDraft.publishAt
		const row = enqueueScheduledPost(apiContext.username, apiContext.entityHash, storedDraft, publishAt)
		scheduleOneScheduledPost(apiContext.username, apiContext.entityHash, row)
		return { scheduled: true, scheduledId: row.scheduledId, publishAt: row.publishAt }
	}

	const albumIds = [...new Set(
		(Array.isArray(draft.albumIds) ? draft.albumIds : [])
			.map(id => String(id || '').trim())
			.filter(id => id && id !== 'default'),
	)]
	let visibilitySpec = normalizeVisibilitySpec(draft)
	if (albumIds.length) {
		const view = await getTimelineMaterialized(apiContext.username, apiContext.entityHash)
		const albumSpecs = []
		for (const albumId of albumIds) {
			const album = view.albums?.[albumId]
			if (!album) throw httpError(400, `unknown album: ${albumId}`)
			albumSpecs.push(album)
		}
		visibilitySpec = minVisibilitySpec(albumSpecs) || visibilitySpec
	}
	const { normalizeReplyPolicy, normalizeReplyDisplay, canReplyUnderPolicy, loadPostReplyGate } = await import('../../lib/replyPolicy.mjs')
	const replyPolicy = normalizeReplyPolicy(draft.replyPolicy)
	const replyDisplay = normalizeReplyDisplay(draft.replyDisplay)

	if (draft.replyTo?.entityHash && draft.replyTo?.postId) {
		const targetOwner = String(draft.replyTo.entityHash).toLowerCase()
		if (!await isKnownSocialTarget(apiContext.username, targetOwner))
			throw httpError(400, 'unknown entity')
		const gate = await loadPostReplyGate(apiContext.username, targetOwner, String(draft.replyTo.postId))
		if (!gate) throw httpError(404, 'reply target not found')
		const allowed = await canReplyUnderPolicy({
			username: apiContext.username,
			authorEntityHash: targetOwner,
			replierEntityHash: apiContext.entityHash,
			replyPolicy: gate.replyPolicy,
		})
		if (!allowed) throw httpError(403, 'reply not allowed by author policy')
	}

	const draftContent = {
		text: String(draft.text ?? ''),
		mediaRefs: sanitizeMediaRefs([
			...draft.mediaRefs ?? [],
			...await buildEmojiMediaRefsForPost(apiContext.username, String(draft.text ?? '')),
		]),
		replyTo: draft.replyTo,
		quoteRef: draft.quoteRef,
		groupRef: draft.groupRef,
		locale: draft.locale || primaryLocaleForUser(apiContext.username),
		...visibilitySpecToContentFields(visibilitySpec),
		...replyPolicy !== 'everyone' ? { replyPolicy } : {},
		...replyDisplay !== 'all' ? { replyDisplay } : {},
		...draft.contentWarning ? { contentWarning: String(draft.contentWarning).trim().slice(0, 200) } : {},
		...resolveSensitiveMedia(draft.sensitiveMedia, draft.contentWarning) ? { sensitiveMedia: true } : {},
	}
	if (Array.isArray(draft.tags)) {
		const tags = [...new Set(draft.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 16)
		if (tags.length) draftContent.tags = tags
	}
	if (draft.poll)
		draftContent.poll = normalizePollDraft(draft.poll)

	const signed = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
		type: 'post',
		charPartName,
		content: await maybeEncryptPostContent(
			apiContext.username,
			apiContext.entityHash,
			randomUUID(),
			draftContent,
			visibilitySpec,
		),
	})
	for (const albumId of albumIds) 
		await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
			type: 'album_post_add',
			content: { albumId, postId: signed.id },
		})
	
	const itemContext = await createFeedItemBuildContext(apiContext.username, new Set([apiContext.entityHash]), apiContext.entityHash)
	const item = await buildPostFeedItem(apiContext.username, apiContext.entityHash, { ...signed, postId: signed.id }, itemContext)
	pushFeedUpdate(apiContext.username, { type: 'post', item })
	return createPost(apiContext, apiContext.entityHash, signed.id, { event: signed, content: draftContent })
}
