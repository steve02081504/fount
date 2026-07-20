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
	const baseObj = channelMessageContentObject(base)
	const patchObj = channelMessageContentObject(patch)
	return channelMessageContentObject({
		...baseObj,
		...textChannelContent(String(patchObj.content ?? baseObj.content ?? ''), {
			content_for_show: patchObj.content_for_show ?? baseObj.content_for_show,
			content_for_edit: patchObj.content_for_edit ?? baseObj.content_for_edit,
		}),
		...patchObj,
	})
}

/**
 * @param {object} row 消息或 overlay 行
 * @returns {string} 目标消息 eventId
 */
function overlayTargetId(row) {
	return row.type === 'message'
		? String(row.eventId).trim()
		: String(row.content?.targetId ?? '').trim()
}

/**
 * 按目标 eventId 取行时一并带上指向它们的 overlay（edit/delete/feedback）。
 * @param {object[]} lines 频道原始行
 * @param {Iterable<string>} eventIds 目标 eventId
 * @returns {object[]} 过滤后的行
 */
export function linesIncludingOverlaysForTargets(lines, eventIds) {
	const want = new Set(
		[...eventIds].map(id => String(id || '').trim().toLowerCase()).filter(Boolean),
	)
	if (!want.size) return []
	return lines.filter(row => {
		const id = String(row?.eventId || '').trim().toLowerCase()
		if (want.has(id)) return true
		if (!OVERLAY_EVENT_TYPES.has(row?.type)) return false
		return want.has(String(row?.content?.targetId || '').trim().toLowerCase())
	})
}

/**
 * 将单条 message_edit 的 content 应用到已合并的展示行。
 * @param {object} row 展示用 message 行
 * @param {{ newContent?: object, fileCount?: number }} editContent message_edit.content
 * @returns {object} 更新后的行
 */
export function applyMessageEditToRow(row, editContent) {
	const patchContent = editContent?.newContent
	if (!row || !patchContent) return row
	const content = {
		...mergeMessageContent(row.content, patchContent),
		...editContent.fileCount != null ? { fileCount: editContent.fileCount } : {},
	}
	if ('is_generating' in patchContent)
		content.is_generating = !!patchContent.is_generating
	return { ...row, content, wasEdited: true }
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
	return row
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
