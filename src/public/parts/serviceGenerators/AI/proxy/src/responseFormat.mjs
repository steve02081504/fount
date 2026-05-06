import { escapeRegExp } from '../../../../../../scripts/regex.mjs'

/**
 * 清理 AI 文本响应中的 message/content 包裹标记。
 * @param {string} text - 原始响应文本。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 提示结构。
 * @returns {string} 清理后的纯文本。
 */
export function cleanupResponseText(text, prompt_struct) {
	if (text.match(/<\/sender>\s*<content>/))
		text = (text.match(/<\/sender>\s*<content>([\S\s]*)/)?.[1] ?? text).split(new RegExp(
			`(${(prompt_struct.alternative_charnames || []).map(
				s => s instanceof RegExp ? s.source : escapeRegExp(s)
			).join('|')})\\s*<\\/sender>\\s*<content>`
		)).pop().split(/<\/content>\s*<\/message/).shift()
	if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
		text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()
	text = text.replace(/^\s*<message[^>]*>\s*/, '').replace(/^\s*<content>\s*/, '')
	text = text.replace(/<\/content\s*>/, '').replace(/<\/message[^>]*>/, '').replace(/<\/\s*$/, '')
	return text
}

/**
 * 清理结果对象中的内容展示文本。
 * @param {{ content: string, content_for_show?: string }} res - 待清理的响应对象。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 提示结构。
 * @returns {{ content: string, content_for_show?: string }} 清理后的响应对象。
 */
export function clearFormat(res, prompt_struct) {
	res.content = cleanupResponseText(res.content, prompt_struct)
	if (res.content_for_show)
		res.content_for_show = cleanupResponseText(res.content_for_show, prompt_struct)
	return res
}
