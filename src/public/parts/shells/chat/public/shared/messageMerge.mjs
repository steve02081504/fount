import { channelMessageContentObject, isTextChannelContent, textChannelContent } from './channelContent.mjs'

const OVERLAY_EVENT_TYPES = new Set(['message_edit', 'message_delete', 'message_feedback'])

/**
 * @param {object | undefined} base 原消息 content
 * @param {object | undefined} patch 编辑快照
 * @returns {object} 合并后的 content
 */
function mergeMessageContent(base, patch) {
	if (!isTextChannelContent(base) && !isTextChannelContent(patch))
		return { ...base, ...patch }
	if (!isTextChannelContent(base) || !isTextChannelContent(patch))
		throw new Error('text edit patch requires type text message')
	return channelMessageContentObject(textChannelContent(
		String(patch.content ?? base.content ?? ''),
		{
			content_for_show: patch.content_for_show ?? base.content_for_show,
			content_for_edit: patch.content_for_edit ?? base.content_for_edit,
		},
	))
}

/**
 * @param {object} row 消息或 overlay 行
 * @returns {string} 目标消息 eventId
 */
function overlayTargetId(row) {
	return row.type === 'message'
		? String(row.eventId).trim()
		: String(row.content.targetId).trim()
}

/**
 * @param {object} row 展示行
 * @returns {object} 带 decryptView 的行
 */
function attachDecryptView(row) {
	if (row.decryptView?.failed) {
		const { pendingGeneration, pending, ...rest } = row.decryptView
		const gen = pendingGeneration ?? pending ?? undefined
		return {
			...row,
			decryptView: {
				failed: true,
				...gen != null ? { pendingGeneration: gen } : {},
			},
		}
	}
	const content = row.content
	if (!content?.decryptFailed) return row
	const { decryptFailed, pendingGeneration, ...rest } = content
	return {
		...row,
		content: Object.keys(rest).length ? rest : null,
		decryptView: {
			failed: true,
			...pendingGeneration != null ? { pendingGeneration } : {},
		},
	}
}

/**
 * @param {object} row 原始 message 行
 * @param {object | null} feedback 反馈 overlay
 * @returns {object} 带 extension.feedback 的行
 */
function withFeedback(row, feedback) {
	if (!feedback?.content?.feedbackType) return row
	return {
		...row,
		extension: {
			...row.extension,
			feedback: {
				type: feedback.content.feedbackType,
				content: feedback.content.feedbackContent || '',
			},
		},
	}
}

/**
 * @param {object[]} messages 频道原始行（含 overlay 事件）
 * @returns {object[]} 折叠后的展示行
 */
export function mergeChannelMessagesForDisplay(messages) {
	const edits = new Map()
	const deleted = new Set()
	const feedbackByTarget = new Map()
	for (const row of messages) {
		const targetId = overlayTargetId(row)
		if (!targetId) continue
		if (row.type === 'message_edit') edits.set(targetId, row.content)
		if (row.type === 'message_delete') deleted.add(targetId)
		if (row.type === 'message_feedback') feedbackByTarget.set(targetId, row)
	}
	const merged = []
	const seenMessageIds = new Set()
	for (const row of messages) {
		if (OVERLAY_EVENT_TYPES.has(row.type)) continue
		if (row.type !== 'message') {
			merged.push(row)
			continue
		}
		const messageIdKey = String(row.eventId).trim().toLowerCase()
		if (messageIdKey) {
			if (seenMessageIds.has(messageIdKey)) continue
			seenMessageIds.add(messageIdKey)
		}
		const targetId = overlayTargetId(row)
		if (targetId && deleted.has(targetId)) continue
		const feedback = targetId ? feedbackByTarget.get(targetId) : null
		if (targetId && edits.has(targetId)) {
			const patch = edits.get(targetId)
			const patchContent = patch?.newContent
			if (patchContent) {
				const content = {
					...mergeMessageContent(row.content, patchContent),
					...patch.fileCount != null ? { fileCount: patch.fileCount } : {},
				}
				if ('is_generating' in patchContent)
					content.is_generating = !!patchContent.is_generating
				merged.push(withFeedback(attachDecryptView({ ...row, content, wasEdited: true }), feedback))
				continue
			}
		}
		merged.push(withFeedback(attachDecryptView(row), feedback))
	}
	return merged
}
