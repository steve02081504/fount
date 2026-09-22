import { escapeRegExp } from '../../../../../../scripts/regex.mjs'

/** 整行仅由 message/sender/content 信封标记组成（允许重复 / 嵌套闭合）的判定。 */
const ENVELOPE_ONLY_LINE = /^\s*(?:<\/?(?:message\b[^>]*|sender\b[^>]*|content\b[^>]*)>\s*)+$/
/** 整行形如 `<sender>名字</sender>`（无其它正文）的判定。 */
const SENDER_ONLY_LINE = /^\s*<sender\b[^>]*>[^<]*<\/sender\s*>\s*$/
/** 单个信封标记（用于首尾残留清理）。 */
const ENVELOPE_TOKEN = '</?(?:message\\b[^>]*|sender\\b[^>]*|content\\b[^>]*)>'
/** `</sender>` 与 `<content>` 之间的消息边界。 */
const SENDER_CONTENT_BOUNDARY = /<\/sender>\s*<content\b[^>]*>/g

/**
 * 清理 AI 文本响应中的 message/content 包裹标记。
 *
 * 提示词里每条消息都会包成 `<message "uid"><sender>名字</sender><content>正文</content></message "uid">`；
 * 模型有时会把这段信封回显或续写到自己的回复中。此处把任意位置的残留信封标记剥离：
 * 只保留最后一处 sender/content 边界之后的正文，删掉整行信封标记与 `<sender>名字</sender>`，
 * 并去掉首尾残留的标记 / 半截标签。
 * @param {string} text - 原始响应文本。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} [prompt_struct] - 提示结构（用于按角色名定位消息边界）。
 * @returns {string} 清理后的纯文本。
 */
export function cleanupResponseText(text, prompt_struct) {
	if (typeof text !== 'string') return text

	// 1) 回显整段上下文信封时，只保留最后一处 sender/content 边界之后的正文
	const names = (prompt_struct?.alternative_charnames || []).map(
		s => s instanceof RegExp ? s.source : escapeRegExp(s)
	)
	let boundary = null
	if (names.length) {
		const charBoundaries = [...text.matchAll(new RegExp(`(?:${names.join('|')})\\s*<\\/sender>\\s*<content\\b[^>]*>`, 'g'))]
		boundary = charBoundaries.at(-1) ?? null
	}
	boundary ??= [...text.matchAll(SENDER_CONTENT_BOUNDARY)].at(-1) ?? null

	let out = text
	if (boundary) {
		out = out.slice(boundary.index + boundary[0].length)
		const end = out.search(/<\/content\s*>\s*<\/message\b/)
		if (end !== -1) out = out.slice(0, end)
	}

	// 2) 删除整行仅由信封标记组成的行与 `<sender>名字</sender>` 行
	out = out.split('\n').filter(line => !ENVELOPE_ONLY_LINE.test(line) && !SENDER_ONLY_LINE.test(line)).join('\n')

	// 3) 去掉首尾仍残留的信封标记（含流式半截）与结尾孤立的 `</`
	return out
		.replace(new RegExp(`^\\s*(?:${ENVELOPE_TOKEN}\\s*)+`), '')
		.replace(new RegExp(`(?:\\s*${ENVELOPE_TOKEN})+\\s*$`), '')
		.replace(/<\/\s*$/, '')
}

/**
 * 清理结果对象中的内容展示文本。
 * @param {{ content: string, content_for_show?: string }} res - 待清理的响应对象。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} [prompt_struct] - 提示结构。
 * @returns {{ content: string, content_for_show?: string }} 清理后的响应对象。
 */
export function clearFormat(res, prompt_struct) {
	res.content = cleanupResponseText(res.content, prompt_struct)
	if (res.content_for_show)
		res.content_for_show = cleanupResponseText(res.content_for_show, prompt_struct)
	return res
}
