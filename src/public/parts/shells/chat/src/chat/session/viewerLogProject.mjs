/**
 * 【文件】viewerLogProject.mjs — viewer entries → 频道行 DTO 投影（纯函数，无 I/O）
 * 【职责】按 extension.chat.eventId 可见集投影；改写覆盖 content/content_for_show；overlay 行透传。
 * 【关联】materializeViewerLog、pure 测试。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

import {
	channelMessage,
	messageAgentText,
	messageShowText,
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
		const eventId = entry.extension?.chat?.eventId
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
		if (!content || content.type && content.type !== 'text') {
			out.push(line)
			continue
		}

		const nextAgent = String(entry.content ?? '')
		const nextShow = String(entry.content_for_show ?? entry.content ?? '')
		if (nextAgent === messageAgentText(content) && nextShow === messageShowText(content)) {
			out.push(line)
			continue
		}

		const extra = { ...content }
		delete extra.content
		delete extra.content_for_show
		delete extra.content_for_edit
		out.push({
			...line,
			content: channelMessage(nextAgent, {
				...extra,
				...nextShow !== nextAgent ? { content_for_show: nextShow } : {},
				...entry.content_for_edit != null ? { content_for_edit: String(entry.content_for_edit) } : {},
			}),
			extension: {
				...line.extension,
				viewerRewritten: true,
			},
		})
	}
	return out
}
