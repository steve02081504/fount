import { avatarColor, avatarInitial, escapeHtml, formatTime } from './domUtils.mjs'

/**
 * 从消息对象中提取纯文本内容。
 * @param {{ content?: * }} message 群组或频道消息
 * @returns {string} 展示用文本
 */
export function getMessageText(message) {
	if (typeof message.content === 'string') return message.content
	if (message.content?.text) return message.content.text
	return JSON.stringify(message.content)
}

/**
 * 解析 `[join:问候语]` 格式的系统消息正文。
 * @param {string} [text] 消息文本
 * @returns {string|null} 问候语片段；不匹配则为 null
 */
export function parseJoinMessage(text) {
	const match = String(text || '').match(/^\[join:([^\]]+)\]$/)
	return match ? match[1] : null
}

/**
 * 渲染入群欢迎类系统消息的 HTML 行。
 * @param {{ id?: string, sender?: string, timestamp?: number, content?: * }} message 消息对象
 * @returns {string} 系统消息行的 HTML 字符串
 */
export function renderJoinSystemRow(message) {
	const sender = message.sender || '?'
	const time = message.timestamp || 0
	const greeting = parseJoinMessage(getMessageText(message)) || '加入了对话'
	return `
<div class="hub-system-message" data-message-id="${message.id}">
<span><span class="hub-system-author">${escapeHtml(sender)}</span> ${
	escapeHtml(greeting)
}</span>
<span class="hub-system-time">${formatTime(time)}</span>
</div>
`
}

/**
 * 将纯文本转为可插入消息区的 HTML（贴纸/图片占位等）。
 * @param {string} text 原始消息文本
 * @returns {string} 带内联标签的 HTML
 */
export function renderMessageContent(text) {
	let html = escapeHtml(text)
	html = html.replace(/\[sticker:([^\]|]+)\|([^\]]+)\]/g, (match, stickerId, stickerUrl) => {
		void match
		const safeUrl = stickerUrl.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		return `<img src="${safeUrl}" alt="${escapeHtml(stickerId)}" style="max-width:120px;max-height:120px;" />`
	})
	html = html.replace(
		/\[sticker:([^\]]+)\]/g,
		() => '<span style="opacity:0.7">🖼️ 贴纸</span>',
	)
	html = html.replace(/\[image:([^\]|]+)\|([^\]]+)\]/g, (match, fileName, imageUrl) => {
		void match
		const safeUrl = imageUrl.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		return `<img src="${safeUrl}" alt="${escapeHtml(fileName)}" onclick="window.open('${safeUrl}','_blank')" style="cursor:pointer" />`
	})
	return html
}

/**
 * 渲染单条频道消息块（含入群系统行）。
 * @param {object} message 消息
 * @param {string|null} prevSender 上一条发送者
 * @param {number} prevTime 上一条时间戳
 * @returns {{ html: string, sender: string|null, time: number }} 单条 HTML 与分组游标
 */
export function renderChannelMessageBlock(message, prevSender, prevTime) {
	if (parseJoinMessage(getMessageText(message)))
		return { html: renderJoinSystemRow(message), sender: null, time: 0 }

	const sender = message.sender || '?'
	const time = message.timestamp || 0
	const isFirst = sender !== prevSender || (time - prevTime) > 5 * 60 * 1000
	return {
		html: `
<div class="hub-message ${isFirst ? 'first-in-group' : ''}" data-message-id="${message.id}">
<div class="hub-avatar" data-avatar-for="${escapeHtml(sender)}" style="background: ${avatarColor(sender)};">${escapeHtml(avatarInitial(sender))}</div>
<div class="hub-message-body">
<div class="hub-message-header">
<span class="hub-message-author">${escapeHtml(sender)}</span>
<span class="hub-message-time">${formatTime(time)}</span>
</div>
<div class="hub-message-content">${renderMessageContent(getMessageText(message))}</div>
</div>
</div>
`,
		sender,
		time,
	}
}

/**
 * 将消息数组渲染为消息列表 HTML。
 * @param {Array<{ id?: string, sender?: string, timestamp?: number, content?: * }>} messages 消息列表
 * @returns {string} 消息区 HTML 字符串
 */
export function renderMessages(messages) {
	let html = ''
	let prevSender = null
	let prevTime = 0
	for (const message of messages) {
		const block = renderChannelMessageBlock(message, prevSender, prevTime)
		html += block.html
		prevSender = block.sender
		prevTime = block.time
	}
	return html
}

/**
 * 增量拼接新消息的 HTML（轮询追加用）。
 * @param {object[]} messages 新消息
 * @param {string|null} prevSender 容器内最后一条发送者
 * @param {number} [prevTime] 上一条时间戳
 * @returns {{ html: string, sender: string|null, time: number }} 拼接 HTML 与最终游标
 */
export function appendChannelMessagesHtml(messages, prevSender, prevTime = 0) {
	let html = ''
	let sender = prevSender
	let time = prevTime
	for (const message of messages) {
		const block = renderChannelMessageBlock(message, sender, time)
		html += block.html
		sender = block.sender
		time = block.time
	}
	return { html, sender, time }
}
