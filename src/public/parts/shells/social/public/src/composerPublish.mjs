import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { readCwSensitive } from '/parts/shells:chat/shared/composerAttachmentFields.mjs'
import { geti18n, primaryLocale } from '/scripts/i18n/index.mjs'

import {
	clearComposer,
	refreshMediaPreview,
} from './composerState.mjs'
import { socialApi } from './lib/apiClient.mjs'
import { uploadMedia } from './media.mjs'
import { state } from './state.mjs'
import { readVisibilityPicker } from './visibilityPicker.mjs'

const SOCIAL_CW_IDS = { cwId: 'postContentWarning', sensitiveId: 'postSensitiveMedia' }

/**
 * 从 composer 表单构建发帖 API 请求体（媒体须已上传）。
 * @param {object[]} mediaRefs 已上传 refs
 * @returns {object} 发帖 body
 */
export function buildPostBody(mediaRefs = state.pendingMediaRefs) {
	const { contentWarning, sensitiveMedia } = readCwSensitive(SOCIAL_CW_IDS)
	const visibilityDraft = readVisibilityPicker(document.getElementById('composer'))
	const albumSelect = document.getElementById('postAlbumSelect')
	const albumIds = albumSelect instanceof HTMLSelectElement
		? [...albumSelect.selectedOptions].map(opt => opt.value).filter(id => id && id !== 'default')
		: []
	const body = {
		text: document.getElementById('postText').value.trim(),
		mediaRefs: mediaRefs.map(ref => {
			const { file: _file, objectUrl: _url, pending: _pending, ...rest } = ref
			return rest
		}),
		...visibilityDraft,
		...albumIds.length ? { albumIds } : {},
		locale: document.getElementById('postLocale').value.trim() || primaryLocale(),
		...contentWarning ? { contentWarning } : {},
		...sensitiveMedia ? { sensitiveMedia: true } : {},
	}
	if (state.pendingQuoteRef)
		body.quoteRef = {
			entityHash: state.pendingQuoteRef.entityHash,
			postId: state.pendingQuoteRef.postId,
		}
	if (state.pendingGroupRef)
		body.groupRef = {
			groupId: state.pendingGroupRef.groupId,
			channelId: state.pendingGroupRef.channelId,
		}
	if (state.pendingPoll)
		body.poll = state.pendingPoll

	const replyPolicy = document.getElementById('postReplyPolicy')?.value
	if (replyPolicy && replyPolicy !== 'everyone') body.replyPolicy = replyPolicy

	const replyDisplay = document.getElementById('postReplyDisplay')?.value
	if (replyDisplay && replyDisplay !== 'all') body.replyDisplay = replyDisplay

	const publishAtEl = document.getElementById('postPublishAt')
	if (publishAtEl instanceof HTMLInputElement && publishAtEl.value) {
		const ms = new Date(publishAtEl.value).getTime()
		if (!Number.isNaN(ms) && ms > Date.now()) body.publishAt = ms
	}

	return body
}

/**
 * @param {object[]} refs 待发布 refs
 * @returns {Promise<object[]>} 已上传 refs
 */
async function ensureUploadedMediaRefs(refs) {
	const out = []
	const pendingFiles = []
	const pendingIndexes = []
	for (const [index, ref] of refs.entries())
		if (ref.pending && ref.file instanceof Blob) {
			pendingFiles.push(ref.file)
			pendingIndexes.push(index)
			out.push(null)
		}
		else {
			const { file: _f, objectUrl: _o, pending: _p, ...rest } = ref
			out.push(rest)
		}

	if (pendingFiles.length) {
		const uploaded = await uploadMedia(pendingFiles)
		for (const [i, uploadedRef] of uploaded.entries()) {
			const original = refs[pendingIndexes[i]]
			out[pendingIndexes[i]] = {
				...uploadedRef,
				...original.alt ? { alt: original.alt } : {},
			}
		}
	}
	return out
}

/**
 * 将当前 composer 存入草稿箱（有 activeDraftId 则更新）。
 * @returns {Promise<object>} 写入后的草稿行
 */
export async function saveComposerDraft() {
	if (!document.getElementById('postText')?.value?.trim()
		&& !state.pendingMediaRefs.length
		&& !state.pendingPoll)
		throw new Error(geti18n('social.drafts.empty'))
	const uploadedRefs = await ensureUploadedMediaRefs(state.pendingMediaRefs)
	state.pendingMediaRefs = uploadedRefs.map(ref => ({ ...ref }))
	refreshMediaPreview()
	const body = buildPostBody(uploadedRefs)
	if (state.activeDraftId)
		body.draftId = state.activeDraftId
	const row = await socialApi('/drafts', { method: 'POST', body: JSON.stringify(body) })
	state.activeDraftId = row.draftId
	showToastI18n('success', 'social.drafts.saved')
	return row
}

/**
 * 提交发帖请求并清空 composer 状态。
 * @returns {Promise<void>}
 */
export async function publishPost() {
	if (!document.getElementById('postText').value.trim()
		&& !state.pendingMediaRefs.length
		&& !state.pendingPoll) return
	const uploadedRefs = await ensureUploadedMediaRefs(state.pendingMediaRefs)
	const body = buildPostBody(uploadedRefs)
	const isScheduled = !!body.publishAt
	const draftId = state.activeDraftId
	await socialApi('/posts', { method: 'POST', body: JSON.stringify(body) })
	if (draftId)
		await socialApi(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => {})
	await clearComposer()
	if (isScheduled)
		showToastI18n('success', 'social.composer.scheduleSuccess')
}
