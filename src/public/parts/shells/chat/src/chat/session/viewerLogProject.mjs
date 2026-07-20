/**
 * 【文件】viewerLogProject.mjs — viewer entries → 频道行 DTO 投影（纯函数，无 I/O）
 * 【职责】按 dagEventId 可见集投影；改写覆盖 text content；overlay 行透传。
 * 【关联】materializeViewerLog、pure 测试。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

import {
	channelMessageAgentText,
	channelMessageShowText,
	textChannelContent,
} from '../../../public/shared/channelContent.mjs'

/**
 * 将 viewer 过滤后的 entries 投影回频道消息行 DTO。
 * @param {object[]} rawLines 原始频道行（含 overlay）
 * @param {chatLogEntry_t[]} entries 视图化后的日志条目
 * @returns {object[]} 与 /messages 同形的行（隐藏 message 丢弃；改写覆盖正文；overlay 透传）
 */
export function projectViewerEntriesToRows(rawLines, entries) {
	/** @type {Map<string, chatLogEntry_t>} */
	const byEventId = new Map()
	for (const entry of entries) {
		const eventId = entry.extension?.dagEventId
		if (eventId) byEventId.set(String(eventId), entry)
	}

	const out = []
	for (const line of rawLines) {
		if (line.type !== 'message') {
			out.push(line)
			continue
		}
		const eventId = line.eventId && String(line.eventId)
		if (!eventId || !byEventId.has(eventId)) continue

		const entry = byEventId.get(eventId)
		const { content } = line
		// decryptView 失败行 content 为 null；非 text 类（贴纸/投票等）不做正文改写
		if (content?.type !== 'text') {
			out.push(line)
			continue
		}

		const originalAgent = channelMessageAgentText(content)
		const originalShow = channelMessageShowText(content)
		const nextAgent = String(entry.content ?? '')
		const nextShow = String(entry.content_for_show ?? entry.content ?? '')
		const rewritten = nextAgent !== originalAgent || nextShow !== originalShow

		if (!rewritten) {
			out.push(line)
			continue
		}

		const {
			content: _omitContent,
			content_for_show: _omitShow,
			content_for_edit: _omitEdit,
			...restContent
		} = content
		const nextContent = textChannelContent(nextAgent, {
			...restContent,
			...nextShow !== nextAgent ? { content_for_show: nextShow } : {},
			...entry.content_for_edit != null ? { content_for_edit: String(entry.content_for_edit) } : {},
		})
		out.push({
			...line,
			content: nextContent,
			extension: {
				...line.extension || {},
				viewerRewritten: true,
			},
		})
	}
	return out
}
