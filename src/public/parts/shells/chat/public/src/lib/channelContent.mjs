/**
 * 【文件】public/src/lib/channelContent.mjs
 * 【职责】频道 DAG 消息 content 对象规范（浏览器与 Deno 共用）：type 必填，text 三分字段。
 * 【原理】textChannelContent 组装 agent/show/edit 文本；channelMessageContentObject 规范化传入对象。
 * 【数据结构】{ type:'text', content, content_for_show?, content_for_edit? } 及扩展字段。
 * 【关联】api/groupChannel.mjs、src/chat/lib/messageMerge.mjs；后端消息校验。
 */
/** @typedef {'text' | 'sticker' | 'vote' | 'group_invite'} ChannelContentType */

/**
 * @param {object} content 消息 content
 * @returns {ChannelContentType} 内容类型
 */
export function channelContentType(content) {
	const { type } = content
	if (type === 'text' || type === 'sticker' || type === 'vote' || type === 'group_invite') return type
	throw new Error(`unknown content.type: ${type}`)
}

/**
 * @param {object} content 消息 content
 * @returns {boolean} 是否为文本类载荷
 */
export function isTextChannelContent(content) {
	return channelContentType(content) === 'text'
}

/**
 * @param {Record<string, unknown>} raw 已含 `type: 'text'` 的对象
 * @returns {Record<string, unknown>} 校验后的文本载荷
 */
function finalizeTextChannelContent(raw) {
	if (raw.type !== 'text') throw new Error('expected type text')
	if (typeof raw.content !== 'string') throw new Error('text content requires string content field')
	const out = { ...raw, type: 'text', content: raw.content }
	if (out.content_for_show === out.content) delete out.content_for_show
	if (out.content_for_edit === out.content) delete out.content_for_edit
	if (!out.displayName?.trim()) delete out.displayName
	if (!out.displayAvatar?.trim()) delete out.displayAvatar
	return out
}

/**
 * @param {string} agentText agent 正文
 * @param {{ content_for_show?: string, content_for_edit?: string } & Record<string, unknown>} [extra] 其它字段（fileIds 等）
 * @returns {Record<string, unknown>} `type: 'text'` 载荷
 */
export function textChannelContent(agentText, extra = {}) {
	const { content_for_show, content_for_edit, ...rest } = extra
	return finalizeTextChannelContent({
		type: 'text',
		content: agentText,
		...rest,
		...content_for_show != null ? { content_for_show: String(content_for_show) } : {},
		...content_for_edit != null ? { content_for_edit: String(content_for_edit) } : {},
	})
}

/**
 * @param {object} input 写入 DAG 的 content
 * @returns {Record<string, unknown>} 校验后的对象
 */
export function channelMessageContentObject(input) {
	if (input.type === 'text') return finalizeTextChannelContent(input)
	channelContentType(input)
	return { ...input }
}

/**
 * @param {object} content 消息 content
 * @returns {string} agent 正文
 */
export function channelMessageAgentText(content) {
	if (content?.type === 'vote') return String(content.question || '').trim()
	if (content?.type !== 'text') return ''
	return String(content.content)
}

/**
 * @param {object} content 消息 content
 * @returns {string} 给人看的正文
 */
export function channelMessageShowText(content) {
	if (content?.type === 'vote') return String(content.question || '').trim()
	if (content?.type !== 'text') return ''
	return String(content.content_for_show ?? content.content)
}

/**
 * @param {object} content 消息 content
 * @returns {string} 给人编辑的正文
 */
export function channelMessageEditText(content) {
	if (content?.type !== 'text') return ''
	return String(content.content_for_edit ?? content.content)
}

/**
 * @param {object} content 消息 content
 * @returns {string} 展示/搜索用正文
 */
export function channelMessageText(content) {
	return channelMessageShowText(content)
}
